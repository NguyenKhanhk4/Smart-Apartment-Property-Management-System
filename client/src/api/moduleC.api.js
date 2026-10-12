// API Module C (Minh): Quỹ bảo trì, đề xuất chi quỹ, chi phí vận hành & nhật ký hoạt động.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { http } from './axiosClient';

// Ảnh chứng từ gửi multipart qua field "images" như Module D/E; không có ảnh thì gửi JSON.
const withImages = (body, files = []) => {
  if (!files.length) return body;
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => value != null && value !== '' && form.append(key, value));
  files.forEach((file) => form.append('images', file));
  return form;
};

// ===== UC-C01: Ghi nhận thu quỹ bảo trì; UC-C05: số dư & giao dịch =====
export const maintenanceFundApi = {
  list: () => http.get('/maintenance-funds'),
  transactions: (params) => http.get('/maintenance-funds/transactions', { params }),
  /** body: { amount, description, source?, fundId? | buildingId?, occurredAt? } */
  income: (body) => http.post('/maintenance-funds/incomes', body),
};

// ===== UC-C02..C04: Đề xuất, biểu quyết & chốt chi quỹ =====
export const fundProposalApi = {
  list: (params) => http.get('/fund-proposals', { params }),
  get: (id) => http.get(`/fund-proposals/${id}`),
  /** body: { title, description, amount, fundId? | buildingId? }; files: ảnh báo giá/chứng từ */
  create: (body, files) => http.post('/fund-proposals', withImages(body, files)),
  /** Board Member: body { decision: 'AGREE' | 'DISAGREE', comment? } */
  vote: (id, body) => http.post(`/fund-proposals/${id}/votes`, body),
  /** Board Chairman: body { decision: 'APPROVED' | 'REJECTED', finalNote? } */
  finalize: (id, body) => http.patch(`/fund-proposals/${id}/finalize`, body),
};

// ===== UC-C07: Chi phí vận hành (tách biệt quỹ bảo trì) =====
export const operatingExpenseApi = {
  list: (params) => http.get('/operating-expenses', { params }),
  /** body: { category, amount, month: 'YYYY-MM', description }; files: ảnh chứng từ */
  create: (body, files) => http.post('/operating-expenses', withImages(body, files)),
};

// ===== UC-C08: Tra cứu nhật ký hoạt động =====
export const auditLogApi = {
  list: (params) => http.get('/audit-logs', { params }),
};
