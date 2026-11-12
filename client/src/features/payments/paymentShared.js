// Trạng thái giao dịch thu (Payment.status) — dùng chung danh sách giao dịch và trang chi tiết
export const PAYMENT_STATUS = {
  SUCCESS: { label: 'Thành công', color: 'green' },
  PENDING: { label: 'Chờ kết quả', color: 'gold' },
  FAILED: { label: 'Thất bại', color: 'red' },
};

/** Vì sao giao dịch nằm trong danh sách Cần đối soát / chưa thu được tiền — để Kế toán biết phải làm gì */
export function reconcileHint(p) {
  if (p.status === 'PENDING') {
    return 'payOS chưa báo kết quả quá 15 phút. Bấm "Kiểm tra lại với payOS" để hỏi lại; nếu cư dân đã chuyển tiền thì đối chiếu sao kê theo mã payOS.';
  }
  if (p.status === 'FAILED') return p.note || 'Giao dịch không thành công, chưa thu tiền.';
  // SUCCESS nhưng Cần đối soát: số tiền nhận lệch số phải trả / không gạch nợ được
  return p.note || 'Đã nhận tiền nhưng số tiền không khớp với số phải trả. Đối chiếu sao kê rồi xử lý phần chênh lệch.';
}
