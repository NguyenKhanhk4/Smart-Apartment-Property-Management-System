import { ADJUSTMENT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// invoice_adjustments — khoản điều chỉnh cho thông báo phí ĐÃ PHÁT HÀNH (Mô đun 4, M4-5).
// Thông báo đã phát hành không sửa trực tiếp: Kế toán lập khoản ± kèm lý do; lần tính phí kỳ sau tự đưa vào thông báo
// Nháp của căn (dòng ADJUSTMENT, gắn invoiceId để không tính 2 lần) và Trưởng BQL duyệt cùng thông báo đó.
const invoiceAdjustmentSchema = new Schema(
  {
    sourceInvoiceId: { type: ObjectId, ref: 'Invoice', required: true }, // thông báo bị sai
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    payerId: { type: ObjectId, ref: 'User', required: true }, // Người nộp phí của thông báo bị sai (X1)
    amount: { type: Number, required: true }, // số nguyên VND, > 0 thu thêm, < 0 giảm trừ
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: values(ADJUSTMENT_STATUS), required: true, default: ADJUSTMENT_STATUS.PENDING },
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // thông báo kỳ sau đã đưa khoản này vào
    appliedAt: { type: Date, default: null },
    requestedBy: { type: ObjectId, ref: 'User', required: true }, // Kế toán
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  schemaOptions('invoice_adjustments'),
);

invoiceAdjustmentSchema.index({ apartmentId: 1, status: 1 });
invoiceAdjustmentSchema.index({ sourceInvoiceId: 1 });
invoiceAdjustmentSchema.index({ invoiceId: 1 });

export const InvoiceAdjustment = model('InvoiceAdjustment', invoiceAdjustmentSchema);
