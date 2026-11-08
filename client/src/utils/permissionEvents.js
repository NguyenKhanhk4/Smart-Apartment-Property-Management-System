// UC04: báo AuthProvider nạp lại quyền (ẩn / hiện menu) mà không cần tải lại trang
export const PERMISSIONS_CHANGED_EVENT = 'sapms:permissions-changed';

export const notifyPermissionsChanged = () => window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT));
