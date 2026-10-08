// Enum dùng chung toàn hệ thống — khớp srs_final.md §III.2.2 (Table Descriptions).
// Client có bản nhãn tiếng Việt tương ứng ở client/src/constants/enums.js.

export const values = (enumObj) => Object.values(enumObj);

// ===== Tài khoản & phân quyền (Module A) =====
export const ROLES = Object.freeze({
  RESIDENT: 'RESIDENT',
  STAFF: 'STAFF',
  ACCOUNTANT: 'ACCOUNTANT',
  MANAGER: 'MANAGER',
  BOARD: 'BOARD',
  ADMIN: 'ADMIN',
});

// Chức danh của STAFF
export const ROLE_TITLES = Object.freeze({
  RECEPTIONIST: 'RECEPTIONIST',
  SECURITY: 'SECURITY',
  TECHNICIAN: 'TECHNICIAN',
});

// Chức danh của BOARD (BR-R2: đúng 1 CHAIRMAN đang hoạt động)
export const BOARD_TITLES = Object.freeze({
  CHAIRMAN: 'CHAIRMAN',
  MEMBER: 'MEMBER',
});

// ===== Tòa nhà, căn hộ, hợp đồng, cư dân, xe (Module A) =====
export const APARTMENT_STATUS = Object.freeze({
  VACANT: 'VACANT',
  OWNED: 'OWNED',
  RENTED: 'RENTED',
});

export const CONTRACT_TYPES = Object.freeze({ SALE: 'SALE', LEASE: 'LEASE' });

export const CONTRACT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
});

export const RELATION_TYPES = Object.freeze({
  OWNER: 'OWNER',
  TENANT: 'TENANT',
  FAMILY_MEMBER: 'FAMILY_MEMBER',
});

export const VEHICLE_TYPES = Object.freeze({
  BICYCLE: 'BICYCLE',
  MOTORBIKE: 'MOTORBIKE',
  CAR: 'CAR',
});

export const VEHICLE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

// ===== Phí, hóa đơn, thanh toán, công nợ (Module B) =====
// Nhóm phí trên hóa đơn (BR-F1)
export const FEE_CATEGORIES = Object.freeze({
  CLEANING: 'CLEANING',
  PARKING: 'PARKING',
  AMENITY: 'AMENITY',
  ADJUSTMENT: 'ADJUSTMENT',
});

// Cách tính đơn giá của fee_types (BR-F4)
export const FEE_CALC_METHODS = Object.freeze({
  PER_M2: 'PER_M2',
  PER_APARTMENT: 'PER_APARTMENT',
  PER_VEHICLE: 'PER_VEHICLE',
});

export const INVOICE_STATUS = Object.freeze({
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
});

export const GENERATED_BY = Object.freeze({ CRON: 'CRON', MANUAL: 'MANUAL' });

export const PAYMENT_METHODS = Object.freeze({
  VNPAY: 'VNPAY',
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

export const ADJUSTMENT_TYPES = Object.freeze({ ADJUST: 'ADJUST', CANCEL: 'CANCEL' });

// Dùng chung cho các yêu cầu cần duyệt (điều chỉnh hóa đơn, đề xuất chi quỹ)
export const REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

export const DEBT_STATUS = Object.freeze({ OPEN: 'OPEN', RESOLVED: 'RESOLVED' });

export const CONTACT_METHODS = Object.freeze({
  PHONE: 'PHONE',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  IN_PERSON: 'IN_PERSON',
});

// ===== Quỹ bảo trì, chi phí vận hành (Module C) =====
export const FUND_TX_TYPES = Object.freeze({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' });

export const VOTE_DECISIONS = Object.freeze({ AGREE: 'AGREE', DISAGREE: 'DISAGREE' });

export const EXPENSE_CATEGORIES = Object.freeze({
  SALARY: 'SALARY',
  COMMON_UTILITY: 'COMMON_UTILITY',
  OUTSOURCED_SERVICE: 'OUTSOURCED_SERVICE',
  OTHER: 'OTHER',
});

// ===== Tài sản, bảo trì, tiện ích (Module D) =====
export const ASSET_CATEGORIES = Object.freeze({
  ELEVATOR: 'ELEVATOR',
  PUMP: 'PUMP',
  FIRE_SYSTEM: 'FIRE_SYSTEM',
  OTHER: 'OTHER',
});

export const WORK_ORDER_TYPES = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  TICKET_LINKED: 'TICKET_LINKED',
});

export const WORK_ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
});

// BR-O12: booking tự xác nhận APPROVED khi đặt → CHECKED_IN (lễ tân) → COMPLETED (hết giờ, tính phí BR-O5);
// hoặc CANCELLED / NO_SHOW (không tính phí).
// PENDING, REJECTED: luồng duyệt cũ, Module D KHÔNG còn tạo mới — giữ để dữ liệu & báo cáo UC-E14 cũ không lỗi.
export const BOOKING_STATUS = Object.freeze({
  APPROVED: 'APPROVED',
  CHECKED_IN: 'CHECKED_IN',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
});

// Kiểu tiện ích (BR-O15, BR-O22..O24): FREE = đi vào tự do, không đặt/không phí; WALK_IN = đến thẳng, lễ tân tra mã
// (gói tháng / vé lẻ / miễn phí trẻ nhỏ); BOOKING = đặt slot độc quyền. Bản ghi cũ không có accessMode coi là BOOKING.
export const AMENITY_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  WALK_IN: 'WALK_IN',
  BOOKING: 'BOOKING',
});

// Nhóm tuổi tính giá (BR-O24)
export const AGE_GROUPS = Object.freeze({
  CHILD_FREE: 'CHILD_FREE',
  CHILD: 'CHILD',
  ADULT: 'ADULT',
});

// Gói tháng tiện ích (UC-D09, BR-O22): theo người, theo tháng dương lịch, hiệu lực ngay khi mua
export const AMENITY_PASS_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
});

// ===== Ticket, sổ khách, bảng tin, thông báo (Module E) =====
// Thứ tự trong mảng = thứ tự leo thang (BR-O8)
export const PRIORITIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});
export const PRIORITY_ORDER = Object.freeze([
  PRIORITIES.LOW,
  PRIORITIES.MEDIUM,
  PRIORITIES.HIGH,
  PRIORITIES.URGENT,
]);

export const TICKET_STATUS = Object.freeze({
  NEW: 'NEW',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_CONFIRM: 'WAITING_CONFIRM',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
});

export const GUEST_STATUS = Object.freeze({
  EXPECTED: 'EXPECTED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
});

export const ANNOUNCEMENT_SCOPES = Object.freeze({
  ALL: 'ALL',
  BUILDING: 'BUILDING',
  APARTMENT: 'APARTMENT',
});

export const NOTIFICATION_TYPES = Object.freeze({
  INVOICE: 'INVOICE',
  DEBT_REMINDER: 'DEBT_REMINDER',
  TICKET: 'TICKET',
  BOOKING: 'BOOKING',
  MAINTENANCE: 'MAINTENANCE',
  FUND_APPROVAL: 'FUND_APPROVAL',
  INVOICE_ADJUSTMENT: 'INVOICE_ADJUSTMENT',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  GUEST: 'GUEST',
  SYSTEM: 'SYSTEM',
});

// ===== Hệ thống =====
export const CONFIG_SCOPES = Object.freeze({ BUSINESS: 'BUSINESS', TECHNICAL: 'TECHNICAL' });

export const CRON_STATUS = Object.freeze({ SUCCESS: 'SUCCESS', FAILED: 'FAILED' });

export const CRON_JOBS = Object.freeze({
  INVOICE_GENERATE: 'INVOICE_GENERATE',
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  BOOKING_COMPLETE: 'BOOKING_COMPLETE',
  WORK_ORDER_GENERATE: 'WORK_ORDER_GENERATE',
  TICKET_ESCALATE: 'TICKET_ESCALATE',
  TICKET_AUTO_CLOSE: 'TICKET_AUTO_CLOSE',
  CONTRACT_EXPIRE: 'CONTRACT_EXPIRE',
  FUND_LOW_BALANCE: 'FUND_LOW_BALANCE',
});

// Hành động ghi audit log (BR-O11, NFR-05). Module khác bổ sung thêm khi cần.
export const AUDIT_ACTIONS = Object.freeze({
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  INVOICE_ADJUSTED: 'INVOICE_ADJUSTED',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  FEE_TYPE_CHANGED: 'FEE_TYPE_CHANGED',
  FUND_INCOME_RECORDED: 'FUND_INCOME_RECORDED',
  FUND_VOTED: 'FUND_VOTED',
  FUND_PROPOSAL_APPROVED: 'FUND_PROPOSAL_APPROVED',
  FUND_PROPOSAL_REJECTED: 'FUND_PROPOSAL_REJECTED',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
  COMPLAINT_CATEGORY_CHANGED: 'COMPLAINT_CATEGORY_CHANGED',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_ESCALATED: 'TICKET_ESCALATED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  ANNOUNCEMENT_PUBLISHED: 'ANNOUNCEMENT_PUBLISHED',
  WORKORDER_ASSIGNED: 'WORKORDER_ASSIGNED',
  AMENITY_FEE_CHANGED: 'AMENITY_FEE_CHANGED',
  AMENITY_PASS_CANCELLED: 'AMENITY_PASS_CANCELLED',
  // Module A (Vũ Việt)
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  CONTRACT_CREATED: 'CONTRACT_CREATED',
  CONTRACT_UPDATED: 'CONTRACT_UPDATED',
  CONTRACT_TERMINATED: 'CONTRACT_TERMINATED',
  CONTRACT_EXPIRED: 'CONTRACT_EXPIRED',
  RESIDENT_ASSIGNED: 'RESIDENT_ASSIGNED',
  RESIDENT_REMOVED: 'RESIDENT_REMOVED',
  VEHICLE_APPROVED: 'VEHICLE_APPROVED',
  VEHICLE_REJECTED: 'VEHICLE_REJECTED',
  VEHICLE_CANCELLED: 'VEHICLE_CANCELLED',
  BUILDING_CHANGED: 'BUILDING_CHANGED',
  APARTMENT_CHANGED: 'APARTMENT_CHANGED',
});

// Tham số nghiệp vụ/kỹ thuật mặc định (system_configs). Seed khi khởi tạo DB.
export const CONFIG_KEYS = Object.freeze({
  SLA_HOURS_URGENT: 'SLA_HOURS_URGENT',
  SLA_HOURS_HIGH: 'SLA_HOURS_HIGH',
  SLA_HOURS_MEDIUM: 'SLA_HOURS_MEDIUM',
  SLA_HOURS_LOW: 'SLA_HOURS_LOW',
  TICKET_AUTO_CLOSE_DAYS: 'TICKET_AUTO_CLOSE_DAYS',
  PAYMENT_TERM_DAYS: 'PAYMENT_TERM_DAYS',
  DEBT_REMINDER_DAYS: 'DEBT_REMINDER_DAYS',
  FUND_LOW_BALANCE_THRESHOLD: 'FUND_LOW_BALANCE_THRESHOLD',
  FUND_APPROVAL_RATIO: 'FUND_APPROVAL_RATIO',
  BOOKING_MAX_ACTIVE_PER_APARTMENT: 'BOOKING_MAX_ACTIVE_PER_APARTMENT',
  BOOKING_ADVANCE_DAYS: 'BOOKING_ADVANCE_DAYS',
  CHECKIN_EARLY_MINUTES: 'CHECKIN_EARLY_MINUTES',
  NO_SHOW_GRACE_MINUTES: 'NO_SHOW_GRACE_MINUTES',
  RECEPTION_OPEN_TIME: 'RECEPTION_OPEN_TIME',
  RECEPTION_CLOSE_TIME: 'RECEPTION_CLOSE_TIME',
  CHILD_FREE_AGE: 'CHILD_FREE_AGE',
  CHILD_ADULT_AGE: 'CHILD_ADULT_AGE',
  WALK_IN_VISIT_MINUTES: 'WALK_IN_VISIT_MINUTES',
  PASS_EXPIRY_REMIND_DAYS: 'PASS_EXPIRY_REMIND_DAYS',
  PARKING_CAPACITY_MOTORBIKE: 'PARKING_CAPACITY_MOTORBIKE',
  PARKING_CAPACITY_CAR: 'PARKING_CAPACITY_CAR',
  UPLOAD_MAX_SIZE_MB: 'UPLOAD_MAX_SIZE_MB',
});

export const DEFAULT_CONFIGS = Object.freeze([
  // BUSINESS — Manager sửa (UC-E01)
  { key: CONFIG_KEYS.SLA_HOURS_URGENT, value: 24, scope: 'BUSINESS', description: 'SLA ticket Khẩn cấp (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_HIGH, value: 72, scope: 'BUSINESS', description: 'SLA ticket Cao (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_MEDIUM, value: 168, scope: 'BUSINESS', description: 'SLA ticket Thường (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_LOW, value: 168, scope: 'BUSINESS', description: 'SLA ticket Thấp (giờ)' },
  { key: CONFIG_KEYS.TICKET_AUTO_CLOSE_DAYS, value: 7, scope: 'BUSINESS', description: 'Tự đóng ticket chờ xác nhận sau N ngày — BR-O9' },
  { key: CONFIG_KEYS.PAYMENT_TERM_DAYS, value: 15, scope: 'BUSINESS', description: 'Hạn thanh toán hóa đơn (ngày) — BR-F8' },
  { key: CONFIG_KEYS.DEBT_REMINDER_DAYS, value: [1, 7, 15], scope: 'BUSINESS', description: 'Ngày quá hạn gửi nhắc nợ — BR-D4' },
  { key: CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD, value: 50000000, scope: 'BUSINESS', description: 'Ngưỡng cảnh báo số dư quỹ (VNĐ) — UC-C06' },
  { key: CONFIG_KEYS.FUND_APPROVAL_RATIO, value: 0.5, scope: 'BUSINESS', description: 'Tỷ lệ đồng ý tối thiểu (> giá trị) — BR-M2' },
  { key: CONFIG_KEYS.BOOKING_MAX_ACTIVE_PER_APARTMENT, value: 2, scope: 'BUSINESS', description: 'Số booking chưa dùng tối đa/căn — BR-O3' },
  { key: CONFIG_KEYS.BOOKING_ADVANCE_DAYS, value: 14, scope: 'BUSINESS', description: 'Đặt tiện ích trước tối đa N ngày — BR-O3' },
  { key: CONFIG_KEYS.CHECKIN_EARLY_MINUTES, value: 15, scope: 'BUSINESS', description: 'Check-in sớm nhất trước giờ bắt đầu (phút) — BR-O14' },
  { key: CONFIG_KEYS.NO_SHOW_GRACE_MINUTES, value: 15, scope: 'BUSINESS', description: 'Quá giờ bắt đầu N phút chưa check-in → không đến — BR-O14' },
  { key: CONFIG_KEYS.RECEPTION_OPEN_TIME, value: '05:00', scope: 'BUSINESS', description: 'Giờ lễ tân bắt đầu làm việc (HH:mm) — BR-O15' },
  { key: CONFIG_KEYS.RECEPTION_CLOSE_TIME, value: '22:00', scope: 'BUSINESS', description: 'Giờ lễ tân kết thúc (HH:mm) — BR-O15' },
  { key: CONFIG_KEYS.CHILD_FREE_AGE, value: 6, scope: 'BUSINESS', description: 'Dưới số tuổi này được vào tiện ích miễn phí, cần người lớn đi kèm — BR-O24' },
  { key: CONFIG_KEYS.CHILD_ADULT_AGE, value: 12, scope: 'BUSINESS', description: 'Từ số tuổi này tính giá người lớn; từ CHILD_FREE_AGE đến dưới mốc này tính giá trẻ em — BR-O24' },
  { key: CONFIG_KEYS.WALK_IN_VISIT_MINUTES, value: 120, scope: 'BUSINESS', description: 'Thời lượng 1 lượt vào tiện ích vào cửa (phút), dùng đếm số người đang ở trong — BR-O23' },
  { key: CONFIG_KEYS.PASS_EXPIRY_REMIND_DAYS, value: 3, scope: 'BUSINESS', description: 'Nhắc gia hạn gói tháng trong N ngày cuối tháng — BR-O22' },
  { key: CONFIG_KEYS.PARKING_CAPACITY_MOTORBIKE, value: 500, scope: 'BUSINESS', description: 'Sức chứa bãi xe máy' },
  { key: CONFIG_KEYS.PARKING_CAPACITY_CAR, value: 100, scope: 'BUSINESS', description: 'Sức chứa bãi ô tô' },
  // TECHNICAL — Admin sửa
  { key: CONFIG_KEYS.UPLOAD_MAX_SIZE_MB, value: 5, scope: 'TECHNICAL', description: 'Dung lượng ảnh tối đa (MB) — NFR-10' },
]);
