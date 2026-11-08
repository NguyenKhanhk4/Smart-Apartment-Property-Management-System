// Quy tắc phiếu sự cố / phản ánh — logic thuần, không đọc DB.
// Máy trạng thái sự cố: Mới → Đã nhận → (Chờ cư dân đồng ý phí) → Đang xử lý ⇄ Chờ linh kiện → Đã xong (chờ nghiệm thu)
// → Đã nghiệm thu. Phản ánh không vào hàng chờ Kỹ thuật mà chuyển sang màn hình xử lý của Trưởng BQL.
import {
  PRIORITIES,
  TICKET_FINAL_STATUSES,
  TICKET_OPEN_STATUSES,
  TICKET_SCOPES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, VN_OFFSET_MS } from '../../utils/time.js';

const { NEW, ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS, WAITING_CONFIRM } = TICKET_STATUS;

export const ROUTES = Object.freeze({ TECH_QUEUE: 'TECH_QUEUE', COMPLAINT_DESK: 'COMPLAINT_DESK' });

export const routeOf = (type) => (type === TICKET_TYPES.COMPLAINT ? ROUTES.COMPLAINT_DESK : ROUTES.TECH_QUEUE);

/**
 * Hạn SLA lúc tạo phiếu. Sự cố: hạn nhận phiếu (ackDueAt, tính từ `ackFrom` — xem ackStartAt) + hạn hoàn thành;
 * phản ánh: hạn phản hồi (responseDueAt) + hạn hoàn thành. Hạn hoàn thành lấy slaHours của loại phản ánh.
 */
export function computeDeadlines({ type, slaHours, ackMinutes, responseHours, now = new Date(), ackFrom = now }) {
  const at = (ms) => new Date(now.getTime() + ms);
  const incident = type !== TICKET_TYPES.COMPLAINT;
  return {
    dueDate: at(slaHours * HOUR_MS),
    ackDueAt: incident ? new Date(ackFrom.getTime() + ackMinutes * MINUTE_MS) : null,
    responseDueAt: incident ? null : at(responseHours * HOUR_MS),
  };
}

// Giờ hành chính kỹ thuật (TECH_WORK_START / END / DAYS). Ngoài giờ (đêm, ngày nghỉ) chỉ sự cố Khẩn cấp / Cao báo
// người trực ngay; sự cố thường chờ đầu giờ làm việc tiếp theo, hạn nhận phiếu tính từ lúc đó.
export const URGENT_PRIORITIES = Object.freeze([PRIORITIES.URGENT, PRIORITIES.HIGH]);
export const DEFAULT_WORK_HOURS = Object.freeze({ start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Tham số giờ hành chính bị sửa sai (giờ không phải HH:mm, bắt đầu ≥ kết thúc, ngày ngoài 1–7) → dùng mặc định */
export function normalizeWorkHours({ start, end, days } = {}) {
  const okTime = HHMM.test(start ?? '') && HHMM.test(end ?? '') && minutesOf(start) < minutesOf(end);
  const okDays = Array.isArray(days) && days.length > 0 && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return {
    start: okTime ? start : DEFAULT_WORK_HOURS.start,
    end: okTime ? end : DEFAULT_WORK_HOURS.end,
    days: okDays ? days : DEFAULT_WORK_HOURS.days,
  };
}

/** 00:00 giờ VN của ngày chứa `at` (dạng Date UTC) và thứ trong tuần (1 = Thứ 2 … 7 = Chủ nhật) */
function vnDay(at) {
  const shifted = new Date(new Date(at).getTime() + VN_OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - VN_OFFSET_MS;
  return { midnight, weekday: shifted.getUTCDay() || 7, minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** Đang trong giờ hành chính kỹ thuật? Khung giờ nửa mở [start, end) theo giờ VN */
export function isWorkingTime(at, wh = DEFAULT_WORK_HOURS) {
  const { weekday, minutes } = vnDay(at);
  return wh.days.includes(weekday) && minutes >= minutesOf(wh.start) && minutes < minutesOf(wh.end);
}

/** Thời điểm bắt đầu giờ làm việc gần nhất từ `at` trở đi (đang trong giờ thì chính `at`) */
export function nextWorkingStart(at, wh = DEFAULT_WORK_HOURS) {
  if (isWorkingTime(at, wh)) return new Date(at);
  const { midnight } = vnDay(at);
  for (let k = 0; k <= 7; k += 1) {
    const candidate = midnight + k * DAY_MS + minutesOf(wh.start) * MINUTE_MS;
    if (candidate > new Date(at).getTime() && wh.days.includes(vnDay(candidate).weekday)) return new Date(candidate);
  }
  return new Date(at);
}

/** Mốc bắt đầu tính hạn nhận phiếu: sự cố Khẩn cấp / Cao hoặc trong giờ → ngay; còn lại → đầu giờ làm việc tiếp theo */
export const ackStartAt = (priority, now, wh) => (URGENT_PRIORITIES.includes(priority) ? new Date(now) : nextWorkingStart(now, wh));

// M5-2 — SLA tạm dừng: Chờ cư dân đồng ý phí dừng không giới hạn; Chờ linh kiện dừng tối đa `partsMaxMs`
// (TICKET_PARTS_PAUSE_HOURS) rồi chạy tiếp. Vào trạng thái dừng ghi slaPausedAt; rời đi thì dueDate cộng bù phần đã dừng.
export const SLA_PAUSE_STATUSES = Object.freeze([WAITING_QUOTE_APPROVAL, WAITING_PARTS]);

/** Thời gian (ms) được cộng bù vào dueDate nếu rời trạng thái dừng lúc `now` */
export function slaPauseCreditMs(ticket, now, partsMaxMs) {
  if (!ticket.slaPausedAt || !SLA_PAUSE_STATUSES.includes(ticket.status)) return 0;
  const elapsed = Math.max(0, now.getTime() - new Date(ticket.slaPausedAt).getTime());
  return ticket.status === WAITING_PARTS ? Math.min(elapsed, partsMaxMs) : elapsed;
}

/** Hạn hoàn thành thực tế tại `now` (đã tính phần đang dừng) */
export function effectiveDueDate(ticket, now, partsMaxMs) {
  if (!ticket.dueDate) return null;
  return new Date(new Date(ticket.dueDate).getTime() + slaPauseCreditMs(ticket, now, partsMaxMs));
}

/** Quá hạn hoàn thành? Chờ cư dân đồng ý phí không bao giờ quá hạn (ngoài TICKET_SLA_STATUSES) */
export function isOverdue(ticket, now, partsMaxMs) {
  if (!TICKET_SLA_STATUSES.includes(ticket.status) || !ticket.dueDate) return false;
  return effectiveDueDate(ticket, now, partsMaxMs) < now;
}

/**
 * Filter Mongo tương đương isOverdue. Chờ linh kiện đang dừng từ p: dueDate + min(now − p, max) < now
 * ⟺ dueDate < p hoặc dueDate < now − max. Phiếu cũ không có slaPausedAt coi như không dừng.
 */
export function overdueFilter(now, partsMaxMs, statuses = TICKET_SLA_STATUSES) {
  const running = statuses.filter((s) => s !== WAITING_PARTS);
  const or = [];
  if (running.length) or.push({ status: { $in: running }, dueDate: { $lt: now } });
  if (statuses.includes(WAITING_PARTS)) {
    or.push({
      status: WAITING_PARTS,
      $or: [
        { slaPausedAt: null, dueDate: { $lt: now } },
        { dueDate: { $lt: new Date(now.getTime() - partsMaxMs) } },
        { $expr: { $lt: ['$dueDate', '$slaPausedAt'] } },
      ],
    });
  }
  return or.length ? { $or: or } : { _id: null };
}

/**
 * Gọi TRƯỚC khi đổi `ticket.status` sang `to` (document Mongoose hoặc object): rời trạng thái dừng → cộng bù dueDate;
 * vào trạng thái dừng → ghi slaPausedAt.
 */
export function applySlaTransition(ticket, to, now, partsMaxMs) {
  if (ticket.status === to) return;
  if (ticket.slaPausedAt) {
    if (ticket.dueDate) ticket.dueDate = effectiveDueDate(ticket, now, partsMaxMs);
    ticket.slaPausedAt = null;
    ticket.partsAlertedAt = null;
  }
  if (SLA_PAUSE_STATUSES.includes(to)) ticket.slaPausedAt = now;
}

/** Cảnh báo chờ linh kiện quá hạn dừng (chưa cảnh báo) */
export const partsPauseExceeded = (ticket, now, partsMaxMs) =>
  ticket.status === WAITING_PARTS &&
  Boolean(ticket.slaPausedAt) &&
  !ticket.partsAlertedAt &&
  now.getTime() - new Date(ticket.slaPausedAt).getTime() > partsMaxMs;

/**
 * M5-3 — Trạng thái quay về khi bản báo giá lại (vượt ngưỡng %) bị từ chối / quá hạn: trạng thái ngay trước lần chuyển
 * sang Chờ cư dân đồng ý phí gần nhất (Đang xử lý / Chờ linh kiện); không xác định được thì Đang xử lý.
 */
export function quoteResumeStatus(ticket) {
  const entry = [...(ticket.history ?? [])].reverse().find((h) => h.toStatus === WAITING_QUOTE_APPROVAL && h.fromStatus !== WAITING_QUOTE_APPROVAL);
  return [IN_PROGRESS, WAITING_PARTS].includes(entry?.fromStatus) ? entry.fromStatus : IN_PROGRESS;
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

/** Phản ánh do Trưởng BQL xử lý và đóng trực tiếp; không đi qua nghiệm thu kỹ thuật. */
export function complaintResponseError(ticket, to) {
  if (ticket.type !== TICKET_TYPES.COMPLAINT) return 'Chỉ dùng thao tác này cho phản ánh, khiếu nại';
  if (![NEW, IN_PROGRESS].includes(ticket.status) || ![IN_PROGRESS, TICKET_STATUS.CLOSED].includes(to)) {
    return `Không thể chuyển phản ánh từ ${ticket.status} sang ${to}`;
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
