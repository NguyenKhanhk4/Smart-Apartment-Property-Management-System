import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// prepaid_balances — Số dư trả trước của căn, gắn với Người nộp phí đã nộp tiền (Mô đun 4, X1).
// Cộng / trừ bằng $inc có điều kiện balance >= số trừ để không bao giờ âm.
const prepaidBalanceSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    payerId: { type: ObjectId, ref: 'User', required: true },
    balance: { type: Number, required: true, default: 0, min: 0 }, // VND
  },
  schemaOptions('prepaid_balances'),
);

prepaidBalanceSchema.index({ apartmentId: 1, payerId: 1 }, { unique: true });

export const PrepaidBalance = model('PrepaidBalance', prepaidBalanceSchema);
