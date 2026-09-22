// Phiên đăng nhập lưu ở localStorage (FE và BE khác domain nên không dùng cookie httpOnly).
// `user` chỉ để hiển thị UI và ẩn/hiện menu; quyền thật luôn do backend kiểm tra.
// Mọi truy cập đều bọc try/catch: localStorage có thể bị chặn (chế độ riêng tư, trình duyệt cấu hình chặt).

const ACCESS_KEY = 'sapms_access_token';
const REFRESH_KEY = 'sapms_refresh_token';
const USER_KEY = 'sapms_user';

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Bỏ qua: phiên vẫn chạy trong bộ nhớ đến khi tải lại trang.
  }
}

export const authStorage = {
  getAccessToken: () => read(ACCESS_KEY),
  getRefreshToken: () => read(REFRESH_KEY),
  setTokens({ accessToken, refreshToken }) {
    write(ACCESS_KEY, accessToken);
    write(REFRESH_KEY, refreshToken);
  },
  getUser() {
    try {
      return JSON.parse(read(USER_KEY)) ?? null;
    } catch {
      return null;
    }
  },
  setUser(user) {
    write(USER_KEY, user ? JSON.stringify(user) : null);
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    write(USER_KEY, null);
  },
};
