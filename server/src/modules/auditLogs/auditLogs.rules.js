import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_KEYS, values } from '../../constants/enums.js';
import { paginationQuery } from '../../utils/pagination.js';
import { objectId } from '../../utils/validators.js';

export const FINANCIAL_ACTIONS = [
  'FEE_TYPE_CHANGED', 'AMENITY_FEE_CHANGED',
  'INVOICE_GENERATED', 'INVOICE_ADJUSTED', 'INVOICE_ADJUSTMENT_CANCELLED', 'INVOICE_CANCELLED', 'INVOICE_RECALCULATED',
  'INVOICE_ITEM_ADDED', 'INVOICE_ITEM_REMOVED', 'INVOICE_SUBMITTED', 'INVOICE_PUBLISHED', 'INVOICE_RETURNED',
  'PAYMENT_CONFIRMED', 'PREPAID_REFUNDED', 'DEBT_FOLLOWUP_RECORDED', 'DEBT_NOTICE_EXPORTED',
  'FUND_INCOME_RECORDED', 'FUND_VOTED', 'FUND_PROPOSAL_APPROVED', 'FUND_PROPOSAL_REJECTED',
  'FUND_PROPOSAL_CREATED', 'FUND_PROPOSAL_CANCELLED', 'FUND_WORK_ACCEPTED', 'FUND_EXPENSE_RECORDED',
  // UC05 – Cấu hình tòa nhà & biểu phí (Vũ Việt)
  'BUILDING_PROFILE_UPDATED', 'UTILITY_TARIFF_CREATED', 'UTILITY_TARIFF_DELETED', 'COLLECTION_SETTING_CHANGED',
  // UC10 – Trưởng BQL duyệt sửa bằng Quỹ bảo trì, kết quả biểu quyết / rút đề xuất báo về phiếu bảo trì
  'WORKORDER_FUND_REQUESTED', 'WORKORDER_FUND_DECIDED',
];
export const FINANCIAL_CONFIG_KEYS = [
  CONFIG_KEYS.FUND_APPROVAL_RATIO, CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD, CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS,
  CONFIG_KEYS.PAYMENT_TERM_DAYS, CONFIG_KEYS.BILLING_REMIND_DAY,
];
export const financialAuditFilter = () => ({
  $or: [
    { action: { $in: FINANCIAL_ACTIONS } },
    { action: AUDIT_ACTIONS.CONFIG_CHANGED, 'metadata.key': { $in: FINANCIAL_CONFIG_KEYS } },
  ],
});

export const auditQuery = Joi.object({
  ...paginationQuery,
  from: Joi.date().iso(),
  to: Joi.date().iso().when('from', { is: Joi.exist(), then: Joi.date().min(Joi.ref('from')) }),
  action: Joi.string().valid(...values(AUDIT_ACTIONS)),
  performedBy: objectId(),
  targetType: Joi.string().trim().max(80),
  targetId: objectId(),
  q: Joi.string().trim().max(100).allow(''),
});

// UC06 bước 5 (UC65): xuất đúng bộ lọc đang xem (BR-D02), không phân trang
export const auditExportQuery = auditQuery
  .fork(['page', 'limit'], (s) => s.strip())
  .keys({ format: Joi.string().valid('xlsx', 'pdf').required() });

// Nhãn tiếng Việt của mọi hành động; test kiểm tra hành động mới thêm vào AUDIT_ACTIONS phải có nhãn
export const LABELS = {
  PARCEL_RECEIVED: 'Tiếp nhận bưu kiện',
  PARCEL_HANDED_OVER: 'Bàn giao hoặc trả bưu kiện',
  // Tài khoản (Mô đun 1)
  ROLE_ASSIGNED: 'Gán vai trò tài khoản',
  ACCOUNT_LOCKED: 'Khóa tài khoản',
  ACCOUNT_UNLOCKED: 'Mở khóa tài khoản',
  ACCOUNT_ACTIVATED: 'Kích hoạt tài khoản',
  PASSWORD_RESET: 'Đặt lại mật khẩu',
  ACTIVATION_CODE_ISSUED: 'Cấp mã kích hoạt tại quầy',
  PHONE_CHANGED: 'Đổi số điện thoại đăng nhập',
  EMAIL_CHANGED: 'Đổi email',
  CONSENT_CHANGED: 'Đổi lựa chọn điều khoản dữ liệu',
  AUDIT_LOG_EXPORTED: 'Xuất nhật ký hoạt động',
  ROLE_PERMISSIONS_CHANGED: 'Thay đổi phân quyền vai trò',
  CONFIG_CHANGED: 'Thay đổi cấu hình',
  // Tòa, căn, hợp đồng, cư dân
  BUILDING_CHANGED: 'Thay đổi tòa nhà',
  APARTMENT_CHANGED: 'Thay đổi căn hộ',
  OWNER_ACCOUNT_ISSUED: 'Cấp tài khoản chủ sở hữu',
  APARTMENT_OWNER_CHANGED: 'Đổi chủ sở hữu căn hộ',
  CONTRACT_CREATED: 'Tạo hợp đồng',
  CONTRACT_UPDATED: 'Sửa hợp đồng',
  CONTRACT_TERMINATED: 'Chấm dứt hợp đồng',
  CONTRACT_EXPIRED: 'Hợp đồng hết hạn',
  RESIDENT_ASSIGNED: 'Thêm cư dân vào căn',
  RESIDENT_REMOVED: 'Cho cư dân rời căn',
  RESIDENT_UPDATED: 'Sửa thông tin cư dân',
  RESIDENT_CHANGES_EXPORTED: 'Xuất báo cáo biến động nhân khẩu',
  RESIDENT_OCCUPANCY_EXPORTED: 'Xuất báo cáo cư trú',
  RESIDENT_ID_VIEWED: 'Xem số CCCD',
  VEHICLE_APPROVED: 'Duyệt đăng ký xe',
  VEHICLE_REJECTED: 'Từ chối đăng ký xe',
  VEHICLE_CANCELLED: 'Hủy đăng ký xe',
  PARKING_CARD_ISSUED: 'Cấp thẻ gửi xe',
  PARKING_CARD_HANDED_OVER: 'Bàn giao thẻ gửi xe',
  PARKING_CARD_DISABLED: 'Khóa thẻ gửi xe',
  PARKING_CARD_RETURNED: 'Trả thẻ gửi xe',
  PARKING_CARD_LOST: 'Báo mất thẻ gửi xe',
  GATEPASS_CREATED: 'Tạo giấy chuyển đồ',
  GATEPASS_OWNER_APPROVED: 'Chủ hộ đồng ý giấy chuyển đồ',
  GATEPASS_OWNER_REJECTED: 'Chủ hộ từ chối giấy chuyển đồ',
  GATEPASS_APPROVED: 'Duyệt giấy chuyển đồ',
  GATEPASS_REJECTED: 'Từ chối giấy chuyển đồ',
  GATEPASS_USED: 'Sử dụng giấy chuyển đồ',
  GATEPASS_EXPIRED: 'Giấy chuyển đồ hết hạn',
  GATEPASS_CANCELLED: 'Hủy giấy chuyển đồ',
  // Phí, thanh toán, công nợ
  FEE_TYPE_CHANGED: 'Thay đổi bảng phí',
  AMENITY_FEE_CHANGED: 'Thay đổi phí tiện ích',
  INVOICE_GENERATED: 'Tạo thông báo phí',
  INVOICE_ADJUSTED: 'Lập khoản điều chỉnh thông báo phí',
  INVOICE_ADJUSTMENT_CANCELLED: 'Hủy khoản điều chỉnh thông báo phí',
  INVOICE_CANCELLED: 'Hủy thông báo phí',
  INVOICE_RECALCULATED: 'Tính lại thông báo phí',
  INVOICE_ITEM_ADDED: 'Thêm khoản vào thông báo phí',
  INVOICE_ITEM_REMOVED: 'Bỏ khoản khỏi thông báo phí',
  INVOICE_SUBMITTED: 'Trình duyệt thông báo phí',
  INVOICE_PUBLISHED: 'Phát hành thông báo phí',
  INVOICE_RETURNED: 'Trả lại thông báo phí',
  PAYMENT_CONFIRMED: 'Xác nhận thanh toán',
  BOOKING_PAYMENT_CONFIRMED: 'Xác nhận thanh toán đặt tiện ích',
  PREPAID_REFUNDED: 'Hoàn tiền trả trước',
  DEBT_FOLLOWUP_RECORDED: 'Ghi nhận xử lý công nợ',
  DEBT_NOTICE_EXPORTED: 'Xuất giấy báo nợ',
  // Quỹ bảo trì
  FUND_INCOME_RECORDED: 'Ghi nhận thu quỹ',
  FUND_PROPOSAL_CREATED: 'Tạo đề xuất chi quỹ',
  FUND_PROPOSAL_CANCELLED: 'Rút đề xuất chi quỹ',
  FUND_VOTED: 'Biểu quyết chi quỹ',
  FUND_PROPOSAL_APPROVED: 'Duyệt đề xuất chi quỹ',
  FUND_PROPOSAL_REJECTED: 'Từ chối đề xuất chi quỹ',
  FUND_WORK_ACCEPTED: 'Nghiệm thu sửa chữa từ quỹ',
  FUND_EXPENSE_RECORDED: 'Ghi nhận chi quỹ',
  // Sự cố, bảo trì, phản ánh
  TICKET_ASSIGNED: 'Phân công xử lý sự cố',
  TICKET_CLAIMED: 'Nhận xử lý sự cố',
  TICKET_ESCALATED: 'Chuyển cấp sự cố',
  TICKET_CLOSED: 'Đóng phiếu sự cố',
  TICKET_QUOTE_DECIDED: 'Quyết định báo giá sửa chữa',
  TICKET_RECLASSIFIED: 'Đổi loại phiếu sự cố',
  TICKET_MERGED: 'Gộp phiếu sự cố trùng',
  TICKET_COMPLAINT_RESPONDED: 'Trả lời phản ánh',
  REPAIR_QUOTE_SUBMITTED: 'Gửi báo giá sửa chữa',
  WORKORDER_ASSIGNED: 'Phân công phiếu bảo trì',
  ASSET_CREATED: 'Thêm thiết bị',
  ASSET_UPDATED: 'Sửa thiết bị',
  WORKORDER_INSPECTED: 'Nộp kết quả kiểm tra thiết bị',
  WORKORDER_FAULT_REPORTED: 'Báo cáo hư hỏng thiết bị',
  WORKORDER_REPAIR_APPROVED: 'Duyệt sửa chữa thiết bị',
  WORKORDER_ACCEPTANCE_UPLOADED: 'Tải biên bản nghiệm thu sửa chữa',
  WORKORDER_REPAIR_ACCEPTED: 'Nghiệm thu sửa chữa thiết bị',
  WORKORDER_REPAIR_RETURNED: 'Yêu cầu sửa lại thiết bị',
  WORKORDER_FUND_REQUESTED: 'Duyệt sửa chữa bằng Quỹ bảo trì',
  WORKORDER_FUND_DECIDED: 'Kết quả đề xuất chi quỹ cho sửa chữa',
  WORKORDER_REPAIR_POSTPONED: 'Tạm hoãn sửa chữa thiết bị',
  WORKORDER_REPAIR_REQUESTED: 'Gửi yêu cầu sửa lại thiết bị đang hoãn',
  WORKORDER_REPAIR_RETIRED: 'Ngừng sử dụng thiết bị hư hỏng',
  ASSET_DEACTIVATED: 'Ngừng theo dõi thiết bị',
  ASSET_REACTIVATED: 'Theo dõi lại thiết bị',
  COMPLAINT_CATEGORY_CHANGED: 'Thay đổi danh mục phản ánh',
  DUTY_SHIFT_CREATED: 'Tạo ca trực',
  DUTY_SHIFT_DELETED: 'Xóa ca trực',
  DUTY_SHIFT_UPDATED: 'Sửa ca trực',
  // UC05 – Cấu hình tòa nhà & biểu phí (Vũ Việt)
  BUILDING_PROFILE_UPDATED: 'Cập nhật thông tin tòa nhà',
  UTILITY_TARIFF_CREATED: 'Thêm biểu giá điện/nước',
  UTILITY_TARIFF_DELETED: 'Xóa biểu giá điện/nước',
  COLLECTION_SETTING_CHANGED: 'Thay đổi công tắc thu hộ',
  // Tiện ích, bảng tin
  BOOKING_CANCELLED_BY_STAFF: 'Nhân viên hủy đặt tiện ích',
  AMENITY_VISIT_CANCELLED: 'Hủy lượt vào tiện ích',
  ANNOUNCEMENT_PUBLISHED: 'Đăng bảng tin',
};
export const auditActionLabel = (action) => LABELS[action] ?? action.replaceAll('_', ' ');

const TARGET_LABELS = {
  parcels: 'Bưu kiện',
  maintenance_fund: 'Quỹ bảo trì', fund_transactions: 'Giao dịch quỹ', fund_proposals: 'Đề xuất chi quỹ',
  operating_expenses: 'Chi phí vận hành', users: 'Tài khoản', buildings: 'Tòa nhà', apartments: 'Căn hộ',
  contracts: 'Hợp đồng', residents: 'Cư dân', vehicles: 'Phương tiện',
  gate_passes: 'Giấy chuyển đồ', parking_cards: 'Thẻ gửi xe', fee_types: 'Bảng phí', invoices: 'Thông báo phí', invoice_adjustments: 'Điều chỉnh thông báo phí',
  payments: 'Thanh toán',
  debt_followups: 'Xử lý công nợ', repair_quotes: 'Báo giá sửa chữa', amenities: 'Tiện ích',
  amenity_passes: 'Gói tiện ích', amenity_visits: 'Lượt tiện ích', bookings: 'Đặt tiện ích',
  work_orders: 'Lệnh bảo trì', tickets: 'Sự cố và phản ánh', complaint_categories: 'Danh mục phản ánh',
  announcements: 'Bảng tin', system_configs: 'Cấu hình hệ thống', duty_shifts: 'Ca trực',
  audit_logs: 'Nhật ký hoạt động', assets: 'Thiết bị', role_permissions: 'Phân quyền',
  building_profile: 'Thông tin tòa nhà', utility_tariffs: 'Biểu giá điện/nước', collection_settings: 'Công tắc thu hộ',
};
// Log cũ ghi targetType theo tên model ('Resident', 'Contract'...). Không sửa dữ liệu trên DB dùng chung:
// đọc theo tên mới, và khi lọc theo đối tượng thì gồm cả tên cũ (giống bảng của scripts/migrateAuditTargets.js)
export const LEGACY_TARGETS = {
  User: AUDIT_TARGETS.USER,
  Building: AUDIT_TARGETS.BUILDING,
  Apartment: AUDIT_TARGETS.APARTMENT,
  Contract: AUDIT_TARGETS.CONTRACT,
  Resident: AUDIT_TARGETS.RESIDENT,
  Vehicle: AUDIT_TARGETS.VEHICLE,
  GatePass: 'gate_passes',
  ParkingCard: AUDIT_TARGETS.PARKING_CARD,
};
/** Tên đối tượng mới → [tên mới, các tên cũ] để lọc */
export const targetTypeAliases = (target) => [target, ...Object.keys(LEGACY_TARGETS).filter((k) => LEGACY_TARGETS[k] === target)];
/** Đổi tên cũ về tên collection */
export const normalizeTarget = (target) => LEGACY_TARGETS[target] ?? target;

export const auditTargetLabel = (target) => TARGET_LABELS[normalizeTarget(target)] ?? target ?? '—';

export function auditOptions(isBoard) {
  const actions = values(AUDIT_ACTIONS).filter((v) => !isBoard || FINANCIAL_ACTIONS.includes(v) || v === AUDIT_ACTIONS.CONFIG_CHANGED);
  const targets = isBoard
    ? [AUDIT_TARGETS.MAINTENANCE_FUND, AUDIT_TARGETS.FUND_TRANSACTION, AUDIT_TARGETS.FUND_PROPOSAL,
      AUDIT_TARGETS.FEE_TYPE, AUDIT_TARGETS.INVOICE, AUDIT_TARGETS.INVOICE_ADJUSTMENT, AUDIT_TARGETS.PAYMENT,
      AUDIT_TARGETS.DEBT_FOLLOWUP, AUDIT_TARGETS.AMENITY, AUDIT_TARGETS.SYSTEM_CONFIG,
      AUDIT_TARGETS.BUILDING_PROFILE, AUDIT_TARGETS.UTILITY_TARIFF, AUDIT_TARGETS.COLLECTION_SETTING, AUDIT_TARGETS.WORK_ORDER]
    : values(AUDIT_TARGETS);
  return {
    actions: actions.map((value) => ({ value, label: auditActionLabel(value) })),
    targets: targets.filter(Boolean).map((value) => ({ value, label: auditTargetLabel(value) })),
  };
}
