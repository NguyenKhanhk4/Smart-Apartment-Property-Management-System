// UC10 – Nối phiếu bảo trì với module Quỹ bảo trì (Người 3). Module quỹ gọi thẳng các hàm này, không qua sự kiện.
//
// Luồng: Trưởng BQL duyệt sửa bằng Quỹ → phiếu giữ "Chờ duyệt sửa", repair.costSource = FUND → Kế toán lập đề xuất (UC33)
// gắn workOrderId → Ban quản trị biểu quyết (UC34) → onFundDecision. Nghiệm thu làm trên phiếu bảo trì (Q12) và tự đánh dấu
// đã nghiệm thu bên đề xuất (markFundWorkAccepted), sau đó Kế toán mới lập phiếu chi.
//
// FundProposal.workOrderId do module quỹ thêm vào schema; trước khi có, các truy vấn dưới đây dùng strictQuery: false
// nên không lỗi (chỉ không tìm thấy gì).
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, FUND_PROPOSAL_STATUS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Asset, FundProposal, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';

const S = WORK_ORDER_STATUS;
const LOOSE = { strictQuery: false };
export const FUND_DECISIONS = Object.freeze({ APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' });

const safely = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.error('[UC10] Lỗi gửi thông báo:', err);
  }
};
const assetLabel = async (assetId) => {
  const a = await Asset.findById(assetId).select('code name').lean();
  return a ? `${a.code} – ${a.name}` : 'thiết bị';
};

/** Phiếu đang có đề xuất chi quỹ chờ Ban quản trị biểu quyết */
export async function hasPendingFundProposal(workOrderId, session = null) {
  return Boolean(await FundProposal.exists({ workOrderId, status: FUND_PROPOSAL_STATUS.PENDING }).setOptions(LOOSE).session(session));
}

/**
 * Đề xuất chi quỹ đang chờ biểu quyết của các phiếu chờ duyệt sửa nguồn Quỹ (1 truy vấn cho cả trang).
 * @returns {Promise<Map<string, { _id, code }>>} workOrderId → đề xuất
 */
export async function pendingFundProposals(workOrders) {
  const ids = workOrders
    .filter((w) => w.status === S.AWAITING_REPAIR_APPROVAL && w.repair?.costSource === REPAIR_COST_SOURCES.FUND)
    .map((w) => w._id);
  if (!ids.length) return new Map();
  const docs = await FundProposal.find({ workOrderId: { $in: ids }, status: FUND_PROPOSAL_STATUS.PENDING })
    .setOptions(LOOSE)
    .select('code workOrderId')
    .lean();
  return new Map(docs.map((d) => [String(d.workOrderId), { _id: d._id, code: d.code }]));
}

/** Số phiếu (trong `filter`) đang có đề xuất chi quỹ chờ Ban quản trị biểu quyết */
export async function countAwaitingVote(filter) {
  const woIds = await FundProposal.distinct('workOrderId', { status: FUND_PROPOSAL_STATUS.PENDING, workOrderId: { $ne: null } }).setOptions(LOOSE);
  if (!woIds.length) return 0;
  return WorkOrder.countDocuments({ ...filter, _id: { $in: woIds } });
}

/**
 * Kế toán gọi TRƯỚC khi tạo đề xuất gắn phiếu bảo trì (cùng session nếu có): phiếu phải chờ duyệt sửa, nguồn Quỹ,
 * và chưa có đề xuất đang chờ (mỗi phiếu chỉ 1 đề xuất PENDING).
 */
export async function assertAwaitingFund(workOrderId, session = null) {
  const wo = await WorkOrder.findById(workOrderId).select('status repair.costSource').session(session).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (wo.status !== S.AWAITING_REPAIR_APPROVAL || wo.repair?.costSource !== REPAIR_COST_SOURCES.FUND) {
    throw new ApiError('WORKORDER_NOT_AWAITING_FUND');
  }
  if (await hasPendingFundProposal(workOrderId, session)) throw new ApiError('WORKORDER_FUND_PENDING');
  return wo;
}

/** Dữ liệu điền sẵn form đề xuất chi quỹ (UC33 bước 2: "related equipment or repair") */
export async function fundPrefill(workOrderId) {
  const wo = await WorkOrder.findById(workOrderId).populate('assetId', 'code name location').lean();
  if (!wo?.repair) throw ApiError.notFound('Không tìm thấy báo cáo hư hỏng');
  const a = wo.assetId;
  return {
    workOrderId: wo._id,
    title: `Sửa chữa ${a ? `${a.code} – ${a.name}` : wo.title}`,
    description: [wo.repair.faultDesc, wo.repair.vendorName && `Nhà thầu: ${wo.repair.vendorName}`, `Phương án: ${wo.repair.vendorProposal}`]
      .filter(Boolean)
      .join('\n'),
    amount: wo.repair.estimatedCost, // chi phí KTV dự kiến; Kế toán được sửa theo báo giá thật
    estimatedCost: wo.repair.estimatedCost,
    attachmentUrls: wo.repair.faultImages ?? [],
    largeRepair: true,
    awaitingFund: wo.status === S.AWAITING_REPAIR_APPROVAL && wo.repair.costSource === REPAIR_COST_SOURCES.FUND,
  };
}

/**
 * Module quỹ gọi SAU KHI đã lưu kết quả đề xuất (vote chốt, hoặc Kế toán rút). Chỉ đổi phiếu còn chờ duyệt sửa bằng Quỹ.
 * - APPROVED: phiếu → Đang sửa, báo KTV (MSG-E07).
 * - REJECTED / CANCELLED: bỏ nguồn Quỹ, báo Trưởng BQL quyết định lại (UC10 bước 5a).
 * @returns {Promise<boolean>} true nếu phiếu được cập nhật
 */
export async function onFundDecision(workOrderId, decision, { user = null, proposalId = null, now = new Date() } = {}) {
  if (!Object.values(FUND_DECISIONS).includes(decision)) throw ApiError.badRequest('Kết quả đề xuất không hợp lệ');
  const approved = decision === FUND_DECISIONS.APPROVED;
  const step = {
    action: approved ? 'FUND_APPROVED' : decision === FUND_DECISIONS.REJECTED ? 'FUND_REJECTED' : 'FUND_CANCELLED',
    by: user?.id ?? null,
    at: now,
    refId: proposalId,
  };
  const wo = await WorkOrder.findOneAndUpdate(
    { _id: workOrderId, status: S.AWAITING_REPAIR_APPROVAL, 'repair.costSource': REPAIR_COST_SOURCES.FUND },
    approved
      ? { $set: { status: S.UNDER_REPAIR }, $push: { 'repair.history': step } }
      : { $set: { 'repair.costSource': null }, $push: { 'repair.history': step } },
    { returnDocument: 'after' },
  ).lean();
  if (!wo) return false;

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_FUND_DECIDED,
    user,
    targetType: AUDIT_TARGETS.WORK_ORDER,
    targetId: wo._id,
    before: { status: S.AWAITING_REPAIR_APPROVAL, costSource: REPAIR_COST_SOURCES.FUND },
    after: approved ? { status: S.UNDER_REPAIR } : { costSource: null },
    metadata: { assetId: wo.assetId, decision, proposalId, financial: true },
  });
  const label = await assetLabel(wo.assetId);
  await safely(() => (approved
    ? notify(wo.assignedTo, {
        type: NOTIFICATION_TYPES.MAINTENANCE,
        title: 'Sửa chữa đã được duyệt',
        content: `Sửa chữa ${label} đã được duyệt (Quỹ bảo trì). Khi nhà thầu sửa xong, tải biên bản nghiệm thu lên phiếu.`, // MSG-E07
        refId: wo._id,
        link: '/app/my-work-orders',
      })
    : notifyRoles(['MANAGER'], {
        type: NOTIFICATION_TYPES.MAINTENANCE,
        title: decision === FUND_DECISIONS.REJECTED ? 'Ban quản trị từ chối chi quỹ' : 'Đề xuất chi quỹ đã bị rút',
        content: `${decision === FUND_DECISIONS.REJECTED ? 'Ban quản trị từ chối' : 'Kế toán đã rút'} đề xuất chi quỹ sửa ${label}. Vui lòng quyết định lại: chi phí vận hành, tạm hoãn hoặc ngừng sử dụng thiết bị.`,
        refId: wo._id,
        link: '/app/repair-approvals',
      })));
  return true;
}

/** Q12: nghiệm thu trên phiếu bảo trì → đánh dấu đã nghiệm thu bên đề xuất đã duyệt (cùng transaction với nghiệm thu) */
export async function markFundWorkAccepted(workOrderId, user, now, session) {
  return FundProposal.updateOne(
    { workOrderId, status: FUND_PROPOSAL_STATUS.APPROVED, workAcceptedAt: null },
    { $set: { workAcceptedBy: user.id, workAcceptedAt: now } },
    { session, ...LOOSE },
  );
}
