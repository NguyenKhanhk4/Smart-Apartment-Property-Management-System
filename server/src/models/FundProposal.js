import { FUND_PLAN_TYPES, FUND_PROPOSAL_OPEN_STATUSES, FUND_PROPOSAL_STATUS, VOTE_DECISIONS, values } from '../constants/enums.js';
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

// Nhà thầu do Trưởng ban quản trị chọn (chỉ chi bằng Quỹ). Đổi được tới khi có phiếu Đồng ý đầu tiên.
const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: null },
    quoteUrls: { type: [String], default: [] }, // ảnh hợp đồng với nhà thầu (≥ 1)
    amount: { type: Number, required: true, min: 1 }, // giá nhà thầu báo = số tiền Ban quản trị biểu quyết
    note: { type: String, default: null },
    selectedBy: { type: ObjectId, ref: 'User', required: true },
    selectedAt: { type: Date, required: true },
  },
  { _id: false },
);

// Mỗi vòng gửi / trả lại / xác nhận / biểu quyết / nghiệm thu: 1 dòng, không ghi đè
const historySchema = new Schema(
  { action: String, by: { type: ObjectId, ref: 'User', default: null }, at: Date, note: { type: String, default: null } },
  { _id: false },
);

// fund_proposals — đề xuất chi Quỹ bảo trì 2% (UC33 Trưởng BQL lập; UC34 Ban quản trị biểu quyết). Lập xong là chờ biểu quyết.
// Mỗi thành viên Ban quản trị 1 phiếu, không sửa; đồng ý > FUND_APPROVAL_RATIO × số thành viên → APPROVED,
// không còn khả năng đạt → REJECTED. Đã duyệt → nghiệm thu (Trưởng BQL + Ban quản trị với sửa chữa lớn) → Kế toán lập
// phiếu chi (PAID). Hệ thống không tự duyệt khi quá hạn (X8).
const fundProposalSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true }, // DXQ-YYYYMM-xxxxx (dữ liệu cũ có thể thiếu)
    fundId: { type: ObjectId, ref: 'MaintenanceFund', required: true },
    title: { type: String, required: true }, // hạng mục
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 }, // lúc lập = dự kiến; Trưởng ban chọn nhà thầu thì = giá báo
    estimatedAmount: { type: Number, default: null }, // số Trưởng BQL dự kiến lúc lập
    vendor: { type: vendorSchema, default: null },
    planType: { type: String, enum: values(FUND_PLAN_TYPES), default: FUND_PLAN_TYPES.ANNUAL_PLAN },
    planRef: { type: String, default: null }, // tên / số kế hoạch năm, nghị quyết Hội nghị nhà chung cư
    urgentReason: { type: String, default: null }, // bắt buộc khi bảo trì đột xuất
    largeRepair: { type: Boolean, default: false }, // sửa chữa lớn (Mô đun 10): chỉ lập phiếu chi sau khi Trưởng BQL nghiệm thu (M10-3)
    // UC10: đề xuất lập từ phiếu bảo trì Trưởng BQL duyệt sửa bằng Quỹ. Kết quả biểu quyết / rút báo lại phiếu (onFundDecision);
    // nghiệm thu làm trên phiếu bảo trì (Q12), không làm ở đây.
    workOrderId: { type: ObjectId, ref: 'WorkOrder', default: null },
    attachmentUrls: [String], // ảnh hiện trạng, hồ sơ kèm đề xuất (đề xuất cũ: cả ảnh báo giá)
    proposedBy: { type: ObjectId, ref: 'User', required: true }, // Trưởng BQL (dữ liệu cũ: Kế toán)
    contractNo: { type: String, default: null }, // đề xuất cũ: số hợp đồng / báo giá Trưởng BQL ghi; đề xuất mới dùng ảnh báo giá ở vendor
    votes: [voteSchema],
    boardSize: { type: Number, default: null }, // số thành viên Ban quản trị lúc chốt
    status: { type: String, enum: values(FUND_PROPOSAL_STATUS), required: true, default: FUND_PROPOSAL_STATUS.PENDING },
    // true khi status thuộc FUND_PROPOSAL_OPEN_STATUSES. Mọi chỗ đổi status phải set cùng lúc (xem openFlag ở fund.service)
    isOpen: { type: Boolean, default: true },
    finalizedBy: { type: ObjectId, ref: 'User', default: null }, // người bỏ phiếu quyết định kết quả
    finalNote: String,
    finalizedAt: Date,
    approvalBlockedAt: { type: Date, default: null }, // BR-F16: đủ phiếu đồng ý nhưng số dư khả dụng không đủ, chưa chốt
    lastRemindedAt: { type: Date, default: null },
    workAcceptedBy: { type: ObjectId, ref: 'User', default: null }, // Trưởng BQL nghiệm thu kỹ thuật (sửa chữa lớn)
    workAcceptedAt: { type: Date, default: null },
    boardAcceptedBy: { type: ObjectId, ref: 'User', default: null }, // Ban quản trị xác nhận nghiệm thu (BR-E09)
    boardAcceptedAt: { type: Date, default: null },
    history: { type: [historySchema], default: [] },
    expenseTxId: { type: ObjectId, ref: 'FundTransaction', default: null },
    paidAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  schemaOptions('fund_proposals'),
);

// Tạo mới bằng create/save: isOpen theo status (cập nhật bằng query thì tự set, xem openFlag)
fundProposalSchema.pre('validate', function syncOpen() {
  this.isOpen = FUND_PROPOSAL_OPEN_STATUSES.includes(this.status);
});

fundProposalSchema.index({ status: 1, createdAt: -1 });
// Mỗi phiếu bảo trì chỉ 1 đề xuất đang chờ biểu quyết — chặn cả 2 request song song.
// Dùng cờ isOpen thay vì status $in: partial index hỗ trợ $in từ MongoDB 6.0
fundProposalSchema.index(
  { workOrderId: 1 },
  { name: 'uniq_open_wo_proposal', unique: true, partialFilterExpression: { isOpen: true, workOrderId: { $type: 'objectId' } } },
);

export const FundProposal = model('FundProposal', fundProposalSchema);
