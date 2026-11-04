// Quy tắc lịch ca trực (Người 4 — X6), chỉ là logic thuần để test không cần DB.
// Ca là khoảng nửa mở [startAt, endAt): ca 06:00–14:00 và 14:00–22:00 nối tiếp, không trùng.
import { DAY_MS, HOUR_MS } from '../../utils/time.js';

export const MAX_SHIFT_HOURS = 24;

const time = (d) => new Date(d).getTime();

/** Lỗi khung ca (chuỗi tiếng Việt) hoặc null nếu hợp lệ */
export function validateShiftWindow(startAt, endAt) {
  if (Number.isNaN(time(startAt)) || Number.isNaN(time(endAt))) return 'Thời gian ca trực không hợp lệ';
  if (time(endAt) <= time(startAt)) return 'Giờ kết thúc ca phải sau giờ bắt đầu';
  if (time(endAt) - time(startAt) > MAX_SHIFT_HOURS * HOUR_MS) return `Một ca trực dài tối đa ${MAX_SHIFT_HOURS} giờ`;
  return null;
}

export const overlaps = (a, b) => time(a.startAt) < time(b.endAt) && time(b.startAt) < time(a.endAt);

export const isActiveAt = (shift, at) => time(shift.startAt) <= time(at) && time(at) < time(shift.endAt);

/**
 * Ca đang diễn ra lúc `at`, tách người trực chính / dự phòng. Một người có nhiều dòng ca chồng nhau
 * chỉ tính 1 lần; đã là trực chính ở dòng nào thì không xếp vào dự phòng.
 */
export function splitOnDuty(shifts, at = new Date()) {
  const active = shifts.filter((s) => isActiveAt(s, at));
  const userKey = (s) => String(s.userId?._id ?? s.userId);
  const primaryIds = new Set(active.filter((s) => !s.isBackup).map(userKey));
  const seen = new Set();
  const pick = (s) => {
    const key = userKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const primary = active.filter((s) => !s.isBackup).filter(pick);
  const backup = active.filter((s) => s.isBackup && !primaryIds.has(userKey(s))).filter(pick);
  return { primary, backup };
}

/** Cùng khung giờ lặp lại `days` ngày liên tiếp (xếp lịch cả tuần một lần) */
export function repeatWindows(startAt, endAt, days = 1) {
  return Array.from({ length: days }, (_, i) => ({
    startAt: new Date(time(startAt) + i * DAY_MS),
    endAt: new Date(time(endAt) + i * DAY_MS),
  }));
}
