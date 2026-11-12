// Mô đun 4 — UC30 Ghi nhận thu tiền mặt / chuyển khoản, UC35 Biên lai.
// Một lần thu của Người nộp phí được phân bổ vào các thông báo còn nợ của chính người đó tại căn, CŨ NHẤT TRƯỚC;
// tiền thừa ghi vào Số dư trả trước (tự trừ khi phát hành kỳ sau). Phiếu thu PT-YYYYMM-xxxxx (BR-F11).
// Cập nhật thông báo có điều kiện paidAmount cũ → hai người ghi nhận cùng lúc không cộng trùng.
import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  INVOICE_OUTSTANDING_STATUSES,
  INVOICE_STATUS,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PREPAID_TX_TYPES,
  ROLES,
} from '../../constants/enums.js';
import { Invoice, Payment, PrepaidBalance, PrepaidTransaction } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { fmtDateTimeVn, periodLabel, toVnYmd } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';
import { closeCaseIfCleared } from '../debts/debts.cases.js';
import { isDuplicateOn } from '../invoices/invoices.service.js';

const MAX_ATTEMPTS = 3;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** Phiếu thu kế tiếp trong tháng của ngày thu (giờ VN): PT-202610-00001 */
async function nextReceiptNo(paidAt, session) {
  const prefix = `PT-${toVnYmd(paidAt).slice(0, 7).replace('-', '')}-`;
  const last = await Payment.findOne({ receiptNo: { $regex: `^${escapeRegex(prefix)}\\d+$` } })
    .sort({ receiptNo: -1 })
    .select('receiptNo')
    .session(session)
    .lean();
  const seq = last ? Number(last.receiptNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/** Xác định căn + Người nộp phí: từ 1 thông báo cụ thể, hoặc truyền thẳng apartmentId + payerId */
async function resolvePayer({ invoiceId, apartmentId, payerId }) {
  if (invoiceId) {
    const inv = await Invoice.findById(invoiceId).select('apartmentId payerId status code').lean();
    if (!inv) throw ApiError.notFound('Không tìm thấy thông báo phí');
    if (!INVOICE_OUTSTANDING_STATUSES.includes(inv.status)) {
      throw ApiError.badRequest(`Thông báo ${inv.code} không còn nợ (hoặc chưa phát hành), không ghi nhận thu được`);
    }
    return { apartmentId: inv.apartmentId, payerId: inv.payerId };
  }
  return { apartmentId: oid(apartmentId), payerId: oid(payerId) };
}

/** Các thông báo còn nợ của Người nộp phí tại căn, cũ nhất trước. `invoiceIds`: chỉ trong các thông báo đã chọn (payOS) */
const outstandingInvoices = (apartmentId, payerId, session, invoiceIds = null) =>
  Invoice.find({
    apartmentId,
    payerId,
    status: { $in: [...INVOICE_OUTSTANDING_STATUSES] },
    ...(invoiceIds && { _id: { $in: invoiceIds } }),
  })
    .sort({ period: 1, createdAt: 1 })
    .select('code period totalAmount paidAmount status')
    .session(session)
    .lean();

/** Chia số tiền vào các thông báo (cũ nhất trước), phần còn lại = tiền thừa */
export function allocate(invoices, amount) {
  let left = amount;
  const allocations = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    const owed = inv.totalAmount - (inv.paidAmount ?? 0);
    if (owed <= 0) continue;
    const take = Math.min(owed, left);
    allocations.push({ invoice: inv, amount: take });
    left -= take;
  }
  return { allocations, credit: left };
}

// Trả một phần khi đã quá hạn vẫn giữ OVERDUE cho tới khi trả đủ
const statusAfter = (inv, paidAmount) => {
  if (paidAmount >= inv.totalAmount) return INVOICE_STATUS.PAID;
  return inv.status === INVOICE_STATUS.OVERDUE ? INVOICE_STATUS.OVERDUE : INVOICE_STATUS.PARTIALLY_PAID;
};

/**
 * Lõi gạch nợ dùng chung (tiền mặt / chuyển khoản tay, payOS webhook): phân bổ, cập nhật thông báo,
 * tiền thừa → Số dư trả trước, ghi sổ. `invoiceIds` (payOS): chỉ phân bổ vào các thông báo cư dân đã chọn; thông báo đã
 * được trả bằng cách khác thì phần tiền đó vào Số dư trả trước (M4-3). Chạy trong `session` của transaction bên ngoài. Trả về { allocations, credit, balanceAfter }.
 */
export async function applyPayment({ paymentId, apartmentId, payerId, amount, paidAt, createdBy = null, invoiceIds = null }, session) {
  const invoices = await outstandingInvoices(apartmentId, payerId, session, invoiceIds);
  const { allocations, credit } = allocate(invoices, amount);

  for (const { invoice: inv, amount: take } of allocations) {
    const paidAmount = inv.paidAmount + take;
    const status = statusAfter(inv, paidAmount);
    const res = await Invoice.updateOne(
      { _id: inv._id, paidAmount: inv.paidAmount, status: inv.status },
      { $set: { paidAmount, status, ...(status === INVOICE_STATUS.PAID && { paidAt }) } },
      { session },
    );
    if (res.matchedCount !== 1) throw new ApiError('CONCURRENT_UPDATE');
  }

  let balanceAfter = null;
  if (credit > 0) {
    const bal = await PrepaidBalance.findOneAndUpdate(
      { apartmentId, payerId },
      { $inc: { balance: credit } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    ).lean();
    balanceAfter = bal.balance;
    await PrepaidTransaction.create(
      [
        {
          apartmentId,
          payerId,
          type: PREPAID_TX_TYPES.DEPOSIT,
          amount: credit,
          balanceAfter,
          paymentId,
          note: allocations.length ? 'Tiền thừa sau khi trả đủ các thông báo còn nợ' : 'Nộp trước (không có thông báo còn nợ)',
          createdBy,
        },
      ],
      { session },
    );
  }
  // Trả hết các khoản quá hạn → đóng hồ sơ nợ ngay (không đợi cron nhắc nợ hôm sau)
  if (allocations.length) await closeCaseIfCleared(apartmentId, payerId, { session });
  return {
    allocations: allocations.map((a) => ({ invoiceId: a.invoice._id, amount: a.amount, code: a.invoice.code, period: a.invoice.period })),
    credit,
    balanceAfter,
  };
}

/** Kế toán ghi nhận tiền mặt / chuyển khoản. body: { invoiceId | apartmentId+payerId, method, amount, bankRef?, note?, paidAt? } */
export async function recordOfflinePayment(user, body, { now = new Date() } = {}) {
  const { method, amount, note = null } = body;
  const bankRef = body.bankRef?.trim() || null;
  const paidAt = body.paidAt ?? now;
  if (paidAt > now) throw ApiError.badRequest('Ngày thu không được ở tương lai');
  if (method === PAYMENT_METHODS.BANK_TRANSFER && !bankRef) throw ApiError.badRequest('Chuyển khoản phải nhập mã giao dịch ngân hàng');
  if (bankRef && (await Payment.exists({ bankRef }))) throw new ApiError('PAYMENT_DUPLICATE');

  const { apartmentId, payerId } = await resolvePayer(body);
  if (!payerId) throw ApiError.badRequest('Không xác định được Người nộp phí');

  for (let attempt = 1; ; attempt += 1) {
    try {
      const { payment, result } = await withTransaction(async (session) => {
        const paymentId = new mongoose.Types.ObjectId();
        const result = await applyPayment({ paymentId, apartmentId, payerId, amount, paidAt, createdBy: user.id }, session);
        const [payment] = await Payment.create(
          [
            {
              _id: paymentId,
              apartmentId,
              payerId,
              invoiceId: result.allocations[0]?.invoiceId ?? null,
              allocations: result.allocations.map(({ invoiceId, amount: a }) => ({ invoiceId, amount: a })),
              creditAmount: result.credit,
              method,
              amount,
              status: PAYMENT_STATUS.SUCCESS,
              receiptNo: await nextReceiptNo(paidAt, session),
              bankRef,
              note,
              confirmedBy: user.id,
              paidAt,
            },
          ],
          { session },
        );
        await logAudit(
          {
            action: AUDIT_ACTIONS.PAYMENT_CONFIRMED,
            user,
            targetType: AUDIT_TARGETS.PAYMENT,
            targetId: paymentId,
            metadata: { receiptNo: payment.receiptNo, method, amount, credit: result.credit, invoices: result.allocations.map((a) => a.code) },
          },
          { session },
        );
        return { payment: payment.toObject(), result };
      });
      await sendReceipt(payment, result);
      return { ...payment, allocations: result.allocations, balanceAfter: result.balanceAfter };
    } catch (err) {
      if (isDuplicateOn(err, 'bankRef')) throw new ApiError('PAYMENT_DUPLICATE');
      const retriable = err.errorCode === 'CONCURRENT_UPDATE' || isDuplicateOn(err, 'receiptNo');
      if (!retriable || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

/** Số biên lai: số phiếu thu (tiền mặt / chuyển khoản) hoặc mã đơn payOS */
export const receiptNumber = (p) => p.receiptNo ?? (p.orderCode ? `PAYOS-${p.orderCode}` : String(p._id).slice(-8).toUpperCase());

export const VAT_NOTE = 'Biên lai chỉ xác nhận Ban quản lý đã nhận tiền, không thay thế hóa đơn giá trị gia tăng (GTGT).';

/** Biên lai điện tử cho Người nộp phí (Web + Email) */
export function sendReceipt(payment, { allocations, credit, balanceAfter }) {
  const no = receiptNumber(payment);
  const lines = [`Đã nhận ${formatVnd(payment.amount)} lúc ${fmtDateTimeVn(payment.paidAt)}. Số biên lai ${no}.`];
  for (const a of allocations) lines.push(`• Kỳ ${periodLabel(a.period)} (${a.code}): ${formatVnd(a.amount)}`);
  if (credit > 0) lines.push(`Tiền thừa ${formatVnd(credit)} đã vào Số dư trả trước (số dư hiện tại ${formatVnd(balanceAfter)}).`);
  lines.push(VAT_NOTE);
  return notify(payment.payerId, {
    type: NOTIFICATION_TYPES.PAYMENT_RECEIPT,
    title: `Biên lai ${no}`,
    content: lines.join('\n'),
    refId: payment._id,
    link: `/r/payments/${payment._id}/receipt`,
    email: true,
  }).catch((err) => console.error(`[payment] gửi biên lai ${no} lỗi:`, err));
}

// ---------------------------------------------------------------------------
// Xem
// ---------------------------------------------------------------------------
export async function listPayments({ method, status, apartmentId, payerId, from, to, q, needsReconcile, ...query }) {
  const filter = {};
  if (needsReconcile !== undefined) filter.needsReconcile = needsReconcile;
  if (method?.length) filter.method = { $in: method };
  if (status) filter.status = status;
  if (apartmentId) filter.apartmentId = oid(apartmentId);
  if (payerId) filter.payerId = oid(payerId);
  if (from || to) filter.paidAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (q) {
    const rx = { $regex: escapeRegex(q.trim()), $options: 'i' };
    filter.$or = [{ receiptNo: rx }, { bankRef: rx }, { reference: rx }];
    // Mã giao dịch payOS (orderCode) là số: tìm đúng mã — dùng khi bấm từ cảnh báo "Cần đối soát"
    if (/^\d{1,15}$/.test(q.trim())) filter.$or.push({ orderCode: Number(q.trim()) });
  }
  const [{ items, pagination }, [totals]] = await Promise.all([
    paginate(Payment, filter, { ...query, sort: query.sort ?? '-paidAt' }, {
      populate: [
        { path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code' } },
        { path: 'payerId', select: 'fullName' },
        { path: 'confirmedBy', select: 'fullName' },
      ],
    }),
    Payment.aggregate([
      { $match: { ...filter, status: filter.status ?? PAYMENT_STATUS.SUCCESS } },
      { $group: { _id: null, amount: { $sum: '$amount' }, credit: { $sum: '$creditAmount' }, count: { $sum: 1 } } },
    ]),
  ]);
  return { items, pagination, totals: totals ?? { amount: 0, credit: 0, count: 0 } };
}

const STAFF = [ROLES.ACCOUNTANT, ROLES.MANAGER];

/** Biên lai: đã trả, phân bổ vào thông báo nào, số còn nợ hiện tại, số dư trả trước. Cư dân chỉ xem biên lai của mình */
export async function getReceipt(user, id) {
  const payment = await Payment.findById(id)
    .populate([
      { path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code name' } },
      { path: 'payerId', select: 'fullName phone' },
      { path: 'confirmedBy', select: 'fullName' },
      { path: 'allocations.invoiceId', select: 'code period totalAmount paidAmount status' },
      { path: 'bookingId', select: 'date slotStart slotEnd fee status', populate: { path: 'amenityId', select: 'name' } },
    ])
    .lean();
  const own = payment && sameId(payment.payerId?._id, user.id);
  if (!payment || (!STAFF.includes(user.role) && !own)) throw ApiError.notFound('Không tìm thấy giao dịch');

  const aptId = payment.apartmentId?._id;
  const payerId = payment.payerId?._id;
  const [[debt], balance] = await Promise.all([
    Invoice.aggregate([
      { $match: { apartmentId: aptId, payerId, status: { $in: [...INVOICE_OUTSTANDING_STATUSES] } } },
      { $group: { _id: null, outstanding: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } } } },
    ]),
    PrepaidBalance.findOne({ apartmentId: aptId, payerId }).select('balance').lean(),
  ]);
  return {
    ...payment,
    allocations: payment.allocations.map((a) => ({
      amount: a.amount,
      invoice: a.invoiceId && {
        _id: a.invoiceId._id,
        code: a.invoiceId.code,
        period: a.invoiceId.period,
        status: a.invoiceId.status,
        outstanding: Math.max(0, a.invoiceId.totalAmount - (a.invoiceId.paidAmount ?? 0)),
      },
    })),
    receiptNumber: receiptNumber(payment),
    vatNote: VAT_NOTE,
    currentOutstanding: debt?.outstanding ?? 0,
    prepaidBalance: balance?.balance ?? 0,
  };
}
