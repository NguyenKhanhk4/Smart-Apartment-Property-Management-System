import { PAYMENT_METHODS, PAYMENT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Một lần thu tiền phân bổ vào nhiều thông báo phí (trả một phần, cũ nhất trước)
const allocationSchema = new Schema(
  {
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
    amount: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

// payments — giao dịch thu tiền (Mô đun 4): payOS online, tiền mặt, chuyển khoản tay.
// amount = tổng tiền thu; = tổng allocations + creditAmount (phần thừa vào Số dư trả trước).
const paymentSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment' },
    payerId: { type: ObjectId, ref: 'User' }, // Người nộp phí đã trả (X1)
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // thông báo đầu tiên được phân bổ (đọc nhanh / dữ liệu cũ)
    allocations: { type: [allocationSchema], default: [] },
    creditAmount: { type: Number, default: 0, min: 0 }, // tiền thừa ghi vào Số dư trả trước
    method: { type: String, enum: values(PAYMENT_METHODS), required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: values(PAYMENT_STATUS),
      required: true,
      default: PAYMENT_STATUS.PENDING,
    },
    // payOS — mỗi orderCode chỉ được gạch nợ 1 lần (chống gạch nợ trùng)
    orderCode: { type: Number, default: undefined }, // số nguyên gửi sang payOS
    paymentLinkId: String,
    checkoutUrl: String,
    qrCode: String, // chuỗi VietQR để client tự vẽ mã QR
    expiredAt: Date, // hết hạn link thanh toán
    reference: String, // mã giao dịch ngân hàng payOS trả về trong webhook
    needsReconcile: { type: Boolean, default: false }, // quá 15 phút chưa rõ kết quả → danh sách Cần đối soát
    // Tiền mặt / chuyển khoản tay
    receiptNo: String, // PT-YYYYMM-xxxxx (BR-F11)
    bankRef: String, // mã giao dịch trên sao kê ngân hàng
    note: String, // lý do khi nội dung chuyển khoản sai cú pháp, ghi chú đối soát
    confirmedBy: { type: ObjectId, ref: 'User', default: null }, // Kế toán; null nếu payOS tự gạch nợ
    paidAt: Date,
    reconciled: { type: Boolean, default: false },
    reconciledBy: { type: ObjectId, ref: 'User' },
    reconciledAt: Date,
  },
  schemaOptions('payments'),
);

paymentSchema.index({ orderCode: 1 }, { unique: true, sparse: true });
paymentSchema.index({ receiptNo: 1 }, { unique: true, sparse: true });
// Chặn ghi nhận trùng 1 giao dịch ngân hàng (mã trên sao kê)
paymentSchema.index({ bankRef: 1 }, { unique: true, partialFilterExpression: { bankRef: { $type: 'string' } } });
paymentSchema.index({ invoiceId: 1, status: 1 });
paymentSchema.index({ 'allocations.invoiceId': 1 });
paymentSchema.index({ apartmentId: 1, payerId: 1, paidAt: -1 });
paymentSchema.index({ method: 1, paidAt: 1 });
paymentSchema.index({ status: 1, needsReconcile: 1 });

export const Payment = model('Payment', paymentSchema);
