// Mã lỗi chuẩn theo srs_final.md §5.3 (+ vài mã bổ sung ở cuối). status = HTTP status mặc định.
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'Dữ liệu đầu vào không hợp lệ' },
  UNAUTHORIZED: { status: 401, message: 'Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn' },
  FORBIDDEN_ROLE: { status: 403, message: 'Bạn không có quyền thực hiện thao tác này' },
  NOT_FOUND: { status: 404, message: 'Không tìm thấy dữ liệu' },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: 'Email hoặc mật khẩu không đúng' },
  MANAGER_ALREADY_EXISTS: { status: 409, message: 'Đã có 1 tài khoản Trưởng BQL đang hoạt động' },
  INVOICE_ALREADY_EXISTS: { status: 409, message: 'Căn hộ đã có hóa đơn cho tháng này' },
  INVOICE_ALREADY_PAID: { status: 409, message: 'Hóa đơn đã được thanh toán' },
  INVOICE_LOCKED: { status: 409, message: 'Hóa đơn đã thanh toán/hủy, không được điều chỉnh' },
  ADJUSTMENT_ALREADY_REVIEWED: {
    status: 409,
    message: 'Đề nghị điều chỉnh đã được duyệt/từ chối trước đó',
  },
  SELF_APPROVAL_FORBIDDEN: { status: 403, message: 'Người lập đề nghị không được tự duyệt' },
  PAYMENT_DUPLICATE: { status: 409, message: 'Giao dịch đã được ghi nhận trước đó' },
  FEE_TYPE_OVERLAP: { status: 409, message: 'Đơn giá cùng loại phí trùng khoảng hiệu lực' },
  DEBT_FOLLOWUP_NOT_ASSIGNED: { status: 403, message: 'Hồ sơ đòi nợ không được giao cho bạn' },
  FUND_INSUFFICIENT_BALANCE: { status: 409, message: 'Số dư quỹ bảo trì không đủ để duyệt chi' },
  PROPOSAL_ALREADY_REVIEWED: {
    status: 409,
    message: 'Đề xuất đã được duyệt hoặc từ chối trước đó',
  },
  PROPOSAL_ALREADY_VOTED: { status: 409, message: 'Bạn đã biểu quyết đề xuất này' },
  PROPOSAL_QUORUM_NOT_MET: { status: 409, message: 'Chưa đủ tỷ lệ biểu quyết để chốt' },
  BOOKING_SLOT_CONFLICT: { status: 409, message: 'Khung giờ đã đủ chỗ hoặc bị trùng lịch' },
  BOOKING_APARTMENT_OVERDUE: {
    status: 409,
    message: 'Căn hộ đang có hóa đơn quá hạn, không thể đặt tiện ích',
  },
  BOOKING_CANCEL_TOO_LATE: { status: 409, message: 'Quá mốc cho phép hủy booking' },
  VEHICLE_SLOT_FULL: { status: 409, message: 'Bãi xe đã hết chỗ' },
  RESIDENCY_DATE_OVERLAP: { status: 409, message: 'Khai báo bị trùng thời gian với khai báo khác' },
  TICKET_ALREADY_CLOSED: { status: 409, message: 'Phản ánh đã đóng, không thể cập nhật' },
  WORKORDER_DUPLICATE: {
    status: 409,
    message: 'Tài sản đang có work order chưa hoàn thành',
  },
  ASSET_NAME_EXISTS: { status: 409, message: 'Tên tài sản đã tồn tại trong tòa này' },
  ASSET_HAS_OPEN_WORKORDER: { status: 409, message: 'Tài sản còn work order chưa hoàn thành' },
  WORKORDER_INVALID_STATUS: { status: 409, message: 'Work order đã hoàn thành, không thể thao tác' },
  WORKORDER_INVALID_ASSIGNEE: {
    status: 400,
    message: 'Người được giao phải là kỹ thuật viên đang hoạt động',
  },
  AMENITY_INACTIVE: { status: 409, message: 'Tiện ích đang ngừng hoạt động' },
  AMENITY_HAS_ACTIVE_BOOKINGS: {
    status: 409,
    message: 'Tiện ích còn lượt đặt sắp tới, cần hủy các lượt đặt đó trước khi ngừng',
  },
  SERVER_ERROR: { status: 500, message: 'Lỗi hệ thống, vui lòng thử lại sau' },

  // Bổ sung ngoài SRS: lỗi trùng unique index chưa được module ánh xạ sang mã riêng
  DUPLICATE_VALUE: { status: 409, message: 'Dữ liệu bị trùng' },
  // Bản ghi vừa bị người khác sửa đồng thời (optimisticConcurrency) — tải lại rồi thao tác lại
  CONCURRENT_UPDATE: {
    status: 409,
    message: 'Dữ liệu vừa được cập nhật bởi thao tác khác, vui lòng tải lại và thử lại',
  },
});
