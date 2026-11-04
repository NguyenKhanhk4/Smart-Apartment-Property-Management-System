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

// ===== Mô đun 4: Thông báo phí (UC26 tính phí, UC27 duyệt & phát hành, UC28 xem, UC36 trả lại) =====
export const invoiceApi = {
  /** params: { period: 'YYYY-MM', apartmentId?, buildingId? } — tính thử, không ghi */
  preview: (params) => http.get('/invoices/preview', { params }),
  /** body: { period, apartmentId? } — có apartmentId: tính 1 căn; không có: cả kỳ → thông báo Nháp */
  generate: (body) => http.post('/invoices/generate', body),

  /** Quản trị — params: { page, limit, sort, period, status (CSV), buildingId, apartmentId, payerId, q }. Kèm byStatus */
  list: (params) => http.get('/invoices', { params }),
  /** Cư dân — params: { apartmentId, page, limit, status, period }. Kèm summary (còn nợ, số dư trả trước) */
  my: (params) => http.get('/invoices/my', { params }),
  get: (id) => http.get(`/invoices/${id}`),

  // Sửa Nháp (Kế toán)
  /** body: { description, amount } */
  addItem: (id, body) => http.post(`/invoices/${id}/items`, body),
  removeItem: (id, index) => http.delete(`/invoices/${id}/items/${index}`),
  recalculate: (id) => http.post(`/invoices/${id}/recalculate`),

  // Duyệt — selector: { invoiceIds: [...] } hoặc { period }
  submit: (selector) => http.post('/invoices/submit', selector),
  publish: (selector) => http.post('/invoices/publish', selector),
  /** body: { invoiceIds | period, reason } */
  returnBack: (body) => http.post('/invoices/return', body),
};

// ===== Mô đun 4: Thanh toán (UC30 thu tiền mặt / chuyển khoản, UC35 biên lai) =====
export const paymentApi = {
  /** Quản trị — params: { page, limit, sort, method (CSV), status, apartmentId, payerId, from, to, q }. Kèm totals */
  list: (params) => http.get('/payments', { params }),
  /** body: { invoiceId | apartmentId + payerId, method: CASH | BANK_TRANSFER, amount, bankRef?, note?, paidAt? } */
  recordOffline: (body) => http.post('/payments/offline', body),
  receipt: (id) => http.get(`/payments/${id}/receipt`),

  // payOS (UC29) — cư dân là Người nộp phí
  /** body: { invoiceIds } → { paymentId, orderCode, amount, checkoutUrl, qrCode, expiredAt, status } */
  payosCreate: (body) => http.post('/payments/payos/create', body),
  /** Trạng thái giao dịch (còn chờ thì server hỏi thẳng payOS) */
  payosStatus: (orderCode) => http.get(`/payments/payos/${orderCode}`),
};
