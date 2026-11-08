// UC08 – Kiểm tra thiết bị định kỳ (BR-E04, BR-E05): checklist ca → quét QR thiết bị → nhập checklist, ảnh → Đạt / Có sự cố
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, ROLE_TITLES, WORK_ORDER_INSPECTING_STATUSES, WORK_ORDER_OPEN_STATUSES, WORK_ORDER_REPAIR_STATUSES,
  WORK_ORDER_RESULTS, WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { Asset, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notifyRoles } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { computeNextMaintenance } from '../assets/assets.service.js';
import { getOnDuty, isUserOnDuty } from '../dutyShifts/dutyShifts.service.js';

const { PENDING, IN_PROGRESS, DONE } = WORK_ORDER_STATUS;
const isMeasured = (item) => Boolean(item.unit) || item.minValue != null || item.maxValue != null;

/**
 * Chấm checklist (thuần, để test). inputs[i] = { value } cho mục đo, { ok } cho mục tick, cùng thứ tự với checklist.
 * Mục đo: isOk = nằm trong [minValue, maxValue]. Mục tick: isOk = ok. Mục không bắt buộc bỏ trống → isOk = null.
 * @returns {{ results, missing: number[], failing: number[] }} missing / failing là vị trí mục
 */
export function evaluateChecklist(checklist = [], inputs = []) {
  const results = [];
  const missing = [];
  const failing = [];
  checklist.forEach((item, index) => {
    const input = inputs[index] ?? {};
    let value = null;
    let ok = null;
    let isOk = null;
    if (isMeasured(item)) {
      const n = input.value === '' || input.value == null ? null : Number(input.value);
      if (n != null && Number.isFinite(n)) {
        value = n;
        isOk = (item.minValue == null || n >= item.minValue) && (item.maxValue == null || n <= item.maxValue);
      }
    } else if (typeof input.ok === 'boolean') {
      ok = input.ok;
      isOk = input.ok;
    }
    if (isOk == null && item.required !== false) missing.push(index);
    if (isOk === false) failing.push(index);
    results.push({ index, label: item.label, value, ok, isOk });
  });
  return { results, missing, failing };
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** KTV có được nhận phiếu chưa ai nhận lúc này: đang trong ca kỹ thuật, hoặc lúc đó không có lịch trực nào */
async function dutyOf(userId, now) {
  const [{ hasSchedule }, onDuty] = await Promise.all([
    getOnDuty(ROLE_TITLES.TECHNICIAN, now),
    isUserOnDuty(userId, ROLE_TITLES.TECHNICIAN, now),
  ]);
  return { hasSchedule, onDuty, canClaim: onDuty || !hasSchedule };
}

// ===== UC08 bước 1: Checklist ca =====
/**
 * Phiếu định kỳ chưa ai nhận (đến hạn) + phiếu chưa xong của chính KTV (kiểm tra, sửa chữa). Kèm tình trạng ca trực.
 * DutyShift là ca theo người, không có "ca của ngày" để gắn phiếu, nên phiếu chưa nhận hiện cho mọi KTV.
 */
export async function shiftChecklist(user, now = new Date()) {
  const duty = await dutyOf(user.id, now);
  const items = await WorkOrder.find({
    type: WORK_ORDER_TYPES.SCHEDULED,
    $or: [
      { status: PENDING, assignedTo: null },
      { status: { $in: [...WORK_ORDER_OPEN_STATUSES] }, assignedTo: user.id }, // cả phiếu đang sửa chữa của mình (UC09)
    ],
  })
    .select('assetId title status scheduledDate assignedTo startedAt scannedAt result checklist note repair')
    .populate({ path: 'assetId', select: 'code name category location buildingId', populate: { path: 'buildingId', select: 'name' } })
    .sort({ scheduledDate: 1, _id: 1 })
    .lean();
  const today = startOfVnDay(now).getTime();
  return {
    ...duty,
    items: items.map((wo) => ({
      ...wo,
      mine: sameId(wo.assignedTo, user.id),
      isOverdue: Boolean(wo.scheduledDate) && new Date(wo.scheduledDate).getTime() < today,
      checklistCount: wo.checklist?.length ?? 0,
      checklist: undefined,
    })),
  };
}

// ===== UC08 bước 2–4: quét QR thiết bị → nhận phiếu, chuyển "Đang kiểm tra" =====
/**
 * Sai thiết bị → MSG-E03, phiếu không đổi. Đúng → IN_PROGRESS, gán KTV. Ghi có điều kiện (status = PENDING,
 * chưa ai nhận hoặc đã giao cho chính người này) nên 2 KTV quét cùng lúc chỉ 1 người nhận được.
 * Phiếu đang kiểm tra của chính mình: quét lại để mở tiếp checklist.
 */
export async function scanWorkOrder(user, id, qrCode, now = new Date()) {
  const wo = await WorkOrder.findById(id).select('assetId status assignedTo').lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (!WORK_ORDER_INSPECTING_STATUSES.includes(wo.status)) {
    throw new ApiError('WORKORDER_INVALID_STATUS', wo.status === DONE ? 'Phiếu bảo trì đã hoàn thành' : 'Phiếu không còn ở bước kiểm tra');
  }
  if (wo.assignedTo && !sameId(wo.assignedTo, user.id)) throw new ApiError('WORKORDER_TAKEN');
  // Phiếu chưa ai nhận: phải đang trong ca (Trưởng BQL giao đích danh thì không cần)
  if (!wo.assignedTo && !(await dutyOf(user.id, now)).canClaim) throw new ApiError('WORKORDER_NOT_ON_DUTY');

  const asset = await Asset.findById(wo.assetId).select('qrCode').lean();
  if (!asset?.qrCode || String(qrCode ?? '').trim().toUpperCase() !== asset.qrCode.toUpperCase()) throw new ApiError('WORKORDER_WRONG_ASSET'); // MSG-E03

  if (wo.status === IN_PROGRESS) {
    await WorkOrder.updateOne({ _id: id, assignedTo: user.id, status: IN_PROGRESS, scannedAt: null }, { $set: { scannedAt: now } });
    return getInspection(user, id);
  }
  const res = await WorkOrder.updateOne(
    { _id: id, status: PENDING, assignedTo: { $in: [null, user.id] } },
    { $set: { status: IN_PROGRESS, assignedTo: user.id, startedAt: now, scannedAt: now } },
  );
  if (!res.modifiedCount) throw new ApiError('WORKORDER_TAKEN');
  await WorkOrder.updateOne({ _id: id, assignedAt: null }, { $set: { assignedAt: now } });
  return getInspection(user, id);
}

/**
 * UC10 lớp 3: thiết bị đang có lỗi đã biết (phiếu sửa chữa khác đang tạm hoãn / chờ duyệt / đang sửa).
 * Kiểm tra định kỳ trên thiết bị đó không tạo báo cáo hư hỏng thứ 2, mà ghi vào lịch sử phiếu kia.
 */
export async function findKnownFault(assetId, excludeId, session = null) {
  return WorkOrder.findOne({
    assetId,
    _id: { $ne: excludeId },
    status: { $in: [WORK_ORDER_STATUS.REPAIR_POSTPONED, ...WORK_ORDER_REPAIR_STATUSES] },
  })
    .select('status repair.faultDesc repair.reviewDate repair.estimatedCost repair.reportedAt')
    .session(session)
    .lean();
}

/** Phiếu để làm checklist: kèm bản sao checklist, thiết bị (không trả mã QR cho client) và lỗi đã biết của thiết bị */
export async function getInspection(user, id) {
  const wo = await WorkOrder.findById(id)
    .populate({ path: 'assetId', select: 'code name category location buildingId', populate: { path: 'buildingId', select: 'name' } })
    .populate('assignedTo', 'fullName')
    .lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (!sameId(wo.assignedTo?._id, user.id) && !(wo.status === PENDING && !wo.assignedTo)) throw ApiError.forbidden();
  const known = wo.assetId?._id ? await findKnownFault(wo.assetId._id, wo._id) : null;
  return { ...wo, knownFault: known ? { _id: known._id, status: known.status, ...known.repair } : null };
}

// ===== UC08 bước 5–7: nộp kết quả =====
const missingError = (checklist, missing, noImages) => {
  const details = missing.map((i) => ({ field: `results.${i}`, message: `Chưa nhập "${checklist[i].label}"` }));
  if (noImages) details.push({ field: 'images', message: 'Cần ít nhất 1 ảnh' });
  return ApiError.badRequest('Còn mục bắt buộc hoặc ảnh chưa nhập', details); // MSG-G01 (6b)
};

/**
 * PASSED: hoàn thành, dời lịch bảo trì của thiết bị (chỉ phiếu định kỳ) trong 1 transaction; báo Trưởng BQL (MSG-E04).
 * FAULTY: lưu kết quả, ảnh, mô tả sự cố; phiếu vẫn "Đang kiểm tra", không dời lịch, chờ báo cáo hư hỏng (UC09).
 * UC10 lớp 3 – thiết bị đã có lỗi đã biết (findKnownFault): FAULTY cũng hoàn thành và dời lịch như PASSED (không báo hư hỏng
 * lần 2); cả 2 kết quả thêm dòng FOLLOWUP_CHECK vào lịch sử phiếu kia trong cùng transaction và báo Trưởng BQL.
 * Có mục bắt buộc không đạt thì không được chọn PASSED.
 */
export async function submitInspection(user, id, { result, note = '', results: inputs = [] }, files = [], now = new Date()) {
  const wo = await WorkOrder.findById(id).select('assetId type title status assignedTo scannedAt result checklist').lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (!sameId(wo.assignedTo, user.id)) throw ApiError.forbidden();
  if (wo.status !== IN_PROGRESS) throw new ApiError('WORKORDER_INVALID_STATUS', wo.status === DONE ? 'Phiếu bảo trì đã hoàn thành' : 'Cần quét mã QR để nhận phiếu trước');
  if (!wo.scannedAt) throw new ApiError('WORKORDER_NOT_SCANNED');
  if (wo.result === WORK_ORDER_RESULTS.FAULTY) {
    throw new ApiError('WORKORDER_INVALID_STATUS', 'Đã nộp kết quả Có sự cố, phiếu đang chờ báo cáo hư hỏng');
  }

  const checklist = wo.checklist ?? [];
  const { results, missing, failing } = evaluateChecklist(checklist, inputs);
  if (missing.length || !files.length) throw missingError(checklist, missing, !files.length);
  if (result === WORK_ORDER_RESULTS.PASSED && failing.some((i) => checklist[i].required !== false)) {
    throw new ApiError('WORKORDER_RESULT_CONFLICT', undefined, {
      details: failing.map((i) => ({ field: `results.${i}`, message: `"${checklist[i].label}" không đạt` })),
    });
  }
  if (result === WORK_ORDER_RESULTS.FAULTY && note.trim().length < 5) {
    throw ApiError.field('note', 'Mô tả sự cố tối thiểu 5 ký tự');
  }

  // Upload ngoài transaction (dịch vụ ngoài). Ghi DB không thành thì ảnh bị bỏ rơi trên Cloudinary, không ảnh hưởng dữ liệu
  const completionImages = await uploadToCloudinary(files, 'work-orders');
  const base = { result, results, inspectedAt: now, note: note.trim(), completionImages };
  const condition = { _id: id, status: IN_PROGRESS, assignedTo: user.id, result: null };
  let nextDate = null;
  const known = await findKnownFault(wo.assetId, wo._id);
  const faulty = result === WORK_ORDER_RESULTS.FAULTY;

  if (!faulty || known) {
    nextDate = await withTransaction(async (session) => {
      const done = await WorkOrder.findOneAndUpdate(condition, { $set: { ...base, status: DONE, completedAt: now } }, { returnDocument: 'after', session }).lean();
      if (!done) throw new ApiError('CONCURRENT_UPDATE');
      if (known) {
        const check = {
          action: 'FOLLOWUP_CHECK',
          by: user.id,
          at: now,
          note: faulty ? `Kiểm tra định kỳ: lỗi vẫn còn. ${note.trim()}` : `Kiểm tra định kỳ: Đạt.${note.trim() ? ` ${note.trim()}` : ''}`,
          images: completionImages,
          refId: done._id,
        };
        await WorkOrder.updateOne({ _id: known._id }, { $push: { 'repair.history': check } }, { session });
      }
      if (done.type !== WORK_ORDER_TYPES.SCHEDULED) return null; // chỉ phiếu định kỳ mới dời lịch bảo trì
      const asset = await Asset.findById(done.assetId).session(session);
      if (!asset) return null;
      asset.lastMaintenanceDate = startOfVnDay(now);
      asset.nextMaintenanceDate = computeNextMaintenance(asset.lastMaintenanceDate, { cycleValue: asset.cycleValue, cycleUnit: asset.cycleUnit });
      await asset.save({ session });
      return asset.nextMaintenanceDate;
    });
  } else {
    const res = await WorkOrder.updateOne(condition, { $set: base });
    if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  }

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_INSPECTED,
    user,
    targetType: AUDIT_TARGETS.WORK_ORDER,
    targetId: wo._id,
    after: { result, failing: failing.length, ...(nextDate && { nextMaintenanceDate: nextDate.toISOString() }) },
    metadata: { assetId: wo.assetId, ...(known && { knownFaultOrderId: known._id }) },
  });

  // Thông báo gửi sau khi đã lưu; lỗi gửi không làm hỏng kết quả
  try {
    const [tech, asset] = await Promise.all([
      User.findById(user.id).select('fullName').lean(),
      Asset.findById(wo.assetId).select('code name').lean(),
    ]);
    const who = tech?.fullName ?? 'Kỹ thuật viên';
    const what = asset ? `${asset.code} – ${asset.name}` : wo.title;
    const knownText = known?.status === WORK_ORDER_STATUS.REPAIR_POSTPONED
      ? ` Thiết bị đang tạm hoãn sửa${known.repair?.reviewDate ? ` đến ${fmtDateVn(known.repair.reviewDate)}` : ''}.`
      : ' Thiết bị đang có phiếu sửa chữa.';
    await notifyRoles(['MANAGER'], known
      ? {
          type: NOTIFICATION_TYPES.MAINTENANCE,
          title: faulty ? 'Kiểm tra lại: lỗi vẫn còn' : 'Kiểm tra lại: thiết bị đạt',
          content: `${who} kiểm tra định kỳ ${what}: ${faulty ? `lỗi vẫn còn (${note.trim()})` : 'Đạt'}.${knownText}`,
          refId: known._id,
          link: '/app/repair-approvals',
        }
      : result === WORK_ORDER_RESULTS.PASSED
      ? {
          type: NOTIFICATION_TYPES.MAINTENANCE,
          title: 'Kiểm tra định kỳ đạt',
          content: `${who} đã kiểm tra ${what}: Đạt.${nextDate ? ` Lần bảo trì tiếp theo: ${fmtDateVn(nextDate)}.` : ''}`,
          refId: wo._id,
          link: '/app/work-orders',
        }
      : {
          type: NOTIFICATION_TYPES.MAINTENANCE,
          title: 'Phát hiện sự cố khi kiểm tra thiết bị',
          content: `${who} phát hiện sự cố ở ${what}: ${note.trim()}. Phiếu chờ báo cáo hư hỏng.`,
          refId: wo._id,
          link: '/app/work-orders',
        });
  } catch (err) {
    console.error('[UC08] Lỗi gửi thông báo cho Trưởng BQL:', err);
  }
  return getInspection(user, id);
}
