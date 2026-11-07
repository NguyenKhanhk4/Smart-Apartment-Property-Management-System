// Tiện ích thời gian cho tiện ích & booking (Module D, UC-D05..D08). Mọi giờ "HH:mm" và ngày "YYYY-MM-DD" là giờ Việt Nam.
import { CONFIG_KEYS, CONFIG_DEFAULTS } from '../../constants/enums.js';
import { getConfigs } from '../../services/systemConfig.service.js';
import { addMinutes, toVnYmd, vnDayStart } from '../../utils/time.js';

// vnDayStart / toVnYmd / addMinutes nằm ở utils/time — export lại để các module tiện ích đang import từ đây vẫn chạy
export { addMinutes, toVnYmd, vnDayStart };

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isHHMM = (v) => typeof v === 'string' && HHMM.test(v);

/** "08:30" → 510 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 510 → "08:30" */
export const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

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

const DEFAULTS = CONFIG_DEFAULTS;
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
