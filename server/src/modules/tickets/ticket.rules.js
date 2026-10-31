// Quy tắc phiếu sự cố / phản ánh (Người 4) — logic thuần, không đọc DB.
// Máy trạng thái sự cố: Mới → Đã nhận → (Chờ cư dân đồng ý phí) → Đang xử lý ⇄ Chờ linh kiện → Đã xong (chờ nghiệm thu)
// → Đã nghiệm thu. Phản ánh không vào hàng chờ Kỹ thuật mà chuyển sang màn hình xử lý của Trưởng BQL (Người 2).
import {
  TICKET_FINAL_STATUSES,
  TICKET_OPEN_STATUSES,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { HOUR_MS, MINUTE_MS } from '../../utils/time.js';

const { NEW, ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS, WAITING_CONFIRM } = TICKET_STATUS;

export const ROUTES = Object.freeze({ TECH_QUEUE: 'TECH_QUEUE', COMPLAINT_DESK: 'COMPLAINT_DESK' });

export const routeOf = (type) => (type === TICKET_TYPES.COMPLAINT ? ROUTES.COMPLAINT_DESK : ROUTES.TECH_QUEUE);

/**
 * Hạn SLA lúc tạo phiếu. Sự cố: hạn nhận phiếu (ackDueAt) + hạn hoàn thành; phản ánh: hạn phản hồi (responseDueAt)
 * + hạn hoàn thành. Hạn hoàn thành lấy slaHours của loại phản ánh (xem quy tắc SLA ở tickets.service).
 */
export function computeDeadlines({ type, slaHours, ackMinutes, responseHours, now = new Date() }) {
  const at = (ms) => new Date(now.getTime() + ms);
  const incident = type !== TICKET_TYPES.COMPLAINT;
  return {
    dueDate: at(slaHours * HOUR_MS),
    ackDueAt: incident ? at(ackMinutes * MINUTE_MS) : null,
    responseDueAt: incident ? null : at(responseHours * HOUR_MS),
  };
}

// Trạng thái KTV được tự chuyển tới (WAITING_QUOTE_APPROVAL → IN_PROGRESS do cư dân quyết định, không phải KTV)
const PROGRESS_TRANSITIONS = {
  [ASSIGNED]: [WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_CONFIRM],
  [IN_PROGRESS]: [IN_PROGRESS, WAITING_PARTS, WAITING_CONFIRM],
  [WAITING_PARTS]: [IN_PROGRESS, WAITING_CONFIRM],
};

const quoteAccepted = (ticket) => ticket.quoteDecision?.accepted === true;

/** Lỗi khi KTV chuyển `ticket` sang `to` (chuỗi tiếng Việt), hoặc null nếu hợp lệ */
export function progressError(ticket, to) {
  if (!PROGRESS_TRANSITIONS[ticket.status]?.includes(to)) return `Không thể chuyển từ ${ticket.status} sang ${to}`;
  const inApartment = ticket.scope === TICKET_SCOPES.IN_APARTMENT;
  if (to === WAITING_QUOTE_APPROVAL && !inApartment) return 'Chỉ sự cố trong căn hộ mới cần báo giá cho cư dân';
  if (inApartment && to !== WAITING_QUOTE_APPROVAL && !quoteAccepted(ticket)) {
    return 'Sự cố trong căn hộ: cần gửi báo giá và chờ cư dân đồng ý phí trước khi xử lý';
  }
  return null;
}

/** Vi phạm SLA chưa cảnh báo: 'ACK' (sự cố chưa ai nhận quá hạn nhận), 'RESPONSE' (phản ánh chưa phản hồi quá hạn) */
export function slaBreaches(ticket, now = new Date()) {
  const late = (due) => Boolean(due) && new Date(due).getTime() < now.getTime();
  const breaches = [];
  if (
    ticket.type !== TICKET_TYPES.COMPLAINT &&
    ticket.status === NEW &&
    !ticket.assignedTo &&
    !ticket.ackAlertedAt &&
    late(ticket.ackDueAt)
  ) {
    breaches.push('ACK');
  }
  if (
    ticket.type === TICKET_TYPES.COMPLAINT &&
    !TICKET_FINAL_STATUSES.includes(ticket.status) &&
    !ticket.respondedAt &&
    !ticket.responseAlertedAt &&
    late(ticket.responseDueAt)
  ) {
    breaches.push('RESPONSE');
  }
  return breaches;
}

// Cột Kanban của Trưởng BQL: các trạng thái đang mở + chờ nghiệm thu (đã đóng không hiện)
export const BOARD_STATUSES = Object.freeze([...TICKET_OPEN_STATUSES, WAITING_CONFIRM]);

export const groupBoard = (tickets) =>
  BOARD_STATUSES.map((status) => ({ status, items: tickets.filter((x) => x.status === status) }));
