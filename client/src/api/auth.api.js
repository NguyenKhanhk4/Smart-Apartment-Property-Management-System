// API đăng nhập. /auth/* do Module A (Vũ Việt) làm; /dev/* chỉ có khi backend chạy NODE_ENV=development.
import { http } from './axiosClient';

export const authApi = {
  /** body { fullName, email, phone, password, confirmPassword } → { user } */
  register: (body) => http.post('/auth/register', body),
  /** body { email, password } → { user, accessToken, refreshToken } (hợp đồng với Module A) */
  login: (body) => http.post('/auth/login', body),
  /** body { refreshToken } → { accessToken, refreshToken } */
  refresh: (refreshToken) => http.post('/auth/refresh', { refreshToken }),
  /** Đăng xuất phiên đăng nhập */
  logout: () => http.post('/auth/logout'),
  devAccounts: () => http.get('/dev/accounts'),
  devLogin: (email) => http.post('/dev/login', { email }),
};
