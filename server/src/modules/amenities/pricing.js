// Kiểu tiện ích, nhóm tuổi, định dạng giá. Hàm thuần — không đọc DB; tuổi tính theo ngày lịch giờ Việt Nam.
import { AGE_GROUPS, AMENITY_ACCESS_MODES, CONFIG_KEYS, CONFIG_DEFAULTS } from '../../constants/enums.js';
import { VN_OFFSET_MS } from '../../utils/time.js';

const DEFAULTS = CONFIG_DEFAULTS;
const DEFAULT_AGE_CFG = {
  childFreeAge: DEFAULTS[CONFIG_KEYS.CHILD_FREE_AGE],
  childAdultAge: DEFAULTS[CONFIG_KEYS.CHILD_ADULT_AGE],
};

/** Bản ghi cũ chưa có accessMode coi là BOOKING */
export const accessModeOf = (amenity) => amenity?.accessMode ?? AMENITY_ACCESS_MODES.BOOKING;

/** Ngày lịch (năm, tháng, ngày) theo giờ VN */
function vnYmd(date) {
  const d = new Date(new Date(date).getTime() + VN_OFFSET_MS); // đọc getUTC*() ra ngày giờ VN
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/**
 * Tuổi tròn năm tại thời điểm `at` (mặc định bây giờ). Không có ngày sinh, ngày sinh không hợp lệ hoặc ở tương lai → null.
 * Sinh hôm nay → 0; sinh nhật năm nay chưa tới thì chưa tăng tuổi.
 */
export function ageAt(dateOfBirth, at = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const when = new Date(at);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(when.getTime())) return null;
  const b = vnYmd(dob);
  const t = vnYmd(when);
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age >= 0 ? age : null; // so theo ngày lịch (không theo giờ): ngày sinh tương lai → age < 0
}

/**
 * Nhóm tuổi tính giá: CHILD_FREE (< childFreeAge) · CHILD (< childAdultAge) · ADULT (còn lại).
 * Không có ngày sinh → ADULT. `cfg` = { childFreeAge, childAdultAge } (getBookingConfig); sai kiểu / ngược thứ tự → mặc định 6 và 12.
 */
export function ageGroupOf(dateOfBirth, at = new Date(), cfg = DEFAULT_AGE_CFG) {
  const age = ageAt(dateOfBirth, at);
  if (age === null) return AGE_GROUPS.ADULT;
  const free = Number(cfg?.childFreeAge);
  const adult = Number(cfg?.childAdultAge);
  const valid = Number.isInteger(free) && Number.isInteger(adult) && free > 0 && adult > free;
  const { childFreeAge, childAdultAge } = valid ? { childFreeAge: free, childAdultAge: adult } : DEFAULT_AGE_CFG;
  if (age < childFreeAge) return AGE_GROUPS.CHILD_FREE;
  if (age < childAdultAge) return AGE_GROUPS.CHILD;
  return AGE_GROUPS.ADULT;
}

/** 1250000 → "1.250.000 đ" */
export const formatVnd = (n) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;
const money = formatVnd;

/** Dòng giá hiển thị sẵn cho FE: "100.000 đ / lượt đặt" */
export function priceSummaryOf(amenity) {
  if (accessModeOf(amenity) === AMENITY_ACCESS_MODES.FREE) return 'Miễn phí';
  return amenity.feePerBooking ? `${money(amenity.feePerBooking)} / lượt đặt` : 'Miễn phí đặt chỗ';
}
