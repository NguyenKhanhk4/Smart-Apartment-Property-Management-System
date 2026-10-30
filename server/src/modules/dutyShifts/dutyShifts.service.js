// Lịch ca trực Kỹ thuật viên / Bảo vệ (Người 4 — X6). Trưởng BQL xếp ca; nhân viên xem lịch.
// getOnDuty() dùng chung: hàng chờ sự cố (Người 4), checklist bảo trì theo ca (Người 1), tuần tra (Người 5).
import { AUDIT_ACTIONS, NOTIFICATION_TYPES, ROLES } from '../../constants/enums.js';
import { DutyShift, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { repeatWindows, splitOnDuty, validateShiftWindow, overlaps } from './shift.rules.js';
import { DAY_MS } from '../../utils/time.js';

const USER_SELECT = 'fullName phone roleTitle avatarUrl';
const LINK = '/app/duty-shifts';

const fmt = (d) =>
  new Date(d).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });

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
  return DutyShift.find(filter).populate('userId', USER_SELECT).sort({ startAt: 1, isBackup: 1 }).lean();
}

/**
 * Ai đang trực lúc `at`: { primary, backup, hasSchedule }. Mỗi phần tử là user (fullName, phone...) kèm shiftId, endAt.
 * hasSchedule = false khi lúc đó không có ca nào → nơi gọi tự quyết (vd hàng chờ sự cố báo tất cả KTV).
 */
export async function getOnDuty(roleTitle, at = new Date()) {
  const shifts = await DutyShift.find({ roleTitle, startAt: { $lte: at }, endAt: { $gt: at } })
    .populate({ path: 'userId', select: USER_SELECT, match: { isActive: true } })
    .lean();
  const { primary, backup } = splitOnDuty(
    shifts.filter((s) => s.userId),
    at,
  );
  const toPerson = (s) => ({ ...s.userId, shiftId: s._id, endAt: s.endAt });
  return { primary: primary.map(toPerson), backup: backup.map(toPerson), hasSchedule: primary.length + backup.length > 0 };
}

/** Người dùng có đang trong ca (chính hoặc dự phòng) không */
export async function isUserOnDuty(userId, roleTitle, at = new Date()) {
  return Boolean(await DutyShift.exists({ userId, roleTitle, startAt: { $lte: at }, endAt: { $gt: at } }));
}

/**
 * Xếp ca (có thể lặp `repeatDays` ngày liên tiếp). Người được xếp phải là nhân viên đang hoạt động đúng chức danh;
 * không trùng giờ với ca khác của chính người đó. Trả về các ca đã tạo.
 */
export async function createShifts(user, { roleTitle, userId, startAt, endAt, isBackup = false, note, repeatDays = 1 }) {
  const error = validateShiftWindow(startAt, endAt);
  if (error) throw ApiError.badRequest(error, [{ field: 'endAt', message: error }]);

  const staff = await User.findOne({ _id: userId, role: ROLES.STAFF, roleTitle, isActive: true }).select('fullName').lean();
  if (!staff) throw ApiError.badRequest('Người được xếp ca phải là nhân viên đang hoạt động đúng chức danh');

  const windows = repeatWindows(startAt, endAt, repeatDays);
  const existing = await DutyShift.find({
    userId,
    startAt: { $lt: windows.at(-1).endAt },
    endAt: { $gt: windows[0].startAt },
  })
    .select('startAt endAt')
    .lean();
  const clash = windows.find((w) => existing.some((e) => overlaps(w, e)));
  if (clash) {
    throw new ApiError('DUTY_SHIFT_OVERLAP', `${staff.fullName} đã có ca trực trùng thời gian ${fmt(clash.startAt)}`);
  }

  const shifts = await DutyShift.insertMany(
    windows.map((w) => ({ roleTitle, userId, ...w, isBackup, note, createdBy: user.id })),
  );

  await logAudit({
    action: AUDIT_ACTIONS.DUTY_SHIFT_CREATED,
    user,
    targetType: 'duty_shifts',
    targetId: shifts[0]._id,
    metadata: { userId, roleTitle, isBackup, count: shifts.length, startAt: windows[0].startAt },
  });
  await notify(userId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: isBackup ? 'Bạn được xếp trực dự phòng' : 'Bạn được xếp ca trực',
    content: `${shifts.length} ca, ca đầu ${fmt(windows[0].startAt)} – ${fmt(windows[0].endAt)}.`,
    refId: shifts[0]._id,
    link: LINK,
  });
  return shifts;
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
    targetType: 'duty_shifts',
    targetId: shift._id,
    metadata: { userId: shift.userId, roleTitle: shift.roleTitle, startAt: shift.startAt, endAt: shift.endAt },
  });
  await notify(shift.userId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Ca trực của bạn đã bị hủy',
    content: `Ca ${fmt(shift.startAt)} – ${fmt(shift.endAt)} đã được Trưởng BQL hủy.`,
    link: LINK,
  });
  return { _id: shift._id };
}
