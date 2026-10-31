// Nút thao tác trên chi tiết phiếu theo quyền + trạng thái. Khớp quy tắc server (server/src/modules/tickets/ticket.rules.js);
// server vẫn kiểm tra lại, đây chỉ để ẩn nút không dùng được.
import { TICKET_FINAL_STATUSES } from '../../constants/enums.js';

const STEPS = {
  ASSIGNED: ['IN_PROGRESS', 'WAITING_CONFIRM'],
  IN_PROGRESS: ['IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CONFIRM'],
  WAITING_PARTS: ['IN_PROGRESS', 'WAITING_CONFIRM'],
};

/** Trạng thái KTV được chuyển tới; sự cố trong căn hộ chưa được đồng ý phí thì chỉ được gửi báo giá */
export function progressOptions(ticket) {
  const needsQuote = ticket.scope === 'IN_APARTMENT' && ticket.quoteDecision?.accepted !== true;
  if (needsQuote) return ticket.status === 'ASSIGNED' ? ['WAITING_QUOTE_APPROVAL'] : [];
  return STEPS[ticket.status] ?? [];
}

/** `hasRole` = useAuth().hasRole */
export function ticketActions(ticket, user, hasRole) {
  const isFinal = TICKET_FINAL_STATUSES.includes(ticket.status);
  const isIncident = ticket.type !== 'COMPLAINT';
  const dispatcher = hasRole('MANAGER', 'STAFF:RECEPTIONIST');
  const resident = hasRole('RESIDENT');
  const mine = hasRole('STAFF:TECHNICIAN') && ticket.assignedTo?._id === user.id;
  return {
    canClaim: hasRole('STAFF:TECHNICIAN') && isIncident && ticket.status === 'NEW' && !ticket.assignedTo,
    canAssign: dispatcher && isIncident && !isFinal && ticket.status !== 'WAITING_CONFIRM',
    canReject: dispatcher && ['NEW', 'ASSIGNED'].includes(ticket.status),
    canProgress: mine && progressOptions(ticket).length > 0,
    canDecideQuote: resident && ticket.status === 'WAITING_QUOTE_APPROVAL',
    canConfirm: resident && ticket.status === 'WAITING_CONFIRM',
  };
}
