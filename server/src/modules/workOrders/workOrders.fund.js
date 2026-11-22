// UC10 – Nối phiếu bảo trì với module Quỹ bảo trì. Module quỹ gọi thẳng các hàm này, không qua sự kiện.
//
// Luồng thường: Trưởng BQL duyệt sửa bằng Quỹ → phiếu giữ "Chờ duyệt sửa", repair.costSource = FUND → Trưởng BQL lập đề xuất
// (UC33) gắn workOrderId → Kế toán xác nhận tài chính (trả lại thì Trưởng BQL sửa, gửi lại) → Ban quản trị biểu quyết (UC34)
// → onFundDecision. Nghiệm thu: Trưởng BQL nghiệm thu kỹ thuật trên phiếu (markFundWorkAccepted) → Ban quản trị xác nhận
// (workOrders.board.js) → Kế toán lập phiếu chi.
// Luồng khẩn cấp (BR-E11): phiếu đã Đang sửa trước khi có đề xuất; kết quả biểu quyết không đổi trạng thái phiếu.
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, FUND_PROPOSAL_STATUS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, ROLES, WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Asset, FundProposal, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';

const S = WORK_ORDER_STATUS;
const LOOSE = { strictQuery: false };
export const FUND_DECISIONS = Object.freeze({ APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', RETURNED: 'RETURNED' });
// Phiếu khẩn cấp được lập đề xuất khi đang sửa / chờ nghiệm thu (sửa trước, hồ sơ sau)
const EMERGENCY_FUNDABLE = [S.UNDER_REPAIR, S.AWAITING_ACCEPTANCE, S.AWAITING_BOARD_ACCEPTANCE];

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

/** Phiếu đang có đề xuất chi quỹ còn xử lý (chờ Kế toán / bị trả lại / chờ Ban quản trị biểu quyết) */
export async function hasPendingFundProposal(workOrderId, session = null) {
  return Boolean(await FundProposal.exists({ workOrderId, isOpen: true }).setOptions(LOOSE).session(session));
}

/**
 * Đề xuất chi quỹ đang xử lý của các phiếu nguồn Quỹ (1 truy vấn cho cả trang).
 * @returns {Promise<Map<string, { _id, code, status }>>} workOrderId → đề xuất (status cho biết đang chờ Kế toán hay Ban quản trị)
 */
export async function pendingFundProposals(workOrders) {
  const ids = workOrders.filter((w) => w.repair?.costSource === REPAIR_COST_SOURCES.FUND).map((w) => w._id);
  if (!ids.length) return new Map();
  const docs = await FundProposal.find({ workOrderId: { $in: ids }, isOpen: true })
    .setOptions(LOOSE)
    .select('code workOrderId status')
    .lean();
  return new Map(docs.map((d) => [String(d.workOrderId), { _id: d._id, code: d.code, status: d.status }]));
}

/** Số phiếu (trong `filter`) có đề xuất chi quỹ đang chờ Kế toán hoặc Ban quản trị (không tính đề xuất bị trả lại) */
export async function countAwaitingFund(filter) {
  const woIds = await FundProposal.distinct('workOrderId', {
    isOpen: true,
    status: { $ne: FUND_PROPOSAL_STATUS.RETURNED },
    workOrderId: { $ne: null },
  }).setOptions(LOOSE);
  if (!woIds.length) return 0;
  return WorkOrder.countDocuments({ ...filter, _id: { $in: woIds } });
}

/**
 * Gọi TRƯỚC khi tạo đề xuất gắn phiếu bảo trì: phiếu nguồn Quỹ đang chờ duyệt sửa (hoặc phiếu khẩn cấp đang sửa / chờ nghiệm
 * thu), chưa có đề xuất đang xử lý; phiếu khẩn cấp còn phải chưa có đề xuất đã duyệt.
 */
export async function assertAwaitingFund(workOrderId, session = null) {
  const wo = await WorkOrder.findById(workOrderId).select('status repair.costSource repair.isEmergency').session(session).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  const emergency = Boolean(wo.repair?.isEmergency);
  const statusOk = wo.status === S.AWAITING_REPAIR_APPROVAL || (emergency && EMERGENCY_FUNDABLE.includes(wo.status));
  if (!statusOk || wo.repair?.costSource !== REPAIR_COST_SOURCES.FUND) throw new ApiError('WORKORDER_NOT_AWAITING_FUND');
  if (await hasPendingFundProposal(workOrderId, session)) throw new ApiError('WORKORDER_FUND_PENDING');
  if (emergency) {
    const approved = await FundProposal.exists({
      workOrderId, status: { $in: [FUND_PROPOSAL_STATUS.APPROVED, FUND_PROPOSAL_STATUS.PAID] },
    }).setOptions(LOOSE).session(session);
    if (approved) throw new ApiError('WORKORDER_NOT_AWAITING_FUND', 'Phiếu khẩn cấp đã có đề xuất chi quỹ được duyệt');
  }
  return wo;
}

/** Dữ liệu điền sẵn form đề xuất chi quỹ (UC33 bước 2: "related equipment or repair") */
export async function fundPrefill(workOrderId) {
  const wo = await WorkOrder.findById(workOrderId).populate('assetId', 'code name location').lean();
  if (!wo?.repair) throw ApiError.notFound('Không tìm thấy báo cáo hư hỏng');
  const a = wo.assetId;
  const emergency = Boolean(wo.repair.isEmergency);
  return {
    workOrderId: wo._id,
    title: `Sửa chữa ${a ? `${a.code} – ${a.name}` : wo.title}`,
    description: [wo.repair.faultDesc, wo.repair.vendorName && `Nhà thầu: ${wo.repair.vendorName}`, `Phương án: ${wo.repair.vendorProposal}`]
      .filter(Boolean)
      .join('\n'),
    amount: wo.repair.estimatedCost, // chi phí KTV dự kiến; Trưởng BQL được sửa theo báo giá thật
    estimatedCost: wo.repair.estimatedCost,
    attachmentUrls: wo.repair.faultImages ?? [],
    largeRepair: true,
    isEmergency: emergency,
    // BR-E11: sửa khẩn cấp luôn là bảo trì đột xuất, lý do lấy từ quyết định khẩn cấp
    ...(emergency && { planType: 'UNSCHEDULED', urgentReason: wo.repair.emergencyReason }),
    awaitingFund: wo.repair.costSource === REPAIR_COST_SOURCES.FUND
      && (wo.status === S.AWAITING_REPAIR_APPROVAL || (emergency && EMERGENCY_FUNDABLE.includes(wo.status))),
  };
}

const STEP_ACTION = {
  APPROVED: 'FUND_APPROVED', REJECTED: 'FUND_REJECTED', CANCELLED: 'FUND_CANCELLED', RETURNED: 'FUND_RETURNED',
};

/**
 * Module quỹ gọi SAU KHI đã lưu kết quả đề xuất (Kế toán trả lại, vote chốt, Trưởng BQL rút).
 * Phiếu thường (còn Chờ duyệt sửa, nguồn Quỹ):
 *   - APPROVED: phiếu → Đang sửa, báo KTV (MSG-E07).
 *   - REJECTED / CANCELLED: bỏ nguồn Quỹ, báo Trưởng BQL quyết định lại (UC10 bước 5a).
 *   - RETURNED: chỉ ghi lịch sử (Trưởng BQL sửa đề xuất và gửi lại).
 * Phiếu khẩn cấp (đã sửa trước): không đổi trạng thái; bị từ chối / rút thì báo Ban quản trị + Trưởng BQL xử lý.
 * @returns {Promise<boolean>} true nếu phiếu được cập nhật
 */
export async function onFundDecision(workOrderId, decision, { user = null, proposalId = null, now = new Date() } = {}) {
  if (!Object.values(FUND_DECISIONS).includes(decision)) throw ApiError.badRequest('Kết quả đề xuất không hợp lệ');
  const current = await WorkOrder.findById(workOrderId).select('status repair.costSource repair.isEmergency assetId assignedTo').lean();
  if (!current || current.repair?.costSource !== REPAIR_COST_SOURCES.FUND) return false;
  const emergency = Boolean(current.repair.isEmergency);
  const approved = decision === FUND_DECISIONS.APPROVED;
  const returned = decision === FUND_DECISIONS.RETURNED;
  const step = {
    action: emergency && !approved && !returned ? 'FUND_REJECTED_EMERGENCY' : STEP_ACTION[decision],
    by: user?.id ?? null,
    at: now,
    refId: proposalId,
  };

  let wo;
  if (emergency || returned) {
    // Chỉ ghi lịch sử, không đổi trạng thái
    wo = await WorkOrder.findOneAndUpdate(
      { _id: workOrderId, 'repair.costSource': REPAIR_COST_SOURCES.FUND },
      { $push: { 'repair.history': step } },
      { returnDocument: 'after' },
    ).lean();
  } else {
    wo = await WorkOrder.findOneAndUpdate(
      { _id: workOrderId, status: S.AWAITING_REPAIR_APPROVAL, 'repair.costSource': REPAIR_COST_SOURCES.FUND },
      approved
        ? { $set: { status: S.UNDER_REPAIR }, $push: { 'repair.history': step } }
        : { $set: { 'repair.costSource': null }, $push: { 'repair.history': step } },
      { returnDocument: 'after' },
    ).lean();
  }
  if (!wo) return false;
  if (returned) return true;

  const changed = !emergency;
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_FUND_DECIDED,
    user,
    targetType: AUDIT_TARGETS.WORK_ORDER,
    targetId: wo._id,
    before: changed ? { status: S.AWAITING_REPAIR_APPROVAL, costSource: REPAIR_COST_SOURCES.FUND } : { status: current.status },
    after: changed ? (approved ? { status: S.UNDER_REPAIR } : { costSource: null }) : { status: wo.status },
    metadata: { assetId: wo.assetId, decision, proposalId, financial: true, ...(emergency && { emergency: true }) },
  });
  const label = await assetLabel(wo.assetId);
  if (emergency) {
    if (approved) return true;
    // Đã sửa bằng Quỹ nhưng khoản chi bị từ chối / rút: không tự xử lý, Ban quản trị + Trưởng BQL quyết và báo cáo Hội nghị
    await safely(async () => {
      const members = await User.find({ role: ROLES.BOARD, isActive: true }).select('_id').lean();
      const msg = {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: 'Khoản sửa chữa khẩn cấp không được duyệt chi quỹ',
        content: `Đề xuất chi quỹ cho sửa chữa khẩn cấp ${label} ${decision === FUND_DECISIONS.REJECTED ? 'bị Ban quản trị từ chối' : 'đã bị rút'}. `
          + 'Cần thống nhất nguồn chi khác và báo cáo Hội nghị nhà chung cư.',
        refId: wo._id,
        link: '/app/repair-approvals',
      };
      await notify(members.map((m) => m._id), msg);
      await notifyRoles(['MANAGER'], msg);
    });
    return true;
  }
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
        content: `${decision === FUND_DECISIONS.REJECTED ? 'Ban quản trị từ chối' : 'Đã rút'} đề xuất chi quỹ sửa ${label}. Vui lòng quyết định lại: chi phí vận hành, tạm hoãn hoặc ngừng sử dụng thiết bị.`,
        refId: wo._id,
        link: '/app/repair-approvals',
      })));
  return true;
}

/** Trưởng BQL nghiệm thu kỹ thuật trên phiếu → đánh dấu bên đề xuất đã duyệt (cùng transaction với nghiệm thu) */
export async function markFundWorkAccepted(workOrderId, user, now, session) {
  return FundProposal.updateOne(
    { workOrderId, status: FUND_PROPOSAL_STATUS.APPROVED, workAcceptedAt: null },
    { $set: { workAcceptedBy: user.id, workAcceptedAt: now } },
    { session, ...LOOSE },
  );
}

/** Ban quản trị xác nhận nghiệm thu trên phiếu → đánh dấu bên đề xuất đã duyệt (cùng transaction) */
export async function markFundBoardAccepted(workOrderId, user, now, session) {
  return FundProposal.updateOne(
    { workOrderId, status: FUND_PROPOSAL_STATUS.APPROVED, boardAcceptedAt: null },
    {
      $set: { boardAcceptedBy: user.id, boardAcceptedAt: now },
      $push: { history: { action: 'BOARD_ACCEPTED', by: user.id, at: now, note: null } },
    },
    { session, ...LOOSE },
  );
}
