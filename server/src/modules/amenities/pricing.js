// Giá tiện ích theo nhóm tuổi (BR-O24). Hàm thuần — không đọc DB; tuổi tính theo ngày lịch giờ Việt Nam.
// Dùng lại ở bước vé lẻ / gói tháng / billing: ageGroupOf(user.dateOfBirth, mốc phát sinh, cfg) → visitFee / passFee.
import { AGE_GROUPS, AMENITY_ACCESS_MODES, CONFIG_KEYS, DEFAULT_CONFIGS } from '../../constants/enums.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULTS = Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c.value]));
const DEFAULT_AGE_CFG = {
  childFreeAge: DEFAULTS[CONFIG_KEYS.CHILD_FREE_AGE],
  childAdultAge: DEFAULTS[CONFIG_KEYS.CHILD_ADULT_AGE],
};

/** Bản ghi cũ chưa có accessMode coi là BOOKING */
export const accessModeOf = (amenity) => amenity?.accessMode ?? AMENITY_ACCESS_MODES.BOOKING;

/** Ngày lịch (năm, tháng, ngày) theo giờ VN */
function vnYmd(date) {
  const d = new Date(new Date(date).getTime() + VN_OFFSET_MS);
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

/** Phí 1 lượt vào (tiện ích WALK_IN) theo nhóm tuổi; trẻ dưới mốc miễn phí luôn 0. Kiểu khác không tính theo lượt → 0. */
export function visitFee(amenity, group) {
  if (group === AGE_GROUPS.CHILD_FREE) return 0;
  const fee = group === AGE_GROUPS.CHILD ? amenity?.perVisitFeeChild : amenity?.perVisitFeeAdult;
  return fee ?? 0;
}

/** Phí gói tháng theo nhóm tuổi; null = tiện ích không bán gói (trẻ CHILD_FREE không cần gói nên 0 nếu có bán gói). */
export function passFee(amenity, group) {
  const adult = amenity?.monthlyPassFeeAdult ?? null;
  const child = amenity?.monthlyPassFeeChild ?? null;
  if (adult === null || child === null) return null;
  if (group === AGE_GROUPS.CHILD_FREE) return 0;
  return group === AGE_GROUPS.CHILD ? child : adult;
}

/** 1250000 → "1.250.000 đ" */
export const formatVnd = (n) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;
const money = formatVnd;

/** Dòng giá hiển thị sẵn cho FE: "Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt · Gói 400.000 đ/tháng" */
export function priceSummaryOf(amenity) {
  const mode = accessModeOf(amenity);
  if (mode === AMENITY_ACCESS_MODES.FREE) return 'Miễn phí';

  const parts = [];
  if (mode === AMENITY_ACCESS_MODES.WALK_IN) {
    const adult = amenity.perVisitFeeAdult ?? 0;
    const child = amenity.perVisitFeeChild ?? 0;
    parts.push(
      adult === 0 && child === 0
        ? 'Miễn phí vé lẻ'
        : `Người lớn ${adult ? money(adult) : 'miễn phí'} · Trẻ em ${child ? money(child) : 'miễn phí'} / lượt`,
    );
  } else {
    parts.push(amenity.feePerBooking ? `${money(amenity.feePerBooking)} / lượt đặt` : 'Miễn phí đặt chỗ');
  }

  const adultPass = passFee(amenity, AGE_GROUPS.ADULT);
  if (adultPass !== null) {
    const childPass = passFee(amenity, AGE_GROUPS.CHILD);
    parts.push(
      childPass === adultPass ? `Gói ${money(adultPass)}/tháng` : `Gói ${money(adultPass)}/tháng (trẻ em ${money(childPass)})`,
    );
  }
  return parts.join(' · ');
}
