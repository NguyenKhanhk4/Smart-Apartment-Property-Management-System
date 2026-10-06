import { FUND_TX_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// fund_transactions — giao dịch thu/chi quỹ (UC-C01, C04)
const fundTransactionSchema = new Schema(
  {
    fundId: { type: ObjectId, ref: 'MaintenanceFund', required: true },
    type: { type: String, enum: values(FUND_TX_TYPES), required: true },
    amount: { type: Number, required: true, min: 1 },
    balanceAfter: Number, // số dư sau giao dịch — vẽ biểu đồ biến động (UC-E11)
    description: String,
    source: String, // vd "Kinh phí 2% bàn giao", "Lãi tiền gửi"
    occurredAt: { type: Date, default: Date.now },
    proposalId: { type: ObjectId, ref: 'FundProposal', default: null }, // khi EXPENSE
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('fund_transactions'),
);

fundTransactionSchema.index({ fundId: 1, occurredAt: -1 });
fundTransactionSchema.index({ type: 1, occurredAt: -1 });

export const FundTransaction = model('FundTransaction', fundTransactionSchema);
