/**
 * Đánh số request để bỏ qua kết quả về trễ: chỉ request mới nhất được ghi vào state
 * (vd gõ tìm kiếm nhanh, response cũ về sau không được đè lên response mới).
 */
export function createSequencer() {
  let latest = 0;
  return {
    next: () => {
      latest += 1;
      return latest;
    },
    isLatest: (id) => id === latest,
    /** Bỏ mọi request đang chạy (vd khi tắt `enabled` hoặc unmount) */
    invalidate: () => {
      latest += 1;
    },
  };
}
