// BR-E09 – Ban quản trị xác nhận nghiệm thu sửa chữa bằng Quỹ (lớp 2, sau nghiệm thu kỹ thuật của Trưởng BQL).
//   Chờ Ban quản trị xác nhận ─ Xác nhận ─► Hoàn thành (dời lịch thiết bị) → Kế toán lập phiếu chi
//                             └ Trả về (lý do) ─► Đang sửa (biên bản cũ giữ trong lịch sử, KTV tải biên bản mới)
// Route đặt dưới /fund (Ban quản trị đã có quyền lõi FUND:VIEW, FUND:APPROVE), handler gọi các hàm ở đây.
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, FUND_PROPOSAL_STATUS, NOTIFICATION_TYPES, WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Asset, FundProposal, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { fmtDateVn } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { finishRepair } from './workOrders.repair.js';
import { syncTicketOnEnd } from './workOrders.ticketLink.js';

const S = WORK_ORDER_STATUS;
const { APPROVED } = FUND_PROPOSAL_STATUS;
const step = (action, user, now, extra = {}) => ({ action, by: user.id, at: now, ...extra });
const safely = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.error('[BR-E09] Lỗi gửi thông báo:', err);
  }
};
const assetLabel = async (assetId) => {
  const a = await Asset.findById(assetId).select('code name').lean();
  return a ? `${a.code} – ${a.name}` : 'thiết bị';
};

async function loadAwaiting(workOrderId) {
  const wo = await WorkOrder.findById(workOrderId).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (wo.status !== S.AWAITING_BOARD_ACCEPTANCE) throw new ApiError('WORKORDER_NOT_AWAITING_BOARD');
  return wo;
}

/**
 * Xác nhận nghiệm thu: phiếu → Hoàn thành, cập nhật thiết bị, đánh dấu đề xuất đã duyệt (cả nghiệm thu kỹ thuật nếu phiếu khẩn
 * cấp có đề xuất được duyệt sau lúc Trưởng BQL nghiệm thu). Phiếu khẩn cấp chưa có đề xuất được duyệt thì chưa xác nhận được.
 */
export async function boardAccept(user, workOrderId, { note = null } = {}, now = new Date()) {
  const wo = await loadAwaiting(workOrderId);
  const proposal = await FundProposal.findOne({ workOrderId: wo._id, status: APPROVED }).select('_id code').lean();
  if (!proposal) {
    throw new ApiError('WORKORDER_NOT_AWAITING_BOARD', wo.repair?.isEmergency
      ? 'Sửa chữa khẩn cấp chưa có đề xuất chi quỹ được Ban quản trị duyệt, chưa xác nhận nghiệm thu được'
      : 'Không tìm thấy đề xuất chi quỹ đã duyệt của phiếu này');
  }
  const text = note?.trim() || null;
  const nextDate = await withTransaction(async (session) => {
    const done = await WorkOrder.findOneAndUpdate(
      { _id: wo._id, status: S.AWAITING_BOARD_ACCEPTANCE },
      {
        $set: { status: S.DONE, completedAt: now, 'repair.boardAcceptedBy': user.id, 'repair.boardAcceptedAt': now, 'repair.boardReturnNote': null },
        $push: { 'repair.history': step('BOARD_ACCEPTED', user, now, { note: text, refId: proposal._id }) },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!done) throw new ApiError('CONCURRENT_UPDATE');
    const res = await FundProposal.updateOne(
      { _id: proposal._id, status: APPROVED, boardAcceptedAt: null },
      {
        $set: {
          boardAcceptedBy: user.id,
          boardAcceptedAt: now,
          // Phiếu khẩn cấp: Trưởng BQL nghiệm thu trước khi đề xuất được duyệt → ghi lại ở đây
          ...(done.repair?.acceptedAt && { workAcceptedBy: done.repair.acceptedBy, workAcceptedAt: done.repair.acceptedAt }),
        },
        $push: { history: { action: 'BOARD_ACCEPTED', by: user.id, at: now, note: text } },
      },
      { session },
    );
    if (res.modifiedCount !== 1) throw new ApiError('CONCURRENT_UPDATE');
    return finishRepair(session, done, now);
  });
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_BOARD_ACCEPTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.DONE },
    metadata: { assetId: wo.assetId, proposalId: proposal._id, proposal: proposal.code, financial: true },
  });
  await syncTicketOnEnd({ ticketId: wo.ticketId, status: S.DONE }, now);
  const label = await assetLabel(wo.assetId);
  await safely(async () => {
    await notifyRoles(['ACCOUNTANT'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đã xác nhận nghiệm thu ${proposal.code}, lập phiếu chi`,
      content: `Ban quản trị đã xác nhận nghiệm thu sửa chữa ${label}. Kế toán lập phiếu chi thực tế kèm hóa đơn.`,
      refId: proposal._id,
      link: `/app/fund/proposals/${proposal._id}`,
    });
    await notify(wo.assignedTo, {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Sửa chữa đã được nghiệm thu',
      content: `Sửa chữa ${label} đã được Ban quản trị xác nhận nghiệm thu, thiết bị hoạt động lại.${nextDate ? ` Lần bảo trì tiếp theo: ${fmtDateVn(nextDate)}.` : ''}`, // MSG-E11
      refId: wo._id,
      link: '/app/my-work-orders',
    });
  });
  return WorkOrder.findById(wo._id).lean();
}

/** Trả về: phiếu → Đang sửa, xóa biên bản đang chờ (giữ trong repair.history), bỏ đánh dấu nghiệm thu kỹ thuật bên đề xuất */
export async function boardReturn(user, workOrderId, { comment }, now = new Date()) {
  const text = comment?.trim() || '';
  if (text.length < 5) throw ApiError.field('comment', 'Ghi lý do tối thiểu 5 ký tự');
  const wo = await loadAwaiting(workOrderId);
  await withTransaction(async (session) => {
    const res = await WorkOrder.updateOne(
      { _id: wo._id, status: S.AWAITING_BOARD_ACCEPTANCE },
      {
        $set: {
          status: S.UNDER_REPAIR,
          'repair.acceptanceImages': [],
          'repair.inspectionCertUrls': [],
          'repair.acceptanceNote': null,
          'repair.acceptanceUploadedAt': null,
          'repair.acceptedBy': null,
          'repair.acceptedAt': null,
          'repair.boardReturnNote': text,
        },
        $push: { 'repair.history': step('BOARD_RETURNED', user, now, { note: text }) },
      },
      { session },
    );
    if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
    await FundProposal.updateOne(
      { workOrderId: wo._id, status: APPROVED },
      { $set: { workAcceptedBy: null, workAcceptedAt: null }, $push: { history: { action: 'BOARD_RETURNED', by: user.id, at: now, note: text } } },
      { session },
    );
  });
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_BOARD_RETURNED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.UNDER_REPAIR }, metadata: { assetId: wo.assetId, reason: text, financial: true },
  });
  const label = await assetLabel(wo.assetId);
  await safely(async () => {
    await notify(wo.assignedTo, {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Ban quản trị yêu cầu sửa lại',
      content: `Ban quản trị chưa đồng ý nghiệm thu sửa chữa ${label}: ${text}. Khi nhà thầu sửa lại, tải biên bản mới.`,
      refId: wo._id,
      link: '/app/my-work-orders',
    });
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Ban quản trị trả về nghiệm thu',
      content: `Ban quản trị chưa đồng ý nghiệm thu sửa chữa ${label}: ${text}. Phiếu về Đang sửa.`,
      refId: wo._id,
      link: '/app/work-orders',
    });
  });
  return WorkOrder.findById(wo._id).lean();
}

/**
 * Việc chờ Ban quản trị xác nhận nghiệm thu: phiếu bảo trì (kèm thiết bị, biên bản, đề xuất, cờ ready) + đề xuất sửa chữa lớn
 * không gắn phiếu đã được Trưởng BQL nghiệm thu. Cũ nhất trước. readyCount: số việc Ban quản trị xác nhận được ngay.
 */
export async function listAwaitingBoard() {
  const wos = await WorkOrder.find({ status: S.AWAITING_BOARD_ACCEPTANCE })
    .select('assetId title status assignedTo repair.estimatedCost repair.acceptanceImages repair.inspectionCertUrls repair.acceptanceNote repair.acceptedAt repair.acceptedBy repair.isEmergency repair.faultDesc')
    .populate('assetId', 'code name location category')
    .populate('assignedTo', 'fullName')
    .populate('repair.acceptedBy', 'fullName')
    .sort({ 'repair.acceptedAt': 1 })
    .lean();
  const proposals = wos.length
    ? await FundProposal.find({ workOrderId: { $in: wos.map((w) => w._id) }, status: { $in: [APPROVED, FUND_PROPOSAL_STATUS.PENDING] } })
      .select('code title amount status workOrderId')
      .lean()
    : [];
  const byWo = new Map(proposals.map((p) => [String(p.workOrderId), p]));
  const standalone = await FundProposal.find({
    status: APPROVED, largeRepair: true, workOrderId: null, workAcceptedAt: { $ne: null }, boardAcceptedAt: null,
  })
    .select('code title amount status workAcceptedAt workAcceptedBy')
    .populate('workAcceptedBy', 'fullName')
    .sort({ workAcceptedAt: 1 })
    .lean();
  // ready: đề xuất đã được Ban quản trị duyệt → xác nhận nghiệm thu được. Phiếu khẩn cấp sửa trước, đề xuất còn chờ
  // biểu quyết thì chưa xác nhận được (boardAccept chặn) → vẫn trả về để biết, nhưng không tính vào việc cần làm.
  const items = wos.map((w) => {
    const proposal = byWo.get(String(w._id)) ?? null;
    return { ...w, proposal, ready: proposal?.status === APPROVED };
  });
  return {
    workOrders: items,
    proposals: standalone,
    readyCount: items.filter((w) => w.ready).length + standalone.length,
  };
}
