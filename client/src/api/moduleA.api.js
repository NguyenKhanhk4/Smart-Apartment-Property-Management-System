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

// ===== UC-A05: Tòa nhà & Căn hộ =====
export const buildingsApi = {
  list: () => http.get('/buildings'),
  getById: (id) => http.get(`/buildings/${id}`),
  create: (body) => http.post('/buildings', body),
  update: (id, body) => http.put(`/buildings/${id}`, body),
  delete: (id) => http.delete(`/buildings/${id}`),
};

export const apartmentsApi = {
  list: (params) => http.get('/apartments', { params }),
  getById: (id) => http.get(`/apartments/${id}`),
  create: (body) => http.post('/apartments', body),
  update: (id, body) => http.put(`/apartments/${id}`, body),
  delete: (id) => http.delete(`/apartments/${id}`),
};

// ===== UC-A06: Hợp đồng =====
export const contractsApi = {
  list: (params) => http.get('/contracts', { params }),
  getById: (id) => http.get(`/contracts/${id}`),
  create: (body) => http.post('/contracts', body),
  update: (id, body) => http.patch(`/contracts/${id}`, body),
  terminate: (id) => http.patch(`/contracts/${id}/terminate`),
};

// ===== UC-A07 & UC-A08: Cư dân & Căn hộ của tôi =====
export const residentsApi = {
  listByApartment: (apartmentId) => http.get(`/apartments/${apartmentId}/residents`),
  addMember: (body) => http.post('/residents', body),
  updateMember: (id, body) => http.patch(`/residents/${id}`, body),
  removeMember: (id) => http.patch(`/residents/${id}/remove`),
  myApartments: () => http.get('/residents/me/apartments'),
};

// ===== UC-A09 & UC-A10: Phương tiện =====
export const vehicleApi = {
  listMine: (params) => http.get('/vehicles/mine', { params }),
  register: (body) => http.post('/vehicles', body),
  requestCancel: (id) => http.patch(`/vehicles/${id}/cancel-request`),
  list: (params) => http.get('/vehicles', { params }),
  approve: (id) => http.patch(`/vehicles/${id}/approve`),
  reject: (id, body) => http.patch(`/vehicles/${id}/reject`, body),
  confirmCancel: (id) => http.patch(`/vehicles/${id}/confirm-cancel`),
};
// ===== UC-A11: Dashboard thống kê hệ thống dành cho Admin =====
export const adminApi = {
  getDashboard: () => http.get('/admin/dashboard'),
};
