// Mô đun 4 — UC29 Thanh toán online qua payOS (VietQR).
//   1. Người nộp phí chọn thông báo còn nợ → tạo giao dịch PENDING + link payOS (orderCode số nguyên duy nhất,
//      số tiền = tổng còn nợ đã chọn, hết hạn sau 15 phút).
//   2. payOS gọi webhook (đã ký HMAC) → gạch nợ đúng 1 lần (claim có điều kiện status), gửi biên lai.
//      Dev chạy localhost không nhận được webhook: trang kết quả gọi tra cứu → server hỏi thẳng payOS rồi gạch nợ.
//   3. Cron đối soát: hỏi payOS các giao dịch còn chờ; quá 15 phút chưa rõ → đánh dấu Cần đối soát.
// Thông báo đã được trả bằng cách khác trong lúc chờ → tiền vào Số dư trả trước, không báo lỗi (M4-3).
// Booking tiện ích có phí (Mô đun 6) cũng trả qua đây: link hết hạn đúng lúc hết giữ chỗ; tiền về muộn mà hết chỗ
// thì vào Số dư trả trước (M6-1).
import {
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  INVOICE_OUTSTANDING_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  ROLES,
} from '../../constants/enums.js';
import { Booking, Invoice, Payment } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { confirmGatewayPayment } from '../bookings/bookings.service.js';
import { formatVnd } from '../amenities/pricing.js';
import { getMyHouseholds } from '../household/household.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { MINUTE_MS, fmtDateVn } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { isDuplicateOn } from '../invoices/invoices.service.js';
import { applyPayment, sendReceipt } from './payments.service.js';
import * as payos from './payos.client.js';

export const LINK_TTL_MINUTES = 15;
const RECONCILE_AFTER_MS = LINK_TTL_MINUTES * MINUTE_MS;
const MAX_ATTEMPTS = 3;
const { PENDING, SUCCESS, FAILED } = PAYMENT_STATUS;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** orderCode: số nguyên ≤ 13 chữ số (an toàn với Number), unique index chặn trùng → thử lại */
const newOrderCode = () => Number(`${Date.now() % 10_000_000_000}${Math.floor(Math.random() * 1000)}`.padEnd(13, '0'));

const shortPeriod = (p) => `T${p.slice(5)}-${p.slice(0, 4)}`;

/** Nội dung chuyển khoản mẫu `<Mã căn> <Kỳ>` (vd A1205 T10-2026), payOS giới hạn 25 ký tự */
function descriptionOf(apartment, invoices) {
  const apt = `${apartment.buildingId?.code ?? ''}${apartment.code}`.replace(/[^A-Za-z0-9]/g, '');
  const periods = invoices.map((i) => i.period).sort();
  const tail = periods.length === 1 ? shortPeriod(periods[0]) : `${shortPeriod(periods.at(-1))} ${periods.length}KY`;
  return `${apt} ${tail}`.slice(0, 25);
}

const linkView = (p) => ({
  paymentId: p._id,
  orderCode: p.orderCode,
  amount: p.amount,
  checkoutUrl: p.checkoutUrl,
  qrCode: p.qrCode,
  expiredAt: p.expiredAt,
  status: p.status,
});

// ---------------------------------------------------------------------------
// Tạo link
// ---------------------------------------------------------------------------
export async function createPayosPayment(user, { invoiceIds }, { now = new Date() } = {}) {
  if (!payos.isPayosEnabled()) throw new ApiError('PAYOS_DISABLED');
  const invoices = await Invoice.find({ _id: { $in: invoiceIds } })
    .populate({ path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code' } })
    .sort({ period: 1 })
    .lean();
  if (invoices.length !== new Set(invoiceIds.map(String)).size) throw ApiError.notFound('Không tìm thấy thông báo phí');
  if (invoices.some((i) => !sameId(i.payerId, user.id))) {
    throw ApiError.forbidden('Chỉ Người nộp phí của thông báo mới thanh toán được');
  }
  const apartment = invoices[0].apartmentId;
  if (invoices.some((i) => !sameId(i.apartmentId?._id, apartment._id))) {
    throw ApiError.badRequest('Chỉ thanh toán cùng lúc các thông báo của một căn hộ');
  }
  const notDue = invoices.find((i) => !INVOICE_OUTSTANDING_STATUSES.includes(i.status));
  if (notDue) throw ApiError.badRequest(`Thông báo ${notDue.code} không còn nợ`);

  const planned = invoices.map((i) => ({ invoiceId: i._id, amount: i.totalAmount - i.paidAmount }));
  const amount = planned.reduce((s, a) => s + a.amount, 0);
  const ids = planned.map((a) => String(a.invoiceId)).sort();

  // Đã có link còn hạn cho đúng các thông báo này → dùng lại, không tạo link thứ hai
  const reusable = await Payment.findOne({
    method: PAYMENT_METHODS.PAYOS,
    status: PENDING,
    payerId: user.id,
    amount,
    expiredAt: { $gt: new Date(now.getTime() + MINUTE_MS) },
    checkoutUrl: { $ne: null },
  }).lean();
  if (reusable && reusable.allocations.map((a) => String(a.invoiceId)).sort().join() === ids.join()) return linkView(reusable);

  const expiredAt = new Date(now.getTime() + RECONCILE_AFTER_MS);
  for (let attempt = 1; ; attempt += 1) {
    let payment;
    try {
      // Lưu PENDING trước khi gọi payOS: webhook về sớm vẫn tìm thấy giao dịch
      payment = await Payment.create({
        apartmentId: apartment._id,
        payerId: user.id,
        invoiceId: planned[0].invoiceId,
        allocations: planned,
        method: PAYMENT_METHODS.PAYOS,
        amount,
        status: PENDING,
        orderCode: newOrderCode(),
        expiredAt,
      });
    } catch (err) {
      if (isDuplicateOn(err, 'orderCode') && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }

    try {
      const link = await payos.createPaymentLink({
        orderCode: payment.orderCode,
        amount,
        description: descriptionOf(apartment, invoices),
        expiredAt,
        items: invoices.map((i) => ({ name: `Phi ${shortPeriod(i.period)}`, quantity: 1, price: i.totalAmount - i.paidAmount })),
      });
      const saved = await Payment.findByIdAndUpdate(
        payment._id,
        { $set: { paymentLinkId: link.paymentLinkId, checkoutUrl: link.checkoutUrl, qrCode: link.qrCode } },
        { new: true },
      ).lean();
      return linkView(saved);
    } catch (err) {
      await Payment.updateOne({ _id: payment._id, status: PENDING }, { $set: { status: FAILED, note: 'Không tạo được link payOS' } });
      throw err;
    }
  }
}

/**
 * Link payOS trả phí booking đang giữ chỗ (PENDING_PAYMENT). Người trong căn của booking mới tạo được; link hết hạn
 * cùng lúc hết giữ chỗ. Đã có link còn hạn thì dùng lại.
 */
export async function createBookingPayosPayment(user, bookingId, { now = new Date() } = {}) {
  if (!payos.isPayosEnabled()) throw new ApiError('PAYOS_DISABLED');
  const booking = await Booking.findById(bookingId)
    .populate({ path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code' } })
    .lean();
  const mine = booking ? await getMyHouseholds(user.id) : [];
  if (!booking || !mine.some((h) => sameId(h.apartment._id, booking.apartmentId?._id))) throw ApiError.notFound('Không tìm thấy booking');
  if (booking.status !== BOOKING_STATUS.PENDING_PAYMENT) throw new ApiError('BOOKING_INVALID_STATUS');
  // payOS cần thời hạn trong tương lai; còn dưới 1 phút thì coi như hết giữ chỗ
  if (!(booking.holdExpiresAt > new Date(now.getTime() + MINUTE_MS))) throw new ApiError('BOOKING_HOLD_EXPIRED');

  const reusable = await Payment.findOne({
    bookingId: booking._id,
    method: PAYMENT_METHODS.PAYOS,
    status: PENDING,
    checkoutUrl: { $ne: null },
    expiredAt: { $gt: new Date(now.getTime() + MINUTE_MS) },
  }).lean();
  if (reusable) return linkView(reusable);

  const apartment = booking.apartmentId;
  const apt = `${apartment.buildingId?.code ?? ''}${apartment.code}`.replace(/[^A-Za-z0-9]/g, '');
  const day = fmtDateVn(booking.date).slice(0, 5).replace('/', '');
  for (let attempt = 1; ; attempt += 1) {
    let payment;
    try {
      payment = await Payment.create({
        apartmentId: apartment._id,
        payerId: booking.chargedTo ?? user.id,
        bookingId: booking._id,
        method: PAYMENT_METHODS.PAYOS,
        amount: booking.fee,
        status: PENDING,
        orderCode: newOrderCode(),
        expiredAt: booking.holdExpiresAt,
      });
    } catch (err) {
      if (isDuplicateOn(err, 'orderCode') && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
    try {
      const link = await payos.createPaymentLink({
        orderCode: payment.orderCode,
        amount: booking.fee,
        description: `${apt} TIEN ICH ${day}`.slice(0, 25),
        expiredAt: booking.holdExpiresAt,
        items: [{ name: `Dat ${booking.slotStart}-${booking.slotEnd}`, quantity: 1, price: booking.fee }],
      });
      const saved = await Payment.findByIdAndUpdate(
        payment._id,
        { $set: { paymentLinkId: link.paymentLinkId, checkoutUrl: link.checkoutUrl, qrCode: link.qrCode } },
        { new: true },
      ).lean();
      return linkView(saved);
    } catch (err) {
      await Payment.updateOne({ _id: payment._id, status: PENDING }, { $set: { status: FAILED, note: 'Không tạo được link payOS' } });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Gạch nợ (webhook + tra cứu + cron dùng chung)
// ---------------------------------------------------------------------------

/** "2026-10-20 10:15:00" (giờ VN, payOS) → Date */
function parsePayosTime(text, fallback) {
  const d = text ? new Date(`${String(text).trim().replace(' ', 'T')}+07:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

/**
 * Ghi nhận tiền payOS đã về cho giao dịch `payment` (PENDING, hoặc FAILED nhưng thực tế đã trả).
 * Claim có điều kiện status nên webhook + tra cứu + cron chạy song song cũng chỉ gạch nợ 1 lần. Trả về payment đã xử lý hoặc null.
 */
async function completePayos(payment, received) {
  return payment.bookingId ? completeBookingPayos(payment, received) : completeInvoicePayos(payment, received);
}

/**
 * Tiền payOS về cho booking: xác nhận booking. Không xác nhận được (hết chỗ / booking đã hủy) hoặc trả thiếu
 * → toàn bộ tiền vào Số dư trả trước của người trả; số tiền lệch thì đánh dấu Cần đối soát.
 */
async function completeBookingPayos(payment, { amount, reference, paidAt }) {
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: [PENDING, FAILED] } },
    { $set: { status: SUCCESS, paidAt, reference: reference ?? null, amount } },
    { new: true },
  ).lean();
  if (!claimed) return null;

  try {
    const mismatch = amount !== payment.amount;
    const result =
      amount >= payment.amount
        ? await confirmGatewayPayment(payment.bookingId, { paymentRef: String(payment.orderCode), paidAt })
        : { confirmed: false, reason: 'UNDERPAID' };

    let credit = 0;
    let balanceAfter = null;
    if (!result.confirmed) {
      const applied = await withTransaction((session) =>
        applyPayment({ paymentId: payment._id, apartmentId: payment.apartmentId, payerId: payment.payerId, amount, paidAt, invoiceIds: [] }, session),
      );
      credit = applied.credit;
      balanceAfter = applied.balanceAfter;
    }
    const note = !result.confirmed
      ? `Không xác nhận được booking (${result.reason}), tiền vào Số dư trả trước`
      : mismatch
        ? `payOS báo nhận ${amount} khác phí booking ${payment.amount}`
        : undefined;
    const saved = await Payment.findByIdAndUpdate(
      payment._id,
      { $set: { creditAmount: credit, needsReconcile: mismatch, ...(note && { note }) } },
      { new: true },
    ).lean();
    await logAudit({
      action: AUDIT_ACTIONS.PAYMENT_CONFIRMED,
      user: null,
      targetType: AUDIT_TARGETS.PAYMENT,
      targetId: payment._id,
      metadata: { method: PAYMENT_METHODS.PAYOS, orderCode: payment.orderCode, reference, amount, bookingId: payment.bookingId, credit },
    });
    if (credit > 0) {
      await notify(payment.payerId, {
        type: NOTIFICATION_TYPES.PAYMENT_RECEIPT,
        title: 'Không giữ được chỗ tiện ích',
        content:
          `Đã nhận ${formatVnd(amount)} nhưng khung giờ đã hết chỗ hoặc booking đã hủy. Số tiền đã vào Số dư trả trước ` +
          `(số dư hiện tại ${formatVnd(balanceAfter)}), được trừ vào thông báo phí kỳ sau.`,
        refId: payment._id,
        email: true,
      });
    }
    return saved;
  } catch (err) {
    // MongoDB standalone không rollback: trả giao dịch về trạng thái cũ để lần sau xử lý lại
    await Payment.updateOne({ _id: payment._id, status: SUCCESS, creditAmount: 0 }, { $set: { status: payment.status } });
    throw err;
  }
}

async function completeInvoicePayos(payment, { amount, reference, paidAt }) {
  const plannedIds = payment.allocations.map((a) => a.invoiceId);
  const mismatch = amount !== payment.amount;

  const run = () =>
    withTransaction(async (session) => {
    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $in: [PENDING, FAILED] } },
      { $set: { status: SUCCESS, paidAt, reference: reference ?? null, amount } },
      { new: true, session },
    ).lean();
    if (!claimed) return null;

    const result = await applyPayment(
      { paymentId: payment._id, apartmentId: payment.apartmentId, payerId: payment.payerId, amount, paidAt, invoiceIds: plannedIds },
      session,
    );
    const saved = await Payment.findByIdAndUpdate(
      payment._id,
      {
        $set: {
          allocations: result.allocations.map(({ invoiceId, amount: a }) => ({ invoiceId, amount: a })),
          invoiceId: result.allocations[0]?.invoiceId ?? payment.invoiceId,
          creditAmount: result.credit,
          needsReconcile: mismatch,
          ...(mismatch && { note: `payOS báo nhận ${amount} khác số tiền tạo link ${payment.amount}` }),
        },
      },
      { new: true, session },
    ).lean();
    await logAudit(
      {
        action: AUDIT_ACTIONS.PAYMENT_CONFIRMED,
        user: null,
        targetType: AUDIT_TARGETS.PAYMENT,
        targetId: payment._id,
        metadata: { method: PAYMENT_METHODS.PAYOS, orderCode: payment.orderCode, reference, amount, credit: result.credit },
      },
      { session },
    );
    return { saved, result };
    });

  let done;
  for (let attempt = 1; ; attempt += 1) {
    try {
      done = await run();
      break;
    } catch (err) {
      // MongoDB standalone không rollback: trả giao dịch về trạng thái cũ để lần sau xử lý lại
      await Payment.updateOne({ _id: payment._id, status: SUCCESS, allocations: payment.allocations }, { $set: { status: payment.status } });
      if (err.errorCode !== 'CONCURRENT_UPDATE' || attempt >= MAX_ATTEMPTS) throw err;
    }
  }

  if (!done) return null;
  await sendReceipt(done.saved, done.result);
  return done.saved;
}

/** payOS gọi về. Chữ ký sai → 400. orderCode lạ (vd webhook thử khi xác nhận URL) → bỏ qua, vẫn trả 200 */
export async function handlePayosWebhook(body) {
  if (!payos.isValidSignature(body?.data, body?.signature)) throw new ApiError('PAYOS_INVALID_SIGNATURE');
  const { data } = body;
  const payment = await Payment.findOne({ orderCode: Number(data.orderCode), method: PAYMENT_METHODS.PAYOS }).lean();
  if (!payment) return { handled: false, reason: 'UNKNOWN_ORDER' };
  if (body.code !== '00' || data.code !== '00') return { handled: false, reason: 'NOT_PAID' };
  if (payment.status === SUCCESS) return { handled: false, reason: 'ALREADY_PROCESSED' };

  const done = await completePayos(payment, {
    amount: Number(data.amount),
    reference: data.reference,
    paidAt: parsePayosTime(data.transactionDateTime, new Date()),
  });
  return { handled: Boolean(done) };
}

/** Hỏi payOS trạng thái 1 giao dịch còn chờ rồi cập nhật. Trả về trạng thái payOS */
export async function syncPayosPayment(payment, { now = new Date() } = {}) {
  const info = await payos.getPaymentLink(payment.orderCode);
  if (info.status === 'PAID') {
    const tx = info.transactions?.at(-1);
    await completePayos(payment, {
      amount: Number(info.amountPaid ?? info.amount),
      reference: tx?.reference,
      paidAt: parsePayosTime(tx?.transactionDateTime, now),
    });
  } else if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
    await Payment.updateOne(
      { _id: payment._id, status: PENDING },
      { $set: { status: FAILED, note: info.status === 'CANCELLED' ? 'Cư dân hủy thanh toán' : 'Link payOS hết hạn' } },
    );
  } else if (now - payment.createdAt > RECONCILE_AFTER_MS) {
    await Payment.updateOne({ _id: payment._id, status: PENDING }, { $set: { needsReconcile: true } });
  }
  return info.status;
}

/** Trang kết quả của cư dân: xem trạng thái (còn chờ thì hỏi payOS ngay để không phụ thuộc webhook) */
export async function getPayosStatus(user, orderCode, { now = new Date() } = {}) {
  let payment = await Payment.findOne({ orderCode, method: PAYMENT_METHODS.PAYOS }).lean();
  const isStaff = [ROLES.ACCOUNTANT, ROLES.MANAGER].includes(user.role);
  if (!payment || (!isStaff && !sameId(payment.payerId, user.id))) throw ApiError.notFound('Không tìm thấy giao dịch');

  if (payment.status === PENDING && payos.isPayosEnabled()) {
    try {
      await syncPayosPayment(payment, { now });
    } catch (err) {
      console.error(`[payos] tra cứu ${orderCode} lỗi:`, err.message); // vẫn trả trạng thái đang có
    }
    payment = await Payment.findById(payment._id).lean();
  }
  const [invoices, booking] = await Promise.all([
    Invoice.find({ _id: { $in: payment.allocations.map((a) => a.invoiceId) } })
      .select('code period status totalAmount paidAmount')
      .lean(),
    payment.bookingId ? Booking.findById(payment.bookingId).select('status date slotStart slotEnd fee').populate('amenityId', 'name').lean() : null,
  ]);
  return {
    ...linkView(payment),
    paidAt: payment.paidAt,
    creditAmount: payment.creditAmount,
    booking: booking && { ...booking, amenity: booking.amenityId ?? null, amenityId: booking.amenityId?._id ?? null },
    allocations: payment.allocations.map((a) => ({ ...a, invoice: invoices.find((i) => sameId(i._id, a.invoiceId)) ?? null })),
  };
}

/** Cron PAYMENT_RECONCILE: giao dịch payOS còn chờ quá 2 phút → hỏi payOS; quá 15 phút chưa rõ → Cần đối soát */
export async function reconcilePayosPayments(now = new Date()) {
  if (!payos.isPayosEnabled()) return { affectedCount: 0 };
  const pending = await Payment.find({
    method: PAYMENT_METHODS.PAYOS,
    status: PENDING,
    createdAt: { $lt: new Date(now.getTime() - 2 * MINUTE_MS) },
  })
    .limit(200)
    .lean();
  const failed = [];
  for (const p of pending) {
    try {
      await syncPayosPayment(p, { now });
    } catch (err) {
      failed.push({ message: `${p.orderCode}: ${err.message}` });
      if (now - p.createdAt > RECONCILE_AFTER_MS) {
        await Payment.updateOne({ _id: p._id, status: PENDING }, { $set: { needsReconcile: true } });
      }
    }
  }
  return { affectedCount: pending.length - failed.length, failed };
}

export const _test = { descriptionOf, newOrderCode, parsePayosTime };
