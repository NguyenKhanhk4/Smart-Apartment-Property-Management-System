// Nút thao tác trên chi tiết phiếu theo quyền + trạng thái. Khớp quy tắc server (server/src/modules/tickets/ticket.rules.js);
// server vẫn kiểm tra lại, đây chỉ để ẩn nút không dùng được.
import { TICKET_FINAL_STATUSES } from '../../constants/enums.js';

const STEPS = {
  ASSIGNED: ['IN_PROGRESS', 'WAITING_CONFIRM'],
  IN_PROGRESS: ['IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CONFIRM'],
  WAITING_PARTS: ['IN_PROGRESS', 'WAITING_CONFIRM'],
};

/**
 * Trạng thái KTV được chuyển tới qua "Cập nhật tiến độ". Sự cố trong căn hộ chưa được đồng ý phí thì không có bước nào:
 * phải gửi báo giá bằng form báo giá (canQuote, POST /repair-quotes).
 */
export function progressOptions(ticket) {
  const needsQuote = ticket.scope === 'IN_APARTMENT' && ticket.quoteDecision?.accepted !== true;
  if (needsQuote) return [];
  return STEPS[ticket.status] ?? [];
}

const NOT_STARTED = ['NEW', 'ASSIGNED'];

// KTV gửi báo giá (Đã nhận), sửa bản đang chờ, hoặc báo giá lại khi đang làm phát sinh thêm (UC48)
const QUOTABLE = ['ASSIGNED', 'WAITING_QUOTE_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS'];

/** `hasRole` = useAuth().hasRole */
export function ticketActions(ticket, user, hasRole) {
  const isFinal = TICKET_FINAL_STATUSES.includes(ticket.status);
  const isIncident = ticket.type !== 'COMPLAINT';
  // Điều phối (giao, từ chối, gộp) chỉ Trưởng BQL (SRS 2.3, UC41–42); Lễ tân xem phiếu, tạo hộ và đổi phân loại
  const manager = hasRole('MANAGER');
  const desk = hasRole('MANAGER', 'STAFF:RECEPTIONIST');
  const resident = hasRole('RESIDENT');
  const mine = hasRole('STAFF:TECHNICIAN') && ticket.assignedTo?._id === user.id;
  return {
    canClaim: hasRole('STAFF:TECHNICIAN') && isIncident && ticket.status === 'NEW' && !ticket.assignedTo,
    canAssign: manager && isIncident && !isFinal && !['WAITING_CONFIRM', 'MERGED'].includes(ticket.status),
    canReject: manager && ['NEW', 'ASSIGNED'].includes(ticket.status),
    canProgress: mine && progressOptions(ticket).length > 0,
    canRespondComplaint: hasRole('MANAGER') && !isIncident && ['NEW', 'IN_PROGRESS'].includes(ticket.status),
    canQuote: mine && isIncident && ticket.scope === 'IN_APARTMENT' && QUOTABLE.includes(ticket.status),
    canDecideQuote: resident && ticket.status === 'WAITING_QUOTE_APPROVAL',
    canConfirm: resident && (ticket.status === 'WAITING_CONFIRM' ||
      (!isIncident && ticket.status === 'CLOSED' && ticket.rating == null)),
    // M5-5: đổi loại / phạm vi khi chưa bắt đầu xử lý; M5-6: gộp sự cố khu vực chung chưa bắt đầu xử lý vào phiếu khác
    canReclassify: (desk || mine) && NOT_STARTED.includes(ticket.status),
    canMerge: manager && isIncident && ticket.scope === 'COMMON_AREA' && NOT_STARTED.includes(ticket.status),
  };
}
