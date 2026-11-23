// Mô đun 9 — UC60 Dashboard vận hành (Trưởng BQL), mục 5.3–5.4 checklist Người 3.
// Lấy thẳng dữ liệu các module đã có (chưa có API thống kê riêng của từng người):
//   - Sự cố kỹ thuật (Người 4): số phiếu theo tháng, nhận phiếu đúng hạn, xử lý đúng hạn (dueDate đã cộng bù thời gian
//     tạm dừng chờ cư dân đồng ý phí / chờ linh kiện — M5-2), số sao theo kỹ thuật viên.
//   - Phản ánh (Người 2 xử lý): theo loại, thời gian phản hồi, phản hồi đúng hạn.
//   - Bảo trì thiết bị (Người 1, Mô đun 10): phiếu bảo trì làm đúng hạn.
//   - Cư dân (Người 2): tỷ lệ lấp đầy, vào ở / chuyển đi theo tháng.
//   - Tiện ích (Người 4): lượt đặt giữ chỗ và lượt đã check-in theo tiện ích.
// Không có số liệu tài chính (BR-R6). Khoảng thời gian theo tháng YYYY-MM như dashboard tài chính.
import mongoose from 'mongoose';
import {
  BOOKING_BILLABLE_STATUSES,
  TICKET_FINAL_STATUSES,
  TICKET_HISTORY_ACTIONS,
  TICKET_OPEN_STATUSES,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
  WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Apartment, Asset, Booking, Resident, Ticket, WorkOrder } from '../../models/index.js';
import { DAY_MS, HOUR_MS } from '../../utils/time.js';
import { overdueFilter } from '../tickets/ticket.rules.js';
import { partsPauseMs } from '../tickets/tickets.service.js';
import { assertRange } from './finance.service.js';
import { occupancyReport } from './reports.service.js';

const TZ = 'Asia/Ho_Chi_Minh';
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const monthOf = (field) => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TZ } });
const rate = (part, total) => (total ? Math.round((part / total) * 10000) / 10000 : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const hoursBetween = (a, b) => ({ $divide: [{ $subtract: [a, b] }, HOUR_MS] });
const isDate = (f) => ({ $eq: [{ $type: f }, 'date'] });
const byPeriod = (rows) => new Map(rows.map((r) => [r._id, r]));

// ---------------------------------------------------------------------------
// Sự cố kỹ thuật
// ---------------------------------------------------------------------------
async function incidentStats(match, { start, end, periods, now, buildingFilter }) {
  const partsMs = await partsPauseMs();
  // Lần nhận / được giao đầu tiên trong lịch sử → so với hạn nhận phiếu
  const firstTake = {
    $min: {
      $map: {
        input: {
          $filter: {
            input: '$history',
            as: 'h',
            cond: { $in: ['$$h.action', [TICKET_HISTORY_ACTIONS.CLAIMED, TICKET_HISTORY_ACTIONS.ASSIGNED]] },
          },
        },
        as: 'h',
        in: '$$h.at',
      },
    },
  };
  const resolvedOnTime = { $and: [isDate('$resolvedAt'), isDate('$dueDate'), { $lte: ['$resolvedAt', '$dueDate'] }] };

  const [[f], resolvedRows, overdueNow] = await Promise.all([
    Ticket.aggregate([
      { $match: match },
      { $addFields: { takenAt: firstTake } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                open: { $sum: { $cond: [{ $in: ['$status', [...TICKET_OPEN_STATUSES]] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.REJECTED] }, 1, 0] } },
                inApartment: { $sum: { $cond: [{ $eq: ['$scope', TICKET_SCOPES.IN_APARTMENT] }, 1, 0] } },
                ackKnown: { $sum: { $cond: [{ $and: [isDate('$ackDueAt'), isDate('$takenAt')] }, 1, 0] } },
                ackOnTime: {
                  $sum: { $cond: [{ $and: [isDate('$ackDueAt'), isDate('$takenAt'), { $lte: ['$takenAt', '$ackDueAt'] }] }, 1, 0] },
                },
                resolved: { $sum: { $cond: [isDate('$resolvedAt'), 1, 0] } },
                onTime: { $sum: { $cond: [resolvedOnTime, 1, 0] } },
                avgHours: { $avg: { $cond: [isDate('$resolvedAt'), hoursBetween('$resolvedAt', '$createdAt'), null] } },
                avgRating: { $avg: '$rating' },
                rated: { $sum: { $cond: [{ $gt: ['$rating', null] }, 1, 0] } },
              },
            },
          ],
          byMonth: [{ $group: { _id: monthOf('$createdAt'), created: { $sum: 1 } } }],
          technicians: [
            { $match: { assignedTo: { $ne: null } } },
            {
              $group: {
                _id: '$assignedTo',
                assigned: { $sum: 1 },
                resolved: { $sum: { $cond: [isDate('$resolvedAt'), 1, 0] } },
                onTime: { $sum: { $cond: [resolvedOnTime, 1, 0] } },
                avgRating: { $avg: '$rating' },
                rated: { $sum: { $cond: [{ $gt: ['$rating', null] }, 1, 0] } },
              },
            },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', pipeline: [{ $project: { fullName: 1 } }], as: 'u' } },
            { $addFields: { fullName: { $first: '$u.fullName' } } },
            { $project: { u: 0 } },
          ],
        },
      },
    ]),
    // Xử lý xong theo tháng xong việc (không phụ thuộc tháng tạo phiếu)
    Ticket.aggregate([
      { $match: { ...buildingFilter, type: TICKET_TYPES.INCIDENT, resolvedAt: { $gte: start, $lt: end } } },
      { $group: { _id: monthOf('$resolvedAt'), resolved: { $sum: 1 }, onTime: { $sum: { $cond: [resolvedOnTime, 1, 0] } } } },
    ]),
    // Đang quá hạn ngay lúc này (mọi phiếu còn mở, kể cả tạo trước khoảng xem)
    Ticket.countDocuments({ ...buildingFilter, type: TICKET_TYPES.INCIDENT, ...overdueFilter(now, partsMs) }),
  ]);

  const t = f.totals[0] ?? {};
  const created = byPeriod(f.byMonth);
  const resolved = byPeriod(resolvedRows);
  const technicians = f.technicians
    .map(({ _id, ...r }) => ({
      userId: _id,
      ...r,
      onTimeRate: rate(r.onTime, r.resolved),
      avgRating: round1(r.avgRating),
    }))
    // Xếp hạng theo số sao (người chưa có đánh giá xếp sau), rồi tỷ lệ đúng hạn, rồi số phiếu đã xong
    .sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1) || (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1) || b.resolved - a.resolved);

  return {
    total: t.total ?? 0,
    open: t.open ?? 0,
    rejected: t.rejected ?? 0,
    inApartment: t.inApartment ?? 0,
    overdueNow,
    resolved: t.resolved ?? 0,
    onTime: t.onTime ?? 0,
    late: (t.resolved ?? 0) - (t.onTime ?? 0),
    onTimeRate: rate(t.onTime ?? 0, t.resolved ?? 0),
    ackOnTimeRate: rate(t.ackOnTime ?? 0, t.ackKnown ?? 0),
    avgResolutionHours: round1(t.avgHours),
    avgRating: round1(t.avgRating),
    rated: t.rated ?? 0,
    byMonth: periods.map((period) => ({
      period,
      created: created.get(period)?.created ?? 0,
      resolved: resolved.get(period)?.resolved ?? 0,
      onTime: resolved.get(period)?.onTime ?? 0,
      late: (resolved.get(period)?.resolved ?? 0) - (resolved.get(period)?.onTime ?? 0),
    })),
    technicians,
  };
}

// ---------------------------------------------------------------------------
// Phản ánh / khiếu nại
// ---------------------------------------------------------------------------
async function complaintStats(match, now) {
  const respondedOnTime = { $and: [isDate('$respondedAt'), isDate('$responseDueAt'), { $lte: ['$respondedAt', '$responseDueAt'] }] };
  const group = {
    count: { $sum: 1 },
    responded: { $sum: { $cond: [isDate('$respondedAt'), 1, 0] } },
    onTime: { $sum: { $cond: [respondedOnTime, 1, 0] } },
    avgHours: { $avg: { $cond: [isDate('$respondedAt'), hoursBetween('$respondedAt', '$createdAt'), null] } },
    overdue: {
      $sum: {
        $cond: [
          {
            $and: [
              { $not: [isDate('$respondedAt')] },
              { $not: [{ $in: ['$status', [...TICKET_FINAL_STATUSES]] }] },
              isDate('$responseDueAt'),
              { $lt: ['$responseDueAt', now] },
            ],
          },
          1,
          0,
        ],
      },
    },
  };
  const [f] = await Ticket.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{ $group: { _id: null, ...group } }],
        byCategory: [
          { $group: { _id: '$category', ...group } },
          { $lookup: { from: 'complaint_categories', localField: '_id', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'c' } },
          { $addFields: { name: { $ifNull: [{ $first: '$c.name' }, 'Khác'] } } },
          { $project: { c: 0 } },
          { $sort: { count: -1 } },
        ],
      },
    },
  ]);
  const view = ({ _id, count, responded, onTime, avgHours, overdue, ...rest }) => ({
    ...rest,
    count,
    responded,
    pending: count - responded,
    overdue,
    onTimeRate: rate(onTime, responded),
    avgResponseHours: round1(avgHours),
  });
  const t = f.totals[0];
  return {
    ...(t ? view(t) : { count: 0, responded: 0, pending: 0, overdue: 0, onTimeRate: null, avgResponseHours: null }),
    byCategory: f.byCategory.map((c) => ({ categoryId: c._id, ...view(c) })),
  };
}

// ---------------------------------------------------------------------------
// Bảo trì thiết bị (Mô đun 10)
// ---------------------------------------------------------------------------
async function maintenanceStats({ start, end, periods, now, buildingId }) {
  const assetIds = buildingId ? await Asset.find({ buildingId }).distinct('_id') : null;
  const base = assetIds ? { assetId: { $in: assetIds } } : {};
  const planned = { $ifNull: ['$scheduledDate', '$createdAt'] };
  // Đúng hạn = KIỂM TRA không muộn hơn 1 ngày sau ngày lên lịch (UC08: inspectedAt; phiếu cũ chưa có thì lấy completedAt).
  // Phiếu kiểm tra đúng hạn nhưng có sự cố, sửa lâu mới nghiệm thu vẫn tính đúng hạn — khớp assets.isOnTime.
  // Tỷ lệ tính trên phiếu ĐÃ KIỂM TRA (kể cả đang sửa / tạm hoãn) để tử và mẫu cùng một tập.
  const checkedAt = { $ifNull: ['$inspectedAt', '$completedAt'] };
  const inspected = isDate(checkedAt);
  const onTime = { $and: [inspected, { $lte: [checkedAt, { $add: [planned, DAY_MS] }] }] };
  const [rows, overdueOpen] = await Promise.all([
    WorkOrder.aggregate([
      { $match: base },
      { $addFields: { planned } },
      { $match: { planned: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: monthOf('$planned'),
          scheduled: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$status', WORK_ORDER_STATUS.DONE] }, 1, 0] } },
          inspected: { $sum: { $cond: [inspected, 1, 0] } },
          onTime: { $sum: { $cond: [onTime, 1, 0] } },
        },
      },
    ]),
    WorkOrder.countDocuments({
      ...base,
      status: { $in: [...WORK_ORDER_ACTIVE_STATUSES] }, // phiếu Tạm hoãn sửa (REPAIR_POSTPONED) không tính quá hạn (UC10)
      $expr: { $lt: [{ $add: [{ $ifNull: ['$scheduledDate', '$createdAt'] }, DAY_MS] }, now] },
    }),
  ]);
  const map = byPeriod(rows);
  const byMonth = periods.map((period) => ({
    period,
    scheduled: map.get(period)?.scheduled ?? 0,
    done: map.get(period)?.done ?? 0,
    inspected: map.get(period)?.inspected ?? 0,
    onTime: map.get(period)?.onTime ?? 0,
  }));
  const sum = (k) => byMonth.reduce((s, m) => s + m[k], 0);
  return {
    scheduled: sum('scheduled'),
    done: sum('done'),
    inspected: sum('inspected'),
    onTime: sum('onTime'),
    late: sum('inspected') - sum('onTime'),
    onTimeRate: rate(sum('onTime'), sum('inspected')),
    overdueOpen,
    byMonth,
  };
}

// ---------------------------------------------------------------------------
// Cư dân: lấp đầy + vào ở / chuyển đi theo tháng
// ---------------------------------------------------------------------------
async function residentStats({ start, end, periods, buildingId }) {
  const apartmentIds = buildingId ? await Apartment.find({ buildingId }).distinct('_id') : null;
  const base = apartmentIds ? { apartmentId: { $in: apartmentIds } } : {};
  const [occupancy, moveIns, moveOuts] = await Promise.all([
    occupancyReport({ buildingId }),
    Resident.aggregate([
      { $match: { ...base, moveInDate: { $gte: start, $lt: end } } },
      { $group: { _id: monthOf('$moveInDate'), n: { $sum: 1 } } },
    ]),
    Resident.aggregate([
      { $match: { ...base, moveOutDate: { $gte: start, $lt: end } } },
      { $group: { _id: monthOf('$moveOutDate'), n: { $sum: 1 } } },
    ]),
  ]);
  const ins = byPeriod(moveIns);
  const outs = byPeriod(moveOuts);
  const byMonth = periods.map((period) => ({ period, moveIn: ins.get(period)?.n ?? 0, moveOut: outs.get(period)?.n ?? 0 }));
  return {
    occupancy,
    moveIn: byMonth.reduce((s, m) => s + m.moveIn, 0),
    moveOut: byMonth.reduce((s, m) => s + m.moveOut, 0),
    byMonth,
  };
}

// ---------------------------------------------------------------------------
// Tiện ích: lượt đặt giữ chỗ thật (đã xác nhận / đã dùng / không đến) theo tiện ích
// ---------------------------------------------------------------------------
async function amenityStats({ start, end, buildingId }) {
  const apartmentIds = buildingId ? await Apartment.find({ buildingId }).distinct('_id') : null;
  const base = apartmentIds ? { apartmentId: { $in: apartmentIds } } : {};
  const rows = await Booking.aggregate([
    { $match: { ...base, date: { $gte: start, $lt: end }, status: { $in: [...BOOKING_BILLABLE_STATUSES] } } },
    { $group: { _id: '$amenityId', bookings: { $sum: 1 }, checkedIn: { $sum: { $cond: [{ $gt: ['$checkedInAt', null] }, 1, 0] } } } },
    { $lookup: { from: 'amenities', localField: '_id', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'a' } },
    { $project: { _id: 0, amenityId: '$_id', name: { $ifNull: [{ $first: '$a.name' }, 'Tiện ích'] }, bookings: 1, checkedIn: 1 } },
    { $sort: { bookings: -1 } },
  ]);
  return rows;
}

/** Dashboard vận hành kỳ `from`..`to` (YYYY-MM), lọc theo tòa nếu có */
export async function operationsDashboard({ from, to, buildingId }, { now = new Date() } = {}) {
  const { periods, start, end } = assertRange(from, to);
  const buildingFilter = buildingId ? { buildingId: oid(buildingId) } : {};
  const inRange = { ...buildingFilter, createdAt: { $gte: start, $lt: end } };
  const ctx = { start, end, periods, now, buildingId, buildingFilter };

  const [incidents, complaints, maintenance, residents, amenities] = await Promise.all([
    incidentStats({ ...inRange, type: TICKET_TYPES.INCIDENT }, ctx),
    complaintStats({ ...inRange, type: TICKET_TYPES.COMPLAINT }, now),
    maintenanceStats(ctx),
    residentStats(ctx),
    amenityStats(ctx),
  ]);
  return { from, to, buildingId: buildingId ?? null, incidents, complaints, maintenance, residents, amenities };
}
