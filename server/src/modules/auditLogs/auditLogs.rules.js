import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_KEYS, values } from '../../constants/enums.js';
import { paginationQuery } from '../../utils/pagination.js';
import { objectId } from '../../utils/validators.js';

export const FINANCIAL_ACTIONS = [
  'FEE_TYPE_CHANGED', 'AMENITY_FEE_CHANGED',
  'INVOICE_GENERATED', 'INVOICE_ADJUSTED', 'INVOICE_CANCELLED', 'INVOICE_RECALCULATED',
  'INVOICE_ITEM_ADDED', 'INVOICE_ITEM_REMOVED', 'INVOICE_SUBMITTED', 'INVOICE_PUBLISHED', 'INVOICE_RETURNED',
  'PAYMENT_CONFIRMED', 'PREPAID_REFUNDED', 'DEBT_FOLLOWUP_RECORDED', 'DEBT_NOTICE_EXPORTED',
  'FUND_INCOME_RECORDED', 'FUND_VOTED', 'FUND_PROPOSAL_APPROVED', 'FUND_PROPOSAL_REJECTED',
  'FUND_PROPOSAL_CREATED', 'FUND_PROPOSAL_CANCELLED', 'FUND_WORK_ACCEPTED', 'FUND_EXPENSE_RECORDED',
];
export const FINANCIAL_CONFIG_KEYS = [CONFIG_KEYS.FUND_APPROVAL_RATIO, CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD, CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS];
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

const LABELS = {
  FUND_PROPOSAL_CREATED: 'Tạo đề xuất chi quỹ',
  FUND_PROPOSAL_CANCELLED: 'Rút đề xuất chi quỹ',
  FUND_WORK_ACCEPTED: 'Nghiệm thu sửa chữa từ quỹ',
  FUND_EXPENSE_RECORDED: 'Ghi nhận chi quỹ',
  FUND_INCOME_RECORDED: 'Ghi nhận thu quỹ',
  FUND_VOTED: 'Biểu quyết chi quỹ',
  FUND_PROPOSAL_APPROVED: 'Duyệt đề xuất chi quỹ',
  FUND_PROPOSAL_REJECTED: 'Từ chối đề xuất chi quỹ',
  PAYMENT_CONFIRMED: 'Xác nhận thanh toán',
  FEE_TYPE_CHANGED: 'Thay đổi bảng phí',
  CONFIG_CHANGED: 'Thay đổi cấu hình',
  INVOICE_GENERATED: 'Tạo thông báo phí',
  INVOICE_ADJUSTED: 'Điều chỉnh thông báo phí',
  INVOICE_PUBLISHED: 'Phát hành thông báo phí',
  INVOICE_SUBMITTED: 'Trình duyệt thông báo phí',
  INVOICE_RETURNED: 'Trả lại thông báo phí',
  ACCOUNT_LOCKED: 'Khóa tài khoản',
  ACCOUNT_UNLOCKED: 'Mở khóa tài khoản',
  ROLE_ASSIGNED: 'Gán quyền tài khoản',
};
export const auditActionLabel = (action) => LABELS[action] ?? action.replaceAll('_', ' ');

const TARGET_LABELS = {
  maintenance_fund: 'Quỹ bảo trì', fund_transactions: 'Giao dịch quỹ', fund_proposals: 'Đề xuất chi quỹ',
  operating_expenses: 'Chi phí vận hành', users: 'Tài khoản', buildings: 'Tòa nhà', apartments: 'Căn hộ',
  contracts: 'Hợp đồng', residents: 'Cư dân', vehicles: 'Phương tiện',
  parking_cards: 'Thẻ gửi xe', fee_types: 'Bảng phí', invoices: 'Thông báo phí', payments: 'Thanh toán',
  debt_followups: 'Xử lý công nợ', repair_quotes: 'Báo giá sửa chữa', amenities: 'Tiện ích',
  amenity_passes: 'Gói tiện ích', amenity_visits: 'Lượt tiện ích', bookings: 'Đặt tiện ích',
  work_orders: 'Lệnh bảo trì', tickets: 'Sự cố và phản ánh', complaint_categories: 'Danh mục phản ánh',
  announcements: 'Bảng tin', system_configs: 'Cấu hình hệ thống', duty_shifts: 'Ca trực',
};
export const auditTargetLabel = (target) => TARGET_LABELS[target] ?? target ?? '—';

export function auditOptions(isBoard) {
  const actions = values(AUDIT_ACTIONS).filter((v) => !isBoard || FINANCIAL_ACTIONS.includes(v) || v === AUDIT_ACTIONS.CONFIG_CHANGED);
  const targets = isBoard
    ? [AUDIT_TARGETS.MAINTENANCE_FUND, AUDIT_TARGETS.FUND_TRANSACTION, AUDIT_TARGETS.FUND_PROPOSAL,
      AUDIT_TARGETS.FEE_TYPE, AUDIT_TARGETS.INVOICE, AUDIT_TARGETS.PAYMENT,
      AUDIT_TARGETS.DEBT_FOLLOWUP, AUDIT_TARGETS.AMENITY, AUDIT_TARGETS.SYSTEM_CONFIG]
    : values(AUDIT_TARGETS);
  return {
    actions: actions.map((value) => ({ value, label: auditActionLabel(value) })),
    targets: targets.filter(Boolean).map((value) => ({ value, label: auditTargetLabel(value) })),
  };
}
