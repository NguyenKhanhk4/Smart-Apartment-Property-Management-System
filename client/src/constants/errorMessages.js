// Thông báo tiếng Việt theo errorCode (srs_final.md §5.3 + DUPLICATE_VALUE).
// Chỉ dùng làm dự phòng khi backend không trả `message`; ưu tiên hiển thị `message` của backend.

export const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Dữ liệu nhập vào không hợp lệ.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  FORBIDDEN_ROLE: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  AUTH_INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  MANAGER_ALREADY_EXISTS: 'Đã có 1 tài khoản Trưởng BQL đang hoạt động.',
  INVOICE_ALREADY_EXISTS: 'Căn hộ đã có hóa đơn của tháng này.',
  INVOICE_ALREADY_PAID: 'Hóa đơn đã được thanh toán.',
  INVOICE_LOCKED: 'Hóa đơn đã thanh toán/hủy, không được điều chỉnh.',
  ADJUSTMENT_ALREADY_REVIEWED: 'Đề nghị điều chỉnh đã được duyệt/từ chối trước đó.',
  SELF_APPROVAL_FORBIDDEN: 'Người lập đề nghị không được tự duyệt.',
  FEE_TYPE_OVERLAP: 'Đơn giá cùng loại phí trùng khoảng hiệu lực.',
  DEBT_FOLLOWUP_NOT_ASSIGNED: 'Hồ sơ đòi nợ không được giao cho bạn.',
  PROPOSAL_ALREADY_VOTED: 'Bạn đã biểu quyết đề xuất này.',
  PROPOSAL_QUORUM_NOT_MET: 'Chưa đủ tỷ lệ biểu quyết để chốt.',
  BOOKING_CANCEL_TOO_LATE: 'Đã quá mốc cho phép hủy đặt tiện ích.',
  PAYMENT_DUPLICATE: 'Giao dịch đã được ghi nhận trước đó.',
  FUND_INSUFFICIENT_BALANCE: 'Số dư quỹ bảo trì không đủ để duyệt khoản chi này.',
  PROPOSAL_ALREADY_REVIEWED: 'Đề xuất đã được duyệt hoặc từ chối trước đó.',
  BOOKING_SLOT_CONFLICT: 'Khung giờ đã đủ chỗ hoặc bị trùng lịch.',
  BOOKING_APARTMENT_OVERDUE: 'Căn hộ đang nợ quá hạn nên chưa thể đặt tiện ích.',
  VEHICLE_SLOT_FULL: 'Bãi xe đã hết chỗ.',
  RESIDENCY_DATE_OVERLAP: 'Thời gian khai báo bị chồng lấn với khai báo khác.',
  TICKET_ALREADY_CLOSED: 'Phản ánh đã đóng, không thể cập nhật.',
  WORKORDER_DUPLICATE: 'Tài sản này đang có lệnh bảo trì chưa hoàn thành.',
  ASSET_NAME_EXISTS: 'Tên tài sản đã tồn tại trong tòa này.',
  ASSET_HAS_OPEN_WORKORDER: 'Tài sản còn work order chưa hoàn thành.',
  AMENITY_INACTIVE: 'Tiện ích đang ngừng hoạt động.',
  AMENITY_HAS_ACTIVE_BOOKINGS: 'Tiện ích còn lượt đặt sắp tới, cần hủy các lượt đặt đó trước khi ngừng.',
  MEMBER_CODE_NOT_FOUND: 'Không tìm thấy mã cư dân hoặc mã đã hết hiệu lực.',
  HOUSEHOLD_HEAD_REQUIRED: 'Chỉ chủ hộ mới thực hiện được thao tác này.',
  PASS_NOT_REQUIRED: 'Trẻ nhỏ được miễn phí nên không cần mua gói tháng.',
  PASS_NOT_SOLD: 'Tiện ích này không bán gói tháng.',
  PASS_ALREADY_EXISTS: 'Người này đã có gói tháng của tiện ích này trong tháng đã chọn.',
  PASS_ALREADY_BILLED: 'Gói tháng đã được gộp vào hóa đơn, không thể hủy.',
  PASS_ALREADY_CANCELLED: 'Gói tháng đã được hủy trước đó.',
  PASS_CANCEL_NOT_ALLOWED: 'Chủ hộ chỉ hủy được gói của tháng sau; gói của tháng này vui lòng liên hệ Trưởng BQL.',
  WORKORDER_INVALID_STATUS: 'Work order đã hoàn thành, không thể thao tác.',
  WORKORDER_INVALID_ASSIGNEE: 'Người được giao phải là kỹ thuật viên đang hoạt động.',
  DUPLICATE_VALUE: 'Dữ liệu bị trùng.',
  CONCURRENT_UPDATE: 'Dữ liệu vừa được người khác cập nhật, vui lòng tải lại trang.',
  SERVER_ERROR: 'Có lỗi xảy ra phía máy chủ, vui lòng thử lại sau.',
};

export const NETWORK_ERROR_MESSAGE =
  'Không kết nối được tới máy chủ. Kiểm tra mạng hoặc thử lại sau.';

export const DEFAULT_ERROR_MESSAGE = 'Đã có lỗi xảy ra, vui lòng thử lại.';
