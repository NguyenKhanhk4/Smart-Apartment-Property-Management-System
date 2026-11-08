// Đồng bộ dữ liệu giữa các trang / tab: sau mỗi thao tác ghi thành công (useAction) phát tín hiệu "dữ liệu đã đổi";
// mọi useApi đang mở (cùng tab qua window event, tab khác cùng trình duyệt qua BroadcastChannel) tự tải lại ngầm.
// Thay đổi từ người dùng khác (máy khác) được cập nhật qua làm mới định kỳ / khi quay lại tab (xem useApi).

export const DATA_CHANGED_EVENT = 'sapms:data-changed';
export const AUTO_REFRESH_MS = 30_000; // tab đang mở: tải lại ngầm mỗi 30 giây
export const STALE_MS = 5_000; // quay lại tab: chỉ tải lại nếu dữ liệu cũ hơn 5 giây

let channel = null;
function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel('sapms-data');
  // Tab khác báo đổi dữ liệu → chuyển thành event trong tab này
  channel.onmessage = () => window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return channel;
}

/** Gọi sau khi ghi dữ liệu thành công: báo cho các useApi trong tab này và các tab khác */
export function notifyDataChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  try {
    getChannel()?.postMessage('changed');
  } catch {
    // Trình duyệt không hỗ trợ / tab đang đóng: chỉ bỏ lỡ đồng bộ chéo tab, làm mới định kỳ vẫn chạy
  }
}

/** Đăng ký nghe tín hiệu đổi dữ liệu; trả về hàm hủy */
export function onDataChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  getChannel();
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
}
