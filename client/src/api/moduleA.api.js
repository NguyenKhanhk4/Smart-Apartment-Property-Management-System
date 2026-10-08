// API Module A (Vũ Việt): Tài khoản, Tòa nhà, Căn hộ, Hợp đồng, Cư dân, Phương tiện, Dashboard Admin.
// Trả về nguyên envelope { success, data, pagination? } theo quy ước axiosClient.js.
import { http } from './axiosClient';

// ===== UC-A03 & UC-A04: Người dùng & Tài khoản nội bộ =====
export const usersApi = {
  me: () => http.get('/users/me'),
  updateMe: (body) => http.patch('/users/me', body),
  updateAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return http.patch('/users/me/avatar', form);
  },
  changePassword: (body) => http.patch('/users/me/password', body),
  listInternal: (params) => http.get('/users/internal', { params }),
  createInternal: (body) => http.post('/users/internal', body),
  updateInternal: (id, body) => http.patch(`/users/internal/${id}`, body),
  setStatus: (id, isActive) => http.patch(`/users/${id}/status`, { isActive }),
};
