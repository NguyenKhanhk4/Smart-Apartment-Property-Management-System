import dayjs from 'dayjs';

/** "2026-10" → "10/2026" */
export const monthLabel = (m) => `${m.slice(5)}/${m.slice(0, 4)}`;

/** Thông tin hạn dùng của gói tháng (tháng lịch: ngày 1 → cuối tháng) */
export function passSpan(month, now = dayjs()) {
  const start = dayjs(`${month}-01`);
  const end = start.endOf('month');
  const total = end.diff(start, 'day') + 1;
  const elapsed = Math.min(Math.max(now.startOf('day').diff(start, 'day') + 1, 0), total);
  return {
    expiry: end.format('DD/MM/YYYY'),
    daysLeft: Math.max(end.startOf('day').diff(now.startOf('day'), 'day'), 0),
    percent: Math.round((elapsed / total) * 100),
  };
}
