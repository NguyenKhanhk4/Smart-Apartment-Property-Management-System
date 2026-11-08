// Mô đun 4 — UC23 Kiểm tra công nợ căn hộ (dùng chung cho chuyển nhượng và sổ công nợ).
// Công nợ tách theo từng Người nộp phí (X1): nợ ròng của 1 người = max(0, còn nợ − Số dư trả trước của chính người đó);
// số dư của người này không bù nợ của người khác. Tổng nợ căn = tổng nợ ròng các Người nộp phí.
import mongoose from 'mongoose';
import { INVOICE_OUTSTANDING_STATUSES, INVOICE_PUBLISHED_STATUSES, INVOICE_STATUS, PAYMENT_STATUS } from '../../constants/enums.js';
import { Invoice, Payment, PrepaidBalance, PrepaidTransaction, User } from '../../models/index.js';
import { startOfVnDay } from '../../utils/time.js';

const { OVERDUE, UNPAID, PARTIALLY_PAID } = INVOICE_STATUS;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Điều kiện "đang quá hạn" cho find(): đã OVERDUE, hoặc còn nợ mà hạn đóng trước 00:00 hôm nay (giờ VN) — để không phụ
 * thuộc giờ chạy cron INVOICE_OVERDUE.
 */
export const overdueFilter = (today) => ({
  $or: [{ status: OVERDUE }, { status: { $in: [UNPAID, PARTIALLY_PAID] }, dueDate: { $ne: null, $lt: today } }],
});

/** Cùng điều kiện cho $expr trong aggregation */
export const overdueExpr = (today) => ({
  $or: [
    { $eq: ['$status', OVERDUE] },
    {
      $and: [{ $in: ['$status', [UNPAID, PARTIALLY_PAID]] }, { $ne: [{ $ifNull: ['$dueDate', null] }, null] }, { $lt: ['$dueDate', today] }],
    },
  ],
});

/** Người nộp phí này tại căn còn khoản nào quá hạn không */
export const hasOverdueDebt = (apartmentId, payerId, today, session = null) =>
  Invoice.exists({ apartmentId, payerId, ...overdueFilter(today) })
    .session(session)
    .then(Boolean);

/** Thông báo còn nợ hiện tại (theo paidAmount đang lưu) */
async function currentSnapshot(apartmentId, today) {
  const [invoices, balances] = await Promise.all([
    Invoice.find({ apartmentId, status: { $in: [...INVOICE_OUTSTANDING_STATUSES] } })
      .sort({ period: 1, createdAt: 1 })
      .select('code period dueDate totalAmount paidAmount status payerId')
      .lean(),
    PrepaidBalance.find({ apartmentId, balance: { $gt: 0 } }).select('payerId balance').lean(),
  ]);
  return {
    invoices: invoices.map((i) => ({
      ...i,
      paid: i.paidAmount,
      outstanding: Math.max(0, i.totalAmount - (i.paidAmount ?? 0)),
      overdue: i.status === OVERDUE || Boolean(i.dueDate && i.dueDate < today),
    })),
    balances: balances.map((b) => ({ payerId: b.payerId, balance: b.balance })),
  };
}

/**
 * Dựng lại công nợ tại một thời điểm trong quá khứ từ lịch sử: thông báo phát hành trước `at`, đã trả = phần trừ Số dư trả
 * trước lúc phát hành + các lần thu thành công trước `at`; số dư = số dư sau giao dịch số dư cuối cùng trước `at`.
 */
async function historicalSnapshot(apartmentId, at) {
  const atDay = startOfVnDay(at);
  const [invoices, paidRows, balanceRows] = await Promise.all([
    Invoice.find({ apartmentId, status: { $in: [...INVOICE_PUBLISHED_STATUSES] }, issuedAt: { $ne: null, $lte: at } })
      .sort({ period: 1, createdAt: 1 })
      .select('code period dueDate totalAmount prepaidApplied status payerId')
      .lean(),
    Payment.aggregate([
      { $match: { apartmentId: oid(apartmentId), status: PAYMENT_STATUS.SUCCESS, paidAt: { $lte: at } } },
      { $unwind: '$allocations' },
      { $group: { _id: '$allocations.invoiceId', amount: { $sum: '$allocations.amount' } } },
    ]),
    PrepaidTransaction.aggregate([
      { $match: { apartmentId: oid(apartmentId), createdAt: { $lte: at } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$payerId', balance: { $first: '$balanceAfter' } } },
    ]),
  ]);
  const paidMap = new Map(paidRows.map((r) => [String(r._id), r.amount]));
  const rows = invoices
    .map((i) => {
      const paid = Math.min(i.totalAmount, (i.prepaidApplied ?? 0) + (paidMap.get(String(i._id)) ?? 0));
      const outstanding = i.totalAmount - paid;
      return { ...i, paid, outstanding, overdue: outstanding > 0 && Boolean(i.dueDate && i.dueDate < atDay) };
    })
    .filter((i) => i.outstanding > 0);
  return { invoices: rows, balances: balanceRows.filter((b) => b.balance > 0).map((b) => ({ payerId: b._id, balance: b.balance })) };
}

/**
 * UC23 — công nợ của căn tại thời điểm `at` (mặc định bây giờ), tách theo Người nộp phí.
 * @returns {{ apartmentId, at, amount, outstanding, overdueAmount, prepaidBalance, credit, invoiceCount, available: true,
 *   byPayer: Array<{ payerId, fullName, phone, outstanding, overdueAmount, prepaidBalance, net, credit, invoices }> }}
 *   `amount` = tổng nợ ròng; `credit` = số dư trả trước vượt quá nợ (cần hoàn khi chuyển nhượng).
 */
export async function checkApartmentDebt(apartmentId, { at } = {}) {
  const now = new Date();
  const atDate = at ? new Date(at) : now;
  const historical = atDate < now;
  const { invoices, balances } = historical
    ? await historicalSnapshot(apartmentId, atDate)
    : await currentSnapshot(apartmentId, startOfVnDay(now));

  const payers = new Map();
  const payerOf = (payerId) => {
    const k = String(payerId ?? 'null');
    if (!payers.has(k)) payers.set(k, { payerId: payerId ?? null, outstanding: 0, overdueAmount: 0, prepaidBalance: 0, invoices: [] });
    return payers.get(k);
  };
  for (const inv of invoices) {
    const p = payerOf(inv.payerId);
    p.outstanding += inv.outstanding;
    if (inv.overdue) p.overdueAmount += inv.outstanding;
    p.invoices.push({
      _id: inv._id,
      code: inv.code,
      period: inv.period,
      dueDate: inv.dueDate,
      status: inv.status,
      totalAmount: inv.totalAmount,
      paid: inv.paid,
      outstanding: inv.outstanding,
      overdue: inv.overdue,
    });
  }
  for (const b of balances) payerOf(b.payerId).prepaidBalance += b.balance;

  const ids = [...payers.values()].map((p) => p.payerId).filter(Boolean);
  const users = await User.find({ _id: { $in: ids } }).select('fullName phone').lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const byPayer = [...payers.values()].map((p) => ({
    ...p,
    fullName: userMap.get(String(p.payerId))?.fullName ?? null,
    phone: userMap.get(String(p.payerId))?.phone ?? null,
    net: Math.max(0, p.outstanding - p.prepaidBalance),
    credit: Math.max(0, p.prepaidBalance - p.outstanding),
  }));
  byPayer.sort((a, b) => b.net - a.net);
  const sum = (field) => byPayer.reduce((s, p) => s + p[field], 0);
  return {
    apartmentId: oid(apartmentId),
    at: atDate,
    amount: sum('net'),
    outstanding: sum('outstanding'),
    overdueAmount: sum('overdueAmount'),
    prepaidBalance: sum('prepaidBalance'),
    credit: sum('credit'),
    invoiceCount: invoices.length,
    available: true,
    byPayer,
  };
}
