// UC10 – Duyệt sửa chữa lớn: Trưởng BQL quyết định với báo cáo hư hỏng (BR-E06, Q5).
//
//   Chờ duyệt sửa ─ Duyệt, chi phí vận hành ─► Đang sửa (MSG-E07)
//                ├ Duyệt, Quỹ bảo trì ──────► giữ Chờ duyệt sửa, chờ đề xuất chi quỹ (workOrders.fund.js)
//                ├ Tạm hoãn ────────────────► Tạm hoãn sửa (lý do + ngày xem lại ≤ N ngày; dời lịch kiểm tra)
//                └ Ngừng sử dụng ───────────► Đã đóng, thiết bị ngừng theo dõi
//   Tạm hoãn sửa ─ Gửi yêu cầu sửa lại (KTV / Trưởng BQL) ─► Chờ duyệt sửa
//                └ Ngừng sử dụng ─► Đã đóng
// Phiếu hoãn được nhắc từ ngày xem lại, lặp mỗi N ngày (remindPostponedRepairs). Mọi bước ghi có điều kiện trạng thái cũ.
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_KEYS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, REPAIR_DECISIONS, WORK_ORDER_INSPECTING_STATUSES,
  WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { Asset, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfigs } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { DAY_MS, endOfVnDay, fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { computeNextMaintenance } from '../assets/assets.service.js';
import { countAwaitingVote, hasPendingFundProposal, pendingFundProposals } from './workOrders.fund.js';

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

/** Tham số UC10 (đọc từ system_configs, thiếu thì mặc định 7 / 90) */
export async function repairSettings() {
  const c = await getConfigs([CONFIG_KEYS.REPAIR_REVIEW_REPEAT_DAYS, CONFIG_KEYS.REPAIR_POSTPONE_MAX_DAYS]);
  return {
    reviewRepeatDays: Number(c[CONFIG_KEYS.REPAIR_REVIEW_REPEAT_DAYS]) || 7,
    postponeMaxDays: Number(c[CONFIG_KEYS.REPAIR_POSTPONE_MAX_DAYS]) || 90,
  };
}

/** Báo KTV kết quả quyết định (MSG-E07). Phiếu chưa có KTV thì bỏ qua */
const notifyTech = (wo, title, content) => safely(async () => {
  if (!wo.assignedTo) return;
  await notify(wo.assignedTo, { type: NOTIFICATION_TYPES.MAINTENANCE, title, content, refId: wo._id, link: '/app/my-work-orders' });
});

// ===== UC10 bước 3–5, 3a: quyết định =====
/**
 * @param {{ decision: 'APPROVE'|'POSTPONE'|'RETIRE', costSource?: 'OPERATING'|'FUND', comment?: string, reviewDate?: Date }} body
 * Còn đề xuất chi quỹ đang chờ Ban quản trị thì không quyết định lại được (WORKORDER_FUND_PENDING).
 */
export async function decideRepair(user, id, { decision, costSource, comment = '', reviewDate }, now = new Date()) {
  const wo = await load(id);
  const note = comment?.trim() || null;
  const allowed = decision === REPAIR_DECISIONS.RETIRE ? [S.AWAITING_REPAIR_APPROVAL, S.REPAIR_POSTPONED] : [S.AWAITING_REPAIR_APPROVAL];
  if (!allowed.includes(wo.status)) {
    throw invalid(wo.status === S.REPAIR_POSTPONED ? 'Phiếu đang tạm hoãn: gửi yêu cầu sửa lại trước khi duyệt' : 'Phiếu không ở trạng thái chờ duyệt sửa');
  }
  if (await hasPendingFundProposal(id)) throw new ApiError('WORKORDER_FUND_PENDING');

  if (decision === REPAIR_DECISIONS.RETIRE) return retire(user, wo, note, now);
  if (decision === REPAIR_DECISIONS.POSTPONE) return postpone(user, wo, note, reviewDate, now);
  if (costSource === REPAIR_COST_SOURCES.FUND) return approveFund(user, wo, note, now);
  return approveOperating(user, wo, note, now);
}

const decided = (user, now, note, costSource) => ({
  'repair.costSource': costSource,
  'repair.decidedBy': user.id,
  'repair.decidedAt': now,
  'repair.decisionNote': note,
});

async function approveOperating(user, wo, note, now) {
  const res = await WorkOrder.updateOne(
    { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: { status: S.UNDER_REPAIR, ...decided(user, now, note, REPAIR_COST_SOURCES.OPERATING) },
      $push: { 'repair.history': step('APPROVED', user, now, { note, cost: wo.repair?.estimatedCost ?? null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_REPAIR_APPROVED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { status: wo.status },
    after: { status: S.UNDER_REPAIR, costSource: REPAIR_COST_SOURCES.OPERATING, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId },
  });
  await notifyTech(wo, 'Sửa chữa đã được duyệt',
    `Sửa chữa ${await assetLabel(wo.assetId)} đã được duyệt (chi phí vận hành). Khi nhà thầu sửa xong, tải biên bản nghiệm thu lên phiếu.`); // MSG-E07
  return WorkOrder.findById(wo._id).lean();
}

/** UC10 bước 5: giữ Chờ duyệt sửa, ghi nguồn Quỹ, báo Kế toán lập đề xuất chi (UC33) */
async function approveFund(user, wo, note, now) {
  const res = await WorkOrder.updateOne(
    { _id: wo._id, status: S.AWAITING_REPAIR_APPROVAL },
    {
      $set: decided(user, now, note, REPAIR_COST_SOURCES.FUND),
      $push: { 'repair.history': step('FUND_REQUESTED', user, now, { note, cost: wo.repair?.estimatedCost ?? null }) },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_FUND_REQUESTED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    before: { costSource: wo.repair?.costSource ?? null },
    after: { costSource: REPAIR_COST_SOURCES.FUND, estimatedCost: wo.repair?.estimatedCost ?? null },
    metadata: { assetId: wo.assetId, financial: true },
  });
  const label = await assetLabel(wo.assetId);
  await safely(() => notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Cần lập đề xuất chi quỹ sửa chữa',
    content: `Trưởng BQL duyệt sửa ${label} bằng Quỹ bảo trì (dự kiến ${money(wo.repair?.estimatedCost)}). Vui lòng lập đề xuất chi quỹ gắn với phiếu bảo trì này.`,
    refId: wo._id,
    link: '/app/fund',
  }));
  await notifyTech(wo, 'Sửa chữa chờ duyệt chi quỹ',
    `Sửa chữa ${label} được duyệt bằng Quỹ bảo trì, đang chờ Ban quản trị duyệt đề xuất chi. Chưa liên hệ nhà thầu.`); // MSG-E07
  return WorkOrder.findById(wo._id).lean();
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
    filter: { status: { $in: [S.UNDER_REPAIR, S.AWAITING_ACCEPTANCE, S.DONE, S.CLOSED] }, 'repair.decidedAt': { $ne: null } },
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
  const pendingFunds = await pendingFundProposals(result.items);
  result.items = result.items.map((wo) => {
    const review = wo.repair?.reviewDate ? new Date(wo.repair.reviewDate) : null;
    const due = wo.status === S.REPAIR_POSTPONED && review && review <= endToday;
    return {
      ...wo,
      isReviewDue: Boolean(due),
      reviewOverdueDays: due ? Math.floor((startOfVnDay(now) - startOfVnDay(review)) / DAY_MS) : 0,
      // Đề xuất chi quỹ đang chờ Ban quản trị biểu quyết → không quyết định lại được (WORKORDER_FUND_PENDING)
      pendingFund: pendingFunds.get(String(wo._id)) ?? null,
    };
  });
  const [pending, postponed, reviewDue, awaitingVote, settings] = await Promise.all([
    WorkOrder.countDocuments(TABS.pending.filter),
    WorkOrder.countDocuments(TABS.postponed.filter),
    WorkOrder.countDocuments({ status: S.REPAIR_POSTPONED, 'repair.reviewDate': { $lte: endToday } }),
    countAwaitingVote(TABS.pending.filter),
    repairSettings(),
  ]);
  // awaitingVote: phiếu chờ quyết định nhưng đang chờ Ban quản trị biểu quyết (Trưởng BQL chưa làm gì được) —
  // số việc cần xử lý trên menu = pending − awaitingVote + reviewDue
  return { ...result, counts: { pending, postponed, reviewDue, awaitingVote }, settings };
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
