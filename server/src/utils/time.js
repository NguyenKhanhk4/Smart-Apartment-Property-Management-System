// Tiện ích thời gian theo giờ Việt Nam (UTC+7, không có DST).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** 00:00 giờ VN của ngày chứa `date`, trả về Date (UTC). */
export function startOfVnDay(date = new Date()) {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - VN_OFFSET_MS);
}

export function endOfVnDay(date = new Date()) {
  return new Date(startOfVnDay(date).getTime() + DAY_MS - 1);
}

/** "YYYY-MM" theo giờ VN */
export function vnPeriod(date = new Date()) {
  const d = new Date(date.getTime() + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Ngày đầu tháng (giờ VN) của "YYYY-MM" */
export function periodStart(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS);
}

/** Ngày đầu tháng kế tiếp (giờ VN) của "YYYY-MM" — dùng làm cận trên mở */
export function periodEnd(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS);
}

/** Danh sách "YYYY-MM" từ `from` tới `to` (bao gồm) */
export function periodRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
