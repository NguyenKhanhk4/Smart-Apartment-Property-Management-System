// UC10 – Duyệt sửa chữa lớn: Trưởng BQL quyết định với báo cáo hư hỏng (BR-E06, Q5).
//
//   Chờ duyệt sửa ─ Duyệt, chi phí vận hành ─► Đang sửa (MSG-E07). Chặn nếu cộng dồn 30 ngày ≥ ngưỡng (BR-E08)
//                ├ Duyệt, bảo hành ─────────► Đang sửa, hãng bảo hành sửa (chỉ khi còn bảo hành, BR-E10)
//                ├ Duyệt, Quỹ bảo trì ──────► giữ Chờ duyệt sửa, Trưởng BQL lập đề xuất chi quỹ (workOrders.fund.js)
//                ├ Duyệt, Quỹ, khẩn cấp ────► Đang sửa ngay, đề xuất lập sau trong N ngày (BR-E11)
//                ├ Tạm hoãn ────────────────► Tạm hoãn sửa (lý do + ngày xem lại ≤ N ngày; dời lịch kiểm tra)
//                └ Ngừng sử dụng ───────────► Đã đóng, thiết bị ngừng theo dõi
//   Tạm hoãn sửa ─ Gửi yêu cầu sửa lại (KTV / Trưởng BQL) ─► Chờ duyệt sửa
//                └ Ngừng sử dụng ─► Đã đóng
// Phiếu hoãn được nhắc từ ngày xem lại, lặp mỗi N ngày (remindPostponedRepairs). Mọi bước ghi có điều kiện trạng thái cũ.
import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_KEYS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, REPAIR_DECISIONS, ROLES, WORK_ORDER_INSPECTING_STATUSES,
  WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { Asset, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfigs } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { DAY_MS, endOfVnDay, fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { computeNextMaintenance } from '../assets/assets.service.js';
import { countAwaitingFund, hasPendingFundProposal, pendingFundProposals } from './workOrders.fund.js';
import { syncTicketOnEnd } from './workOrders.ticketLink.js';

const S = WORK_ORDER_STATUS;
const step = (action, user, now, extra = {}) => ({ action, by: user?.id ?? null, at: now, ...extra });
const money = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;
const invalid = (message) => new ApiError('WORKORDER_INVALID_STATUS', message);
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
async function load(id) {
  const wo = await WorkOrder.findById(id).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  return wo;
}

/** Tham số UC10 (đọc từ system_configs, thiếu thì mặc định) */
export async function repairSettings() {
  const K = CONFIG_KEYS;
  const c = await getConfigs([
    K.REPAIR_REVIEW_REPEAT_DAYS, K.REPAIR_POSTPONE_MAX_DAYS, K.REPAIR_FUND_THRESHOLD, K.REPAIR_OPERATING_WINDOW_DAYS, K.EMERGENCY_DOSSIER_DAYS,
  ]);
  return {
    reviewRepeatDays: Number(c[K.REPAIR_REVIEW_REPEAT_DAYS]) || 7,
    postponeMaxDays: Number(c[K.REPAIR_POSTPONE_MAX_DAYS]) || 90,
    fundThreshold: Number(c[K.REPAIR_FUND_THRESHOLD]) || 50_000_000,
    operatingWindowDays: Number(c[K.REPAIR_OPERATING_WINDOW_DAYS]) || 30,
    emergencyDossierDays: Number(c[K.EMERGENCY_DOSSIER_DAYS]) || 3,
  };
}

// ===== BR-E08, BR-E10: chính sách chọn nguồn chi =====
const toId = (id) => new mongoose.Types.ObjectId(String(id?._id ?? id));

/**
 * Tổng chi phí vận hành đã duyệt cho cùng thiết bị trong windowDays ngày gần nhất (trừ phiếu excludeId).
 * Phiếu Kế toán đã ghi chi thực tế thì lấy số thực tế, chưa ghi thì lấy chi phí dự kiến.
 */
export async function operatingSpentInWindow(assetId, now, windowDays, excludeId = null) {
  const [row] = await WorkOrder.aggregate([
    {
      $match: {
        assetId: toId(assetId),
        'repair.costSource': REPAIR_COST_SOURCES.OPERATING,
        'repair.decidedAt': { $gte: new Date(now.getTime() - windowDays * DAY_MS) },
        ...(excludeId && { _id: { $ne: toId(excludeId) } }),
      },
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$repair.actualCost', { $ifNull: ['$repair.estimatedCost', 0] }] } } } },
  ]);
  return row?.total ?? 0;
}

/**
 * Chính sách chọn nguồn cho phiếu có báo cáo hư hỏng: tổng = dự kiến + đã chi vận hành cùng thiết bị trong cửa sổ;
 * tổng ≥ ngưỡng → bắt buộc Quỹ (BR-E08). Còn bảo hành khi warrantyEnd ≥ đầu ngày hôm nay (BR-E10).
 */
export async function repairPolicy(wo, now = new Date(), settings = null) {
  const { fundThreshold: threshold, operatingWindowDays: windowDays } = settings ?? (await repairSettings());
  const [spentInWindow, asset] = await Promise.all([
    operatingSpentInWindow(wo.assetId, now, windowDays, wo._id),
    Asset.findById(toId(wo.assetId)).select('warrantyEnd').lean(),
  ]);
  const estimatedCost = wo.repair?.estimatedCost ?? 0;
  const total = estimatedCost + spentInWindow;
  const warrantyEnd = asset?.warrantyEnd ?? null;
  return {
    threshold,
    windowDays,
    estimatedCost,
    spentInWindow,
    total,
    fundRequired: total >= threshold,
    warrantyActive: Boolean(warrantyEnd && new Date(warrantyEnd) >= startOfVnDay(now)),
    warrantyEnd,
  };
}

/** Báo KTV kết quả quyết định (MSG-E07). Phiếu chưa có KTV thì bỏ qua */
const notifyTech = (wo, title, content) => safely(async () => {
  if (!wo.assignedTo) return;
  await notify(wo.assignedTo, { type: NOTIFICATION_TYPES.MAINTENANCE, title, content, refId: wo._id, link: '/app/my-work-orders' });
});

// ===== UC10 bước 3–5, 3a: quyết định =====
/**
 * @param {{ decision: 'APPROVE'|'POSTPONE'|'RETIRE', costSource?: 'OPERATING'|'FUND'|'WARRANTY', comment?: string, reviewDate?: Date,
 *   warrantyOverrideReason?: string, emergency?: boolean, emergencyReason?: string }} body
 * Còn đề xuất chi quỹ đang chờ Ban quản trị biểu quyết thì không quyết định lại được (WORKORDER_FUND_PENDING).
 */
export async function decideRepair(user, id, body, now = new Date()) {
  const { decision, costSource, comment = '', reviewDate, warrantyOverrideReason, emergency = false, emergencyReason } = body;
  const wo = await load(id);
  const note = comment?.trim() || null;
  const allowed = decision === REPAIR_DECISIONS.RETIRE ? [S.AWAITING_REPAIR_APPROVAL, S.REPAIR_POSTPONED] : [S.AWAITING_REPAIR_APPROVAL];
  if (!allowed.includes(wo.status)) {
    throw invalid(wo.status === S.REPAIR_POSTPONED ? 'Phiếu đang tạm hoãn: gửi yêu cầu sửa lại trước khi duyệt' : 'Phiếu không ở trạng thái chờ duyệt sửa');
  }
  if (await hasPendingFundProposal(id)) throw new ApiError('WORKORDER_FUND_PENDING');

  if (decision === REPAIR_DECISIONS.RETIRE) return retire(user, wo, note, now);
  if (decision === REPAIR_DECISIONS.POSTPONE) return postpone(user, wo, note, reviewDate, now);

  // APPROVE: kiểm chính sách nguồn chi ở server (client có khóa lựa chọn cũng không tin)
  const policy = await repairPolicy(wo, now);
  if (costSource === REPAIR_COST_SOURCES.WARRANTY && !policy.warrantyActive) {
    throw ApiError.field('costSource', 'Thiết bị đã hết bảo hành, không chọn nguồn Bảo hành được');
  }
  if (costSource === REPAIR_COST_SOURCES.OPERATING && policy.fundRequired) {
    throw new ApiError(
      'WORKORDER_FUND_REQUIRED',
      `Tổng chi phí ${money(policy.total)} (gồm ${money(policy.spentInWindow)} đã chi vận hành cho thiết bị trong ${policy.windowDays} ngày) `
        + `từ ngưỡng ${money(policy.threshold)} trở lên, bắt buộc dùng Quỹ bảo trì`,
      { details: [{ field: 'costSource', message: 'Bắt buộc dùng Quỹ bảo trì', total: policy.total, threshold: policy.threshold, spentInWindow: policy.spentInWindow }] },
    );
  }
  let warrantyNote = null;
  if (policy.warrantyActive && costSource !== REPAIR_COST_SOURCES.WARRANTY) {
    warrantyNote = warrantyOverrideReason?.trim() || '';
    if (warrantyNote.length < 5) {
      throw new ApiError('WORKORDER_WARRANTY_REASON_REQUIRED', `Thiết bị còn bảo hành đến ${fmtDateVn(policy.warrantyEnd)}. Ghi lý do không dùng bảo hành (tối thiểu 5 ký tự)`, {
        details: [{ field: 'warrantyOverrideReason', message: 'Ghi lý do không dùng bảo hành' }],
      });
    }
  }
  const extra = { warrantyNote, policy };
  if (costSource === REPAIR_COST_SOURCES.FUND) {
    if (emergency) {
      const reason = emergencyReason?.trim() || '';
      if (reason.length < 10) throw ApiError.field('emergencyReason', 'Ghi lý do khẩn cấp tối thiểu 10 ký tự');
      return approveEmergency(user, wo, note, reason, now, extra);
    }
    return approveFund(user, wo, note, now, extra);
  }
  return approveDirect(user, wo, note, now, costSource, extra);
}

const decided = (user, now, note, costSource, warrantyNote = null) => ({
  'repair.costSource': costSource,
  'repair.decidedBy': user.id,
  'repair.decidedAt': now,
  'repair.decisionNote': note,
  'repair.warrantyOverrideReason': warrantyNote,
});

/** Chi phí vận hành hoặc bảo hành: phiếu sang Đang sửa ngay */
async function approveDirect(user, wo, note, now, source, { warrantyNote, policy }) {
  const warranty = source === REPAIR_COST_SOURCES.WARRANTY;
  const historyNote = warrantyNote ? [note, `Không dùng bảo hành: ${warrantyNote}`].filter(Boolean).join('. ') : note;
  const res = await WorkOrder.updateOne(
    { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: { status: S.UNDER_REPAIR, ...decided(user, now, note, source, warrantyNote) },
      $push: { 'repair.history': step('APPROVED', user, now, { note: historyNote, cost: warranty ? 0 : wo.repair?.estimatedCost ?? null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_APPROVED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status },
    after: { status: S.UNDER_REPAIR, costSource: source, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: {
      assetId: wo.assetId,
      ...(!warranty && { spentInWindow: policy.spentInWindow, threshold: policy.threshold }),
      ...(warrantyNote && { warrantyOverrideReason: warrantyNote }),
    },
  });
  const label = await assetLabel(wo.assetId);
  await notifyTech(wo, 'Sửa chữa đã được duyệt', warranty
    ? `Sửa chữa ${label} đã được duyệt theo bảo hành. Liên hệ hãng bảo hành để sửa; sửa xong tải biên bản nghiệm thu lên phiếu.`
    : `Sửa chữa ${label} đã được duyệt (chi phí vận hành). Khi sửa xong, tải biên bản nghiệm thu lên phiếu.`); // MSG-E07
  return WorkOrder.findById(wo._id).lean();
}

/**
 * UC10 bước 5: giữ Chờ duyệt sửa, ghi nguồn Quỹ. Trưởng BQL lập đề xuất chi ngay sau đó (UC33, form điền sẵn từ báo cáo
 * hư hỏng) → trả nextStep để client mở form. Ban quản trị được báo khi đề xuất được lập.
 */
async function approveFund(user, wo, note, now, { warrantyNote }) {
  const res = await WorkOrder.updateOne(
    { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: decided(user, now, note, REPAIR_COST_SOURCES.FUND, warrantyNote),
      $push: { 'repair.history': step('FUND_REQUESTED', user, now, { note, cost: wo.repair?.estimatedCost ?? null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_FUND_REQUESTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { costSource: wo.repair?.costSource ?? null },
    after: { costSource: REPAIR_COST_SOURCES.FUND, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId, financial: true, ...(warrantyNote && { warrantyOverrideReason: warrantyNote }) },
  });
  await notifyTech(wo, 'Sửa chữa chờ duyệt chi quỹ',
    `Sửa chữa ${await assetLabel(wo.assetId)} được duyệt bằng Quỹ bảo trì, đang chờ lập đề xuất, Trưởng ban quản trị chọn nhà thầu và Ban quản trị biểu quyết. Chưa sửa.`); // MSG-E07
  return { ...(await WorkOrder.findById(wo._id).lean()), nextStep: 'CREATE_PROPOSAL' };
}

/**
 * BR-E11: sự cố khẩn cấp (vd thang máy kẹt người) — sửa trước bằng Quỹ, phiếu sang Đang sửa ngay. Báo KTV tiến hành,
 * báo Ban quản trị ngay; Trưởng BQL lập đề xuất (Đột xuất, kèm lý do) trong EMERGENCY_DOSSIER_DAYS ngày, quá hạn job nhắc.
 */
async function approveEmergency(user, wo, note, reason, now, { warrantyNote }) {
  const { emergencyDossierDays } = await repairSettings();
  const res = await WorkOrder.updateOne(
    { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: {
        status: S.UNDER_REPAIR,
        ...decided(user, now, note, REPAIR_COST_SOURCES.FUND, warrantyNote),
        'repair.isEmergency': true,
        'repair.emergencyReason': reason,
        'repair.emergencyAt': now,
        'repair.dossierRemindedAt': null,
      },
      $push: { 'repair.history': step('EMERGENCY_STARTED', user, now, { note: reason, cost: wo.repair?.estimatedCost ?? null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_EMERGENCY_STARTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status },
    after: { status: S.UNDER_REPAIR, costSource: REPAIR_COST_SOURCES.FUND, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId, reason, financial: true },
  });
  const label = await assetLabel(wo.assetId);
  await notifyTech(wo, 'Sửa chữa khẩn cấp: tiến hành ngay',
    `Trưởng BQL duyệt sửa khẩn cấp ${label}: ${reason}. Trưởng ban quản trị chọn nhà thầu; phối hợp sửa ngay, sửa xong tải biên bản nghiệm thu lên phiếu.`); // MSG-E07
  await safely(async () => {
    const members = await User.find({ role: ROLES.BOARD, isActive: true }).select('_id').lean();
    if (!members.length) return;
    await notify(members.map((m) => m._id), {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Sửa chữa khẩn cấp bằng Quỹ: ${label}`,
      content: `Trưởng BQL cho sửa ngay ${label} (dự kiến ${money(wo.repair?.estimatedCost)}) vì: ${reason}. `
        + `Đề xuất chi quỹ sẽ được lập trong ${emergencyDossierDays} ngày: Trưởng ban quản trị chọn nhà thầu, Ban quản trị biểu quyết.`,
      refId: wo._id,
      link: '/app/fund',
      email: true,
    });
  });
  return { ...(await WorkOrder.findById(wo._id).lean()), nextStep: 'CREATE_PROPOSAL' };
}

/**
 * Q5: Tạm hoãn. Bắt buộc lý do; ngày xem lại sau hôm nay, tối đa REPAIR_POSTPONE_MAX_DAYS. Trong 1 transaction:
 * phiếu → Tạm hoãn sửa; lịch kiểm tra của thiết bị tính lại từ lúc kiểm tra (nếu không job tạo phiếu ngay hôm sau).
 */
async function postpone(user, wo, note, reviewDate, now) {
  if (!note || note.length < 5) throw ApiError.field('comment', 'Nhập lý do tạm hoãn tối thiểu 5 ký tự'); // MSG-G01
  if (!reviewDate) throw ApiError.field('reviewDate', 'Chọn ngày xem lại');
  const { postponeMaxDays } = await repairSettings();
  const today = startOfVnDay(now);
  const day = startOfVnDay(reviewDate);
  if (day <= today) throw ApiError.field('reviewDate', 'Ngày xem lại phải sau hôm nay');
  if (day.getTime() > today.getTime() + postponeMaxDays * DAY_MS) {
    throw ApiError.field('reviewDate', `Ngày xem lại tối đa ${postponeMaxDays} ngày kể từ hôm nay`);
  }

  const nextDate = await withTransaction(async (session) => {
    const done = await WorkOrder.findOneAndUpdate(
      { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
      {
        $set: {
          status: S.REPAIR_POSTPONED,
          ...decided(user, now, note, null),
          'repair.reviewDate': day,
          'repair.postponedAt': now,
          'repair.lastRemindedAt': null,
          'repair.remindCount': 0,
        },
        $push: { 'repair.history': step('POSTPONED', user, now, { note, reviewDate: day }) },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!done) throw new ApiError('CONCURRENT_UPDATE');
    if (done.type !== WORK_ORDER_TYPES.SCHEDULED) return null;
    const asset = await Asset.findById(done.assetId).session(session);
    if (!asset) return null;
    const last = startOfVnDay(done.inspectedAt ?? now);
    const next = computeNextMaintenance(last, { cycleValue: asset.cycleValue, cycleUnit: asset.cycleUnit });
    if (!asset.lastMaintenanceDate || asset.lastMaintenanceDate < last) asset.lastMaintenanceDate = last;
    if (!asset.nextMaintenanceDate || asset.nextMaintenanceDate < next) asset.nextMaintenanceDate = next;
    await asset.save({ session });
    return asset.nextMaintenanceDate;
  });

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_POSTPONED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.REPAIR_POSTPONED, reviewDate: day.toISOString() },
    metadata: { assetId: wo.assetId, reason: note, ...(nextDate && { nextMaintenanceDate: nextDate.toISOString() }) },
  });
  await notifyTech(wo, 'Sửa chữa tạm hoãn',
    `Sửa chữa ${await assetLabel(wo.assetId)} đã được tạm hoãn đến ${fmtDateVn(day)}: ${note}. Thiết bị vẫn kiểm tra định kỳ; thấy lỗi nặng hơn thì gửi yêu cầu sửa lại.`); // MSG-E07
  return WorkOrder.findById(wo._id).lean();
}

/** Không sửa: phiếu → Đã đóng; thiết bị ngừng theo dõi; phiếu kiểm tra đang mở của thiết bị cũng đóng */
async function retire(user, wo, note, now) {
  if (!note || note.length < 5) throw ApiError.field('comment', 'Nhập lý do ngừng sử dụng tối thiểu 5 ký tự');
  const closedOthers = await withTransaction(async (session) => {
    const done = await WorkOrder.findOneAndUpdate(
      { _id: wo._id, status: wo.status },
      {
        $set: { status: S.CLOSED, completedAt: now, ...decided(user, now, note, null), 'repair.reviewDate': null },
        $push: { 'repair.history': step('RETIRED', user, now, { note }) },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!done) throw new ApiError('CONCURRENT_UPDATE');
    const others = await WorkOrder.updateMany(
      { assetId: wo.assetId, _id: { $ne: wo._id }, status: { $in: [...WORK_ORDER_INSPECTING_STATUSES] } },
      { $set: { status: S.CLOSED, completedAt: now, note: 'Đóng do thiết bị ngừng sử dụng' } },
      { session },
    );
    await Asset.updateOne({ _id: wo.assetId }, { $set: { isActive: false } }, { session });
    return others.modifiedCount;
  });

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_RETIRED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status }, after: { status: S.CLOSED }, metadata: { assetId: wo.assetId, reason: note, closedOthers },
  });
  await syncTicketOnEnd({ ticketId: wo.ticketId, status: S.CLOSED }, now);
  await logAudit({
    action: AUDIT_ACTIONS.ASSET_DEACTIVATED, user, targetType: AUDIT_TARGETS.ASSET, targetId: wo.assetId,
    before: { isActive: true }, after: { isActive: false }, metadata: { reason: note, workOrderId: wo._id },
  });
  await notifyTech(wo, 'Thiết bị ngừng sử dụng',
    `Trưởng BQL quyết định không sửa ${await assetLabel(wo.assetId)} và ngừng sử dụng thiết bị: ${note}.`); // MSG-E07
  return WorkOrder.findById(wo._id).lean();
}

// ===== UC10: gửi yêu cầu sửa lại phiếu đang hoãn (KTV hoặc Trưởng BQL) =====
/**
 * Tạm hoãn sửa → Chờ duyệt sửa. Bắt buộc ghi chú; được cập nhật chi phí dự kiến và ảnh mới (báo giá cũ có thể không còn đúng).
 * Xóa ngày xem lại, dấu nhắc, nguồn chi. KTV gửi thì phiếu giao cho KTV đó (người đang theo thiết bị). Báo Trưởng BQL (MSG-E06).
 */
export async function requestRepair(user, id, { note, estimatedCost }, files = [], now = new Date()) {
  const wo = await load(id);
  if (wo.status !== S.REPAIR_POSTPONED) throw new ApiError('WORKORDER_NOT_POSTPONED');
  const images = files.length ? await uploadToCloudinary(files, 'work-orders') : [];
  const tech = isRole(user, 'STAFF:TECHNICIAN');
  const set = {
    status: S.AWAITING_REPAIR_APPROVAL,
    'repair.reviewDate': null,
    'repair.lastRemindedAt': null,
    'repair.remindCount': 0,
    'repair.costSource': null,
    ...(estimatedCost && { 'repair.estimatedCost': estimatedCost }),
    ...(images.length && { 'repair.faultImages': images }), // ảnh cũ vẫn ở dòng REPORTED của repair.history
    ...(tech && { assignedTo: user.id }),
  };
  const res = await WorkOrder.updateOne(
    { _id: id, status: S.REPAIR_POSTPONED },
    { $set: set, $push: { 'repair.history': step('REQUESTED', user, now, { note, cost: estimatedCost ?? null, images }) } },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_REQUESTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status, estimatedCost: wo.repair?.estimatedCost ?? null },
    after: { status: S.AWAITING_REPAIR_APPROVAL, estimatedCost: estimatedCost ?? wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId, note },
  });
  await safely(async () => notifyRoles(['MANAGER'], {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Yêu cầu sửa lại thiết bị đang hoãn',
    content: `Có yêu cầu sửa ${await assetLabel(wo.assetId)} (đang tạm hoãn): ${note}. Vui lòng xem lại đề xuất sửa chữa.`, // MSG-E06
    refId: wo._id,
    link: '/app/repair-approvals',
  }));
  return WorkOrder.findById(id).lean();
}

// ===== UC10 bước 1: danh sách duyệt sửa chữa lớn =====
const TABS = {
  pending: { filter: { status: S.AWAITING_REPAIR_APPROVAL }, sort: 'repair.reportedAt' },
  postponed: { filter: { status: S.REPAIR_POSTPONED }, sort: 'repair.reviewDate' },
  decided: {
    filter: { status: { $in: [S.UNDER_REPAIR, S.AWAITING_ACCEPTANCE, S.AWAITING_BOARD_ACCEPTANCE, S.DONE, S.CLOSED] }, 'repair.decidedAt': { $ne: null } },
    sort: '-repair.decidedAt',
  },
};
const LIST_POPULATE = [
  { path: 'assetId', select: 'code name category location buildingId', populate: { path: 'buildingId', select: 'name' } },
  { path: 'assignedTo', select: 'fullName' },
  { path: 'repair.reportedBy', select: 'fullName' },
  { path: 'repair.decidedBy', select: 'fullName' },
];

/** Phiếu theo tab + số đếm từng tab + số phiếu hoãn đã tới ngày xem lại + tham số (để form giới hạn ngày) */
export async function listRepairs({ tab = 'pending', ...query }, now = new Date()) {
  const { filter, sort } = TABS[tab] ?? TABS.pending;
  const endToday = endOfVnDay(now);
  const result = await paginate(WorkOrder, filter, { ...query, sort }, { populate: LIST_POPULATE });
  const settings = await repairSettings();
  const [pendingFunds, policies] = await Promise.all([
    pendingFundProposals(result.items),
    // Phiếu chờ quyết định: kèm chính sách nguồn chi để form khóa lựa chọn (BR-E08, BR-E10)
    Promise.all(result.items.map((wo) => (wo.status === S.AWAITING_REPAIR_APPROVAL && wo.repair ? repairPolicy(wo, now, settings) : null))),
  ]);
  result.items = result.items.map((wo, i) => {
    const review = wo.repair?.reviewDate ? new Date(wo.repair.reviewDate) : null;
    const due = wo.status === S.REPAIR_POSTPONED && review && review <= endToday;
    return {
      ...wo,
      isReviewDue: Boolean(due),
      reviewOverdueDays: due ? Math.floor((startOfVnDay(now) - startOfVnDay(review)) / DAY_MS) : 0,
      // Đề xuất chi quỹ đang xử lý → không quyết định lại được (WORKORDER_FUND_PENDING); status cho biết chờ ai
      pendingFund: pendingFunds.get(String(wo._id)) ?? null,
      policy: policies[i],
    };
  });
  const [pending, postponed, reviewDue, awaitingFund] = await Promise.all([
    WorkOrder.countDocuments(TABS.pending.filter),
    WorkOrder.countDocuments(TABS.postponed.filter),
    WorkOrder.countDocuments({ status: S.REPAIR_POSTPONED, 'repair.reviewDate': { $lte: endToday } }),
    countAwaitingFund(TABS.pending.filter),
  ]);
  // awaitingFund: phiếu chờ quyết định đã có đề xuất đang chờ Ban quản trị biểu quyết (Trưởng BQL chưa làm gì được)
  // — số việc trên menu = pending − awaitingFund + reviewDue
  return { ...result, counts: { pending, postponed, reviewDue, awaitingFund }, settings };
}

// ===== Job REPAIR_REVIEW: nhắc Trưởng BQL xem lại phiếu tạm hoãn (MSG-E12) =====
/**
 * [Cron 07:05] Phiếu Tạm hoãn sửa có ngày xem lại ≤ hôm nay và chưa nhắc / lần nhắc trước đã cách ≥ N ngày
 * (REPAIR_REVIEW_REPEAT_DAYS) → nhắc, ghi lastRemindedAt, tăng remindCount. KHÔNG đổi trạng thái phiếu.
 * Ghi có điều kiện nên 2 lần chạy chồng nhau không nhắc trùng; lỡ 1 ngày thì lần sau nhắc bù.
 * @returns {Promise<number>} số phiếu đã nhắc
 */
export async function remindPostponedRepairs(now = new Date()) {
  const { reviewRepeatDays } = await repairSettings();
  const today = startOfVnDay(now);
  // Nhắc lúc 07:05 ngày D → lần sau ngày D + N: lastRemindedAt < đầu ngày (hôm nay − N + 1)
  const cutoff = new Date(today.getTime() - (reviewRepeatDays - 1) * DAY_MS);
  const due = {
    status: S.REPAIR_POSTPONED,
    'repair.reviewDate': { $lte: endOfVnDay(now) },
    $or: [{ 'repair.lastRemindedAt': null }, { 'repair.lastRemindedAt': { $lt: cutoff } }],
  };
  const candidates = await WorkOrder.find(due).select('_id').lean();
  let count = 0;
  for (const { _id } of candidates) {
    try {
      const wo = await WorkOrder.findOneAndUpdate(
        { _id, ...due },
        { $set: { 'repair.lastRemindedAt': now }, $inc: { 'repair.remindCount': 1 } },
        { returnDocument: 'after' },
      ).lean();
      if (!wo) continue;
      count += 1;
      const late = Math.floor((today - startOfVnDay(wo.repair.reviewDate)) / DAY_MS);
      await notifyRoles(['MANAGER'], {
        type: NOTIFICATION_TYPES.MAINTENANCE,
        title: 'Đến hạn xem lại sửa chữa tạm hoãn',
        content: `Sửa chữa ${await assetLabel(wo.assetId)} tạm hoãn đã đến ngày xem lại${late > 0 ? ` (quá ${late} ngày, nhắc lần ${wo.repair.remindCount})` : ''}. Gửi yêu cầu sửa lại, hoãn tiếp hoặc ngừng sử dụng thiết bị.`, // MSG-E12
        refId: wo._id,
        link: '/app/repair-approvals',
      });
    } catch (err) {
      console.error(`[UC10] Lỗi nhắc phiếu tạm hoãn ${_id}:`, err);
    }
  }
  return count;
}
