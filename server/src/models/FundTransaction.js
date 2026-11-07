import { FUND_INCOME_SOURCES, FUND_TX_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// fund_transactions — sổ thu / chi Quỹ bảo trì 2% (UC33). Không sửa / xóa bản ghi (toàn vẹn dữ liệu tài chính).
// Thu: phiếu thu quỹ PTQ-YYYYMM-xxxxx (nguồn + chứng từ); Chi: phiếu chi PCQ-YYYYMM-xxxxx gắn đề xuất đã duyệt.
const fundTransactionSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true }, // dữ liệu cũ có thể thiếu
    fundId: { type: ObjectId, ref: 'MaintenanceFund', required: true },
    type: { type: String, enum: values(FUND_TX_TYPES), required: true },
    amount: { type: Number, required: true, min: 1 },
    balanceAfter: Number, // số dư sau giao dịch — vẽ biểu đồ biến động
    description: String,
    incomeSource: { type: String, enum: [...values(FUND_INCOME_SOURCES), null], default: null },
    source: String, // mô tả nguồn (dữ liệu cũ), vd "Lãi tiền gửi"
    documentNo: { type: String, default: null }, // số chứng từ / hóa đơn
    attachmentUrls: [String], // ảnh chứng từ, hóa đơn
    occurredAt: { type: Date, default: Date.now },
    proposalId: { type: ObjectId, ref: 'FundProposal', default: null }, // khi EXPENSE
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('fund_transactions'),
);

fundTransactionSchema.index({ fundId: 1, occurredAt: -1 });
fundTransactionSchema.index({ type: 1, occurredAt: -1 });

export const FundTransaction = model('FundTransaction', fundTransactionSchema);
