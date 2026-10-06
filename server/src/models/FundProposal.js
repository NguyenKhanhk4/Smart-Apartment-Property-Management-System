import { REVIEW_STATUS, VOTE_DECISIONS, values } from '../constants/enums.js';
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

// fund_proposals — đề xuất chi quỹ + biểu quyết BQT (UC-C02..C04)
const fundProposalSchema = new Schema(
  {
    fundId: { type: ObjectId, ref: 'MaintenanceFund', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    attachmentUrls: [String],
    proposedBy: { type: ObjectId, ref: 'User', required: true }, // Manager
    votes: [voteSchema], // BR-M2: mỗi thành viên 1 phiếu (kiểm tra ở service)
    status: {
      type: String,
      enum: values(REVIEW_STATUS),
      required: true,
      default: REVIEW_STATUS.PENDING,
    },
    finalizedBy: { type: ObjectId, ref: 'User', default: null }, // Trưởng BQT
    finalNote: String,
    finalizedAt: Date,
  },
  schemaOptions('fund_proposals'),
);

fundProposalSchema.index({ status: 1, createdAt: -1 });

export const FundProposal = model('FundProposal', fundProposalSchema);
