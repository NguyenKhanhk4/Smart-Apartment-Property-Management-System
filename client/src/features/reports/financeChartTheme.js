// Màu biểu đồ tài chính — bảng màu tham chiếu của skill dataviz, đã chạy validate_palette (sáng + tối, 4 slot đầu).
// Màu theo thực thể cố định (không theo thứ hạng); trạng thái nợ dùng bảng màu trạng thái, luôn kèm nhãn.
const LIGHT = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  status: { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' },
  grid: '#e7e6e2',
  axis: '#52514e',
  surface: '#fcfcfb',
};
const DARK = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
  status: { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' },
  grid: '#33332f',
  axis: '#c3c2b7',
  surface: '#1a1a19',
};

export const chartTheme = (isDark) => (isDark ? DARK : LIGHT);

/** Hình thức thu → slot màu cố định (CASH 1, BANK_TRANSFER 2, PAYOS 3; tiện ích trả ngay 4) */
export const METHOD_SLOT = { CASH: 0, BANK_TRANSFER: 1, PAYOS: 2, AMENITY: 3 };

/** Trục tiền gọn: 1.2 tr, 350 k */
export const compactVnd = (v) => {
  const n = Math.abs(v);
  if (n >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  if (n >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (n >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(v);
};
