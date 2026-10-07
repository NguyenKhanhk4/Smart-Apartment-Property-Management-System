// API đăng nhập. /auth/* do Module A (Vũ Việt) làm; /dev/* chỉ có khi backend chạy NODE_ENV=development.
import { http } from './axiosClient';

export const authApi = {
  /** body { email, password } → { user, accessToken, refreshToken } (hợp đồng với Module A) */
  login: (body) => http.post('/auth/login', body),
  devAccounts: () => http.get('/dev/accounts'),
  devLogin: (email) => http.post('/dev/login', { email }),
};
