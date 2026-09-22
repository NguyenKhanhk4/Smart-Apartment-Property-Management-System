// Mã lỗi chuẩn theo SRS 4.2 (+ vài mã bổ sung ở cuối). status = HTTP status mặc định.
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'Dữ liệu đầu vào không hợp lệ' },
  UNAUTHORIZED: { status: 401, message: 'Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn' },
  FORBIDDEN_ROLE: { status: 403, message: 'Bạn không có quyền thực hiện thao tác này' },
  NOT_FOUND: { status: 404, message: 'Không tìm thấy dữ liệu' },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: 'Email hoặc mật khẩu không đúng' },
  INVOICE_ALREADY_EXISTS: { status: 409, message: 'Căn hộ đã có hóa đơn cho tháng này' },
  INVOICE_ALREADY_PAID: { status: 409, message: 'Hóa đơn đã được thanh toán' },
  PAYMENT_DUPLICATE: { status: 409, message: 'Giao dịch đã được ghi nhận trước đó' },
  FUND_INSUFFICIENT_BALANCE: { status: 409, message: 'Số dư quỹ bảo trì không đủ để duyệt chi' },
  PROPOSAL_ALREADY_REVIEWED: {
    status: 409,
    message: 'Đề xuất đã được duyệt hoặc từ chối trước đó',
  },
  BOOKING_SLOT_CONFLICT: { status: 409, message: 'Khung giờ đã đủ chỗ hoặc bị trùng lịch' },
  BOOKING_APARTMENT_OVERDUE: {
    status: 409,
    message: 'Căn hộ đang có hóa đơn quá hạn, không thể đặt tiện ích',
  },
  VEHICLE_SLOT_FULL: { status: 409, message: 'Bãi xe đã hết chỗ' },
  RESIDENCY_DATE_OVERLAP: { status: 409, message: 'Khai báo bị trùng thời gian với khai báo khác' },
  TICKET_ALREADY_CLOSED: { status: 409, message: 'Phản ánh đã đóng, không thể cập nhật' },
  WORKORDER_DUPLICATE: {
    status: 409,
    message: 'Tài sản đang có work order chưa hoàn thành',
  },
  SERVER_ERROR: { status: 500, message: 'Lỗi hệ thống, vui lòng thử lại sau' },

  // Bổ sung ngoài SRS: lỗi trùng unique index chưa được module ánh xạ sang mã riêng
  DUPLICATE_VALUE: { status: 409, message: 'Dữ liệu bị trùng' },
});
