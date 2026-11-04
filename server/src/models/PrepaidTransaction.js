import { PREPAID_TX_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// prepaid_transactions — sổ chi tiết Số dư trả trước: tiền thừa vào, trừ vào thông báo phí, hoàn tiền.
// Không xóa / sửa bản ghi (toàn vẹn dữ liệu tài chính).
const prepaidTransactionSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    payerId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: values(PREPAID_TX_TYPES), required: true },
    amount: { type: Number, required: true, min: 1 }, // luôn dương; type cho biết cộng hay trừ
    balanceAfter: { type: Number, required: true, min: 0 },
    paymentId: { type: ObjectId, ref: 'Payment', default: null }, // DEPOSIT: lần thu tạo ra tiền thừa
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // APPLY: thông báo được trừ
    note: String, // REFUND: lý do, số phiếu chi
    createdBy: { type: ObjectId, ref: 'User', default: null }, // null khi hệ thống tự trừ / payOS
  },
  schemaOptions('prepaid_transactions'),
);

prepaidTransactionSchema.index({ apartmentId: 1, payerId: 1, createdAt: -1 });
prepaidTransactionSchema.index({ invoiceId: 1 });

export const PrepaidTransaction = model('PrepaidTransaction', prepaidTransactionSchema);
