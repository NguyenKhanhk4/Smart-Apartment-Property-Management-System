// Mô đun 9 — UC60 Dashboard tài chính (Trưởng BQL, Kế toán) và báo cáo giám sát cho Ban quản trị (5.6).
// Số liệu tài chính lấy từ Mô đun 4: thông báo phí đã phát hành, giao dịch thu, Số dư trả trước, Quỹ bảo trì.
// Tiền tiện ích trả ngay khi đặt (booking.paidAt — tại quầy hoặc payOS) tách riêng, không đi qua thông báo phí (M4-8).
import {
  FUND_PROPOSAL_STATUS,
  FUND_TX_TYPES,
  INVOICE_OUTSTANDING_STATUSES,
  INVOICE_PUBLISHED_STATUSES,
  INVOICE_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
} from '../../constants/enums.js';
import { Booking, FundProposal, FundTransaction, Invoice, MaintenanceFund, Payment, PrepaidBalance } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { periodEnd, periodRange, periodStart, startOfVnDay } from '../../utils/time.js';
import { overdueExpr } from '../debts/debts.check.js';
import { MAX_RANGE_MONTHS, ticketReport } from './reports.service.js';

const TZ = 'Asia/Ho_Chi_Minh';
const monthOf = (field) => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TZ } });
const rate = (part, total) => (total ? Math.round((part / total) * 10000) / 10000 : 0);

// Tránh đếm trùng tiền tiện ích (mỗi khoản chỉ tính 1 lần):
//  - payOS trả phí booking đã xác nhận được booking (creditAmount = 0): tiền đã tính ở booking.paidAt → bỏ khỏi giao dịch thu.
//    Không giữ được chỗ thì toàn bộ tiền vào Số dư trả trước (creditAmount > 0) → vẫn là tiền thu payOS.
//  - Đổi lịch booking đã trả: booking mới chép paidAt của booking cũ → chỉ tính ở booking cũ.
const NOT_BOOKING_CONFIRMED = { $nor: [{ bookingId: { $ne: null }, creditAmount: { $lte: 0 } }] };
const NOT_INHERITED_PAYMENT = [
  { $lookup: { from: 'bookings', localField: 'rescheduledFrom', foreignField: '_id', pipeline: [{ $project: { paidAt: 1 } }], as: 'prev' } },
  { $match: { $expr: { $ne: [{ $first: '$prev.paidAt' }, '$paidAt'] } } },
];

function assertRange(from, to) {
  if (from > to) throw ApiError.badRequest('Khoảng thời gian không hợp lệ (from > to)');
  const periods = periodRange(from, to);
  if (periods.length > MAX_RANGE_MONTHS) throw ApiError.badRequest(`Khoảng thời gian tối đa ${MAX_RANGE_MONTHS / 12} năm, hãy thu hẹp lại`);
  return { periods, start: periodStart(from), end: periodEnd(to) };
}

/** Tình trạng nợ hiện tại theo căn: không nợ / còn nợ chưa quá hạn / có khoản quá hạn (trên các căn đã có thông báo phí) */
async function debtStatusNow(now) {
  const today = startOfVnDay(now);
  const [row] = await Invoice.aggregate([
    { $match: { status: { $in: [...INVOICE_PUBLISHED_STATUSES] } } },
    {
      $group: {
        _id: '$apartmentId',
        outstanding: {
          $sum: { $cond: [{ $in: ['$status', [...INVOICE_OUTSTANDING_STATUSES]] }, { $subtract: ['$totalAmount', '$paidAmount'] }, 0] },
        },
        overdue: { $sum: { $cond: [overdueExpr(today), { $subtract: ['$totalAmount', '$paidAmount'] }, 0] } },
      },
    },
    {
      $group: {
        _id: null,
        apartments: { $sum: 1 },
        clear: { $sum: { $cond: [{ $lte: ['$outstanding', 0] }, 1, 0] } },
        overdueApartments: { $sum: { $cond: [{ $gt: ['$overdue', 0] }, 1, 0] } },
        outstanding: { $sum: '$outstanding' },
        overdueAmount: { $sum: '$overdue' },
      },
    },
  ]);
  const apartments = row?.apartments ?? 0;
  const overdueApartments = row?.overdueApartments ?? 0;
  const clear = row?.clear ?? 0;
  return {
    apartments,
    clear,
    owing: apartments - clear - overdueApartments, // còn nợ nhưng chưa quá hạn
    overdueApartments,
    owingRate: rate(apartments - clear, apartments),
    outstanding: row?.outstanding ?? 0,
    overdueAmount: row?.overdueAmount ?? 0,
  };
}

/**
 * Dashboard tài chính kỳ `from`..`to` (YYYY-MM):
 *  - byMonth: phát hành (theo kỳ thông báo), thu được (theo ngày thu, tách hình thức), tiện ích trả ngay
 *  - byFeeCategory: cơ cấu phí đã phát hành trong khoảng kỳ
 *  - byMethod: dòng tiền theo hình thức thanh toán
 *  - debt: tỷ lệ căn còn nợ / quá hạn hiện tại; fund: số dư và thu chi quỹ trong khoảng
 */
export async function financeDashboard({ from, to }, { now = new Date() } = {}) {
  const { periods, start, end } = assertRange(from, to);
  const published = { status: { $in: [...INVOICE_PUBLISHED_STATUSES] }, period: { $gte: from, $lte: to } };

  const [billedRows, categoryRows, paymentRows, amenityRows, debt, funds, fundRows, prepaid, pendingProposals] = await Promise.all([
    Invoice.aggregate([
      { $match: published },
      {
        $group: {
          _id: '$period',
          billed: { $sum: '$totalAmount' },
          paid: { $sum: '$paidAmount' },
          invoices: { $sum: 1 },
          paidInvoices: { $sum: { $cond: [{ $eq: ['$status', INVOICE_STATUS.PAID] }, 1, 0] } },
        },
      },
    ]),
    Invoice.aggregate([
      { $match: published },
      { $unwind: '$items' },
      { $group: { _id: '$items.feeCategory', amount: { $sum: '$items.amount' } } },
      { $sort: { amount: -1 } },
    ]),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.SUCCESS, paidAt: { $gte: start, $lt: end }, ...NOT_BOOKING_CONFIRMED } },
      { $group: { _id: { month: monthOf('$paidAt'), method: '$method' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { paidAt: { $gte: start, $lt: end }, fee: { $gt: 0 } } },
      ...NOT_INHERITED_PAYMENT,
      { $group: { _id: monthOf('$paidAt'), amount: { $sum: '$fee' }, count: { $sum: 1 } } },
    ]),
    debtStatusNow(now),
    MaintenanceFund.find().select('balance').lean(),
    FundTransaction.aggregate([
      { $match: { occurredAt: { $gte: start, $lt: end } } },
      { $group: { _id: '$type', amount: { $sum: '$amount' } } },
    ]),
    PrepaidBalance.aggregate([{ $group: { _id: null, amount: { $sum: '$balance' } } }]),
    FundProposal.countDocuments({ status: FUND_PROPOSAL_STATUS.PENDING }),
  ]);

  const billedMap = new Map(billedRows.map((r) => [r._id, r]));
  const amenityMap = new Map(amenityRows.map((r) => [r._id, r]));
  const methods = Object.values(PAYMENT_METHODS);
  const byMonth = periods.map((period) => {
    const pays = paymentRows.filter((r) => r._id.month === period);
    const byMethodOfMonth = Object.fromEntries(methods.map((m) => [m, pays.find((r) => r._id.method === m)?.amount ?? 0]));
    const b = billedMap.get(period);
    return {
      period,
      billed: b?.billed ?? 0,
      paidOfPeriod: b?.paid ?? 0, // đã thu của các thông báo kỳ này (kể cả thu sau)
      collected: pays.reduce((s, r) => s + r.amount, 0), // tiền thu được trong tháng (mọi kỳ)
      ...byMethodOfMonth,
      amenityDirect: amenityMap.get(period)?.amount ?? 0,
    };
  });
  const byMethod = methods.map((method) => {
    const rows = paymentRows.filter((r) => r._id.method === method);
    return { method, amount: rows.reduce((s, r) => s + r.amount, 0), count: rows.reduce((s, r) => s + r.count, 0) };
  });
  const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] ?? 0), 0);
  const fundMap = Object.fromEntries(fundRows.map((r) => [r._id, r.amount]));
  const billed = sum(byMonth, 'billed');
  const paidOfRange = sum(byMonth, 'paidOfPeriod');
  const invoiceCount = billedRows.reduce((s, r) => s + r.invoices, 0);

  return {
    from,
    to,
    totals: {
      billed,
      paidOfRange,
      collectionRate: rate(paidOfRange, billed),
      collected: sum(byMonth, 'collected'),
      amenityDirect: sum(byMonth, 'amenityDirect'),
      invoices: invoiceCount,
      paidInvoices: billedRows.reduce((s, r) => s + r.paidInvoices, 0),
      prepaidBalance: prepaid[0]?.amount ?? 0,
    },
    byMonth,
    byMethod,
    byFeeCategory: categoryRows.map((r) => ({ feeCategory: r._id, amount: r.amount, share: rate(r.amount, billed) })),
    debt,
    fund: {
      balance: funds.reduce((s, f) => s + f.balance, 0),
      income: fundMap[FUND_TX_TYPES.INCOME] ?? 0,
      expense: fundMap[FUND_TX_TYPES.EXPENSE] ?? 0,
      pendingProposals,
    },
  };
}

/**
 * Báo cáo giám sát cho Ban quản trị (5.6): Quỹ bảo trì (số dư, thu chi, đề xuất), tình hình thu phí,
 * chất lượng xử lý sự cố / phản ánh. Không có số liệu công nợ từng căn (Ban quản trị chỉ xem phần giám sát).
 * Khảo sát (Mô đun 8) chưa có API — trả `survey: null`.
 */
export async function supervisionReport({ from, to }, { now = new Date() } = {}) {
  const { start, end } = assertRange(from, to);
  const [finance, fundTx, proposals, tickets] = await Promise.all([
    financeDashboard({ from, to }, { now }),
    FundTransaction.find({ occurredAt: { $gte: start, $lt: end } })
      .sort({ occurredAt: -1 })
      .populate('proposalId', 'code title')
      .lean(),
    FundProposal.find({ createdAt: { $gte: start, $lt: end } })
      .sort({ createdAt: -1 })
      .select('code title amount status planType createdAt finalNote paidAt votes')
      .lean(),
    ticketReport({ from: start, to: new Date(Math.min(end.getTime() - 1, now.getTime())) }),
  ]);
  return {
    from,
    to,
    fund: {
      ...finance.fund,
      transactions: fundTx,
      proposals: proposals.map(({ votes, ...p }) => ({ ...p, voteCount: votes?.length ?? 0 })),
    },
    billing: {
      billed: finance.totals.billed,
      paidOfRange: finance.totals.paidOfRange,
      collectionRate: finance.totals.collectionRate,
      collected: finance.totals.collected,
      owingRate: finance.debt.owingRate,
      overdueApartments: finance.debt.overdueApartments,
      apartments: finance.debt.apartments,
      byMonth: finance.byMonth.map(({ period, billed, paidOfPeriod, collected }) => ({ period, billed, paidOfPeriod, collected })),
    },
    tickets: {
      total: tickets.total,
      open: tickets.open,
      closed: tickets.closed,
      onTimeRate: tickets.onTimeRate,
      overdue: tickets.overdue,
      avgResolutionHours: tickets.avgResolutionHours,
      avgRating: tickets.avgRating,
      byCategory: tickets.byCategory,
    },
    survey: null,
  };
}
