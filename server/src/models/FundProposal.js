import { FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, VOTE_DECISIONS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const voteSchema = new Schema(
  {
    memberId: { type: ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: values(VOTE_DECISIONS), required: true },
    comment: String,
    votedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// fund_proposals — đề xuất chi Quỹ bảo trì 2% (UC33 Kế toán lập, UC34 Ban quản trị biểu quyết).
// Mỗi thành viên Ban quản trị 1 phiếu, không sửa; đồng ý > FUND_APPROVAL_RATIO × số thành viên → APPROVED,
// không còn khả năng đạt → REJECTED. Đã duyệt → Kế toán lập phiếu chi (PAID). Hệ thống không tự duyệt khi quá hạn (X8).
const fundProposalSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true }, // DXQ-YYYYMM-xxxxx (dữ liệu cũ có thể thiếu)
    fundId: { type: ObjectId, ref: 'MaintenanceFund', required: true },
    title: { type: String, required: true }, // hạng mục
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    planType: { type: String, enum: values(FUND_PLAN_TYPES), default: FUND_PLAN_TYPES.ANNUAL_PLAN },
    planRef: { type: String, default: null }, // tên / số kế hoạch năm, nghị quyết Hội nghị nhà chung cư
    urgentReason: { type: String, default: null }, // bắt buộc khi bảo trì đột xuất
    largeRepair: { type: Boolean, default: false }, // sửa chữa lớn (Mô đun 10): chỉ lập phiếu chi sau khi Trưởng BQL nghiệm thu (M10-3)
    // UC10: đề xuất lập từ phiếu bảo trì Trưởng BQL duyệt sửa bằng Quỹ. Kết quả biểu quyết / rút báo lại phiếu (onFundDecision);
    // nghiệm thu làm trên phiếu bảo trì (Q12), không làm ở đây.
    workOrderId: { type: ObjectId, ref: 'WorkOrder', default: null },
    attachmentUrls: [String], // ảnh báo giá
    proposedBy: { type: ObjectId, ref: 'User', required: true }, // Kế toán (dữ liệu cũ: Trưởng BQL)
    votes: [voteSchema],
    boardSize: { type: Number, default: null }, // số thành viên Ban quản trị lúc chốt
    status: { type: String, enum: values(FUND_PROPOSAL_STATUS), required: true, default: FUND_PROPOSAL_STATUS.PENDING },
    finalizedBy: { type: ObjectId, ref: 'User', default: null }, // người bỏ phiếu quyết định kết quả
    finalNote: String,
    finalizedAt: Date,
    lastRemindedAt: { type: Date, default: null },
    workAcceptedBy: { type: ObjectId, ref: 'User', default: null }, // Trưởng BQL nghiệm thu (sửa chữa lớn)
    workAcceptedAt: { type: Date, default: null },
    expenseTxId: { type: ObjectId, ref: 'FundTransaction', default: null },
    paidAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  schemaOptions('fund_proposals'),
);

fundProposalSchema.index({ status: 1, createdAt: -1 });
// Mỗi phiếu bảo trì chỉ 1 đề xuất đang chờ biểu quyết (chặn cả 2 request song song)
fundProposalSchema.index(
  { workOrderId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING', workOrderId: { $type: 'objectId' } } },
);

export const FundProposal = model('FundProposal', fundProposalSchema);
