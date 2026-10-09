// Module C — Minh. Giữ nguyên envelope { success, data, pagination? } theo axiosClient.
import { http } from './axiosClient';

// Dùng cùng field images và multipart như Module D/E; không tự đặt Content-Type/boundary.
const withImages = (body, files = []) => {
  if (!files.length) return body;
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => value != null && value !== '' && form.append(key, value));
  files.forEach((file) => form.append('images', file));
  return form;
};
export const maintenanceFundApi = {
  list: () => http.get('/maintenance-funds'),
  transactions: (params) => http.get('/maintenance-funds/transactions', { params }),
  income: (body) => http.post('/maintenance-funds/incomes', body),
};
export const fundProposalApi = {
  list: (params) => http.get('/fund-proposals', { params }),
  get: (id) => http.get(`/fund-proposals/${id}`),
  create: (body, files) => http.post('/fund-proposals', withImages(body, files)),
  vote: (id, body) => http.post(`/fund-proposals/${id}/votes`, body),
  finalize: (id, body) => http.patch(`/fund-proposals/${id}/finalize`, body),
};
export const operatingExpenseApi = {
  list: (params) => http.get('/operating-expenses', { params }),
  create: (body, files) => http.post('/operating-expenses', withImages(body, files)),
};
export const auditLogApi = { list: (params) => http.get('/audit-logs', { params }) };
