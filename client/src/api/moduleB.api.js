// API Module B: Phí & đơn giá, hóa đơn, thanh toán, công nợ.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { http } from './axiosClient';

// ===== UC-B01: Danh mục phí & đơn giá theo thời gian =====
export const feeTypeApi = {
  /** params: { code, feeCategory, state } */
  list: (params) => http.get('/fee-types', { params }),
  current: () => http.get('/fee-types/current'),
  /** body: { code, unitPrice, effectiveFrom: 'YYYY-MM', name?, feeCategory?, calcMethod?, vehicleType? } — mã đã có = đổi giá */
  create: (body) => http.post('/fee-types', body),
  /** body: { name?, unitPrice? } */
  update: (id, body) => http.patch(`/fee-types/${id}`, body),
  /** Ngừng thu từ kỳ effectiveTo 'YYYY-MM' */
  end: (id, effectiveTo) => http.patch(`/fee-types/${id}/end`, { effectiveTo }),
  remove: (id) => http.delete(`/fee-types/${id}`),
};

// ===== UC-B02: Sinh hóa đơn tháng =====
export const invoiceApi = {
  /** params: { period: 'YYYY-MM', apartmentId?, buildingId? } — tính thử, không ghi */
  preview: (params) => http.get('/invoices/preview', { params }),
  /** body: { period, apartmentId? } — có apartmentId: lập 1 căn; không có: chạy cả đợt */
  generate: (body) => http.post('/invoices/generate', body),
};
