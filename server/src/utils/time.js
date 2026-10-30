// Tiện ích thời gian theo giờ Việt Nam (UTC+7, không có DST). Module KHÔNG tự khai báo lại các hằng / hàm này.
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const VN_OFFSET_MS = 7 * HOUR_MS;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
/** Date "dịch" sang giờ VN để đọc getUTC*() ra ngày giờ VN */
const shiftVn = (date) => new Date(new Date(date).getTime() + VN_OFFSET_MS);

export const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * MINUTE_MS);

/** Date → "YYYY-MM-DD" theo giờ VN */
export const toVnYmd = (date) => shiftVn(date).toISOString().slice(0, 10);

/** "2026-10-08" → 00:00 ngày đó giờ VN (= 2026-10-07T17:00:00.000Z) */
export function vnDayStart(ymd) {
  if (!YMD.test(ymd)) throw new Error(`Ngày không đúng dạng YYYY-MM-DD: ${ymd}`);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS);
}

/** "HH:mm" giờ VN của một mốc thời gian */
export const vnHHmm = (date) => shiftVn(date).toISOString().slice(11, 16);

// Định dạng hiển thị (thông báo, email, file xuất) — tự ghép chuỗi để không phụ thuộc ICU/locale của máy chủ
export const fmtTimeVn = (date) => (date ? vnHHmm(date) : '—');
export function fmtDateVn(date) {
  if (!date) return '—';
  const d = shiftVn(date);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
export const fmtDateTimeVn = (date) => (date ? `${fmtTimeVn(date)} ${fmtDateVn(date)}` : '—');
/** "2026-03" → "03/2026" */
export const periodLabel = (period) => `${period.slice(5)}/${period.slice(0, 4)}`;

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

/** Cộng/trừ `n` tháng cho "YYYY-MM": shiftPeriod('2026-01', -1) → '2025-12' */
export function shiftPeriod(period, n) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
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
