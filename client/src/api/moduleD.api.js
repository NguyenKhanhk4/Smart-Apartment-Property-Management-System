// API Module D (Thanh Bình): Tài sản & bảo trì, Tiện ích & đặt chỗ.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { http } from './axiosClient';

// ===== UC-D01: Tài sản =====
export const assetApi = {
  list: (params) => http.get('/assets', { params }),
  get: (id) => http.get(`/assets/${id}`),
  history: (id, params) => http.get(`/assets/${id}/history`, { params }),
  create: (body) => http.post('/assets', body),
  update: (id, body) => http.put(`/assets/${id}`, body),
  setStatus: (id, isActive) => http.patch(`/assets/${id}/status`, { isActive }),
};
