// Helper trạng thái dựa trên nhóm chung ở constants/enums.js — trang không tự liệt kê danh sách trạng thái.
import { TICKET_FINAL_STATUSES, TICKET_OPEN_STATUSES } from '../constants/enums.js';

export const isTicketOpen = (status) => TICKET_OPEN_STATUSES.includes(status);
export const isTicketFinal = (status) => TICKET_FINAL_STATUSES.includes(status);

// Màu hex cho biểu đồ (recharts không dùng được tên màu antd Tag)
const TICKET_STATUS_HEX = {
  NEW: '#1677ff',
  ASSIGNED: '#13c2c2',
  WAITING_QUOTE_APPROVAL: '#722ed1',
  IN_PROGRESS: '#2f54eb',
  WAITING_PARTS: '#fa8c16',
  WAITING_CONFIRM: '#faad14',
  CLOSED: '#52c41a',
  REJECTED: '#8c8c8c',
};
const FALLBACK_HEX = '#bfbfbf';
export const ticketStatusColor = (status) => TICKET_STATUS_HEX[status] ?? FALLBACK_HEX;

export const PRIORITY_HEX = { LOW: '#8c8c8c', MEDIUM: '#1677ff', HIGH: '#fa8c16', URGENT: '#f5222d' };
export const priorityColor = (priority) => PRIORITY_HEX[priority] ?? FALLBACK_HEX;

/** { KEY: { label } } → { KEY: 'KEY' } để so sánh giá trị: const R = keysOf(PLATE_LOOKUP_RESULTS); r === R.UNKNOWN */
export const keysOf = (enumMap) => Object.freeze(Object.fromEntries(Object.keys(enumMap).map((k) => [k, k])));
