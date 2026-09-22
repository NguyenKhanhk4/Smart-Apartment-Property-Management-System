// Thông báo tiếng Việt theo errorCode (SRS mục 4.2 + DUPLICATE_VALUE).
// Chỉ dùng làm dự phòng khi backend không trả `message`; ưu tiên hiển thị `message` của backend.

export const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Dữ liệu nhập vào không hợp lệ.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  FORBIDDEN_ROLE: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  AUTH_INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  INVOICE_ALREADY_EXISTS: 'Căn hộ đã có hóa đơn của tháng này.',
  INVOICE_ALREADY_PAID: 'Hóa đơn đã được thanh toán.',
  PAYMENT_DUPLICATE: 'Giao dịch đã được ghi nhận trước đó.',
  FUND_INSUFFICIENT_BALANCE: 'Số dư quỹ bảo trì không đủ để duyệt khoản chi này.',
  PROPOSAL_ALREADY_REVIEWED: 'Đề xuất đã được duyệt hoặc từ chối trước đó.',
  BOOKING_SLOT_CONFLICT: 'Khung giờ đã đủ chỗ hoặc bị trùng lịch.',
  BOOKING_APARTMENT_OVERDUE: 'Căn hộ đang nợ quá hạn nên chưa thể đặt tiện ích.',
  VEHICLE_SLOT_FULL: 'Bãi xe đã hết chỗ.',
  RESIDENCY_DATE_OVERLAP: 'Thời gian khai báo bị chồng lấn với khai báo khác.',
  TICKET_ALREADY_CLOSED: 'Phản ánh đã đóng, không thể cập nhật.',
  WORKORDER_DUPLICATE: 'Tài sản này đang có lệnh bảo trì chưa hoàn thành.',
  DUPLICATE_VALUE: 'Dữ liệu bị trùng.',
  SERVER_ERROR: 'Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau.',
};

export const NETWORK_ERROR_MESSAGE =
  'Không kết nối được tới máy chủ. Kiểm tra mạng hoặc thử lại sau.';

export const DEFAULT_ERROR_MESSAGE = 'Đã có lỗi xảy ra, vui lòng thử lại.';
