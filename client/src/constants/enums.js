// Nhãn enum frontend khớp server, gồm cron vận hành/an ninh Module 7.
// Module nào thêm enum nghiệp vụ thì thêm vào đây theo cùng dạng { VALUE: { label, color } }.

export const ROLES = {
  RESIDENT: { label: 'Cư dân', color: 'blue' },
  STAFF: { label: 'Nhân viên', color: 'cyan' },
  ACCOUNTANT: { label: 'Kế toán', color: 'green' },
  MANAGER: { label: 'Trưởng BQL', color: 'gold' },
  BOARD: { label: 'Ban quản trị', color: 'purple' },
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
export const APARTMENT_OCCUPANCY = {
  NOT_HANDED_OVER: { label: 'Chưa bàn giao', color: '#e2e8f0' },
  VACANT: { label: 'Đang trống', color: '#ffffff' },
  OWNER_OCCUPIED: { label: 'Chủ nhà đang ở', color: '#bbf7d0' },
  RENTED: { label: 'Đang cho thuê', color: '#bfdbfe' },
  UNDER_REPAIR: { label: 'Đang sửa chữa', color: '#fef08a' },
};

export const APARTMENT_TYPES = {
  RESIDENTIAL: { label: 'Căn để ở' },
  COMMERCIAL: { label: 'Căn kinh doanh' },
};

export const APARTMENT_STATUS = {
  VACANT: { label: 'Trống', color: 'default' },
  OWNED: { label: 'Đã sở hữu', color: 'blue' },
  RENTED: { label: 'Đang cho thuê', color: 'green' },
};

export const CONTRACT_TYPES = {
  SALE: { label: 'Mua bán', color: 'blue' },
  LEASE: { label: 'Cho thuê', color: 'green' },
};

export const OWNERSHIP_DOCUMENT_TYPES = {
  DEVELOPER_SALE_CONTRACT: { label: 'Hợp đồng mua bán với chủ đầu tư', color: 'blue' },
  OWNERSHIP_CERTIFICATE: { label: 'Giấy chứng nhận quyền sở hữu', color: 'purple' },
  TRANSFER_DOCUMENT: { label: 'Giấy tờ xác nhận chuyển nhượng', color: 'blue' },
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
  MERGED: { label: 'Đã gộp vào phiếu khác', color: 'default' },
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
  QUOTE_REVISED: { label: 'Cập nhật báo giá', color: 'purple' },
  QUOTE_EXPIRED: { label: 'Báo giá quá hạn, tự đóng', color: 'gray' },
  WAITING_PARTS: { label: 'Chờ linh kiện', color: 'orange' },
  RESOLVED: { label: 'Đã xử lý xong', color: 'blue' },
  CONFIRMED: { label: 'Cư dân nghiệm thu', color: 'green' },
  REOPENED: { label: 'Cư dân chưa đồng ý', color: 'orange' },
  ESCALATED: { label: 'Hệ thống leo thang', color: 'red' },
  SLA_ALERTED: { label: 'Cảnh báo trễ hạn', color: 'red' },
  AUTO_CLOSED: { label: 'Hệ thống tự đóng', color: 'green' },
  REJECTED: { label: 'Từ chối', color: 'gray' },
  RECLASSIFIED: { label: 'Đổi phân loại', color: 'purple' },
  MERGED: { label: 'Gộp phiếu trùng', color: 'gray' },
  EMERGENCY_ACKED: { label: 'Đã tiếp nhận cảnh báo khẩn', color: 'red' },
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
  INVOICE_APPROVAL: { label: 'Duyệt thông báo phí', color: 'geekblue' },
  PAYMENT_RECEIPT: { label: 'Biên lai', color: 'green' },
  ANNOUNCEMENT: { label: 'Bảng tin', color: 'blue' },
  GUEST: { label: 'Khách', color: 'geekblue' },
  SYSTEM: { label: 'Hệ thống', color: 'default' },
};

// ===== Dùng chung cho báo cáo =====
export const FEE_CATEGORIES = {
  MANAGEMENT: { label: 'Phí quản lý', color: 'blue' },
  CLEANING: { label: 'Phí vệ sinh', color: 'green' },
  PARKING: { label: 'Phí gửi xe', color: 'blue' },
  AMENITY: { label: 'Phí tiện ích', color: 'purple' },
  ADJUSTMENT: { label: 'Điều chỉnh', color: 'gold' },
  OTHER: { label: 'Khoản thu khác', color: 'magenta' },
  REPAIR: { label: 'Sửa chữa trong căn', color: 'volcano' },
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
  NOT_HANDED_OVER: { label: 'Chưa bàn giao trong kỳ', color: 'default' },
  NO_PAYER: { label: 'Chưa có HĐ mua bán', color: 'default' },
  ERROR: { label: 'Lỗi', color: 'red' },
};

export const PAYER_SOURCES = {
  OWNER: { label: 'Chủ sở hữu', color: 'geekblue' },
  TENANT: { label: 'Người thuê', color: 'purple' },
};

export const PAYMENT_METHODS = {
  PAYOS: { label: 'payOS (VietQR)', color: 'blue' },
  CASH: { label: 'Tiền mặt', color: 'green' },
  BANK_TRANSFER: { label: 'Chuyển khoản', color: 'cyan' },
};

// Vòng đời thông báo phí (Mô đun 4): Nháp → Chờ duyệt → Đã phát hành → Thanh toán một phần → Đã thanh toán
export const INVOICE_STATUS = {
  DRAFT: { label: 'Nháp', color: 'default' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', color: 'gold' },
  UNPAID: { label: 'Chưa thanh toán', color: 'blue' },
  PARTIALLY_PAID: { label: 'Thanh toán một phần', color: 'cyan' },
  PAID: { label: 'Đã thanh toán', color: 'green' },
  OVERDUE: { label: 'Quá hạn', color: 'red' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

// ===== Quỹ bảo trì 2% (UC33, UC34) =====
export const FUND_TX_TYPES = {
  INCOME: { label: 'Thu', color: 'green' },
  EXPENSE: { label: 'Chi', color: 'red' },
};

export const VOTE_DECISIONS = {
  AGREE: { label: 'Đồng ý', color: 'green' },
  DISAGREE: { label: 'Không đồng ý', color: 'red' },
};

export const FUND_INCOME_SOURCES = {
  INITIAL_HANDOVER: { label: 'Số dư ban đầu CĐT bàn giao', color: 'blue' },
  INTEREST: { label: 'Lãi tiền gửi', color: 'cyan' },
  OTHER: { label: 'Khác', color: 'default' },
};

export const FUND_PLAN_TYPES = {
  ANNUAL_PLAN: { label: 'Kế hoạch bảo trì năm', color: 'blue' },
  UNSCHEDULED: { label: 'Bảo trì đột xuất', color: 'orange' },
};

export const FUND_PROPOSAL_STATUS = {
  PENDING: { label: 'Chờ Ban quản trị duyệt', color: 'gold' },
  APPROVED: { label: 'Đã duyệt, chờ chi', color: 'blue' },
  REJECTED: { label: 'Bị từ chối', color: 'red' },
  PAID: { label: 'Đã chi', color: 'green' },
  CANCELLED: { label: 'Đã rút', color: 'default' },
};

// Báo giá sửa chữa trong căn hộ (UC48, UC40)
export const QUOTE_STATUS = {
  PENDING: { label: 'Chờ đồng ý', color: 'gold' },
  ACCEPTED: { label: 'Đã đồng ý', color: 'green' },
  DECLINED: { label: 'Đã từ chối', color: 'red' },
  EXPIRED: { label: 'Quá hạn phản hồi', color: 'default' },
  SUPERSEDED: { label: 'Đã thay bằng bản mới', color: 'default' },
};

// Công nợ (UC31): hồ sơ nợ quá hạn của 1 Người nộp phí tại 1 căn
export const DEBT_STATUS = {
  REMINDING: { label: 'Đang nhắc nợ', color: 'orange' },
  LONG_OVERDUE: { label: 'Nợ quá hạn dài', color: 'magenta' },
  RESOLVED: { label: 'Đã trả hết', color: 'green' },
};

// Tình trạng một dòng sổ công nợ (căn + Người nộp phí), lấy mức nặng nhất
export const LEDGER_STATUS = {
  PAID: { label: 'Đã thanh toán', color: 'green' },
  UNPAID: { label: 'Chưa thanh toán', color: 'blue' },
  PARTIALLY_PAID: { label: 'Thanh toán một phần', color: 'cyan' },
  OVERDUE: { label: 'Quá hạn', color: 'red' },
  LONG_OVERDUE: { label: 'Nợ quá hạn dài', color: 'magenta' },
};

export const CONTACT_METHODS = {
  PHONE: { label: 'Gọi điện', color: 'blue' },
  SMS: { label: 'Tin nhắn', color: 'cyan' },
  EMAIL: { label: 'Email', color: 'geekblue' },
  IN_PERSON: { label: 'Gặp trực tiếp', color: 'purple' },
  LETTER: { label: 'Gửi văn bản', color: 'default' },
};

export const PREPAID_TX_TYPES = {
  DEPOSIT: { label: 'Ghi vào số dư', color: 'green' },
  APPLY: { label: 'Trừ vào thông báo phí', color: 'blue' },
  REFUND: { label: 'Hoàn tiền', color: 'orange' },
};

// Khoản điều chỉnh thông báo phí đã phát hành (M4-5)
export const ADJUSTMENT_STATUS = {
  PENDING: { label: 'Chờ vào kỳ sau', color: 'gold' },
  APPLIED: { label: 'Đã áp dụng', color: 'green' },
  CANCELLED: { label: 'Đã hủy', color: 'default' },
};

export const WORK_ORDER_STATUS = {
  PENDING: { label: 'Đến hạn', color: 'blue' }, // BR-E05: Due
  IN_PROGRESS: { label: 'Đang kiểm tra', color: 'processing' }, // Inspecting
  AWAITING_REPAIR_APPROVAL: { label: 'Chờ duyệt sửa', color: 'orange' },
  UNDER_REPAIR: { label: 'Đang sửa', color: 'volcano' },
  AWAITING_ACCEPTANCE: { label: 'Chờ nghiệm thu', color: 'gold' },
  REPAIR_POSTPONED: { label: 'Tạm hoãn sửa', color: 'purple' }, // UC10 (Q5)
  DONE: { label: 'Hoàn thành', color: 'success' },
  CLOSED: { label: 'Đã đóng', color: 'default' }, // UC10: thiết bị ngừng sử dụng
};

// UC10: quyết định với báo cáo hư hỏng
export const REPAIR_DECISIONS = {
  APPROVE: { label: 'Duyệt sửa', color: 'green' },
  POSTPONE: { label: 'Tạm hoãn', color: 'purple' },
  RETIRE: { label: 'Ngừng sử dụng thiết bị', color: 'red' },
};

export const REPAIR_COST_SOURCES = {
  OPERATING: { label: 'Chi phí vận hành', color: 'blue' },
  FUND: { label: 'Quỹ bảo trì', color: 'purple' },
};

export const WORK_ORDER_OPEN_STATUSES = ['PENDING', 'IN_PROGRESS', 'AWAITING_REPAIR_APPROVAL', 'UNDER_REPAIR', 'AWAITING_ACCEPTANCE', 'REPAIR_POSTPONED'];

export const WORK_ORDER_TYPES = {
  SCHEDULED: { label: 'Bảo trì định kỳ', color: 'geekblue' },
  TICKET_LINKED: { label: 'Theo phản ánh', color: 'orange' },
};

// ===== Module D =====
// PENDING, REJECTED: dữ liệu luồng duyệt cũ (không còn tạo mới — BR-O12). `tone` dùng cho StatusBadge ở giao diện cư dân
// Cách trả phí tiện ích có phí (cư dân chọn khi đặt)
export const BOOKING_PAYMENT_METHODS = {
  ONLINE: { label: 'Thanh toán online', color: 'blue' },
  INVOICE: { label: 'Cộng vào phí tháng', color: 'purple' },
};

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

// Kiểu tiện ích (accessMode). Bản ghi cũ không có accessMode coi là BOOKING
export const AMENITY_ACCESS_MODES = {
  FREE: { label: 'Tự do', color: 'green', hint: 'Công viên, đường dạo, sân chơi ngoài trời: không đặt chỗ, không phí, chỉ hiển thị giờ và vị trí.' },
  BOOKING: { label: 'Đặt chỗ', color: 'blue', hint: 'Sân tennis, cầu lông, khu BBQ, gym, hồ bơi: cư dân đặt theo khung giờ (slot), lễ tân hoặc bảo vệ check-in.' },
};

// Nhóm tuổi theo ngày sinh (hiển thị ở thẻ cư dân, gia đình, đặt hộ tại quầy); mốc tuổi lấy từ tham số CHILD_FREE_AGE / CHILD_ADULT_AGE
export const AGE_GROUPS = {
  CHILD_FREE: { label: 'Trẻ nhỏ', color: 'green' },
  CHILD: { label: 'Trẻ em', color: 'cyan' },
  ADULT: { label: 'Người lớn', color: 'default' },
};

export const CONSENT_ACTIONS = {
  ACCEPTED: { label: 'Đã đồng ý', color: 'success' },
  DECLINED: { label: 'Từ chối', color: 'default' },
  WITHDRAWN: { label: 'Đã rút đồng ý', color: 'warning' },
};

export const RELATION_TYPES = {
  OWNER: { label: 'Chủ sở hữu', color: 'blue' },
  TENANT: { label: 'Người thuê', color: 'geekblue' },
  FAMILY_MEMBER: { label: 'Thành viên', color: 'default' },
};

// UC08: kết quả kiểm tra định kỳ
export const WORK_ORDER_RESULTS = {
  PASSED: { label: 'Đạt', color: 'success' },
  FAULTY: { label: 'Có sự cố', color: 'error' },
};

// UC07: đơn vị chu kỳ bảo trì
export const CYCLE_UNITS = {
  DAY: { label: 'Ngày', color: 'default' },
  MONTH: { label: 'Tháng', color: 'blue' },
  QUARTER: { label: 'Quý', color: 'purple' },
};

export const ASSET_CATEGORIES = {
  ELEVATOR: { label: 'Thang máy', color: 'blue' },
  PUMP: { label: 'Máy bơm', color: 'cyan' },
  FIRE_SYSTEM: { label: 'PCCC', color: 'red' },
  OTHER: { label: 'Khác', color: 'default' },
};

// ===== Thẻ cư dân và biến động nhân khẩu (Người 2) =====
export const PARKING_CARD_STATUS = {
  PENDING_HANDOVER: { label: 'Chờ bàn giao', color: 'processing' },
  ACTIVE: { label: 'Đang hoạt động', color: 'success' },
  DISABLED_TO_COLLECT: { label: 'Cần thu hồi', color: 'warning' },
  RETURNED: { label: 'Đã thu hồi', color: 'default' },
  LOST: { label: 'Mất thẻ', color: 'error' },
};

// ===== Hệ thống =====
export const CRON_JOBS = {
  OPERATIONS_SECURITY: { label: 'Vận hành & an ninh (Module 7)' },
  INVOICE_GENERATE: { label: 'Tạo hóa đơn định kỳ', color: 'green' },
  INVOICE_OVERDUE: { label: 'Quét hóa đơn quá hạn', color: 'red' },
  BILLING_REMIND: { label: 'Nhắc tính phí / duyệt thông báo phí', color: 'gold' },
  PAYMENT_RECONCILE: { label: 'Đối soát giao dịch payOS', color: 'blue' },
  DEBT_REMIND: { label: 'Nhắc nợ quá hạn', color: 'red' },
  QUOTE_REMIND: { label: 'Nhắc / tự đóng báo giá sửa chữa', color: 'purple' },
  FUND_PROPOSAL_REMIND: { label: 'Nhắc Ban quản trị duyệt chi quỹ', color: 'purple' },
  BOOKING_COMPLETE: { label: 'Hoàn tất / không đến booking tiện ích', color: 'cyan' },
  WORK_ORDER_GENERATE: { label: 'Tạo work order bảo trì định kỳ', color: 'geekblue' },
  EQUIPMENT_WARNING: { label: 'Cảnh báo bảo trì quá hạn, sắp hết bảo hành', color: 'orange' },
  REPAIR_REVIEW: { label: 'Nhắc xem lại sửa chữa tạm hoãn', color: 'purple' },
  TICKET_ESCALATE: { label: 'Leo thang phản ánh quá hạn', color: 'orange' },
  TICKET_AUTO_CLOSE: { label: 'Tự đóng phản ánh chờ nghiệm thu', color: 'default' },
  CONTRACT_EXPIRE: { label: 'Quét hợp đồng thuê hết hạn', color: 'purple' },
  FUND_LOW_BALANCE: { label: 'Cảnh báo số dư quỹ thấp', color: 'gold' },
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
