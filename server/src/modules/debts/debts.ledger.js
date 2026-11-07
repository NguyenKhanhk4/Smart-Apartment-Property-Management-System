// Mô đun 4 — UC31 Sổ công nợ: mỗi dòng = 1 Người nộp phí tại 1 căn (X1). Nợ của Người nộp phí cũ (khách thuê đã chuyển đi)
// vẫn nằm trong sổ của căn, chỉ cư dân là chính người đó mới thấy ở trang của mình.
import mongoose from 'mongoose';
import {
  DEBT_OPEN_STATUSES,
  DEBT_STATUS,
  INVOICE_PUBLISHED_STATUSES,
  INVOICE_STATUS,
  LEDGER_STATUS,
} from '../../constants/enums.js';
import { Apartment, DebtFollowup, Invoice, Payment, PrepaidTransaction, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, getPagination } from '../../utils/pagination.js';
import { startOfVnDay } from '../../utils/time.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { checkApartmentDebt, overdueExpr } from './debts.check.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const countIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
const SUM_FIELDS = ['billed', 'paid', 'outstanding', 'overdueAmount', 'invoiceCount', 'unpaidCount', 'partialCount', 'overdueCount'];
const SORTS = {
  outstanding: { outstanding: -1, apartmentCode: 1 },
  '-outstanding': { outstanding: -1, apartmentCode: 1 },
  overdueAmount: { overdueAmount: -1, apartmentCode: 1 },
  '-overdueAmount': { overdueAmount: -1, apartmentCode: 1 },
  apartmentCode: { buildingCode: 1, apartmentCode: 1 },
  '-apartmentCode': { buildingCode: -1, apartmentCode: -1 },
};

/** Biểu thức tình trạng dòng sổ: Nợ quá hạn dài > Quá hạn > Thanh toán một phần > Chưa thanh toán > Đã thanh toán */
const ledgerStatusExpr = {
  $switch: {
    branches: [
      { case: { $eq: ['$caseStatus', DEBT_STATUS.LONG_OVERDUE] }, then: LEDGER_STATUS.LONG_OVERDUE },
      { case: { $gt: ['$overdueAmount', 0] }, then: LEDGER_STATUS.OVERDUE },
      { case: { $gt: ['$partialCount', 0] }, then: LEDGER_STATUS.PARTIALLY_PAID },
      { case: { $gt: ['$unpaidCount', 0] }, then: LEDGER_STATUS.UNPAID },
    ],
    default: LEDGER_STATUS.PAID,
  },
};

const byPair = (from, as, extraMatch = [], pipeline = []) => ({
  $lookup: {
    from,
    let: { a: '$_id.a', p: '$_id.p' },
    pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$apartmentId', '$$a'] }, { $eq: ['$payerId', '$$p'] }, ...extraMatch] } } }, ...pipeline],
    as,
  },
});

/**
 * Sổ công nợ. query: { buildingId, apartmentId, payerId, q (mã căn), status: LEDGER_STATUS[], hasBalance, page, limit, sort }.
 * Trả về { items, pagination, summary } — summary tính trên toàn bộ dòng khớp bộ lọc (không phụ thuộc trang).
 */
export async function listLedger({ buildingId, apartmentId, payerId, q, status, hasBalance, sort = '-outstanding', ...query }, { now = new Date() } = {}) {
  const today = startOfVnDay(now);
  const { page, limit, skip } = getPagination(query);
  const base = { ...(apartmentId && { apartmentId: oid(apartmentId) }), ...(payerId && { payerId: oid(payerId) }) };

  const pipeline = [
    { $match: { ...base, payerId: base.payerId ?? { $ne: null }, status: { $in: [...INVOICE_PUBLISHED_STATUSES] } } },
    {
      $group: {
        _id: { a: '$apartmentId', p: '$payerId' },
        billed: { $sum: '$totalAmount' },
        paid: { $sum: '$paidAmount' },
        outstanding: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } },
        overdueAmount: { $sum: { $cond: [overdueExpr(today), { $subtract: ['$totalAmount', '$paidAmount'] }, 0] } },
        invoiceCount: { $sum: 1 },
        unpaidCount: countIf({ $eq: ['$status', INVOICE_STATUS.UNPAID] }),
        partialCount: countIf({ $eq: ['$status', INVOICE_STATUS.PARTIALLY_PAID] }),
        overdueCount: countIf(overdueExpr(today)),
        lastPeriod: { $max: '$period' },
      },
    },
    // Người nộp trước chưa có thông báo nào (chỉ có Số dư trả trước) vẫn có dòng trong sổ
    {
      $unionWith: {
        coll: 'prepaid_balances',
        pipeline: [
          { $match: { ...base, balance: { $gt: 0 } } },
          { $project: { _id: { a: '$apartmentId', p: '$payerId' }, ...Object.fromEntries(SUM_FIELDS.map((f) => [f, { $literal: 0 }])), lastPeriod: null } },
        ],
      },
    },
    { $group: { _id: '$_id', ...Object.fromEntries(SUM_FIELDS.map((f) => [f, { $sum: `$${f}` }])), lastPeriod: { $max: '$lastPeriod' } } },
    { $lookup: { from: 'apartments', localField: '_id.a', foreignField: '_id', as: 'apt' } },
    { $set: { apartmentCode: { $first: '$apt.code' }, buildingId: { $first: '$apt.buildingId' } } },
    ...(buildingId ? [{ $match: { buildingId: oid(buildingId) } }] : []),
    ...(q?.trim() ? [{ $match: { apartmentCode: { $regex: escapeRegex(q.trim()), $options: 'i' } } }] : []),
    byPair('prepaid_balances', 'bal'),
    byPair('debt_followups', 'dc', [{ $in: ['$status', [...DEBT_OPEN_STATUSES]] }]),
    { $set: { prepaidBalance: { $ifNull: [{ $first: '$bal.balance' }, 0] }, case: { $first: '$dc' } } },
    { $set: { caseStatus: { $ifNull: ['$case.status', null] } } },
    { $set: { ledgerStatus: ledgerStatusExpr } },
    ...(status?.length ? [{ $match: { ledgerStatus: { $in: status } } }] : []),
    ...(hasBalance === true ? [{ $match: { prepaidBalance: { $gt: 0 } } }] : []),
    ...(hasBalance === false ? [{ $match: { prepaidBalance: 0 } }] : []),
    { $lookup: { from: 'buildings', localField: 'buildingId', foreignField: '_id', as: 'b' } },
    { $set: { buildingCode: { $first: '$b.code' } } },
    {
      $facet: {
        items: [
          { $sort: SORTS[sort] ?? SORTS['-outstanding'] },
          { $skip: skip },
          { $limit: limit },
          { $lookup: { from: 'users', localField: '_id.p', foreignField: '_id', as: 'u' } },
          byPair('payments', 'rc', [{ $eq: ['$needsReconcile', true] }], [{ $count: 'n' }]),
          {
            $project: {
              _id: 0,
              apartmentId: '$_id.a',
              payerId: '$_id.p',
              apartmentCode: 1,
              buildingId: 1,
              buildingCode: 1,
              payerName: { $first: '$u.fullName' },
              payerPhone: { $first: '$u.phone' },
              ...Object.fromEntries(SUM_FIELDS.map((f) => [f, 1])),
              lastPeriod: 1,
              prepaidBalance: 1,
              ledgerStatus: 1,
              case: {
                $cond: [
                  { $ifNull: ['$case', false] },
                  {
                    _id: '$case._id',
                    status: '$case.status',
                    reminderCount: '$case.reminderCount',
                    lastRemindedAt: '$case.lastRemindedAt',
                    promisedDate: '$case.promisedDate',
                    longOverdueAt: '$case.longOverdueAt',
                  },
                  null,
                ],
              },
              reconcileCount: { $ifNull: [{ $first: '$rc.n' }, 0] },
            },
          },
        ],
        total: [{ $count: 'n' }],
        summary: [
          {
            $group: {
              _id: '$ledgerStatus',
              count: { $sum: 1 },
              outstanding: { $sum: '$outstanding' },
              overdueAmount: { $sum: '$overdueAmount' },
              prepaidBalance: { $sum: '$prepaidBalance' },
            },
          },
        ],
      },
    },
  ];

  const [res] = await Invoice.aggregate(pipeline);
  const byStatus = Object.fromEntries(Object.values(LEDGER_STATUS).map((s) => [s, 0]));
  const summary = { outstanding: 0, overdueAmount: 0, prepaidBalance: 0, byStatus };
  for (const r of res.summary) {
    byStatus[r._id] = r.count;
    summary.outstanding += r.outstanding;
    summary.overdueAmount += r.overdueAmount;
    summary.prepaidBalance += r.prepaidBalance;
  }
  summary.reconcileCount = await Payment.countDocuments({ needsReconcile: true, ...base });
  return { items: res.items, pagination: { page, limit, total: res.total[0]?.n ?? 0 }, summary };
}

/**
 * Chi tiết sổ công nợ của 1 căn: từng Người nộp phí (thông báo đã phát hành, số dư, hồ sơ nợ đang mở), lịch sử xử lý nợ,
 * sổ Số dư trả trước, các giao dịch Cần đối soát. `isCurrentPayer` đánh dấu Người nộp phí hiện tại theo hợp đồng.
 */
export async function getApartmentLedger(apartmentId, { now = new Date() } = {}) {
  const apartment = await Apartment.findById(apartmentId).select('code buildingId status').populate('buildingId', 'code name').lean();
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
  const today = startOfVnDay(now);

  const [invoices, cases, prepaidTransactions, reconcilePayments, debt, currentPayer] = await Promise.all([
    Invoice.find({ apartmentId, status: { $in: [...INVOICE_PUBLISHED_STATUSES] } })
      .sort({ period: -1, createdAt: -1 })
      .select('code period issuedAt dueDate totalAmount paidAmount prepaidApplied status payerId paidAt')
      .lean(),
    DebtFollowup.find({ apartmentId })
      .sort({ createdAt: -1 })
      .populate([
        { path: 'payerId', select: 'fullName' },
        { path: 'activities.by', select: 'fullName' },
      ])
      .lean(),
    PrepaidTransaction.find({ apartmentId }).sort({ createdAt: -1 }).limit(50).populate('payerId', 'fullName').lean(),
    Payment.find({ apartmentId, needsReconcile: true }).sort({ createdAt: -1 }).populate('payerId', 'fullName').lean(),
    checkApartmentDebt(apartmentId),
    getPayer(apartmentId, now).catch(() => null),
  ]);

  const payerIds = new Set([
    ...invoices.map((i) => String(i.payerId ?? '')),
    ...debt.byPayer.map((p) => String(p.payerId ?? '')),
    ...cases.map((c) => String(c.payerId?._id ?? '')),
  ]);
  payerIds.delete('');
  const debtMap = new Map(debt.byPayer.map((p) => [String(p.payerId), p]));
  const nameMap = new Map([
    ...cases.map((c) => [String(c.payerId?._id), c.payerId?.fullName]),
    ...debt.byPayer.map((p) => [String(p.payerId), p.fullName]),
  ]);
  const missing = [...payerIds].filter((id) => !nameMap.get(id));
  if (missing.length) {
    for (const u of await User.find({ _id: { $in: missing } }).select('fullName').lean()) nameMap.set(String(u._id), u.fullName);
  }

  const payers = [...payerIds].map((id) => {
    const mine = invoices.filter((i) => String(i.payerId) === id);
    const d = debtMap.get(id);
    const openCase = cases.find((c) => String(c.payerId?._id) === id && DEBT_OPEN_STATUSES.includes(c.status)) ?? null;
    return {
      payerId: id,
      fullName: nameMap.get(id) ?? null,
      phone: d?.phone ?? null,
      isCurrentPayer: currentPayer ? String(currentPayer.userId) === id : false,
      billed: mine.reduce((s, i) => s + i.totalAmount, 0),
      paid: mine.reduce((s, i) => s + i.paidAmount, 0),
      outstanding: d?.outstanding ?? 0,
      overdueAmount: d?.overdueAmount ?? 0,
      prepaidBalance: d?.prepaidBalance ?? 0,
      net: d?.net ?? 0,
      caseId: openCase?._id ?? null,
      caseStatus: openCase?.status ?? null,
      invoices: mine.map((i) => ({
        ...i,
        outstanding: Math.max(0, i.totalAmount - i.paidAmount),
        overdue: i.status === INVOICE_STATUS.OVERDUE || (i.paidAmount < i.totalAmount && Boolean(i.dueDate && i.dueDate < today)),
      })),
    };
  });
  payers.sort((a, b) => Number(b.isCurrentPayer) - Number(a.isCurrentPayer) || b.outstanding - a.outstanding);

  return { apartment, currentPayerId: currentPayer?.userId ?? null, debt, payers, cases, prepaidTransactions, reconcilePayments };
}
