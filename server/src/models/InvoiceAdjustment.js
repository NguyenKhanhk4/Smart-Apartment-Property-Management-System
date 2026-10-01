import { ADJUSTMENT_TYPES, REVIEW_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// invoice_adjustments — đề nghị điều chỉnh/hủy hóa đơn (UC-B08)
const invoiceAdjustmentSchema = new Schema(
  {
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
    type: { type: String, enum: values(ADJUSTMENT_TYPES), required: true },
    amount: { type: Number, default: null }, // âm/dương khi ADJUST
    reason: { type: String, required: true },
    attachmentUrls: [String],
    requestedBy: { type: ObjectId, ref: 'User', required: true }, // Accountant
    status: {
      type: String,
      enum: values(REVIEW_STATUS),
      required: true,
      default: REVIEW_STATUS.PENDING,
    },
    reviewedBy: { type: ObjectId, ref: 'User', default: null }, // Manager, khác requestedBy (BR-R5)
    reviewNote: String,
    reviewedAt: Date,
  },
  schemaOptions('invoice_adjustments'),
);

invoiceAdjustmentSchema.index({ invoiceId: 1, status: 1 });
invoiceAdjustmentSchema.index({ status: 1, createdAt: -1 });

export const InvoiceAdjustment = model('InvoiceAdjustment', invoiceAdjustmentSchema);
