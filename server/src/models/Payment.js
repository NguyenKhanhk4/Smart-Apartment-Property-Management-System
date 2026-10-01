import { PAYMENT_METHODS, PAYMENT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// payments — giao dịch thanh toán (UC-B04..B07)
const paymentSchema = new Schema(
  {
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
    method: { type: String, enum: values(PAYMENT_METHODS), required: true },
    amount: { type: Number, required: true, min: 0 }, // = invoice.totalAmount (BR-F9)
    vnpTxnRef: String, // idempotent IPN (NFR-06)
    vnpTransactionNo: String,
    vnpResponseCode: String,
    receiptNo: String, // PT-YYYYMM-xxxxx (BR-F11)
    bankRef: String,
    status: {
      type: String,
      enum: values(PAYMENT_STATUS),
      required: true,
      default: PAYMENT_STATUS.PENDING,
    },
    paidAt: Date,
    confirmedBy: { type: ObjectId, ref: 'User', default: null }, // Accountant; null nếu VNPay
    reconciled: { type: Boolean, default: false },
    reconciledBy: { type: ObjectId, ref: 'User' },
    reconciledAt: Date,
  },
  schemaOptions('payments'),
);

paymentSchema.index({ vnpTxnRef: 1 }, { unique: true, sparse: true });
paymentSchema.index({ receiptNo: 1 }, { unique: true, sparse: true });
paymentSchema.index({ invoiceId: 1, status: 1 });
paymentSchema.index({ method: 1, paidAt: 1 });

export const Payment = model('Payment', paymentSchema);
