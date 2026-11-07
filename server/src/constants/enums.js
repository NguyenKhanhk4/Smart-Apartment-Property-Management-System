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
});

// Hành động trên điều khoản dữ liệu cá nhân (BR-X7)
export const CONSENT_ACTIONS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  WITHDRAWN: 'WITHDRAWN',
});

// Phiên bản điều khoản dữ liệu cá nhân đang áp dụng; đổi nội dung điều khoản thì tăng số này
export const CONSENT_POLICY_VERSION = '1.0';

// Mã xác minh: dùng để làm gì và cấp qua đâu (BR-X4, BR-S05)
export const VERIFICATION_PURPOSES = Object.freeze({
  ACTIVATION: 'ACTIVATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
});
export const VERIFICATION_CHANNELS = Object.freeze({
  EMAIL_OTP: 'EMAIL_OTP',
  DESK_CODE: 'DESK_CODE',
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

// ===== Gate Pass & tra biển số (Người 2 — UC52..54, UC62) =====
export const GATE_PASS_DIRECTIONS = Object.freeze({
  IN: 'IN',
  OUT: 'OUT',
});

export const GATE_PASS_STATUS = Object.freeze({
  AWAITING_OWNER: 'AWAITING_OWNER',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  USED: 'USED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

export const PLATE_LOOKUP_RESULTS = Object.freeze({
  REGISTERED_VEHICLE: 'REGISTERED_VEHICLE',
  MATCHES_GATE_PASS: 'MATCHES_GATE_PASS',
  UNKNOWN: 'UNKNOWN',
});

// ===== Thẻ gửi xe (Người 2 — UC66) =====
// Biến động nhân khẩu nộp Công an phường (UC21)
export const OCCUPANT_CHANGE_TYPES = Object.freeze({ MOVE_IN: 'MOVE_IN', MOVE_OUT: 'MOVE_OUT' });

export const PARKING_CARD_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED_TO_COLLECT: 'DISABLED_TO_COLLECT',
  RETURNED: 'RETURNED',
  LOST: 'LOST',
});

// ===== Phí, hóa đơn, thanh toán, công nợ (Module B) =====
// Nhóm phí trên hóa đơn (BR-F1)
export const FEE_CATEGORIES = Object.freeze({
  CLEANING: 'CLEANING',
  PARKING: 'PARKING',
  AMENITY: 'AMENITY',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER', // khoản thu khác Kế toán thêm tay vào thông báo Nháp (Mô đun 4)
  REPAIR: 'REPAIR', // chi phí sửa chữa trong căn hộ đã nghiệm thu (báo giá đã đồng ý, UC48)
});

// Báo giá sửa chữa trong căn hộ (UC48, UC40). Mỗi lần gửi / báo giá lại là 1 phiên bản; báo giá có hiệu lực = bản ACCEPTED mới nhất
export const QUOTE_STATUS = Object.freeze({
  PENDING: 'PENDING', // chờ Người nộp phí đồng ý
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED', // quá hạn không phản hồi → phiếu tự đóng (Từ chối)
  SUPERSEDED: 'SUPERSEDED', // đã có bản báo giá mới thay thế
});

// Cách tính đơn giá của fee_types (BR-F4)
// Trạng thái hiệu lực của một mức giá theo kỳ hiện tại (UC-B01)
export const FEE_TYPE_STATES = Object.freeze({ ACTIVE: 'ACTIVE', UPCOMING: 'UPCOMING', ENDED: 'ENDED' });

// Kết quả xem trước khi sinh hóa đơn (UC-B02)
export const INVOICE_PREVIEW_STATUS = Object.freeze({
  NEW: 'NEW', // sẽ được lập
  EXISTS: 'EXISTS', // đã có hóa đơn chưa hủy (BR-F2)
  NO_PAYER: 'NO_PAYER', // chưa có hợp đồng hiệu lực → bỏ qua
  ERROR: 'ERROR', // thiếu đơn giá...
});

export const FEE_CALC_METHODS = Object.freeze({
  PER_M2: 'PER_M2',
  PER_APARTMENT: 'PER_APARTMENT',
  PER_VEHICLE: 'PER_VEHICLE',
});

// Vòng đời thông báo phí (Mô đun 4): Nháp → Chờ duyệt → Đã phát hành (UNPAID) → (Thanh toán một phần) → Đã thanh toán.
// Quá hạn đóng mà chưa trả đủ → OVERDUE. UNPAID giữ nghĩa "đã phát hành, chưa trả" để module khác đọc như cũ.
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
});

// Chưa phát hành: Kế toán / Trưởng BQL còn sửa, duyệt; cư dân không thấy
export const INVOICE_UNPUBLISHED_STATUSES = Object.freeze([INVOICE_STATUS.DRAFT, INVOICE_STATUS.PENDING_APPROVAL]);
// Đã phát hành tới Người nộp phí: cư dân xem được, tính vào doanh thu / công nợ
export const INVOICE_PUBLISHED_STATUSES = Object.freeze([
  INVOICE_STATUS.UNPAID,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.PAID,
  INVOICE_STATUS.OVERDUE,
]);
// Còn nợ: thu tiền được, tính vào sổ công nợ
export const INVOICE_OUTSTANDING_STATUSES = Object.freeze([
  INVOICE_STATUS.UNPAID,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.OVERDUE,
]);
// Mọi trạng thái trừ CANCELLED: mỗi căn 1 thông báo/kỳ (BR-F2)
export const INVOICE_ACTIVE_STATUSES = Object.freeze([...INVOICE_UNPUBLISHED_STATUSES, ...INVOICE_PUBLISHED_STATUSES]);

export const GENERATED_BY = Object.freeze({ CRON: 'CRON', MANUAL: 'MANUAL' });

export const PAYMENT_METHODS = Object.freeze({
  PAYOS: 'PAYOS', // thanh toán online qua link payOS (VietQR)
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

// Sổ Số dư trả trước của căn theo Người nộp phí (Mô đun 4)
export const PREPAID_TX_TYPES = Object.freeze({
  DEPOSIT: 'DEPOSIT', // tiền thu thừa ghi vào số dư
  APPLY: 'APPLY', // trừ số dư vào thông báo phí khi phát hành
  REFUND: 'REFUND', // phiếu chi hoàn tiền (hoàn ngoài hệ thống)
});

export const ADJUSTMENT_TYPES = Object.freeze({ ADJUST: 'ADJUST', CANCEL: 'CANCEL' });

// Dùng chung cho các yêu cầu cần duyệt (điều chỉnh hóa đơn, đề xuất chi quỹ)
export const REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

// Hồ sơ nợ quá hạn của 1 Người nộp phí tại 1 căn (UC31): đang nhắc tự động → nhắc đủ số lần mà chưa trả → Nợ quá hạn dài
// (Trưởng BQL xử lý); trả hết nợ quá hạn → Đã xong
export const DEBT_STATUS = Object.freeze({ REMINDING: 'REMINDING', LONG_OVERDUE: 'LONG_OVERDUE', RESOLVED: 'RESOLVED' });
export const DEBT_OPEN_STATUSES = Object.freeze([DEBT_STATUS.REMINDING, DEBT_STATUS.LONG_OVERDUE]);

// Tình trạng một dòng trong sổ công nợ (căn + Người nộp phí), lấy theo mức nặng nhất
export const LEDGER_STATUS = Object.freeze({
  PAID: 'PAID',
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  OVERDUE: 'OVERDUE',
  LONG_OVERDUE: 'LONG_OVERDUE',
});

export const CONTACT_METHODS = Object.freeze({
  PHONE: 'PHONE',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  IN_PERSON: 'IN_PERSON',
  LETTER: 'LETTER',
});

// ===== Quỹ bảo trì, chi phí vận hành (Module C) =====
export const FUND_TX_TYPES = Object.freeze({ INCOME: 'INCOME', EXPENSE: 'EXPENSE' });

export const VOTE_DECISIONS = Object.freeze({ AGREE: 'AGREE', DISAGREE: 'DISAGREE' });

// Quỹ bảo trì 2% (UC33, UC34) — nguồn thu quỹ có chứng từ (M4-7)
export const FUND_INCOME_SOURCES = Object.freeze({
  INITIAL_HANDOVER: 'INITIAL_HANDOVER', // số dư ban đầu Chủ đầu tư bàn giao
  INTEREST: 'INTEREST', // lãi tiền gửi
  OTHER: 'OTHER',
});

// Loại kế hoạch của đề xuất chi quỹ
export const FUND_PLAN_TYPES = Object.freeze({
  ANNUAL_PLAN: 'ANNUAL_PLAN', // thuộc Kế hoạch bảo trì năm đã được Hội nghị nhà chung cư thông qua
  UNSCHEDULED: 'UNSCHEDULED', // bảo trì đột xuất, bắt buộc ghi lý do
});

// Vòng đời đề xuất chi quỹ: Chờ Ban quản trị biểu quyết → Đã duyệt → Đã chi (Kế toán lập phiếu chi);
// hoặc Từ chối / Kế toán rút lại. Đủ tỷ lệ đồng ý > FUND_APPROVAL_RATIO số thành viên thì tự duyệt.
export const FUND_PROPOSAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
});

export const EXPENSE_CATEGORIES = Object.freeze({
  SALARY: 'SALARY',
  COMMON_UTILITY: 'COMMON_UTILITY',
  OUTSOURCED_SERVICE: 'OUTSOURCED_SERVICE',
  OTHER: 'OTHER',
});

// ===== Thiết bị, bảo trì (Người 1, Mô đun 10) =====
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

// Work order chưa hoàn thành (BR-O6: 1 tài sản chỉ 1 work order SCHEDULED đang mở)
export const WORK_ORDER_OPEN_STATUSES = Object.freeze([WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PROGRESS]);

// ===== Tiện ích (Module D) =====
// BR-O12: booking tự xác nhận APPROVED khi đặt → CHECKED_IN (lễ tân) → COMPLETED (hết giờ, tính phí BR-O5);
// hoặc CANCELLED / NO_SHOW (không tính phí).
// PENDING, REJECTED: luồng duyệt cũ, Module D KHÔNG còn tạo mới — giữ để dữ liệu & báo cáo UC-E14 cũ không lỗi.
// PENDING_PAYMENT (Người 4): booking có phí giữ chỗ chờ thanh toán khi BOOKING_PAYMENT_HOLD_MINUTES > 0,
// quá hạn giữ mà chưa thanh toán thì cron chuyển CANCELLED.
export const BOOKING_STATUS = Object.freeze({
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  APPROVED: 'APPROVED',
  CHECKED_IN: 'CHECKED_IN',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
});

// Booking đang chiếm slot (sức chứa, giới hạn booking chưa dùng BR-O3); giữ chỗ chờ thanh toán cũng chiếm slot
export const BOOKING_ACTIVE_STATUSES = Object.freeze([
  BOOKING_STATUS.PENDING_PAYMENT,
  BOOKING_STATUS.APPROVED,
  BOOKING_STATUS.CHECKED_IN,
]);
// Booking có phí bị tính khi đã giữ slot: chưa đến giờ, đang dùng, đã dùng, hoặc không đến (BR-O5, BR-O16).
// Booking đã thanh toán trước (paidAt) không gộp vào hóa đơn tháng — lọc riêng ở invoices.builder.
export const BOOKING_BILLABLE_STATUSES = Object.freeze([
  BOOKING_STATUS.APPROVED,
  BOOKING_STATUS.CHECKED_IN,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW,
]);
// Luồng duyệt cũ: chỉ còn trong dữ liệu cũ, không tạo mới và không đưa vào báo cáo / ô chọn
export const BOOKING_LEGACY_STATUSES = Object.freeze([BOOKING_STATUS.PENDING, BOOKING_STATUS.REJECTED]);

// Kiểu tiện ích: FREE = đi vào tự do, không đặt/không phí; BOOKING = đặt slot (UC44, UC45).
// Bản ghi cũ không có accessMode coi là BOOKING.
export const AMENITY_ACCESS_MODES = Object.freeze({
  FREE: 'FREE',
  BOOKING: 'BOOKING',
});

// Nhóm tuổi theo ngày sinh (hiển thị ở mã cư dân, đặt hộ tại quầy)
export const AGE_GROUPS = Object.freeze({
  CHILD_FREE: 'CHILD_FREE',
  CHILD: 'CHILD',
  ADULT: 'ADULT',
});

// Dữ liệu cũ gói tháng / lượt vào cửa (đã bỏ khỏi nghiệp vụ). Chỉ model AmenityPass, AmenityVisit và phần tính phí
// (invoices.*, Người 3) còn đọc — gỡ cùng lúc khi Người 3 bỏ dòng gói tháng / vé lẻ khỏi thông báo phí.
export const AMENITY_PASS_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
});
export const VISIT_CHARGE_TYPES = Object.freeze({
  PASS: 'PASS',
  SINGLE: 'SINGLE',
  FREE: 'FREE',
});
export const VISIT_STATUS = Object.freeze({
  VALID: 'VALID',
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

// Máy trạng thái sự cố (Người 4): Mới → Đã nhận → (Chờ cư dân đồng ý phí) → Đang xử lý ⇄ Chờ linh kiện
// → Đã xong, chờ nghiệm thu → Đã nghiệm thu (CLOSED)
export const TICKET_STATUS = Object.freeze({
  NEW: 'NEW',
  ASSIGNED: 'ASSIGNED',
  WAITING_QUOTE_APPROVAL: 'WAITING_QUOTE_APPROVAL',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_PARTS: 'WAITING_PARTS',
  WAITING_CONFIRM: 'WAITING_CONFIRM',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  MERGED: 'MERGED', // M5-6: phiếu trùng đã gộp vào phiếu chính (mergedInto), đóng theo phiếu chính
});

// Nhóm trạng thái ticket — mọi nơi (service, cron, báo cáo, client) dùng các nhóm này, không tự liệt kê.
// Đang mở = chưa xử lý xong; WAITING_CONFIRM (đã xong, chờ nghiệm thu) và nhóm kết thúc nằm ngoài.
export const TICKET_OPEN_STATUSES = Object.freeze([
  TICKET_STATUS.NEW,
  TICKET_STATUS.ASSIGNED,
  TICKET_STATUS.WAITING_QUOTE_APPROVAL,
  TICKET_STATUS.IN_PROGRESS,
  TICKET_STATUS.WAITING_PARTS,
]);
// Tính SLA hoàn thành / leo thang: tạm dừng khi đang chờ cư dân đồng ý phí (lỗi không thuộc Ban quản lý).
// Chờ linh kiện vẫn nằm trong nhóm này nhưng được cộng tối đa TICKET_PARTS_PAUSE_HOURS (M5-2, xem ticket.rules)
export const TICKET_SLA_STATUSES = Object.freeze(
  TICKET_OPEN_STATUSES.filter((s) => s !== TICKET_STATUS.WAITING_QUOTE_APPROVAL),
);
export const TICKET_FINAL_STATUSES = Object.freeze([TICKET_STATUS.CLOSED, TICKET_STATUS.REJECTED]);

// Hành động trong lịch sử xử lý ticket (tickets.history.action)
export const TICKET_HISTORY_ACTIONS = Object.freeze({
  CREATED: 'CREATED',
  ASSIGNED: 'ASSIGNED',
  REASSIGNED: 'REASSIGNED',
  CLAIMED: 'CLAIMED',
  PROGRESS: 'PROGRESS',
  QUOTE_REQUESTED: 'QUOTE_REQUESTED',
  QUOTE_ACCEPTED: 'QUOTE_ACCEPTED',
  QUOTE_DECLINED: 'QUOTE_DECLINED',
  QUOTE_REVISED: 'QUOTE_REVISED', // báo giá lại trong ngưỡng cho phép, không cần duyệt lại
  QUOTE_EXPIRED: 'QUOTE_EXPIRED', // quá hạn không phản hồi báo giá, hệ thống đóng phiếu
  WAITING_PARTS: 'WAITING_PARTS',
  RESOLVED: 'RESOLVED',
  CONFIRMED: 'CONFIRMED',
  REOPENED: 'REOPENED',
  ESCALATED: 'ESCALATED',
  SLA_ALERTED: 'SLA_ALERTED',
  AUTO_CLOSED: 'AUTO_CLOSED',
  REJECTED: 'REJECTED',
  RECLASSIFIED: 'RECLASSIFIED', // M5-5: đổi loại / phạm vi phiếu
  MERGED: 'MERGED', // M5-6: gộp phiếu trùng vào phiếu chính
});

// Loại phiếu: sự cố kỹ thuật vào hàng chờ Kỹ thuật; phản ánh chuyển sang màn hình xử lý của Người 2
export const TICKET_TYPES = Object.freeze({
  INCIDENT: 'INCIDENT',
  COMPLAINT: 'COMPLAINT',
});

// Phạm vi sự cố: trong căn hộ thì cần báo giá và cư dân đồng ý phí trước khi xử lý
export const TICKET_SCOPES = Object.freeze({
  COMMON_AREA: 'COMMON_AREA',
  IN_APARTMENT: 'IN_APARTMENT',
});

// Chức danh được xếp lịch ca trực (Người 4 — X6)
export const DUTY_ROLE_TITLES = Object.freeze({
  TECHNICIAN: ROLE_TITLES.TECHNICIAN,
  SECURITY: ROLE_TITLES.SECURITY,
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
  INVOICE_APPROVAL: 'INVOICE_APPROVAL', // trình duyệt / trả lại / nhắc kỳ tính phí (Kế toán ↔ Trưởng BQL)
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT', // biên lai điện tử mỗi lần thu tiền
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  GUEST: 'GUEST',
  SYSTEM: 'SYSTEM',
});

// ===== Hệ thống =====
export const CONFIG_SCOPES = Object.freeze({ BUSINESS: 'BUSINESS', TECHNICAL: 'TECHNICAL' });

export const CRON_STATUS = Object.freeze({ SUCCESS: 'SUCCESS', FAILED: 'FAILED' });

export const CRON_TRIGGERS = Object.freeze({ SCHEDULE: 'SCHEDULE', MANUAL: 'MANUAL' });

export const CRON_JOBS = Object.freeze({
  INVOICE_GENERATE: 'INVOICE_GENERATE',
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  BILLING_REMIND: 'BILLING_REMIND', // nhắc Kế toán đến kỳ tính phí + nhắc Trưởng BQL duyệt quá hạn (X8)
  PAYMENT_RECONCILE: 'PAYMENT_RECONCILE',
  QUOTE_REMIND: 'QUOTE_REMIND',
  FUND_PROPOSAL_REMIND: 'FUND_PROPOSAL_REMIND', // đề xuất chi quỹ chờ biểu quyết quá N ngày → nhắc Ban quản trị + báo Trưởng BQL // báo giá sửa chữa chờ đồng ý: nhắc sau N ngày, tự đóng sau M ngày
  DEBT_REMIND: 'DEBT_REMIND', // nhắc nợ quá hạn N ngày/lần, tối đa M lần → Nợ quá hạn dài; quá ngày hẹn trả → báo Trưởng BQL // payOS: tra cứu giao dịch chờ kết quả, quá 15 phút → Cần đối soát
  BOOKING_COMPLETE: 'BOOKING_COMPLETE',
  WORK_ORDER_GENERATE: 'WORK_ORDER_GENERATE',
  TICKET_ESCALATE: 'TICKET_ESCALATE',
  TICKET_AUTO_CLOSE: 'TICKET_AUTO_CLOSE',
  CONTRACT_EXPIRE: 'CONTRACT_EXPIRE',
  FUND_LOW_BALANCE: 'FUND_LOW_BALANCE',
  GATE_PASS_EXPIRE: 'GATE_PASS_EXPIRE',
  CONTRACT_EXPIRY_REMIND: 'CONTRACT_EXPIRY_REMIND',
  // Sự cố & tiện ích (Người 4)
  TICKET_SLA_ALERT: 'TICKET_SLA_ALERT',
  BOOKING_HOLD_EXPIRE: 'BOOKING_HOLD_EXPIRE',
});

// Hành động ghi audit log (BR-O11, NFR-05). Module khác bổ sung thêm khi cần.
export const AUDIT_ACTIONS = Object.freeze({
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  INVOICE_ADJUSTED: 'INVOICE_ADJUSTED',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  INVOICE_RECALCULATED: 'INVOICE_RECALCULATED',
  INVOICE_ITEM_ADDED: 'INVOICE_ITEM_ADDED',
  INVOICE_ITEM_REMOVED: 'INVOICE_ITEM_REMOVED',
  INVOICE_SUBMITTED: 'INVOICE_SUBMITTED',
  INVOICE_PUBLISHED: 'INVOICE_PUBLISHED',
  INVOICE_RETURNED: 'INVOICE_RETURNED',
  PREPAID_REFUNDED: 'PREPAID_REFUNDED',
  DEBT_FOLLOWUP_RECORDED: 'DEBT_FOLLOWUP_RECORDED',
  REPAIR_QUOTE_SUBMITTED: 'REPAIR_QUOTE_SUBMITTED',
  DEBT_NOTICE_EXPORTED: 'DEBT_NOTICE_EXPORTED',
  FEE_TYPE_CHANGED: 'FEE_TYPE_CHANGED',
  FUND_INCOME_RECORDED: 'FUND_INCOME_RECORDED',
  FUND_VOTED: 'FUND_VOTED',
  FUND_PROPOSAL_APPROVED: 'FUND_PROPOSAL_APPROVED',
  FUND_PROPOSAL_REJECTED: 'FUND_PROPOSAL_REJECTED',
  FUND_PROPOSAL_CREATED: 'FUND_PROPOSAL_CREATED',
  FUND_PROPOSAL_CANCELLED: 'FUND_PROPOSAL_CANCELLED',
  FUND_WORK_ACCEPTED: 'FUND_WORK_ACCEPTED',
  FUND_EXPENSE_RECORDED: 'FUND_EXPENSE_RECORDED',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
  COMPLAINT_CATEGORY_CHANGED: 'COMPLAINT_CATEGORY_CHANGED',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_ESCALATED: 'TICKET_ESCALATED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  ANNOUNCEMENT_PUBLISHED: 'ANNOUNCEMENT_PUBLISHED',
  WORKORDER_ASSIGNED: 'WORKORDER_ASSIGNED',
  AMENITY_FEE_CHANGED: 'AMENITY_FEE_CHANGED',
  BOOKING_CANCELLED_BY_STAFF: 'BOOKING_CANCELLED_BY_STAFF',
  AMENITY_VISIT_CANCELLED: 'AMENITY_VISIT_CANCELLED',
  // Module A (Vũ Việt)
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  CONTRACT_CREATED: 'CONTRACT_CREATED',
  CONTRACT_UPDATED: 'CONTRACT_UPDATED',
  CONTRACT_TERMINATED: 'CONTRACT_TERMINATED',
  CONTRACT_EXPIRED: 'CONTRACT_EXPIRED',
  RESIDENT_ASSIGNED: 'RESIDENT_ASSIGNED',
  RESIDENT_REMOVED: 'RESIDENT_REMOVED',
  RESIDENT_UPDATED: 'RESIDENT_UPDATED',
  ACCOUNT_ACTIVATED: 'ACCOUNT_ACTIVATED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACTIVATION_CODE_ISSUED: 'ACTIVATION_CODE_ISSUED',
  PHONE_CHANGED: 'PHONE_CHANGED',
  EMAIL_CHANGED: 'EMAIL_CHANGED',
  CONSENT_CHANGED: 'CONSENT_CHANGED',
  AUDIT_LOG_EXPORTED: 'AUDIT_LOG_EXPORTED', // UC06 bước 5 / UC65: xuất nhật ký cũng được ghi lại
  VEHICLE_APPROVED: 'VEHICLE_APPROVED',
  VEHICLE_REJECTED: 'VEHICLE_REJECTED',
  VEHICLE_CANCELLED: 'VEHICLE_CANCELLED',
  BUILDING_CHANGED: 'BUILDING_CHANGED',
  APARTMENT_CHANGED: 'APARTMENT_CHANGED',
  // Gate Pass (Người 2)
  GATEPASS_CREATED: 'GATEPASS_CREATED',
  GATEPASS_OWNER_APPROVED: 'GATEPASS_OWNER_APPROVED',
  GATEPASS_OWNER_REJECTED: 'GATEPASS_OWNER_REJECTED',
  GATEPASS_APPROVED: 'GATEPASS_APPROVED',
  GATEPASS_REJECTED: 'GATEPASS_REJECTED',
  GATEPASS_USED: 'GATEPASS_USED',
  GATEPASS_EXPIRED: 'GATEPASS_EXPIRED',
  // Thẻ gửi xe (Người 2 — UC66)
  PARKING_CARD_ISSUED: 'PARKING_CARD_ISSUED',
  PARKING_CARD_DISABLED: 'PARKING_CARD_DISABLED',
  PARKING_CARD_RETURNED: 'PARKING_CARD_RETURNED',
  PARKING_CARD_LOST: 'PARKING_CARD_LOST',
  // Biến động nhân khẩu (Người 2 — UC21)
  RESIDENT_CHANGES_EXPORTED: 'RESIDENT_CHANGES_EXPORTED',
  RESIDENT_ID_VIEWED: 'RESIDENT_ID_VIEWED',
  // Sự cố & tiện ích (Người 4)
  DUTY_SHIFT_CREATED: 'DUTY_SHIFT_CREATED',
  DUTY_SHIFT_DELETED: 'DUTY_SHIFT_DELETED',
  TICKET_CLAIMED: 'TICKET_CLAIMED',
  TICKET_QUOTE_DECIDED: 'TICKET_QUOTE_DECIDED',
  TICKET_RECLASSIFIED: 'TICKET_RECLASSIFIED',
  TICKET_MERGED: 'TICKET_MERGED',
  BOOKING_PAYMENT_CONFIRMED: 'BOOKING_PAYMENT_CONFIRMED',
});

// targetType của audit_logs = tên collection (index { targetType, targetId } tra lịch sử một bản ghi)
export const AUDIT_TARGETS = Object.freeze({
  MAINTENANCE_FUND: 'maintenance_fund',
  OPERATING_EXPENSE: 'operating_expenses',
  AUDIT_LOG: 'audit_logs',
  USER: 'users',
  BUILDING: 'buildings',
  APARTMENT: 'apartments',
  CONTRACT: 'contracts',
  RESIDENT: 'residents',
  VEHICLE: 'vehicles',
  GATE_PASS: 'gate_passes',
  PARKING_CARD: 'parking_cards',
  FEE_TYPE: 'fee_types',
  INVOICE: 'invoices',
  PAYMENT: 'payments',
  DEBT_FOLLOWUP: 'debt_followups',
  REPAIR_QUOTE: 'repair_quotes',
  FUND_PROPOSAL: 'fund_proposals',
  FUND_TRANSACTION: 'fund_transactions',
  AMENITY: 'amenities',
  AMENITY_VISIT: 'amenity_visits',
  BOOKING: 'bookings',
  WORK_ORDER: 'work_orders',
  TICKET: 'tickets',
  COMPLAINT_CATEGORY: 'complaint_categories',
  ANNOUNCEMENT: 'announcements',
  SYSTEM_CONFIG: 'system_configs',
  DUTY_SHIFT: 'duty_shifts',
});

// Tham số nghiệp vụ/kỹ thuật mặc định (system_configs). Seed khi khởi tạo DB.
export const CONFIG_KEYS = Object.freeze({
  SLA_HOURS_URGENT: 'SLA_HOURS_URGENT',
  SLA_HOURS_HIGH: 'SLA_HOURS_HIGH',
  SLA_HOURS_MEDIUM: 'SLA_HOURS_MEDIUM',
  SLA_HOURS_LOW: 'SLA_HOURS_LOW',
  TICKET_AUTO_CLOSE_DAYS: 'TICKET_AUTO_CLOSE_DAYS',
  PAYMENT_TERM_DAYS: 'PAYMENT_TERM_DAYS',
  DEBT_REMINDER_INTERVAL_DAYS: 'DEBT_REMINDER_INTERVAL_DAYS',
  DEBT_REMINDER_MAX: 'DEBT_REMINDER_MAX',
  QUOTE_REMIND_DAYS: 'QUOTE_REMIND_DAYS',
  QUOTE_AUTO_CLOSE_DAYS: 'QUOTE_AUTO_CLOSE_DAYS',
  QUOTE_REAPPROVAL_PERCENT: 'QUOTE_REAPPROVAL_PERCENT',
  BILLING_REMIND_DAY: 'BILLING_REMIND_DAY',
  INVOICE_APPROVAL_REMIND_DAYS: 'INVOICE_APPROVAL_REMIND_DAYS',
  FUND_LOW_BALANCE_THRESHOLD: 'FUND_LOW_BALANCE_THRESHOLD',
  FUND_APPROVAL_RATIO: 'FUND_APPROVAL_RATIO',
  FUND_APPROVAL_REMIND_DAYS: 'FUND_APPROVAL_REMIND_DAYS',
  BOOKING_MAX_ACTIVE_PER_APARTMENT: 'BOOKING_MAX_ACTIVE_PER_APARTMENT',
  BOOKING_ADVANCE_DAYS: 'BOOKING_ADVANCE_DAYS',
  CHECKIN_EARLY_MINUTES: 'CHECKIN_EARLY_MINUTES',
  NO_SHOW_GRACE_MINUTES: 'NO_SHOW_GRACE_MINUTES',
  RECEPTION_OPEN_TIME: 'RECEPTION_OPEN_TIME',
  RECEPTION_CLOSE_TIME: 'RECEPTION_CLOSE_TIME',
  CHILD_FREE_AGE: 'CHILD_FREE_AGE',
  CHILD_ADULT_AGE: 'CHILD_ADULT_AGE',
  PARKING_CAPACITY_MOTORBIKE: 'PARKING_CAPACITY_MOTORBIKE',
  PARKING_CAPACITY_CAR: 'PARKING_CAPACITY_CAR',
  UPLOAD_MAX_SIZE_MB: 'UPLOAD_MAX_SIZE_MB',
  // Sự cố & tiện ích (Người 4)
  TICKET_ACK_MINUTES: 'TICKET_ACK_MINUTES',
  TICKET_PARTS_PAUSE_HOURS: 'TICKET_PARTS_PAUSE_HOURS',
  COMPLAINT_RESPONSE_HOURS: 'COMPLAINT_RESPONSE_HOURS',
  BOOKING_PAYMENT_HOLD_MINUTES: 'BOOKING_PAYMENT_HOLD_MINUTES',
});

export const DEFAULT_CONFIGS = Object.freeze([
  // BUSINESS — Manager sửa (UC-E01)
  { key: CONFIG_KEYS.SLA_HOURS_URGENT, value: 24, scope: CONFIG_SCOPES.BUSINESS, description: 'SLA ticket Khẩn cấp (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_HIGH, value: 72, scope: CONFIG_SCOPES.BUSINESS, description: 'SLA ticket Cao (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_MEDIUM, value: 168, scope: CONFIG_SCOPES.BUSINESS, description: 'SLA ticket Thường (giờ) — BR-O7' },
  { key: CONFIG_KEYS.SLA_HOURS_LOW, value: 168, scope: CONFIG_SCOPES.BUSINESS, description: 'SLA ticket Thấp (giờ)' },
  { key: CONFIG_KEYS.TICKET_AUTO_CLOSE_DAYS, value: 3, scope: CONFIG_SCOPES.BUSINESS, description: 'Cư dân không nghiệm thu sau N ngày thì tự chuyển Đã nghiệm thu (không tính sao), nhắc trước 1 ngày — M5-1' },
  { key: CONFIG_KEYS.PAYMENT_TERM_DAYS, value: 15, scope: CONFIG_SCOPES.BUSINESS, description: 'Hạn thanh toán hóa đơn (ngày) — BR-F8' },
  { key: CONFIG_KEYS.DEBT_REMINDER_INTERVAL_DAYS, value: 3, scope: CONFIG_SCOPES.BUSINESS, description: 'Nhắc nợ quá hạn N ngày/lần (lần đầu ngay ngày đầu quá hạn) — UC31, X8' },
  { key: CONFIG_KEYS.QUOTE_REMIND_DAYS, value: 2, scope: CONFIG_SCOPES.BUSINESS, description: 'Báo giá sửa chữa chờ quá N ngày chưa phản hồi thì nhắc Người nộp phí — UC48, X8' },
  { key: CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS, value: 5, scope: CONFIG_SCOPES.BUSINESS, description: 'Báo giá sửa chữa quá N ngày chưa phản hồi thì tự đóng phiếu (Từ chối) — UC48, X8' },
  { key: CONFIG_KEYS.QUOTE_REAPPROVAL_PERCENT, value: 10, scope: CONFIG_SCOPES.BUSINESS, description: 'Báo giá lại vượt quá N% số đã đồng ý thì Người nộp phí phải duyệt lại — M5-3' },
  { key: CONFIG_KEYS.DEBT_REMINDER_MAX, value: 3, scope: CONFIG_SCOPES.BUSINESS, description: 'Nhắc nợ tối đa N lần; quá N lần chưa trả → Nợ quá hạn dài, báo Trưởng BQL — UC31, X8' },
  { key: CONFIG_KEYS.BILLING_REMIND_DAY, value: 1, scope: CONFIG_SCOPES.BUSINESS, description: 'Ngày trong tháng nhắc Kế toán tính phí (1–28) — Mô đun 4' },
  { key: CONFIG_KEYS.INVOICE_APPROVAL_REMIND_DAYS, value: 2, scope: CONFIG_SCOPES.BUSINESS, description: 'Thông báo phí chờ duyệt quá N ngày thì nhắc Trưởng BQL mỗi ngày — X8' },
  { key: CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD, value: 50000000, scope: CONFIG_SCOPES.BUSINESS, description: 'Ngưỡng cảnh báo số dư quỹ (VNĐ) — UC-C06' },
  { key: CONFIG_KEYS.FUND_APPROVAL_RATIO, value: 0.5, scope: CONFIG_SCOPES.BUSINESS, description: 'Đề xuất chi quỹ được duyệt khi số phiếu đồng ý > tỷ lệ này × số thành viên Ban quản trị — UC34' },
  { key: CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS, value: 3, scope: CONFIG_SCOPES.BUSINESS, description: 'Đề xuất chi quỹ chờ quá N ngày → nhắc Ban quản trị và báo Trưởng BQL (N ngày/lần, không tự duyệt) — X8' },
  { key: CONFIG_KEYS.BOOKING_MAX_ACTIVE_PER_APARTMENT, value: 2, scope: CONFIG_SCOPES.BUSINESS, description: 'Số booking chưa dùng tối đa/căn — BR-O3' },
  { key: CONFIG_KEYS.BOOKING_ADVANCE_DAYS, value: 14, scope: CONFIG_SCOPES.BUSINESS, description: 'Đặt tiện ích trước tối đa N ngày — BR-O3' },
  { key: CONFIG_KEYS.CHECKIN_EARLY_MINUTES, value: 15, scope: CONFIG_SCOPES.BUSINESS, description: 'Check-in sớm nhất trước giờ bắt đầu (phút) — BR-O14' },
  { key: CONFIG_KEYS.NO_SHOW_GRACE_MINUTES, value: 15, scope: CONFIG_SCOPES.BUSINESS, description: 'Quá giờ bắt đầu N phút chưa check-in → không đến — BR-O14' },
  { key: CONFIG_KEYS.RECEPTION_OPEN_TIME, value: '05:00', scope: CONFIG_SCOPES.BUSINESS, description: 'Giờ lễ tân bắt đầu làm việc (HH:mm) — BR-O15' },
  { key: CONFIG_KEYS.RECEPTION_CLOSE_TIME, value: '22:00', scope: CONFIG_SCOPES.BUSINESS, description: 'Giờ lễ tân kết thúc (HH:mm) — BR-O15' },
  { key: CONFIG_KEYS.CHILD_FREE_AGE, value: 6, scope: CONFIG_SCOPES.BUSINESS, description: 'Dưới số tuổi này được vào tiện ích miễn phí, cần người lớn đi kèm — BR-O24' },
  { key: CONFIG_KEYS.CHILD_ADULT_AGE, value: 12, scope: CONFIG_SCOPES.BUSINESS, description: 'Từ số tuổi này tính giá người lớn; từ CHILD_FREE_AGE đến dưới mốc này tính giá trẻ em — BR-O24' },
  { key: CONFIG_KEYS.PARKING_CAPACITY_MOTORBIKE, value: 500, scope: CONFIG_SCOPES.BUSINESS, description: 'Sức chứa bãi xe máy' },
  { key: CONFIG_KEYS.PARKING_CAPACITY_CAR, value: 100, scope: CONFIG_SCOPES.BUSINESS, description: 'Sức chứa bãi ô tô' },
  { key: CONFIG_KEYS.TICKET_ACK_MINUTES, value: 30, scope: CONFIG_SCOPES.BUSINESS, description: 'Hạn kỹ thuật viên nhận sự cố kể từ lúc gửi (phút)' },
  { key: CONFIG_KEYS.TICKET_PARTS_PAUSE_HOURS, value: 48, scope: CONFIG_SCOPES.BUSINESS, description: 'SLA dừng tối đa N giờ khi chờ linh kiện, quá thì cảnh báo Trưởng BQL — M5-2' },
  { key: CONFIG_KEYS.COMPLAINT_RESPONSE_HOURS, value: 48, scope: CONFIG_SCOPES.BUSINESS, description: 'Hạn phản hồi phản ánh của cư dân (giờ)' },
  { key: CONFIG_KEYS.BOOKING_PAYMENT_HOLD_MINUTES, value: 15, scope: CONFIG_SCOPES.BUSINESS, description: 'Giữ chỗ booking có phí chờ thanh toán qua payOS (phút); 0 hoặc chưa cấu hình payOS = phí gộp vào thông báo phí tháng' },
  // TECHNICAL — tham số kỹ thuật, Trưởng BQL sửa
  { key: CONFIG_KEYS.UPLOAD_MAX_SIZE_MB, value: 5, scope: CONFIG_SCOPES.TECHNICAL, description: 'Dung lượng ảnh tối đa (MB) — NFR-10' },
]);

// key → giá trị mặc định (module thuần như pricing / slot.utils đọc từ đây, không tự dựng lại map)
export const CONFIG_DEFAULTS = Object.freeze(Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c.value])));

// Tham số được phép đặt 0 = tắt tính năng (các tham số số khác phải > 0)
export const ZERO_ALLOWED_CONFIG_KEYS = Object.freeze([CONFIG_KEYS.BOOKING_PAYMENT_HOLD_MINUTES]);
