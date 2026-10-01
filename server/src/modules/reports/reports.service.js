import mongoose from 'mongoose';
import {
  APARTMENT_STATUS,
  BOOKING_STATUS,
  FUND_TX_TYPES,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  REVIEW_STATUS,
  TICKET_STATUS,
  WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import {
  Amenity,
  Apartment,
  Asset,
  Booking,
  DebtFollowup,
  FundProposal,
  FundTransaction,
  Invoice,
  MaintenanceFund,
  Payment,
  Ticket,
  WorkOrder,
} from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { DAY_MS, HOUR_MS, endOfVnDay, periodRange, startOfVnDay } from '../../utils/time.js';

const TZ = 'Asia/Ho_Chi_Minh';
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round = (n, digits = 2) => Math.round((n ?? 0) * 10 ** digits) / 10 ** digits;
const rate = (part, total) => (total ? round(part / total, 4) : 0);

// Giới hạn khoảng báo cáo để aggregation không quét toàn bộ lịch sử (UC-E13: dữ liệu quá lớn → gợi ý thu hẹp)
export const MAX_RANGE_MONTHS = 60;
const MAX_RANGE_MS = MAX_RANGE_MONTHS * 31 * DAY_MS;

/** Khoảng ngày [from 00:00, to 23:59] giờ VN; from > to hoặc dài quá 5 năm → VALIDATION_ERROR */
export function dateRange(from, to) {
  const start = startOfVnDay(from);
  const end = endOfVnDay(to);
  if (start > end) throw ApiError.badRequest('Khoảng thời gian không hợp lệ (from > to)');
  if (end - start > MAX_RANGE_MS) {
    throw ApiError.badRequest(`Khoảng thời gian tối đa ${MAX_RANGE_MONTHS / 12} năm, hãy thu hẹp lại`);
  }
  return { start, end };
}

// =====================================================================
// UC-E10 — Báo cáo tổng hợp thu phí (lũy kế theo kỳ YYYY-MM)
// =====================================================================
export async function billingSummary({ from, to, buildingId, feeCategory }) {
  if (from > to) throw ApiError.badRequest('Khoảng thời gian không hợp lệ (from > to)');
  if (periodRange(from, to).length > MAX_RANGE_MONTHS) {
    throw ApiError.badRequest(`Khoảng thời gian tối đa ${MAX_RANGE_MONTHS} tháng, hãy thu hẹp lại`);
  }

  const match = { period: { $gte: from, $lte: to } };
  if (buildingId) match.buildingId = oid(buildingId);
  if (feeCategory) match['items.feeCategory'] = feeCategory;

  // `amount` = tổng các dòng thuộc nhóm phí đang lọc (không lọc → totalAmount)
  const amountExpr = feeCategory
    ? {
        $sum: {
          $map: {
            input: { $filter: { input: '$items', cond: { $eq: ['$$this.feeCategory', feeCategory] } } },
            in: '$$this.amount',
          },
        },
      }
    : '$totalAmount';
  const notCancelled = { $ne: ['$status', INVOICE_STATUS.CANCELLED] };
  const isPaid = { $eq: ['$status', INVOICE_STATUS.PAID] };
  const isOutstanding = { $in: ['$status', [INVOICE_STATUS.UNPAID, INVOICE_STATUS.OVERDUE]] };
  const sumIf = (cond, value = '$amount') => ({ $sum: { $cond: [cond, value, 0] } });
  const moneyGroup = {
    billed: sumIf(notCancelled),
    collected: sumIf(isPaid),
    outstanding: sumIf(isOutstanding),
    overdueAmount: sumIf({ $eq: ['$status', INVOICE_STATUS.OVERDUE] }),
    invoiceCount: sumIf(notCancelled, 1),
  };

  const [facets] = await Invoice.aggregate([
    { $match: match },
    { $addFields: { amount: amountExpr } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }],
        totals: [{ $group: { _id: null, ...moneyGroup } }],
        byMonth: [{ $group: { _id: '$period', ...moneyGroup } }, { $sort: { _id: 1 } }],
        byBuilding: [
          { $group: { _id: '$buildingId', ...moneyGroup } },
          { $lookup: { from: 'buildings', localField: '_id', foreignField: '_id', as: 'b' } },
          { $addFields: { buildingName: { $first: '$b.name' } } },
          { $project: { b: 0 } },
          { $sort: { buildingName: 1 } },
        ],
        byFeeCategory: [
          { $match: { status: { $ne: INVOICE_STATUS.CANCELLED } } },
          { $unwind: '$items' },
          ...(feeCategory ? [{ $match: { 'items.feeCategory': feeCategory } }] : []),
          {
            $group: {
              _id: '$items.feeCategory',
              billed: { $sum: '$items.amount' },
              collected: { $sum: { $cond: [isPaid, '$items.amount', 0] } },
              outstanding: { $sum: { $cond: [isOutstanding, '$items.amount', 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  // Theo phương thức thanh toán — chỉ giao dịch SUCCESS của hóa đơn trong kỳ
  const byMethod = await Payment.aggregate([
    { $match: { status: PAYMENT_STATUS.SUCCESS } },
    { $lookup: { from: 'invoices', localField: 'invoiceId', foreignField: '_id', as: 'inv' } },
    { $unwind: '$inv' },
    { $match: Object.fromEntries(Object.entries(match).map(([k, v]) => [`inv.${k}`, v])) },
    { $group: { _id: '$method', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    { $sort: { amount: -1 } },
  ]);

  const statusCount = Object.fromEntries(Object.values(INVOICE_STATUS).map((s) => [s, 0]));
  for (const s of facets.byStatus) statusCount[s._id] = s.count;
  const totals = facets.totals[0] ?? { billed: 0, collected: 0, outstanding: 0, overdueAmount: 0 };

  // Đủ tháng trong khoảng (tháng không có hóa đơn → 0) để biểu đồ liền mạch
  const monthMap = Object.fromEntries(facets.byMonth.map((m) => [m._id, m]));
  const withRate = (row) => ({ ...row, collectionRate: rate(row.collected, row.billed) });

  return {
    filter: { from, to, buildingId: buildingId ?? null, feeCategory: feeCategory ?? null },
    overview: {
      issued: Object.values(statusCount).reduce((a, b) => a + b, 0),
      paid: statusCount.PAID,
      unpaid: statusCount.UNPAID,
      overdue: statusCount.OVERDUE,
      cancelled: statusCount.CANCELLED,
      billed: totals.billed,
      collected: totals.collected,
      outstanding: totals.outstanding,
      overdueAmount: totals.overdueAmount,
      collectionRate: rate(totals.collected, totals.billed),
    },
    byFeeCategory: facets.byFeeCategory.map(({ _id, ...r }) => withRate({ feeCategory: _id, ...r })),
    byMonth: periodRange(from, to).map((period) => {
      const m = monthMap[period];
      return withRate({
        period,
        billed: m?.billed ?? 0,
        collected: m?.collected ?? 0,
        outstanding: m?.outstanding ?? 0,
        overdueAmount: m?.overdueAmount ?? 0,
        invoiceCount: m?.invoiceCount ?? 0,
      });
    }),
    byBuilding: facets.byBuilding.map(({ _id, ...r }) => withRate({ buildingId: _id, ...r })),
    byMethod: byMethod.map(({ _id, ...r }) => ({ method: _id, ...r })),
  };
}

// =====================================================================
// Báo cáo công nợ (nguồn cho UC-E13 xuất "debts") — các căn đang có hóa đơn OVERDUE
// =====================================================================
export async function debtReport({ buildingId }) {
  const match = { status: INVOICE_STATUS.OVERDUE };
  if (buildingId) match.buildingId = oid(buildingId);

  const rows = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$apartmentId',
        buildingId: { $first: '$buildingId' },
        invoiceCount: { $sum: 1 },
        outstanding: { $sum: '$totalAmount' },
        oldestDueDate: { $min: '$dueDate' },
        periods: { $push: '$period' },
      },
    },
    { $lookup: { from: 'apartments', localField: '_id', foreignField: '_id', as: 'a' } },
    { $lookup: { from: 'buildings', localField: 'buildingId', foreignField: '_id', as: 'b' } },
    { $addFields: { apartmentCode: { $first: '$a.code' }, buildingName: { $first: '$b.name' } } },
    { $project: { a: 0, b: 0 } },
    { $sort: { outstanding: -1 } },
  ]);

  const followups = await DebtFollowup.find({
    apartmentId: { $in: rows.map((r) => r._id) },
    status: 'OPEN',
  })
    .populate('assignedTo', 'fullName')
    .lean();
  const fuMap = Object.fromEntries(followups.map((f) => [String(f.apartmentId), f]));
  const now = Date.now();

  const items = rows.map(({ _id, ...r }) => ({
    apartmentId: _id,
    ...r,
    periods: r.periods.sort(),
    daysOverdue: Math.max(0, Math.floor((now - new Date(r.oldestDueDate).getTime()) / DAY_MS)),
    assignedTo: fuMap[String(_id)]?.assignedTo?.fullName ?? null,
    lastContactAt: fuMap[String(_id)]?.activities?.at(-1)?.at ?? null,
  }));
  return {
    totalApartments: items.length,
    totalOutstanding: items.reduce((s, i) => s + i.outstanding, 0),
    unassigned: items.filter((i) => !i.assignedTo).length,
    items,
  };
}

// =====================================================================
// UC-E11 — Dashboard quỹ bảo trì
// =====================================================================
export async function fundDashboard({ from, to }) {
  const { start, end } = dateRange(from, to);
  const funds = await MaintenanceFund.find().populate('buildingId', 'name').lean();
  const txMatch = { occurredAt: { $gte: start, $lte: end } };

  const [monthly, totals, recent, pendingProposals] = await Promise.all([
    FundTransaction.aggregate([
      { $match: txMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$occurredAt', timezone: TZ } },
          income: { $sum: { $cond: [{ $eq: ['$type', FUND_TX_TYPES.INCOME] }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', FUND_TX_TYPES.EXPENSE] }, '$amount', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    FundTransaction.aggregate([
      { $match: txMatch },
      { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    FundTransaction.find(txMatch)
      .sort({ occurredAt: -1 })
      .limit(10)
      .populate('proposalId', 'title status')
      .populate('createdBy', 'fullName')
      .lean(),
    FundProposal.find({ status: REVIEW_STATUS.PENDING })
      .select('title amount votes createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const totalMap = Object.fromEntries(totals.map((t) => [t._id, t]));
  const monthMap = Object.fromEntries(monthly.map((m) => [m._id, m]));
  const periods = periodRange(
    new Date(start.getTime() + 7 * HOUR_MS).toISOString().slice(0, 7),
    new Date(end.getTime() + 7 * HOUR_MS).toISOString().slice(0, 7),
  );

  return {
    balance: funds.reduce((s, f) => s + f.balance, 0),
    funds: funds.map((f) => ({
      _id: f._id,
      name: f.name,
      buildingName: f.buildingId?.name ?? 'Toàn khu',
      balance: f.balance,
    })),
    totalIncome: totalMap.INCOME?.amount ?? 0,
    totalExpense: totalMap.EXPENSE?.amount ?? 0,
    transactionCount: (totalMap.INCOME?.count ?? 0) + (totalMap.EXPENSE?.count ?? 0),
    monthly: periods.map((period) => ({
      period,
      income: monthMap[period]?.income ?? 0,
      expense: monthMap[period]?.expense ?? 0,
    })),
    recentTransactions: recent,
    pendingProposals: pendingProposals.map((p) => ({
      _id: p._id,
      title: p.title,
      amount: p.amount,
      voteCount: p.votes?.length ?? 0,
      createdAt: p.createdAt,
    })),
  };
}

// =====================================================================
// UC-E12 — Dashboard vận hành (không chứa số liệu tài chính — BR-R6)
// =====================================================================
export async function occupancyReport({ buildingId }) {
  const match = buildingId ? { buildingId: oid(buildingId) } : {};
  const rows = await Apartment.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$buildingId',
        total: { $sum: 1 },
        owned: { $sum: { $cond: [{ $eq: ['$status', APARTMENT_STATUS.OWNED] }, 1, 0] } },
        rented: { $sum: { $cond: [{ $eq: ['$status', APARTMENT_STATUS.RENTED] }, 1, 0] } },
        vacant: { $sum: { $cond: [{ $eq: ['$status', APARTMENT_STATUS.VACANT] }, 1, 0] } },
      },
    },
    { $lookup: { from: 'buildings', localField: '_id', foreignField: '_id', as: 'b' } },
    { $addFields: { buildingName: { $first: '$b.name' } } },
    { $project: { b: 0 } },
    { $sort: { buildingName: 1 } },
  ]);

  const byBuilding = rows.map(({ _id, ...r }) => ({
    buildingId: _id,
    ...r,
    occupancyRate: rate(r.owned + r.rented, r.total),
  }));
  const sum = (k) => byBuilding.reduce((s, b) => s + b[k], 0);
  return {
    total: sum('total'),
    owned: sum('owned'),
    rented: sum('rented'),
    vacant: sum('vacant'),
    occupancyRate: rate(sum('owned') + sum('rented'), sum('total')),
    byBuilding,
  };
}

export async function ticketReport({ from, to, buildingId }) {
  const { start, end } = dateRange(from, to);
  const match = { createdAt: { $gte: start, $lte: end } };
  if (buildingId) match.buildingId = oid(buildingId);
  const now = new Date();
  const openStatuses = [TICKET_STATUS.NEW, TICKET_STATUS.ASSIGNED, TICKET_STATUS.IN_PROGRESS];

  const [facets] = await Ticket.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
        byCategory: [
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $lookup: { from: 'complaint_categories', localField: '_id', foreignField: '_id', as: 'c' } },
          { $addFields: { name: { $first: '$c.name' } } },
          { $project: { c: 0 } },
          { $sort: { count: -1 } },
        ],
        overdue: [
          { $match: { status: { $in: openStatuses }, dueDate: { $lt: now } } },
          { $count: 'count' },
        ],
        resolution: [
          { $match: { status: TICKET_STATUS.CLOSED, closedAt: { $ne: null } } },
          {
            $group: {
              _id: null,
              avgHours: { $avg: { $divide: [{ $subtract: ['$closedAt', '$createdAt'] }, HOUR_MS] } },
              // Đúng hạn = có resolvedAt và resolvedAt ≤ dueDate (thiếu resolvedAt không được tính)
              onTime: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: [{ $type: '$resolvedAt' }, 'date'] }, { $lte: ['$resolvedAt', '$dueDate'] }] },
                    1,
                    0,
                  ],
                },
              },
              closed: { $sum: 1 },
              avgRating: { $avg: '$rating' },
              rated: { $sum: { $cond: [{ $gt: ['$rating', null] }, 1, 0] } },
            },
          },
        ],
        technicians: [
          { $match: { assignedTo: { $ne: null } } },
          {
            $group: {
              _id: '$assignedTo',
              assigned: { $sum: 1 },
              closed: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
              avgRating: { $avg: '$rating' },
            },
          },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
          { $addFields: { fullName: { $first: '$u.fullName' } } },
          { $project: { u: 0 } },
          { $sort: { avgRating: -1, closed: -1 } },
        ],
      },
    },
  ]);

  const toMap = (arr) => Object.fromEntries(arr.map((x) => [x._id, x.count]));
  const byStatus = toMap(facets.byStatus);
  const total = facets.byStatus.reduce((s, x) => s + x.count, 0);
  const res = facets.resolution[0];
  return {
    total,
    open: openStatuses.reduce((s, k) => s + (byStatus[k] ?? 0), 0),
    waitingConfirm: byStatus.WAITING_CONFIRM ?? 0,
    closed: byStatus.CLOSED ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    overdue: facets.overdue[0]?.count ?? 0,
    byStatus,
    byPriority: toMap(facets.byPriority),
    byCategory: facets.byCategory.map(({ _id, ...r }) => ({ categoryId: _id, ...r })),
    avgResolutionHours: round(res?.avgHours ?? 0, 1),
    onTimeRate: rate(res?.onTime ?? 0, res?.closed ?? 0),
    avgRating: round(res?.avgRating ?? 0, 2),
    ratedCount: res?.rated ?? 0,
    technicians: facets.technicians.map(({ _id, ...r }) => ({
      userId: _id,
      ...r,
      avgRating: r.avgRating == null ? null : round(r.avgRating, 2),
    })),
  };
}

export async function maintenanceReport({ from, to, buildingId }) {
  const { start, end } = dateRange(from, to);
  let assetIds = null;
  if (buildingId) {
    assetIds = (await Asset.find({ buildingId }).select('_id').lean()).map((a) => a._id);
  }
  const woMatch = { createdAt: { $gte: start, $lte: end } };
  if (assetIds) woMatch.assetId = { $in: assetIds };

  const soon = new Date(Date.now() + 7 * DAY_MS);
  const assetFilter = { isActive: true, nextMaintenanceDate: { $ne: null, $lte: soon } };
  if (buildingId) assetFilter.buildingId = buildingId;

  const [byStatusRows, completion, upcoming] = await Promise.all([
    WorkOrder.aggregate([{ $match: woMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    WorkOrder.aggregate([
      { $match: { ...woMatch, status: WORK_ORDER_STATUS.DONE, completedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          done: { $sum: 1 },
          // Đúng hạn = hoàn thành không muộn hơn 1 ngày sau ngày lên lịch
          onTime: {
            $sum: {
              $cond: [
                { $lte: ['$completedAt', { $add: [{ $ifNull: ['$scheduledDate', '$createdAt'] }, DAY_MS] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Asset.find(assetFilter)
      .select('name category nextMaintenanceDate buildingId')
      .populate('buildingId', 'name')
      .sort({ nextMaintenanceDate: 1 })
      .limit(20)
      .lean(),
  ]);

  const byStatus = Object.fromEntries(byStatusRows.map((r) => [r._id, r.count]));
  const c = completion[0] ?? { done: 0, onTime: 0 };
  return {
    total: byStatusRows.reduce((s, r) => s + r.count, 0),
    byStatus,
    done: c.done,
    onTime: c.onTime,
    late: c.done - c.onTime,
    onTimeRate: rate(c.onTime, c.done),
    upcomingAssets: upcoming.map((a) => ({
      ...a,
      overdue: a.nextMaintenanceDate < new Date(),
    })),
  };
}

// =====================================================================
// UC-E14 — Thống kê sử dụng tiện ích
// =====================================================================
export async function amenityUsage({ from, to, amenityId }) {
  const { start, end } = dateRange(from, to);
  if (amenityId && !(await Amenity.exists({ _id: amenityId }))) {
    throw ApiError.notFound('Không tìm thấy tiện ích');
  }
  const match = { date: { $gte: start, $lte: end } };
  if (amenityId) match.amenityId = oid(amenityId);
  const USED = [BOOKING_STATUS.APPROVED, BOOKING_STATUS.COMPLETED];

  const [facets] = await Booking.aggregate([
    { $match: match },
    {
      $facet: {
        byAmenity: [
          {
            $group: {
              _id: '$amenityId',
              total: { $sum: 1 },
              ...Object.fromEntries(
                Object.values(BOOKING_STATUS).map((s) => [
                  s.toLowerCase(),
                  { $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } },
                ]),
              ),
              // BR-O5: chỉ COMPLETED mới tính là đã sử dụng/được tính phí
              revenue: {
                $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, '$fee', 0] },
              },
            },
          },
          { $lookup: { from: 'amenities', localField: '_id', foreignField: '_id', as: 'a' } },
          { $addFields: { name: { $first: '$a.name' } } },
          { $project: { a: 0 } },
          { $sort: { total: -1 } },
        ],
        // Tỷ lệ lấp slot: số lượt giữ chỗ / capacityPerSlot, trung bình theo khung giờ (BR-O3)
        bySlot: [
          { $match: { status: { $in: USED } } },
          {
            $group: {
              _id: { amenityId: '$amenityId', date: '$date', slotStart: '$slotStart' },
              count: { $sum: 1 },
            },
          },
          { $lookup: { from: 'amenities', localField: '_id.amenityId', foreignField: '_id', as: 'a' } },
          {
            $addFields: {
              fill: {
                $min: [1, { $divide: ['$count', { $max: [1, { $first: '$a.capacityPerSlot' }] }] }],
              },
            },
          },
          {
            $group: {
              _id: '$_id.slotStart',
              bookings: { $sum: '$count' },
              avgFillRate: { $avg: '$fill' },
            },
          },
          { $sort: { _id: 1 } },
        ],
        topApartments: [
          { $match: { status: { $in: USED } } },
          { $group: { _id: '$apartmentId', bookings: { $sum: 1 } } },
          { $sort: { bookings: -1 } },
          { $limit: 10 },
          { $lookup: { from: 'apartments', localField: '_id', foreignField: '_id', as: 'ap' } },
          { $addFields: { apartmentCode: { $first: '$ap.code' } } },
          { $project: { ap: 0 } },
        ],
      },
    },
  ]);

  const byAmenity = facets.byAmenity.map(({ _id, ...r }) => ({
    amenityId: _id,
    ...r,
    cancelRate: rate(r.cancelled, r.total),
    rejectRate: rate(r.rejected, r.total),
  }));
  const sum = (k) => byAmenity.reduce((s, a) => s + a[k], 0);
  const bySlot = facets.bySlot.map(({ _id, ...r }) => ({
    slotStart: _id,
    bookings: r.bookings,
    avgFillRate: round(r.avgFillRate, 4),
  }));
  const peak = [...bySlot].sort((a, b) => b.bookings - a.bookings)[0] ?? null;

  return {
    total: sum('total'),
    completed: sum('completed'),
    cancelled: sum('cancelled'),
    rejected: sum('rejected'),
    revenue: sum('revenue'),
    cancelRate: rate(sum('cancelled'), sum('total')),
    rejectRate: rate(sum('rejected'), sum('total')),
    mostUsed: byAmenity[0] ? { amenityId: byAmenity[0].amenityId, name: byAmenity[0].name } : null,
    peakSlot: peak?.slotStart ?? null,
    byAmenity,
    bySlot,
    topApartments: facets.topApartments.map(({ _id, ...r }) => ({ apartmentId: _id, ...r })),
  };
}
