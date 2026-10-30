// Nhãn tiếng Việt + màu antd Tag cho enum. Key phải khớp server/src/constants/enums.js.
// Module nào thêm enum nghiệp vụ thì thêm vào đây theo cùng dạng { VALUE: { label, color } }.

export const ROLES = {
  RESIDENT: { label: 'Cư dân', color: 'blue' },
  STAFF: { label: 'Nhân viên', color: 'cyan' },
  ACCOUNTANT: { label: 'Kế toán', color: 'green' },
  MANAGER: { label: 'Trưởng BQL', color: 'gold' },
  BOARD: { label: 'Ban quản trị', color: 'purple' },
  ADMIN: { label: 'Quản trị viên', color: 'red' },
};

export const ROLE_TITLES = {
  RECEPTIONIST: { label: 'Lễ tân', color: 'geekblue' },
  SECURITY: { label: 'Bảo vệ', color: 'volcano' },
  TECHNICIAN: { label: 'Kỹ thuật viên', color: 'orange' },
};

export const BOARD_TITLES = {
  CHAIRMAN: { label: 'Trưởng BQT', color: 'magenta' },
  MEMBER: { label: 'Thành viên BQT', color: 'purple' },
};

// ===== Module A =====
export const APARTMENT_STATUS = {
  VACANT: { label: 'Trống', color: 'default' },
  OWNED: { label: 'Đã sở hữu', color: 'blue' },
  RENTED: { label: 'Đang cho thuê', color: 'green' },
};

export const CONTRACT_TYPES = {
  SALE: { label: 'Mua bán', color: 'blue' },
  LEASE: { label: 'Cho thuê', color: 'green' },
};

export const CONTRACT_STATUS = {
  ACTIVE: { label: 'Đang hiệu lực', color: 'green' },
  EXPIRED: { label: 'Hết hạn', color: 'default' },
  TERMINATED: { label: 'Đã chấm dứt', color: 'red' },
};

export const VEHICLE_TYPES = {
  BICYCLE: { label: 'Xe đạp', color: 'green' },
  MOTORBIKE: { label: 'Xe máy', color: 'blue' },
  CAR: { label: 'Ô tô', color: 'purple' },
};

export const VEHICLE_STATUS = {
  PENDING: { label: 'Chờ duyệt', color: 'gold' },
  APPROVED: { label: 'Đã duyệt', color: 'green' },
  REJECTED: { label: 'Từ chối', color: 'red' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

// ===== Module E =====
export const PRIORITIES = {
  LOW: { label: 'Thấp', color: 'default' },
  MEDIUM: { label: 'Thường', color: 'blue' },
  HIGH: { label: 'Cao', color: 'orange' },
  URGENT: { label: 'Khẩn cấp', color: 'red' },
};

export const TICKET_STATUS = {
  NEW: { label: 'Mới', color: 'blue' },
  ASSIGNED: { label: 'Đã nhận', color: 'cyan' },
  WAITING_QUOTE_APPROVAL: { label: 'Chờ đồng ý phí', color: 'purple' },
  IN_PROGRESS: { label: 'Đang xử lý', color: 'processing' },
  WAITING_PARTS: { label: 'Chờ linh kiện', color: 'orange' },
  WAITING_CONFIRM: { label: 'Chờ nghiệm thu', color: 'gold' },
  CLOSED: { label: 'Đã nghiệm thu', color: 'success' },
  REJECTED: { label: 'Từ chối', color: 'default' },
};

// Nhóm trạng thái — giống hệt server/src/constants/enums.js (test enumParity kiểm tra). Không tự liệt kê ở từng trang.
// Đang mở = chưa xử lý xong; WAITING_CONFIRM (chờ nghiệm thu) và nhóm kết thúc nằm ngoài.
export const TICKET_OPEN_STATUSES = ['NEW', 'ASSIGNED', 'WAITING_QUOTE_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS'];
export const TICKET_FINAL_STATUSES = ['CLOSED', 'REJECTED'];

// Lịch sử xử lý ticket
export const TICKET_HISTORY_ACTIONS = {
  CREATED: { label: 'Tạo phản ánh', color: 'blue' },
  ASSIGNED: { label: 'Phân công', color: 'blue' },
  REASSIGNED: { label: 'Phân công lại', color: 'blue' },
  CLAIMED: { label: 'Kỹ thuật viên nhận', color: 'blue' },
  PROGRESS: { label: 'Cập nhật tiến độ', color: 'blue' },
  QUOTE_REQUESTED: { label: 'Gửi báo giá', color: 'purple' },
  QUOTE_ACCEPTED: { label: 'Cư dân đồng ý phí', color: 'green' },
  QUOTE_DECLINED: { label: 'Cư dân từ chối phí', color: 'gray' },
  WAITING_PARTS: { label: 'Chờ linh kiện', color: 'orange' },
  RESOLVED: { label: 'Đã xử lý xong', color: 'blue' },
  CONFIRMED: { label: 'Cư dân nghiệm thu', color: 'green' },
  REOPENED: { label: 'Cư dân chưa đồng ý', color: 'orange' },
  ESCALATED: { label: 'Hệ thống leo thang', color: 'red' },
  SLA_ALERTED: { label: 'Cảnh báo trễ hạn', color: 'red' },
  AUTO_CLOSED: { label: 'Hệ thống tự đóng', color: 'green' },
  REJECTED: { label: 'Từ chối', color: 'gray' },
};

// ===== Sự cố & tiện ích (Người 4) =====
export const TICKET_TYPES = {
  INCIDENT: { label: 'Sự cố kỹ thuật', color: 'volcano' },
  COMPLAINT: { label: 'Phản ánh', color: 'geekblue' },
};

export const TICKET_SCOPES = {
  COMMON_AREA: { label: 'Khu vực chung', color: 'default' },
  IN_APARTMENT: { label: 'Trong căn hộ', color: 'magenta' },
};

export const DUTY_ROLE_TITLES = {
  TECHNICIAN: { label: 'Kỹ thuật viên', color: 'orange' },
  SECURITY: { label: 'Bảo vệ', color: 'volcano' },
};

export const GUEST_STATUS = {
  EXPECTED: { label: 'Chờ đến', color: 'blue' },
  CHECKED_IN: { label: 'Đang ở trong', color: 'green' },
  CHECKED_OUT: { label: 'Đã rời', color: 'default' },
};

export const ANNOUNCEMENT_SCOPES = {
  ALL: { label: 'Toàn khu', color: 'blue' },
  BUILDING: { label: 'Theo tòa', color: 'purple' },
  APARTMENT: { label: 'Theo căn hộ', color: 'cyan' },
};

export const NOTIFICATION_TYPES = {
  INVOICE: { label: 'Hóa đơn', color: 'green' },
  DEBT_REMINDER: { label: 'Nhắc nợ', color: 'red' },
  TICKET: { label: 'Phản ánh', color: 'orange' },
  BOOKING: { label: 'Tiện ích', color: 'cyan' },
  MAINTENANCE: { label: 'Bảo trì', color: 'volcano' },
  FUND_APPROVAL: { label: 'Quỹ bảo trì', color: 'purple' },
  INVOICE_ADJUSTMENT: { label: 'Điều chỉnh HĐ', color: 'gold' },
  ANNOUNCEMENT: { label: 'Bảng tin', color: 'blue' },
  GUEST: { label: 'Khách', color: 'geekblue' },
  SYSTEM: { label: 'Hệ thống', color: 'default' },
};

// ===== Dùng chung cho báo cáo =====
export const FEE_CATEGORIES = {
  CLEANING: { label: 'Phí vệ sinh', color: 'green' },
  PARKING: { label: 'Phí gửi xe', color: 'blue' },
  AMENITY: { label: 'Phí tiện ích', color: 'purple' },
  ADJUSTMENT: { label: 'Điều chỉnh', color: 'gold' },
};

// ===== Module B — Phí & đơn giá (UC-B01) =====
export const FEE_CALC_METHODS = {
  PER_M2: { label: 'Theo m²', color: 'green', unit: 'm²' },
  PER_APARTMENT: { label: 'Theo căn', color: 'cyan', unit: 'căn' },
  PER_VEHICLE: { label: 'Theo xe', color: 'blue', unit: 'xe' },
};

export const FEE_TYPE_STATES = {
  ACTIVE: { label: 'Đang áp dụng', color: 'green' },
  UPCOMING: { label: 'Sắp áp dụng', color: 'gold' },
  ENDED: { label: 'Đã kết thúc', color: 'default' },
};

// Kết quả xem trước khi sinh hóa đơn (UC-B02)
export const INVOICE_PREVIEW_STATUS = {
  NEW: { label: 'Sẽ lập', color: 'blue' },
  EXISTS: { label: 'Đã có hóa đơn', color: 'green' },
  NO_PAYER: { label: 'Chưa có HĐ mua bán', color: 'default' },
  ERROR: { label: 'Lỗi', color: 'red' },
};

export const PAYER_SOURCES = {
  OWNER: { label: 'Chủ sở hữu', color: 'geekblue' },
  TENANT: { label: 'Người thuê', color: 'purple' },
};

export const PAYMENT_METHODS = {
  VNPAY: { label: 'VNPay', color: 'blue' },
  CASH: { label: 'Tiền mặt', color: 'green' },
  BANK_TRANSFER: { label: 'Chuyển khoản', color: 'cyan' },
};

export const INVOICE_STATUS = {
  UNPAID: { label: 'Chưa thanh toán', color: 'blue' },
  PAID: { label: 'Đã thanh toán', color: 'green' },
  OVERDUE: { label: 'Quá hạn', color: 'red' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

export const WORK_ORDER_STATUS = {
  PENDING: { label: 'Chờ xử lý', color: 'blue' },
  IN_PROGRESS: { label: 'Đang xử lý', color: 'processing' },
  DONE: { label: 'Hoàn thành', color: 'success' },
};

export const WORK_ORDER_OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];

export const WORK_ORDER_TYPES = {
  SCHEDULED: { label: 'Bảo trì định kỳ', color: 'geekblue' },
  TICKET_LINKED: { label: 'Theo phản ánh', color: 'orange' },
};

// ===== Module D =====
// PENDING, REJECTED: dữ liệu luồng duyệt cũ (không còn tạo mới — BR-O12). `tone` dùng cho StatusBadge ở giao diện cư dân
export const BOOKING_STATUS = {
  PENDING_PAYMENT: { label: 'Chờ thanh toán', color: 'gold', tone: 'warn' },
  APPROVED: { label: 'Đã xác nhận', color: 'blue', tone: 'ok' },
  CHECKED_IN: { label: 'Đã check-in', color: 'processing', tone: 'info' },
  COMPLETED: { label: 'Đã dùng', color: 'success', tone: 'neutral' },
  CANCELLED: { label: 'Đã hủy', color: 'default', tone: 'neutral' },
  NO_SHOW: { label: 'Không đến', color: 'warning', tone: 'warn' },
  PENDING: { label: 'Chờ duyệt (cũ)', color: 'default', tone: 'neutral' },
  REJECTED: { label: 'Từ chối (cũ)', color: 'default', tone: 'neutral' },
};
// Booking đang chiếm slot; PENDING / REJECTED là dữ liệu luồng duyệt cũ, không đưa vào ô chọn / báo cáo
export const BOOKING_ACTIVE_STATUSES = ['PENDING_PAYMENT', 'APPROVED', 'CHECKED_IN'];
export const BOOKING_LEGACY_STATUSES = ['PENDING', 'REJECTED'];

// Lượt vào tiện ích WALK_IN (UC-D10)
export const VISIT_CHARGE_TYPES = {
  PASS: { label: 'Gói tháng', color: 'cyan' },
  SINGLE: { label: 'Vé lẻ', color: 'blue' },
  FREE: { label: 'Miễn phí', color: 'green' },
};
export const VISIT_STATUS = {
  VALID: { label: 'Hợp lệ', color: 'success' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

// Kiểu tiện ích (accessMode). Bản ghi cũ không có accessMode coi là BOOKING
export const AMENITY_ACCESS_MODES = {
  FREE: { label: 'Tự do', color: 'green', hint: 'Công viên, đường dạo, sân chơi ngoài trời: không đặt chỗ, không phí, chỉ hiển thị giờ và vị trí.' },
  WALK_IN: { label: 'Vào cửa', color: 'cyan', hint: 'Gym, yoga, hồ bơi: cư dân đến thẳng, lễ tân tra mã; vào bằng gói tháng, vé lẻ hoặc miễn phí (trẻ nhỏ).' },
  BOOKING: { label: 'Đặt chỗ', color: 'blue', hint: 'Sân tennis, cầu lông, khu BBQ: cư dân đặt slot độc quyền, lễ tân hoặc bảo vệ check-in.' },
};

// Nhóm tuổi tính giá tiện ích (BR-O24); mốc tuổi lấy từ tham số CHILD_FREE_AGE / CHILD_ADULT_AGE
export const AGE_GROUPS = {
  CHILD_FREE: { label: 'Trẻ nhỏ (miễn phí)', color: 'green' },
  CHILD: { label: 'Trẻ em', color: 'cyan' },
  ADULT: { label: 'Người lớn', color: 'default' },
};

export const RELATION_TYPES = {
  OWNER: { label: 'Chủ sở hữu', color: 'blue' },
  TENANT: { label: 'Người thuê', color: 'geekblue' },
  FAMILY_MEMBER: { label: 'Thành viên', color: 'default' },
};

export const AMENITY_PASS_STATUS = {
  ACTIVE: { label: 'Đang hiệu lực', color: 'green' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

export const ASSET_CATEGORIES = {
  ELEVATOR: { label: 'Thang máy', color: 'blue' },
  PUMP: { label: 'Máy bơm', color: 'cyan' },
  FIRE_SYSTEM: { label: 'PCCC', color: 'red' },
  OTHER: { label: 'Khác', color: 'default' },
};

// ===== Gate Pass, thẻ gửi xe, biến động nhân khẩu (Người 2) =====
export const GATE_PASS_DIRECTIONS = {
  IN: { label: 'Chuyển đồ vào (IN)', color: 'blue' },
  OUT: { label: 'Chuyển đồ ra (OUT)', color: 'volcano' },
};

export const GATE_PASS_STATUS = {
  AWAITING_OWNER: { label: 'Chờ chủ hộ xác nhận', color: 'gold' },
  PENDING: { label: 'Chờ BQL duyệt', color: 'processing' },
  APPROVED: { label: 'Đã duyệt', color: 'success' },
  USED: { label: 'Đã qua cổng', color: 'cyan' },
  REJECTED: { label: 'Từ chối', color: 'error' },
  EXPIRED: { label: 'Hết hạn', color: 'default' },
};

export const PLATE_LOOKUP_RESULTS = {
  REGISTERED_VEHICLE: { label: 'Xe đã đăng ký', color: 'success' },
  MATCHES_GATE_PASS: { label: 'Khớp Gate Pass hôm nay', color: 'processing' },
  UNKNOWN: { label: 'Không có trong hệ thống', color: 'error' },
};

export const PARKING_CARD_STATUS = {
  ACTIVE: { label: 'Đang hoạt động', color: 'success' },
  DISABLED_TO_COLLECT: { label: 'Cần thu hồi', color: 'warning' },
  RETURNED: { label: 'Đã thu hồi', color: 'default' },
  LOST: { label: 'Mất thẻ', color: 'error' },
};

export const OCCUPANT_CHANGE_TYPES = {
  MOVE_IN: { label: 'Vào ở', color: 'green' },
  MOVE_OUT: { label: 'Chuyển đi', color: 'volcano' },
};

// ===== Hệ thống =====
export const CRON_JOBS = {
  INVOICE_GENERATE: { label: 'Tạo hóa đơn định kỳ', color: 'green' },
  INVOICE_OVERDUE: { label: 'Quét hóa đơn quá hạn', color: 'red' },
  BOOKING_COMPLETE: { label: 'Hoàn tất / không đến booking tiện ích', color: 'cyan' },
  WORK_ORDER_GENERATE: { label: 'Tạo work order bảo trì định kỳ', color: 'geekblue' },
  TICKET_ESCALATE: { label: 'Leo thang phản ánh quá hạn', color: 'orange' },
  TICKET_AUTO_CLOSE: { label: 'Tự đóng phản ánh chờ nghiệm thu', color: 'default' },
  CONTRACT_EXPIRE: { label: 'Quét hợp đồng thuê hết hạn', color: 'purple' },
  FUND_LOW_BALANCE: { label: 'Cảnh báo số dư quỹ thấp', color: 'gold' },
  GATE_PASS_EXPIRE: { label: 'Hết hạn Gate Pass', color: 'default' },
  CONTRACT_EXPIRY_REMIND: { label: 'Nhắc hợp đồng thuê sắp hết hạn', color: 'purple' },
  TICKET_SLA_ALERT: { label: 'Cảnh báo SLA sự cố / phản ánh', color: 'red' },
  BOOKING_HOLD_EXPIRE: { label: 'Hủy giữ chỗ quá hạn thanh toán', color: 'default' },
};

// Dùng cho <Select options={enumOptions(ROLES)} />
export const enumOptions = (enumObj) =>
  Object.entries(enumObj).map(([value, { label }]) => ({ value, label }));

/** Nhãn hiển thị role của user: chức danh nếu có, không thì role */
export const roleLabelOf = (user) =>
  (user?.roleTitle && ROLE_TITLES[user.roleTitle]) ||
  (user?.boardTitle && BOARD_TITLES[user.boardTitle]) ||
  ROLES[user?.role];
