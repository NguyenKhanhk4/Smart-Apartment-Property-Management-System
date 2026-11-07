// Hiển thị giá trị cũ / mới của nhật ký hoạt động (UC06 bước 4). Thuần JS để test bằng node:test.
import {
  APARTMENT_STATUS, BOARD_TITLES, BOOKING_STATUS, CONTRACT_STATUS, CONTRACT_TYPES, FUND_PROPOSAL_STATUS, GATE_PASS_STATUS,
  INVOICE_STATUS, PARKING_CARD_STATUS, PRIORITIES, QUOTE_STATUS, ROLE_TITLES, ROLES, TICKET_STATUS, TICKET_TYPES,
  VEHICLE_STATUS, WORK_ORDER_STATUS,
} from '../../constants/enums.js';

// Trạng thái phụ thuộc loại đối tượng: cùng mã 'ACTIVE' nhưng hợp đồng và thẻ xe có nhãn khác nhau
const STATUS_BY_TARGET = {
  tickets: TICKET_STATUS, invoices: INVOICE_STATUS, contracts: CONTRACT_STATUS, vehicles: VEHICLE_STATUS,
  gate_passes: GATE_PASS_STATUS, parking_cards: PARKING_CARD_STATUS, work_orders: WORK_ORDER_STATUS,
  bookings: BOOKING_STATUS, fund_proposals: FUND_PROPOSAL_STATUS, apartments: APARTMENT_STATUS, repair_quotes: QUOTE_STATUS,
};
const STATUS_FIELDS = new Set(['status', 'fromStatus', 'toStatus']);
// Trường `type` cũng phụ thuộc đối tượng. Loại căn: nhãn giống APARTMENT_TYPES trên nhánh của Bình (chưa vào main)
const TYPE_BY_TARGET = {
  apartments: { RESIDENTIAL: { label: 'Căn để ở' }, COMMERCIAL: { label: 'Căn kinh doanh' } },
  contracts: CONTRACT_TYPES,
  tickets: TICKET_TYPES,
};
const ACCOUNT_STATE = { true: { label: 'Đang hoạt động', color: 'success' }, false: { label: 'Đã khóa', color: 'error' } };

/** Trường trạng thái → { label, color } để hiện Tag; không phải trạng thái hoặc mã lạ → null */
export function statusOf(field, value, targetType) {
  if (field === 'isActive' && typeof value === 'boolean') return ACCOUNT_STATE[value];
  if (STATUS_FIELDS.has(field) && typeof value === 'string') return STATUS_BY_TARGET[targetType]?.[value] ?? null;
  return null;
}

const MONEY_FIELDS = new Set(['amount', 'balanceBefore', 'balanceAfter', 'totalAmount', 'paidAmount', 'fee', 'bookingFee']);
const ENUM_FIELDS = { role: ROLES, roleTitle: ROLE_TITLES, boardTitle: BOARD_TITLES, priority: PRIORITIES };

export const FIELD_LABELS = {
  value: 'Giá trị',
  role: 'Vai trò', roleTitle: 'Chức danh', boardTitle: 'Chức danh BQT', isActive: 'Trạng thái tài khoản',
  fromStatus: 'Trạng thái trước', toStatus: 'Trạng thái sau',
  fullName: 'Họ tên', code: 'Mã', name: 'Tên', status: 'Trạng thái', endDate: 'Ngày kết thúc', startDate: 'Ngày bắt đầu',
  floor: 'Tầng', area: 'Diện tích', type: 'Loại', tenantPaysFees: 'Người thuê đóng phí',
  amount: 'Số tiền', balanceBefore: 'Số dư trước giao dịch', balanceAfter: 'Số dư sau giao dịch',
  fundId: 'Mã quỹ', transactionId: 'Mã giao dịch', proposalId: 'Mã đề xuất', source: 'Nguồn thu',
  description: 'Nội dung', occurredAt: 'Thời điểm thu/chi', period: 'Kỳ', receiptNo: 'Số phiếu thu',
  invoiceId: 'Mã thông báo phí', invoiceIds: 'Các thông báo phí', totalAmount: 'Tổng tiền',
  paidAmount: 'Đã thanh toán', method: 'Phương thức', key: 'Tham số', reason: 'Lý do',
  count: 'Số lượng', decision: 'Quyết định', format: 'Định dạng', filters: 'Bộ lọc', policyVersion: 'Phiên bản điều khoản',
  channel: 'Kênh', purpose: 'Mục đích', expiresAt: 'Hết hạn', note: 'Ghi chú',
  action: 'Thao tác', netArea: 'Diện tích thông thủy', handoverDate: 'Ngày bàn giao', occupancyStatus: 'Tình trạng sử dụng',
  totalFloors: 'Số tầng', address: 'Địa chỉ', fileUrl: 'File hợp đồng', op: 'Thao tác',
  priority: 'Mức ưu tiên', classification: 'Phân loại', assignee: 'Người phụ trách', dueDate: 'Hạn xử lý',
  assignedTo: 'Giao cho', prevAssignee: 'Người phụ trách trước', rating: 'Đánh giá', accepted: 'Chấp nhận',
  autoClosed: 'Tự đóng', parent: 'Phiếu chính', ticket: 'Phiếu sự cố', version: 'Phiên bản', assetId: 'Thiết bị',
  generatedBy: 'Cách lập', created: 'Số đã tạo', failed: 'Số lỗi', skipped: 'Số bỏ qua', exists: 'Số đã có',
  total: 'Tổng', overdueTotal: 'Tổng quá hạn', invoices: 'Thông báo phí', credit: 'Tiền dư', reference: 'Mã tham chiếu',
  orderCode: 'Mã đơn', promisedDate: 'Ngày hẹn trả', cardNumber: 'Số thẻ', recipientCount: 'Số người nhận',
};

// Giá trị dạng mã của một số trường → chữ
const OPERATIONS = { CREATE: 'Tạo mới', UPDATE: 'Cập nhật', DELETE: 'Xóa', DEACTIVATE: 'Ngừng dùng' };
const VALUE_LABELS = {
  action: OPERATIONS,
  op: OPERATIONS,
  generatedBy: { MANUAL: 'Kế toán lập tay', CRON: 'Hệ thống tự lập' },
  method: { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', PAYOS: 'PayOS' },
};
const PERIOD = /^(\d{4})-(\d{2})$/; // kỳ phí '2026-11' → '11/2026'

export const fieldLabel = (field) => FIELD_LABELS[field] ?? field;

/**
 * Mã bản ghi dễ đọc: mã / tên server tra được (TK-…, A-1203, tên người…); thao tác hàng loạt theo kỳ → "Cả kỳ 11/2026";
 * không tra được thì null (giao diện hiện ID rút gọn)
 */
export function targetText(log) {
  if (log.targetName) return log.targetName;
  if (!log.targetId && typeof log.metadata?.period === 'string') return `Cả kỳ ${formatAuditValue('period', log.metadata.period)}`;
  return null;
}

/** Cột IP: job tự chạy không có request → "Hệ thống"; log cũ của người dùng chưa ghi IP → "Không ghi nhận" */
export const ipLabel = (log) => log.ip || (log.performedBy ? 'Không ghi nhận' : 'Hệ thống');

const money = (n) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const pad = (n) => String(n).padStart(2, '0');
const dateTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Một giá trị cũ / mới → chữ dễ đọc. undefined (trường không có ở phía đó) và null đều hiện "—" */
export function formatAuditValue(field, value, targetType) {
  if (value === undefined || value === null || value === '') return '—';
  const status = statusOf(field, value, targetType);
  if (status) return status.label;
  if (field === 'type' && typeof value === 'string' && TYPE_BY_TARGET[targetType]?.[value]) return TYPE_BY_TARGET[targetType][value].label;
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number' && MONEY_FIELDS.has(field)) return money(value);
  if (typeof value === 'string' && ENUM_FIELDS[field]?.[value]) return ENUM_FIELDS[field][value].label;
  if (typeof value === 'string' && VALUE_LABELS[field]?.[value]) return VALUE_LABELS[field][value];
  if (field === 'period' && typeof value === 'string' && PERIOD.test(value)) return value.replace(PERIOD, '$2/$1');
  if (typeof value === 'string' && ISO_DATE.test(value)) return dateTime(value);
  if (Array.isArray(value)) return value.map((v) => formatAuditValue(field, v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
