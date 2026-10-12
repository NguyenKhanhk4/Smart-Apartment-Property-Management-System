// Tiện ích thời gian cho tiện ích & booking (Module D, UC-D05..D08). Mọi giờ "HH:mm" và ngày "YYYY-MM-DD" là giờ Việt Nam.
import { CONFIG_KEYS, DEFAULT_CONFIGS } from '../../constants/enums.js';
import { getConfigs } from '../../services/systemConfig.service.js';

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * MINUTE_MS;

export const isHHMM = (v) => typeof v === 'string' && HHMM.test(v);

/** "08:30" → 510 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 510 → "08:30" */
export const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "2026-10-08" → 00:00 ngày đó giờ VN (= 2026-10-07T17:00:00.000Z) */
export function vnDayStart(ymd) {
  if (!YMD.test(ymd)) throw new Error(`Ngày không đúng dạng YYYY-MM-DD: ${ymd}`);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS);
}

/** Date → "YYYY-MM-DD" theo giờ VN */
export const toVnYmd = (date) => new Date(new Date(date).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

export const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * MINUTE_MS);

/** Mốc thật của "HH:mm" trong ngày `dayStart` (00:00 giờ VN) */
export const atTime = (dayStart, hhmm) => addMinutes(dayStart, toMinutes(hhmm));

/** Lưới slot liên tiếp từ giờ mở cửa; slot cuối phải kết thúc ≤ giờ đóng cửa. */
export function buildSlotGrid({ openTime, closeTime, slotDurationMinutes }) {
  const close = toMinutes(closeTime);
  const slots = [];
  for (let t = toMinutes(openTime); t + slotDurationMinutes <= close; t += slotDurationMinutes) {
    slots.push({ slotStart: toHHMM(t), slotEnd: toHHMM(t + slotDurationMinutes) });
  }
  return slots;
}

const DEFAULTS = Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c.value]));
const positiveInt = (v, fallback) =>
  (typeof v === 'number' || typeof v === 'string') && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fallback;

/**
 * Tham số booking / tiện ích (system_configs), đã ép kiểu. Giá trị bị sửa sai (không phải số nguyên dương, giờ không
 * đúng HH:mm, giờ lễ tân mở ≥ đóng, mốc tuổi miễn phí ≥ mốc người lớn) thì dùng giá trị mặc định để hệ thống vẫn chạy.
 */
export async function getBookingConfig() {
  const K = CONFIG_KEYS;
  const c = await getConfigs([
    K.BOOKING_MAX_ACTIVE_PER_APARTMENT,
    K.BOOKING_ADVANCE_DAYS,
    K.CHECKIN_EARLY_MINUTES,
    K.NO_SHOW_GRACE_MINUTES,
    K.RECEPTION_OPEN_TIME,
    K.RECEPTION_CLOSE_TIME,
    K.CHILD_FREE_AGE,
    K.CHILD_ADULT_AGE,
    K.WALK_IN_VISIT_MINUTES,
    K.PASS_EXPIRY_REMIND_DAYS,
  ]);
  let receptionOpen = isHHMM(c[K.RECEPTION_OPEN_TIME]) ? c[K.RECEPTION_OPEN_TIME] : DEFAULTS[K.RECEPTION_OPEN_TIME];
  let receptionClose = isHHMM(c[K.RECEPTION_CLOSE_TIME]) ? c[K.RECEPTION_CLOSE_TIME] : DEFAULTS[K.RECEPTION_CLOSE_TIME];
  if (toMinutes(receptionOpen) >= toMinutes(receptionClose)) {
    receptionOpen = DEFAULTS[K.RECEPTION_OPEN_TIME];
    receptionClose = DEFAULTS[K.RECEPTION_CLOSE_TIME];
  }
  // Mốc tuổi (BR-O24): phải là số nguyên dương và miễn phí < người lớn, sai thì bỏ cả cặp
  let childFreeAge = positiveInt(c[K.CHILD_FREE_AGE], DEFAULTS[K.CHILD_FREE_AGE]);
  let childAdultAge = positiveInt(c[K.CHILD_ADULT_AGE], DEFAULTS[K.CHILD_ADULT_AGE]);
  if (childFreeAge >= childAdultAge) {
    childFreeAge = DEFAULTS[K.CHILD_FREE_AGE];
    childAdultAge = DEFAULTS[K.CHILD_ADULT_AGE];
  }
  return {
    maxActivePerApartment: positiveInt(c[K.BOOKING_MAX_ACTIVE_PER_APARTMENT], DEFAULTS[K.BOOKING_MAX_ACTIVE_PER_APARTMENT]),
    advanceDays: positiveInt(c[K.BOOKING_ADVANCE_DAYS], DEFAULTS[K.BOOKING_ADVANCE_DAYS]),
    checkinEarlyMinutes: positiveInt(c[K.CHECKIN_EARLY_MINUTES], DEFAULTS[K.CHECKIN_EARLY_MINUTES]),
    noShowGraceMinutes: positiveInt(c[K.NO_SHOW_GRACE_MINUTES], DEFAULTS[K.NO_SHOW_GRACE_MINUTES]),
    receptionOpen,
    receptionClose,
    childFreeAge,
    childAdultAge,
    walkInVisitMinutes: positiveInt(c[K.WALK_IN_VISIT_MINUTES], DEFAULTS[K.WALK_IN_VISIT_MINUTES]),
    passExpiryRemindDays: positiveInt(c[K.PASS_EXPIRY_REMIND_DAYS], DEFAULTS[K.PASS_EXPIRY_REMIND_DAYS]),
  };
}
