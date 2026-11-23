// Dùng chung cho các trang thông báo phí (quản trị + cư dân)
import EnumTag from '../../components/EnumTag';
import { FEE_CATEGORIES } from '../../constants/enums';
import { formatMoney, formatQuantity } from '../../utils/format';

export const periodLabel = (p) => (p ? `${p.slice(5)}/${p.slice(0, 4)}` : '—');
export const aptLabel = (inv) => [inv.buildingId?.code, inv.apartmentId?.code].filter(Boolean).join('-') || '—';
export const outstandingOf = (inv) => Math.max(0, (inv.totalAmount ?? 0) - (inv.paidAmount ?? 0));

// Trạng thái có thể còn nợ (dùng để tô đỏ số còn nợ)
export const OUTSTANDING_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'];

// Tông màu badge trạng thái ở giao diện cư dân (StatusBadge)
export const INVOICE_TONE = { PAID: 'ok', OVERDUE: 'warn', UNPAID: 'info', PARTIALLY_PAID: 'info', CANCELLED: 'neutral' };

/** Cột bảng dòng phí. `extra` thêm cột cuối (vd nút xóa khoản thu khác) */
export const itemColumns = (extra) => [
  { title: 'Nhóm', dataIndex: 'feeCategory', width: 140, render: (v) => <EnumTag map={FEE_CATEGORIES} value={v} /> },
  { title: 'Diễn giải', dataIndex: 'description' },
  { title: 'SL', dataIndex: 'quantity', width: 80, align: 'right', render: formatQuantity },
  { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: formatMoney },
  { title: 'Thành tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
  ...(extra ? [extra] : []),
];
