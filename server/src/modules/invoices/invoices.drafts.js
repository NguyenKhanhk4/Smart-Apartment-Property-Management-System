// Mô đun 4 — UC26: Kế toán sửa thông báo phí Nháp trước khi trình duyệt.
//   - Thêm / xóa Khoản thu khác (không có trong biểu phí định kỳ), mọi thay đổi ghi Audit Log.
//   - Tính lại: lấy lại đơn giá, xe, phí tiện ích, Người nộp phí mới nhất; giữ nguyên các khoản thu khác đã thêm tay.
// Chỉ sửa được khi còn DRAFT; cập nhật có điều kiện (status + updatedAt) để 2 người sửa cùng lúc không ghi đè nhau.
import { AUDIT_ACTIONS, AUDIT_TARGETS, FEE_CATEGORIES, INVOICE_STATUS } from '../../constants/enums.js';
import { AmenityPass, AmenityVisit, Booking, Invoice } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { getPriceTable } from '../feeTypes/feeTypes.queries.js';
import { buildInvoiceDraft } from './invoices.builder.js';
import { linkAmenityCharges, loadApartments } from './invoices.service.js';

const OTHER = FEE_CATEGORIES.OTHER;
const sumItems = (items) => items.reduce((s, i) => s + i.amount, 0);

const audit = (action, user, invoice, metadata) =>
  logAudit({ action, user, targetType: AUDIT_TARGETS.INVOICE, targetId: invoice._id, metadata: { code: invoice.code, ...metadata } });

async function loadDraft(invoiceId) {
  const invoice = await Invoice.findById(invoiceId).lean();
  if (!invoice) throw ApiError.notFound('Không tìm thấy thông báo phí');
  if (invoice.status !== INVOICE_STATUS.DRAFT) throw new ApiError('INVOICE_NOT_DRAFT');
  return invoice;
}

/** Ghi items mới nếu thông báo vẫn là Nháp và chưa bị ai sửa kể từ lúc đọc */
async function saveItems(invoice, items, extra = {}, session = null) {
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: INVOICE_STATUS.DRAFT, updatedAt: invoice.updatedAt },
    { $set: { items, totalAmount: sumItems(items), ...extra } },
    { new: true, session },
  ).lean();
  if (!updated) throw new ApiError('CONCURRENT_UPDATE');
  return updated;
}

/** Thêm 1 khoản thu khác (vd làm lại thẻ xe) vào thông báo Nháp */
export async function addOtherItem(user, invoiceId, { description, amount }) {
  const invoice = await loadDraft(invoiceId);
  const item = {
    feeCategory: OTHER,
    feeCode: OTHER,
    description: description.trim(),
    quantity: 1,
    unitPrice: amount,
    amount,
    addedBy: user.id,
  };
  const updated = await saveItems(invoice, [...invoice.items, item]);
  await audit(AUDIT_ACTIONS.INVOICE_ITEM_ADDED, user, invoice, {
    description: item.description,
    amount,
    oldTotal: invoice.totalAmount,
    newTotal: updated.totalAmount,
  });
  return updated;
}

/** Xóa khoản thu khác theo vị trí dòng (chỉ dòng OTHER; dòng tính tự động phải sửa nguồn rồi Tính lại) */
export async function removeOtherItem(user, invoiceId, index) {
  const invoice = await loadDraft(invoiceId);
  const item = invoice.items[index];
  if (!item) throw ApiError.notFound('Không tìm thấy dòng phí');
  if (item.feeCategory !== OTHER) throw ApiError.badRequest('Chỉ xóa được khoản thu khác; dòng phí tự động hãy bấm Tính lại');
  const updated = await saveItems(
    invoice,
    invoice.items.filter((_, i) => i !== index),
  );
  await audit(AUDIT_ACTIONS.INVOICE_ITEM_REMOVED, user, invoice, {
    description: item.description,
    amount: item.amount,
    oldTotal: invoice.totalAmount,
    newTotal: updated.totalAmount,
  });
  return updated;
}

/**
 * Tính lại 1 thông báo Nháp: dòng phí tự động lấy theo dữ liệu hiện tại, giữ khoản thu khác.
 * Phí tiện ích: gắn thêm bản ghi mới phát sinh, gỡ bản ghi không còn tính (đã hủy...) khỏi thông báo này.
 */
export async function recalculateDraft(user, invoiceId) {
  const invoice = await loadDraft(invoiceId);
  const [apartment] = await loadApartments({ _id: invoice.apartmentId });
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');

  const prices = await getPriceTable(invoice.period);
  const draft = await buildInvoiceDraft(apartment, invoice.period, prices, { invoiceId: invoice._id });
  if (draft.excludedByHandover) throw ApiError.badRequest('Căn hộ chưa bàn giao trong kỳ, không tính lại được');
  if (!draft.payer) {
    throw ApiError.badRequest('Căn hộ không có hợp đồng mua bán hiệu lực tại ngày bắt đầu tính phí');
  }
  const items = [...draft.items, ...invoice.items.filter((i) => i.feeCategory === OTHER)];

  const updated = await withTransaction(async (session) => {
    await linkAmenityCharges(draft.charges, invoice._id, session);
    // Gỡ các bản ghi tiện ích từng gắn vào thông báo này nhưng không còn được tính
    const keep = { passIds: draft.charges.passIds, visitIds: draft.charges.visitIds, bookingIds: draft.charges.bookingIds };
    await unlinkStale(invoice._id, keep, session);
    return saveItems(invoice, items, { payerId: draft.payer.userId, payerSource: draft.payer.source }, session);
  });

  await audit(AUDIT_ACTIONS.INVOICE_RECALCULATED, user, invoice, { oldTotal: invoice.totalAmount, newTotal: updated.totalAmount });
  return updated;
}

// Tuần tự: MongoDB không cho chạy song song nhiều lệnh trong cùng 1 transaction
async function unlinkStale(invoiceId, keep, session) {
  for (const [Model, ids] of [
    [AmenityPass, keep.passIds],
    [AmenityVisit, keep.visitIds],
    [Booking, keep.bookingIds],
  ]) {
    await Model.updateMany({ invoiceId, _id: { $nin: ids } }, { $set: { invoiceId: null } }, { session });
  }
}
