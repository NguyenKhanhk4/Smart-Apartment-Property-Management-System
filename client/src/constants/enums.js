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
  ASSIGNED: { label: 'Đã phân công', color: 'cyan' },
  IN_PROGRESS: { label: 'Đang xử lý', color: 'processing' },
  WAITING_CONFIRM: { label: 'Chờ xác nhận', color: 'gold' },
  CLOSED: { label: 'Đã đóng', color: 'success' },
  REJECTED: { label: 'Từ chối', color: 'default' },
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

export const WORK_ORDER_TYPES = {
  SCHEDULED: { label: 'Bảo trì định kỳ', color: 'geekblue' },
  TICKET_LINKED: { label: 'Theo phản ánh', color: 'orange' },
};

// ===== Module D =====
// PENDING, REJECTED: dữ liệu luồng duyệt cũ (không còn tạo mới — BR-O12)
export const BOOKING_STATUS = {
  APPROVED: { label: 'Đã xác nhận', color: 'blue' },
  CHECKED_IN: { label: 'Đã check-in', color: 'processing' },
  COMPLETED: { label: 'Hoàn tất', color: 'success' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
  NO_SHOW: { label: 'Không đến', color: 'warning' },
  PENDING: { label: 'Chờ duyệt', color: 'gold' },
  REJECTED: { label: 'Từ chối', color: 'red' },
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

// Dùng cho <Select options={enumOptions(ROLES)} />
export const enumOptions = (enumObj) =>
  Object.entries(enumObj).map(([value, { label }]) => ({ value, label }));

/** Nhãn hiển thị role của user: chức danh nếu có, không thì role */
export const roleLabelOf = (user) =>
  (user?.roleTitle && ROLE_TITLES[user.roleTitle]) ||
  (user?.boardTitle && BOARD_TITLES[user.boardTitle]) ||
  ROLES[user?.role];
