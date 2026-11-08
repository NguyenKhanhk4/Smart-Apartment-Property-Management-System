// UC09 – Báo cáo hư hỏng và nghiệm thu sửa chữa; UC10 (phần tối thiểu) – Trưởng BQL duyệt sửa bằng chi phí vận hành.
// Luồng (BR-E05, Q12): Đang kiểm tra (Có sự cố) → Chờ duyệt sửa → Đang sửa → Chờ nghiệm thu → Hoàn thành.
// Mọi bước ghi có điều kiện trạng thái cũ nên 2 thao tác cùng lúc không ghi đè nhau; thêm 1 dòng repair.history + audit.
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, WORK_ORDER_RESULTS, WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { Asset, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { computeNextMaintenance } from '../assets/assets.service.js';

const S = WORK_ORDER_STATUS;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const step = (action, user, now, extra = {}) => ({ action, by: user.id, at: now, ...extra });
const money = (n) => `${Math.round(n).toLocaleString('vi-VN')} đ`;

async function load(id) {
  const wo = await WorkOrder.findById(id).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  return wo;
}
const invalid = (message) => new ApiError('WORKORDER_INVALID_STATUS', message);
const assetLabel = async (assetId) => {
  const a = await Asset.findById(assetId).select('code name').lean();
  return a ? `${a.code} – ${a.name}` : 'thiết bị';
};
/** Thông báo gửi sau khi đã lưu; lỗi gửi không làm hỏng thao tác */
const safely = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.error('[UC09] Lỗi gửi thông báo:', err);
  }
};
const noImages = (field = 'images') => ApiError.badRequest('Cần ít nhất 1 ảnh', [{ field, message: 'Cần ít nhất 1 ảnh' }]); // MSG-G01

// ===== UC09 bước 1–3: KTV báo cáo hư hỏng =====
/** Chỉ phiếu của mình, đã nộp kết quả Có sự cố ở UC08. Chuyển Chờ duyệt sửa, báo Trưởng BQL (MSG-E06) */
export async function reportFault(user, id, { faultDesc, vendorName, vendorProposal, estimatedCost }, files = [], now = new Date()) {
  const wo = await load(id);
  if (!sameId(wo.assignedTo, user.id)) throw ApiError.forbidden();
  if (wo.status !== S.IN_PROGRESS || wo.result !== WORK_ORDER_RESULTS.FAULTY) {
    throw invalid('Chỉ báo cáo hư hỏng cho phiếu đã nộp kết quả Có sự cố và chưa báo cáo');
  }
  if (!files.length) throw noImages();
  const faultImages = await uploadToCloudinary(files, 'work-orders');
  const repair = {
    faultDesc, vendorName, vendorProposal, estimatedCost, faultImages, reportedBy: user.id, reportedAt: now,
    history: [step('REPORTED', user, now, { note: faultDesc, images: faultImages })],
  };
  const res = await WorkOrder.updateOne(
    { _id: id, status: S.IN_PROGRESS, assignedTo: user.id, result: WORK_ORDER_RESULTS.FAULTY },
    { $set: { status: S.AWAITING_REPAIR_APPROVAL, repair } },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_FAULT_REPORTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    after: { status: S.AWAITING_REPAIR_APPROVAL, estimatedCost }, metadata: { assetId: wo.assetId },
  });
  await safely(async () => notifyRoles(['MANAGER'], {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Báo cáo hư hỏng thiết bị',
    content: `Có hư hỏng nghiêm trọng ở ${await assetLabel(wo.assetId)}. Vui lòng xem đề xuất sửa chữa (dự kiến ${money(estimatedCost)}).`, // MSG-E06
    refId: wo._id,
    link: '/app/work-orders',
  }));
  return WorkOrder.findById(id).lean();
}

// ===== UC10 (tối thiểu): Trưởng BQL duyệt sửa =====
/**
 * Chỉ nguồn Chi phí vận hành: chuyển Đang sửa, báo KTV (MSG-E07). Nguồn Quỹ bảo trì (đề xuất chi qua Ban quản trị)
 * và Tạm hoãn làm ở UC10.
 */
export async function approveRepair(user, id, { costSource, note }, now = new Date()) {
  if (costSource !== REPAIR_COST_SOURCES.OPERATING) throw new ApiError('WORKORDER_COST_SOURCE_UNSUPPORTED');
  const wo = await load(id);
  if (wo.status !== S.AWAITING_REPAIR_APPROVAL) throw invalid('Phiếu không ở trạng thái chờ duyệt sửa');
  const res = await WorkOrder.updateOne(
    { _id: id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: {
        status: S.UNDER_REPAIR,
        'repair.costSource': costSource,
        'repair.decidedBy': user.id,
        'repair.decidedAt': now,
        'repair.decisionNote': note || null,
      },
      $push: { 'repair.history': step('APPROVED', user, now, { note: note || null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_APPROVED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.UNDER_REPAIR, costSource, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId },
  });
  await safely(async () => notify(wo.assignedTo, {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Sửa chữa đã được duyệt',
    content: `Sửa chữa ${await assetLabel(wo.assetId)} đã được duyệt (chi phí vận hành). Khi nhà thầu sửa xong, tải biên bản nghiệm thu lên phiếu.`, // MSG-E07
    refId: wo._id,
    link: '/app/my-work-orders',
  }));
  return WorkOrder.findById(id).lean();
}

// ===== UC09 bước 4–6: KTV tải biên bản nghiệm thu của nhà thầu =====
/** Đang sửa → Chờ nghiệm thu (không hoàn thành thẳng, Q12); thiết bị vẫn đang sửa; báo Trưởng BQL (MSG-E13) */
export async function uploadAcceptance(user, id, { note }, files = [], now = new Date()) {
  const wo = await load(id);
  if (!sameId(wo.assignedTo, user.id)) throw ApiError.forbidden();
  if (wo.status !== S.UNDER_REPAIR) {
    throw invalid(wo.status === S.AWAITING_REPAIR_APPROVAL ? 'Sửa chữa chưa được duyệt, chưa tải biên bản được' : 'Phiếu không ở trạng thái đang sửa');
  }
  if (!files.length) throw noImages();
  const images = await uploadToCloudinary(files, 'work-orders');
  const res = await WorkOrder.updateOne(
    { _id: id, status: S.UNDER_REPAIR, assignedTo: user.id },
    {
      $set: { status: S.AWAITING_ACCEPTANCE, 'repair.acceptanceImages': images, 'repair.acceptanceNote': note || null, 'repair.acceptanceUploadedAt': now },
      $push: { 'repair.history': step('ACCEPTANCE_UPLOADED', user, now, { note: note || null, images }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_ACCEPTANCE_UPLOADED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.AWAITING_ACCEPTANCE }, metadata: { assetId: wo.assetId },
  });
  await safely(async () => notifyRoles(['MANAGER'], {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Sửa chữa chờ nghiệm thu',
    content: `Sửa chữa ${await assetLabel(wo.assetId)} đã có biên bản của nhà thầu, đang chờ bạn nghiệm thu.`, // MSG-E13
    refId: wo._id,
    link: '/app/work-orders',
  }));
  return WorkOrder.findById(id).lean();
}

// ===== Q12: Trưởng BQL nghiệm thu =====
/**
 * Chờ nghiệm thu → Hoàn thành, trong 1 transaction cùng cập nhật thiết bị: ghi lần bảo trì hôm nay; lịch kế tiếp chỉ dời khi
 * đã đến hạn (≤ hôm nay thì thành hôm nay + chu kỳ), còn ở tương lai thì giữ. Báo KTV (MSG-E11).
 */
export async function acceptRepair(user, id, now = new Date()) {
  const wo = await load(id);
  if (wo.status !== S.AWAITING_ACCEPTANCE) throw invalid('Phiếu chưa có biên bản nghiệm thu để xác nhận');
  const nextDate = await withTransaction(async (session) => {
    const done = await WorkOrder.findOneAndUpdate(
      { _id: id, status: S.AWAITING_ACCEPTANCE },
      {
        $set: { status: S.DONE, completedAt: now, 'repair.acceptedBy': user.id, 'repair.acceptedAt': now },
        $push: { 'repair.history': step('ACCEPTED', user, now) },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!done) throw new ApiError('CONCURRENT_UPDATE');
    if (done.type !== WORK_ORDER_TYPES.SCHEDULED) return null;
    const asset = await Asset.findById(done.assetId).session(session);
    if (!asset) return null;
    const today = startOfVnDay(now);
    asset.lastMaintenanceDate = today;
    if (asset.nextMaintenanceDate <= today) {
      asset.nextMaintenanceDate = computeNextMaintenance(today, { cycleValue: asset.cycleValue, cycleUnit: asset.cycleUnit });
    }
    await asset.save({ session });
    return asset.nextMaintenanceDate;
  });
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_ACCEPTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.DONE }, metadata: { assetId: wo.assetId },
  });
  await safely(async () => notify(wo.assignedTo, {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Sửa chữa đã được nghiệm thu',
    content: `Sửa chữa ${await assetLabel(wo.assetId)} đã được nghiệm thu, thiết bị hoạt động lại.${nextDate ? ` Lần bảo trì tiếp theo: ${fmtDateVn(nextDate)}.` : ''}`, // MSG-E11
    refId: wo._id,
    link: '/app/my-work-orders',
  }));
  return WorkOrder.findById(id).lean();
}

/** Chờ nghiệm thu → Đang sửa, bắt buộc lý do; biên bản bị trả lại vẫn giữ trong repair.history; báo KTV */
export async function returnRepair(user, id, { comment }, now = new Date()) {
  const wo = await load(id);
  if (wo.status !== S.AWAITING_ACCEPTANCE) throw invalid('Phiếu không ở trạng thái chờ nghiệm thu');
  const res = await WorkOrder.updateOne(
    { _id: id, status: S.AWAITING_ACCEPTANCE },
    {
      $set: { status: S.UNDER_REPAIR, 'repair.acceptanceImages': [], 'repair.acceptanceNote': null, 'repair.acceptanceUploadedAt': null },
      $push: { 'repair.history': step('RETURNED', user, now, { note: comment }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_RETURNED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.UNDER_REPAIR }, metadata: { assetId: wo.assetId, reason: comment },
  });
  await safely(async () => notify(wo.assignedTo, {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Yêu cầu sửa lại',
    content: `Trưởng BQL chưa nghiệm thu sửa chữa ${await assetLabel(wo.assetId)}: ${comment}. Khi nhà thầu sửa lại, tải biên bản mới.`,
    refId: wo._id,
    link: '/app/my-work-orders',
  }));
  return WorkOrder.findById(id).lean();
}
