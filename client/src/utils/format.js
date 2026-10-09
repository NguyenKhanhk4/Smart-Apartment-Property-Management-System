import dayjs from 'dayjs';

export const formatMoney = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;
export const formatCompactMoney = (n) => {
  const v = Math.abs(n ?? 0);
  if (v >= 1e9) return `${(n / 1e9).toFixed(1)} tỷ`;
  if (v >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  if (v >= 1e3) return `${(n / 1e3).toFixed(0)} k`;
  return String(n ?? 0);
};
export const formatPercent = (r, digits = 1) => `${((r ?? 0) * 100).toFixed(digits)}%`;
export const formatDateTime = (d) => (d ? dayjs(d).format('HH:mm DD/MM/YYYY') : '—');
export const formatDate = (d) => (d ? dayjs(d).format('DD/MM/YYYY') : '—');
export const fromNow = (d) => (d ? dayjs(d).fromNow() : '');

/** Tên gọi thân mật theo thói quen người Việt: chữ cuối của họ tên ("Nguyễn Văn An" → "An") */
export const givenName = (fullName) => String(fullName ?? '').trim().split(/\s+/).pop() ?? '';

/** Đường dẫn thông báo: link tuyệt đối (/r, /app) giữ nguyên; link chung gắn tiền tố khu vực hiện tại */
export const resolveLink = (link, area) => {
  if (!link) return null;
  if (link.startsWith('/r/') || link.startsWith('/app/')) return link;
  return `/${area}${link}`;
};

/** "Hôm nay" / "Ngày mai" / "DD/MM" cho một mốc thời gian */
export const dayLabel = (d) => {
  const day = dayjs(d).startOf('day');
  const diff = day.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Ngày mai';
  return day.format('DD/MM');
};
