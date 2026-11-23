/**
 * Mục menu đang mở: mục có đường dẫn khớp dài nhất với URL hiện tại (so theo từng đoạn).
 * Nhờ vậy "invoices/generate" (Tính phí) và "invoices" (Thông báo phí) không cùng sáng,
 * còn trang chi tiết (invoices/:id, assets/:id) vẫn sáng mục cha.
 * @param {string} pathname vd /app/invoices/generate
 * @param {{ key: string, path: string }[]} items
 */
export function activeMenuKey(pathname, items) {
  const segs = pathname.split('/').filter(Boolean).slice(1); // bỏ "app"
  let best = null;
  let bestLen = 0;
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean);
    const matches = parts.length <= segs.length && parts.every((p, i) => p.startsWith(':') || p === segs[i]);
    if (matches && parts.length > bestLen) {
      best = item.key;
      bestLen = parts.length;
    }
  }
  return best;
}
