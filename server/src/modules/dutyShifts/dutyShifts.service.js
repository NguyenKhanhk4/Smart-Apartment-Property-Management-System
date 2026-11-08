// Lịch ca trực Kỹ thuật viên / Bảo vệ. Trưởng BQL xếp ca (1 ca nhiều người trực); nhân viên xem lịch.
// getOnDuty() dùng chung: hàng chờ sự cố (Người 4), checklist bảo trì theo ca (Người 1), tuần tra (Người 5).
import { AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, ROLES } from '../../constants/enums.js';
import { DutyShift, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { activeShifts, overlaps, repeatWindows, validateShiftWindow } from './shift.rules.js';
import { DAY_MS, fmtDateTimeVn, fmtDateVn, startOfVnDay } from '../../utils/time.js';

const USER_SELECT = 'fullName phone roleTitle avatarUrl';
const LINK = '/app/duty-shifts';

/** Nhân viên đang hoạt động có chức danh `roleTitle` — để chọn người khi xếp ca */
export function listDutyStaff(roleTitle) {
  return User.find({ role: ROLES.STAFF, roleTitle, isActive: true }).select(USER_SELECT).sort({ fullName: 1 }).lean();
}

/** Ca giao với khoảng [from, to); mặc định 7 ngày kể từ hôm nay */
export function listShifts({ from, to, roleTitle, userId } = {}) {
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 7 * DAY_MS);
  const filter = { startAt: { $lt: end }, endAt: { $gt: start } };
  if (roleTitle) filter.roleTitle = roleTitle;
  if (userId) filter.userId = userId;
  return DutyShift.find(filter).populate('userId', USER_SELECT).sort({ startAt: 1 }).lean();
}

/**
 * Ai đang trực lúc `at`: { onDuty, hasSchedule }. Mỗi phần tử là user (fullName, phone...) kèm shiftId, endAt.
 * hasSchedule = false khi lúc đó không có ai trực → nơi gọi tự quyết (vd hàng chờ sự cố báo tất cả KTV).
 */
export async function getOnDuty(roleTitle, at = new Date()) {
  const shifts = await DutyShift.find({ roleTitle, startAt: { $lte: at }, endAt: { $gt: at } })
    .populate({ path: 'userId', select: USER_SELECT, match: { isActive: true } })
    .lean();
  const onDuty = activeShifts(
    shifts.filter((s) => s.userId),
    at,
  ).map((s) => ({ ...s.userId, shiftId: s._id, endAt: s.endAt }));
  return { onDuty, hasSchedule: onDuty.length > 0 };
}

/** Người dùng có đang trong ca không */
export async function isUserOnDuty(userId, roleTitle, at = new Date()) {
  return Boolean(await DutyShift.exists({ userId, roleTitle, startAt: { $lte: at }, endAt: { $gt: at } }));
}

/**
 * Xếp ca cho 1 hoặc nhiều người cùng khung giờ (có thể lặp `repeatDays` ngày liên tiếp). Người được xếp phải là
 * nhân viên đang hoạt động đúng chức danh; không trùng giờ với ca khác của chính người đó. Có người trùng thì
 * không tạo ca nào. Lịch cũ chỉ để xem: không xếp ca cho ngày đã qua hay ca đã kết thúc (ca hôm nay đang diễn ra
 * vẫn xếp thêm người được). Trả về các ca đã tạo.
 */
export async function createShifts(user, { roleTitle, userIds, startAt, endAt, note, repeatDays = 1 }, { now = new Date() } = {}) {
  const error = validateShiftWindow(startAt, endAt);
  if (error) throw ApiError.badRequest(error, [{ field: 'endAt', message: error }]);
  if (new Date(startAt) < startOfVnDay(now)) throw ApiError.badRequest('Không xếp ca cho ngày đã qua', [{ field: 'startAt', message: 'Ngày đã qua' }]);
  if (new Date(endAt) <= now) throw ApiError.badRequest('Ca này đã kết thúc, không xếp được', [{ field: 'endAt', message: 'Ca đã kết thúc' }]);

  const ids = [...new Set(userIds.map(String))];
  const staffList = await User.find({ _id: { $in: ids }, role: ROLES.STAFF, roleTitle, isActive: true }).select('fullName').lean();
  if (staffList.length !== ids.length) throw ApiError.badRequest('Người được xếp ca phải là nhân viên đang hoạt động đúng chức danh');

  const windows = repeatWindows(startAt, endAt, repeatDays);
  // Ca trùng giờ của 1 trong các người được xếp: { staff, window } hoặc null
  const findClash = async (excludeIds = []) => {
    const existing = await DutyShift.find({
      userId: { $in: ids },
      _id: { $nin: excludeIds },
      startAt: { $lt: windows.at(-1).endAt },
      endAt: { $gt: windows[0].startAt },
    })
      .select('userId startAt endAt')
      .lean();
    for (const staff of staffList) {
      const mine = existing.filter((e) => String(e.userId) === String(staff._id));
      const window = windows.find((w) => mine.some((e) => overlaps(w, e)));
      if (window) return { staff, window };
    }
    return null;
  };
  const overlapError = ({ staff, window }) =>
    new ApiError('DUTY_SHIFT_OVERLAP', `${staff.fullName} đã có ca trực trùng thời gian ${fmtDateTimeVn(window.startAt)}`);

  const clash = await findClash();
  if (clash) throw overlapError(clash);

  const shifts = await DutyShift.insertMany(
    staffList.flatMap((staff) => windows.map((w) => ({ roleTitle, userId: staff._id, ...w, note, createdBy: user.id }))),
  );
  // 2 request xếp trùng gửi cùng lúc đều qua được bước kiểm tra trên → kiểm tra lại sau khi ghi,
  // trùng thì hoàn tác ca vừa tạo (có thể cả 2 cùng hoàn tác — an toàn hơn là để trùng ca)
  const ownIds = shifts.map((s) => s._id);
  const lateClash = await findClash(ownIds);
  if (lateClash) {
    await DutyShift.deleteMany({ _id: { $in: ownIds } });
    throw overlapError(lateClash);
  }

  await logAudit({
    action: AUDIT_ACTIONS.DUTY_SHIFT_CREATED,
    user,
    targetType: AUDIT_TARGETS.DUTY_SHIFT,
    targetId: shifts[0]._id,
    metadata: { userIds: ids, roleTitle, count: shifts.length, startAt: windows[0].startAt },
  });
  await notify(ids, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Bạn được xếp ca trực',
    content: `${windows.length} ca, ca đầu ${fmtDateTimeVn(windows[0].startAt)} – ${fmtDateTimeVn(windows[0].endAt)}.`,
    refId: shifts[0]._id,
    link: LINK,
  });
  return shifts;
}

/**
 * Sửa ca chưa kết thúc: đổi người trực, giờ bắt đầu / kết thúc, ghi chú (kéo thả ca sang ngày khác cũng gọi hàm này).
 * Ca đang diễn ra không đổi giờ bắt đầu và không kết thúc sớm hơn hiện tại; người mới phải là nhân viên đang hoạt động
 * đúng chức danh và không trùng giờ với ca khác của chính người đó. Báo người trực (cả người cũ nếu đổi người).
 */
export async function updateShift(user, id, changes, { now = new Date() } = {}) {
  const shift = await DutyShift.findById(id).lean();
  if (!shift) throw ApiError.notFound('Không tìm thấy ca trực');
  if (shift.endAt <= now) throw ApiError.badRequest('Ca trực đã kết thúc, không thể sửa');

  const started = shift.startAt <= now;
  const startAt = changes.startAt ? new Date(changes.startAt) : shift.startAt;
  const endAt = changes.endAt ? new Date(changes.endAt) : shift.endAt;
  const userId = String(changes.userId ?? shift.userId);
  if (started && startAt.getTime() !== new Date(shift.startAt).getTime()) {
    throw ApiError.badRequest('Ca đang diễn ra, không đổi được giờ bắt đầu');
  }
  if (!started && startAt <= now) throw ApiError.badRequest('Không chuyển ca về thời điểm đã qua');
  if (endAt <= now) throw ApiError.badRequest('Giờ kết thúc ca phải sau thời điểm hiện tại');
  const error = validateShiftWindow(startAt, endAt);
  if (error) throw ApiError.badRequest(error, [{ field: 'endAt', message: error }]);

  const staff = await User.findOne({ _id: userId, role: ROLES.STAFF, roleTitle: shift.roleTitle, isActive: true }).select('fullName').lean();
  if (!staff) throw ApiError.badRequest('Người được xếp ca phải là nhân viên đang hoạt động đúng chức danh');
  const findClash = () =>
    DutyShift.exists({ _id: { $ne: shift._id }, userId, startAt: { $lt: endAt }, endAt: { $gt: startAt } });
  const overlapError = () => new ApiError('DUTY_SHIFT_OVERLAP', `${staff.fullName} đã có ca trực trùng thời gian ${fmtDateTimeVn(startAt)}`);
  if (await findClash()) throw overlapError();

  const note = changes.note === undefined ? shift.note : changes.note;
  await DutyShift.updateOne({ _id: shift._id }, { $set: { userId, startAt, endAt, note } });
  // 2 thao tác cùng lúc có thể cùng qua bước kiểm tra → kiểm tra lại, trùng thì trả ca về như cũ
  if (await findClash()) {
    await DutyShift.updateOne({ _id: shift._id }, { $set: { userId: shift.userId, startAt: shift.startAt, endAt: shift.endAt, note: shift.note } });
    throw overlapError();
  }

  await logAudit({
    action: AUDIT_ACTIONS.DUTY_SHIFT_UPDATED,
    user,
    targetType: AUDIT_TARGETS.DUTY_SHIFT,
    targetId: shift._id,
    metadata: {
      before: { userId: shift.userId, startAt: shift.startAt, endAt: shift.endAt },
      after: { userId, startAt, endAt },
    },
  });
  const window = `${fmtDateTimeVn(startAt)} – ${fmtDateTimeVn(endAt)}`;
  if (userId !== String(shift.userId)) {
    await notify(shift.userId, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Ca trực của bạn đã chuyển cho người khác',
      content: `Ca ${fmtDateTimeVn(shift.startAt)} – ${fmtDateTimeVn(shift.endAt)} đã được Trưởng BQL chuyển cho ${staff.fullName}.`,
      link: LINK,
    });
    await notify(userId, { type: NOTIFICATION_TYPES.SYSTEM, title: 'Bạn được xếp ca trực', content: `Ca ${window}.`, refId: shift._id, link: LINK });
  } else {
    await notify(userId, { type: NOTIFICATION_TYPES.SYSTEM, title: 'Ca trực của bạn đã thay đổi', content: `Ca mới: ${window}.`, refId: shift._id, link: LINK });
  }
  return DutyShift.findById(shift._id).populate('userId', USER_SELECT).lean();
}

/**
 * UC37 bước 2: sao chép ca của tuần trước sang tuần `weekStart` (cùng giờ, +7 ngày). Bỏ qua ca rơi vào thời điểm đã qua,
 * người đã bị khóa / đổi chức danh, hoặc trùng giờ với ca đã có của chính người đó. Trả về { created, skipped }.
 */
export async function copyWeek(user, { roleTitle, weekStart }, { now = new Date() } = {}) {
  const target = new Date(weekStart);
  const from = new Date(target.getTime() - 7 * DAY_MS);
  const source = await DutyShift.find({ roleTitle, startAt: { $gte: from, $lt: target } }).lean();
  if (!source.length) throw ApiError.badRequest('Tuần trước chưa có ca nào để sao chép');

  const active = new Set(
    (await User.find({ _id: { $in: source.map((s) => s.userId) }, role: ROLES.STAFF, roleTitle, isActive: true }).select('_id').lean()).map((u) =>
      String(u._id),
    ),
  );
  const candidates = source
    .map((s) => ({ roleTitle, userId: s.userId, startAt: new Date(s.startAt.getTime() + 7 * DAY_MS), endAt: new Date(s.endAt.getTime() + 7 * DAY_MS), note: s.note, createdBy: user.id }))
    .filter((c) => c.startAt >= startOfVnDay(now) && c.endAt > now && active.has(String(c.userId)));
  const existing = await DutyShift.find({
    userId: { $in: candidates.map((c) => c.userId) },
    startAt: { $lt: new Date(target.getTime() + 8 * DAY_MS) },
    endAt: { $gt: target },
  })
    .select('userId startAt endAt')
    .lean();
  const toCreate = candidates.filter((c) => !existing.some((e) => String(e.userId) === String(c.userId) && overlaps(c, e)));
  const created = toCreate.length ? await DutyShift.insertMany(toCreate) : [];

  if (created.length) {
    await logAudit({
      action: AUDIT_ACTIONS.DUTY_SHIFT_CREATED,
      user,
      targetType: AUDIT_TARGETS.DUTY_SHIFT,
      targetId: created[0]._id,
      metadata: { roleTitle, count: created.length, copiedFromWeek: from, weekStart: target },
    });
    const ids = [...new Set(created.map((c) => String(c.userId)))];
    await notify(ids, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Bạn được xếp ca trực tuần mới',
      content: `Lịch trực tuần ${fmtDateVn(target)} đã được sao chép từ tuần trước.`,
      link: LINK,
    });
  }
  return { created: created.length, skipped: source.length - created.length };
}

/**
 * UC37 Alt 3b: nhân viên bị khóa → gỡ khỏi các ca sắp tới, ca đang diễn ra kết thúc ngay lúc khóa
 * (ca đã qua giữ nguyên để tra cứu). Gọi từ chỗ khóa tài khoản. Trả về số ca bị ảnh hưởng.
 */
export async function releaseShiftsOf(userId, { now = new Date() } = {}) {
  const [removed, ended] = await Promise.all([
    DutyShift.deleteMany({ userId, startAt: { $gt: now } }),
    DutyShift.updateMany({ userId, startAt: { $lte: now }, endAt: { $gt: now } }, { $set: { endAt: now } }),
  ]);
  return removed.deletedCount + ended.modifiedCount;
}

/** Xóa ca chưa kết thúc (ca đã qua giữ lại để tra cứu ai trực lúc xảy ra sự cố) */
export async function deleteShift(user, id, { now = new Date() } = {}) {
  const shift = await DutyShift.findById(id).lean();
  if (!shift) throw ApiError.notFound('Không tìm thấy ca trực');
  if (shift.endAt <= now) throw ApiError.badRequest('Ca trực đã kết thúc, không thể xóa');

  await DutyShift.deleteOne({ _id: id });
  await logAudit({
    action: AUDIT_ACTIONS.DUTY_SHIFT_DELETED,
    user,
    targetType: AUDIT_TARGETS.DUTY_SHIFT,
    targetId: shift._id,
    metadata: { userId: shift.userId, roleTitle: shift.roleTitle, startAt: shift.startAt, endAt: shift.endAt },
  });
  await notify(shift.userId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Ca trực của bạn đã bị hủy',
    content: `Ca ${fmtDateTimeVn(shift.startAt)} – ${fmtDateTimeVn(shift.endAt)} đã được Trưởng BQL hủy.`,
    link: LINK,
  });
  return { _id: shift._id };
}
