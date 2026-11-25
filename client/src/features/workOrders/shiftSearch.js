// Lọc và sắp xếp Checklist ca của KTV (danh sách đã tải hết về máy nên lọc tại chỗ)

/** Bỏ dấu tiếng Việt + chữ thường: gõ "bom" khớp "Bơm", "dien" khớp "Điện" */
const plain = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

/** Ngày giờ VN dạng YYYY-MM-DD (so sánh chuỗi được), '' nếu không có */
export const vnDay = (date) => (date ? new Date(new Date(date).getTime() + 7 * 3600e3).toISOString().slice(0, 10) : '');

/**
 * @param {{ keyword?: string, statuses?: string[], from?: string, to?: string }} filter
 * keyword: mã, tên, vị trí, tòa của thiết bị; mọi từ đều phải khớp. from / to: YYYY-MM-DD theo ngày lên lịch, tính cả 2 đầu.
 */
export function filterShiftItems(items, { keyword = '', statuses = [], from = '', to = '' } = {}) {
  const words = plain(keyword).split(/\s+/).filter(Boolean);
  return items.filter((wo) => {
    if (statuses.length && !statuses.includes(wo.status)) return false;
    const day = vnDay(wo.scheduledDate);
    if ((from || to) && (!day || (from && day < from) || (to && day > to))) return false;
    const a = wo.assetId ?? {};
    const text = plain([a.code, a.name, a.location, a.buildingId?.name].filter(Boolean).join(' '));
    return words.every((w) => text.includes(w));
  });
}

/** Hôm nay lên đầu, rồi các ngày đã qua (gần nhất trước), rồi các ngày tới (gần nhất trước). Cùng ngày giữ thứ tự cũ */
export function sortTodayFirst(items, now = new Date()) {
  const today = vnDay(now);
  const group = (day) => (day === today ? 0 : day && day < today ? 1 : 2);
  return [...items].sort((x, y) => {
    const [a, b] = [vnDay(x.scheduledDate), vnDay(y.scheduledDate)];
    if (group(a) !== group(b)) return group(a) - group(b);
    if (a === b) return 0;
    if (!a || !b) return a ? -1 : 1; // không có ngày: cuối cùng
    return group(a) === 1 ? b.localeCompare(a) : a.localeCompare(b);
  });
}
