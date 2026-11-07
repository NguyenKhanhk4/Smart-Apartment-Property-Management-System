// API đăng nhập. /auth/* do Module A (Vũ Việt) làm; /dev/* chỉ có khi backend chạy NODE_ENV=development.
import { http } from './axiosClient';

export const authApi = {
  /** UC11. body { phone, apartmentCode?, email } → gửi OTP qua email */
  startActivation: (body) => http.post('/auth/activation/start', body),
  /** UC11. body { phone, code, password, confirmPassword, consent: 'ACCEPTED' | 'DECLINED' } */
  confirmActivation: (body) => http.post('/auth/activation/confirm', body),
  /** UC02. body { phone } → luôn trả thành công để không dò được SĐT */
  forgotPassword: (phone) => http.post('/auth/password/forgot', { phone }),
  /** UC02. body { phone, code, password, confirmPassword } */
  resetPassword: (body) => http.post('/auth/password/reset', body),
  /** UC01. body { phone, password } → { user, accessToken, refreshToken } (hợp đồng với Module A) */
  login: (body) => http.post('/auth/login', body),
  /** body { refreshToken } → { accessToken, refreshToken } */
  refresh: (refreshToken) => http.post('/auth/refresh', { refreshToken }),
  /** Thu hồi refresh token trên mọi thiết bị; không cần access token còn hạn */
  logout: (refreshToken) => http.post('/auth/logout', { refreshToken }),
  devAccounts: () => http.get('/dev/accounts'),
  devLogin: (email) => http.post('/dev/login', { email }),
};
