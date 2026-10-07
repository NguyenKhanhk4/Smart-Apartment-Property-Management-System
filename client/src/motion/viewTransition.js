// Hiệu ứng "Morph" kiểu PowerPoint giữa 2 màn hình (View Transitions API).
// Phần tử có cùng `view-transition-name` ở trang cũ và trang mới sẽ tự bay/đổi kích thước sang vị trí mới.
// Trình duyệt không hỗ trợ hoặc người dùng bật "giảm chuyển động" → đổi ngay, không lỗi.

const canMorph = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Bọc 1 thay đổi giao diện (đổi theme, đổi trạng thái) trong view transition */
export function runViewTransition(update) {
  if (!canMorph()) {
    update();
    return null;
  }
  return document.startViewTransition(update);
}

/**
 * Tên view-transition cho phần tử dùng chung giữa 2 trang, vd card tài sản ↔ header trang chi tiết.
 * Mỗi tên chỉ được xuất hiện 1 lần trên 1 trang.
 * @example <h2 style={vtName('asset-title', asset._id)}>…</h2>
 */
export const vtName = (...parts) => ({ viewTransitionName: parts.filter(Boolean).join('-') });
