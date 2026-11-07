// Mô đun 4 — M4-5: thông báo phí đã phát hành KHÔNG sửa trực tiếp. Sai thì Kế toán lập khoản điều chỉnh (± kèm lý do);
// lần tính phí kỳ sau tự đưa vào thông báo Nháp của căn (dòng ADJUSTMENT) và Trưởng BQL duyệt cùng thông báo đó.
// Mọi thao tác ghi Audit Log (Ban quản trị xem được — X2).
import mongoose from 'mongoose';
import {
  ADJUSTMENT_STATUS,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  INVOICE_PUBLISHED_STATUSES,
  INVOICE_STATUS,
} from '../../constants/enums.js';
import { Invoice, InvoiceAdjustment } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';
import { totalsOf } from './invoices.builder.js';

const { PENDING, CANCELLED } = ADJUSTMENT_STATUS;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const POPULATE = [
  { path: 'sourceInvoiceId', select: 'code period totalAmount status' },
  { path: 'invoiceId', select: 'code period status' },
  { path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code' } },
  { path: 'payerId', select: 'fullName' },
  { path: 'requestedBy', select: 'fullName' },
  { path: 'cancelledBy', select: 'fullName' },
];

const audit = (action, user, adjustment, metadata) =>
  logAudit({ action, user, targetType: AUDIT_TARGETS.INVOICE_ADJUSTMENT, targetId: adjustment._id, metadata });

/** Kế toán lập khoản điều chỉnh cho 1 thông báo đã phát hành. amount: số nguyên ≠ 0 (âm = giảm trừ) */
export async function createAdjustment(user, sourceInvoiceId, { amount, reason }) {
  const source = await Invoice.findById(sourceInvoiceId).select('code period apartmentId payerId totalAmount status').lean();
  if (!source) throw ApiError.notFound('Không tìm thấy thông báo phí');
  if (!INVOICE_PUBLISHED_STATUSES.includes(source.status)) {
    throw ApiError.badRequest('Chỉ lập điều chỉnh cho thông báo đã phát hành; thông báo Nháp hãy sửa trực tiếp hoặc Tính lại');
  }
  if (!source.payerId) throw ApiError.badRequest('Thông báo không có Người nộp phí');

  // Tổng các khoản giảm của 1 thông báo không vượt quá số tiền của chính thông báo đó
  if (amount < 0) {
    const [row] = await InvoiceAdjustment.aggregate([
      { $match: { sourceInvoiceId: source._id, status: { $ne: CANCELLED }, amount: { $lt: 0 } } },
      { $group: { _id: null, decreased: { $sum: '$amount' } } },
    ]);
    const room = source.totalAmount + (row?.decreased ?? 0);
    if (-amount > room) {
      throw ApiError.badRequest(`Tổng giảm trừ vượt số tiền thông báo; còn giảm được tối đa ${formatVnd(Math.max(0, room))}`);
    }
  }

  const adjustment = await InvoiceAdjustment.create({
    sourceInvoiceId: source._id,
    apartmentId: source.apartmentId,
    payerId: source.payerId,
    amount,
    reason: reason.trim(),
    requestedBy: user.id,
  });
  await audit(AUDIT_ACTIONS.INVOICE_ADJUSTED, user, adjustment, { sourceCode: source.code, amount, reason: adjustment.reason });
  return getAdjustment(adjustment._id);
}

export const getAdjustment = (id) => InvoiceAdjustment.findById(id).populate(POPULATE).lean();

/**
 * Kế toán hủy khoản điều chỉnh chưa áp dụng. Đã vào thông báo Nháp kỳ sau thì gỡ dòng đó khỏi Nháp cùng lúc;
 * thông báo kỳ sau đang Chờ duyệt thì phải được trả lại về Nháp trước.
 */
export async function cancelAdjustment(user, id, { reason }) {
  const adjustment = await InvoiceAdjustment.findById(id).lean();
  if (!adjustment) throw ApiError.notFound('Không tìm thấy khoản điều chỉnh');
  if (adjustment.status !== PENDING) throw ApiError.badRequest('Khoản điều chỉnh đã áp dụng hoặc đã hủy');

  const draft = adjustment.invoiceId ? await Invoice.findById(adjustment.invoiceId).lean() : null;
  if (draft && draft.status !== INVOICE_STATUS.DRAFT) {
    throw ApiError.badRequest(`Khoản điều chỉnh đang nằm trong thông báo ${draft.code} chờ duyệt; cần Trưởng BQL trả lại về Nháp trước`);
  }

  await withTransaction(async (session) => {
    const res = await InvoiceAdjustment.updateOne(
      { _id: adjustment._id, status: PENDING, invoiceId: adjustment.invoiceId },
      { $set: { status: CANCELLED, cancelledBy: user.id, cancelledAt: new Date(), cancelReason: reason.trim(), invoiceId: null } },
      { session },
    );
    if (res.matchedCount !== 1) throw new ApiError('CONCURRENT_UPDATE');
    if (draft) {
      const items = draft.items.filter((i) => String(i.refId) !== String(adjustment._id));
      const updated = await Invoice.updateOne(
        { _id: draft._id, status: INVOICE_STATUS.DRAFT, updatedAt: draft.updatedAt },
        { $set: { items, ...totalsOf(items) } },
        { session },
      );
      if (updated.matchedCount !== 1) throw new ApiError('CONCURRENT_UPDATE');
    }
  });
  await audit(AUDIT_ACTIONS.INVOICE_ADJUSTMENT_CANCELLED, user, adjustment, {
    amount: adjustment.amount,
    reason: reason.trim(),
    removedFromDraft: draft?.code ?? null,
  });
  return getAdjustment(adjustment._id);
}

/**
 * Danh sách khoản điều chỉnh. `period`: các khoản nằm trong thông báo của kỳ đó (màn hình duyệt);
 * `waiting`: chỉ khoản chưa vào thông báo nào. Kèm tổng tăng / giảm.
 */
export async function listAdjustments({ period, status, apartmentId, sourceInvoiceId, invoiceId, waiting, ...query }) {
  const filter = {};
  if (status?.length) filter.status = { $in: status };
  if (apartmentId) filter.apartmentId = oid(apartmentId);
  if (sourceInvoiceId) filter.sourceInvoiceId = oid(sourceInvoiceId);
  if (invoiceId) filter.invoiceId = oid(invoiceId);
  if (waiting) filter.invoiceId = null;
  if (period) {
    const ids = await Invoice.find({ period, status: { $ne: INVOICE_STATUS.CANCELLED } }).distinct('_id');
    filter.invoiceId = { $in: ids };
  }
  const [{ items, pagination }, [sums]] = await Promise.all([
    paginate(InvoiceAdjustment, filter, { ...query, sort: query.sort ?? '-createdAt' }, { populate: POPULATE }),
    InvoiceAdjustment.aggregate([
      { $match: { ...filter, status: filter.status ?? { $ne: CANCELLED } } },
      {
        $group: {
          _id: null,
          increase: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
          decrease: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  return { items, pagination, summary: { increase: sums?.increase ?? 0, decrease: sums?.decrease ?? 0, count: sums?.count ?? 0 } };
}

/** Khoản điều chỉnh lập trên 1 thông báo (chi tiết thông báo — quản trị) */
export const adjustmentsOf = (sourceInvoiceId) =>
  InvoiceAdjustment.find({ sourceInvoiceId }).populate(POPULATE).sort({ createdAt: 1 }).lean();

