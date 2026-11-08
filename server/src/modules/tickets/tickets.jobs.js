import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PRIORITY_ORDER,
  TICKET_HISTORY_ACTIONS as ACT,
  TICKET_FINAL_STATUSES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { Ticket } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { DAY_MS, HOUR_MS, fmtDateTimeVn, startOfVnDay } from '../../utils/time.js';
import { isOverdue, partsPauseExceeded, slaBreaches } from './ticket.rules.js';
import { closeMergedChildren } from './tickets.service.js';

const partsPauseMs = async () => Number(await getConfig(CONFIG_KEYS.TICKET_PARTS_PAUSE_HOURS)) * HOUR_MS;

/**
 * UC-E06 / BR-O8 — [Cron 09:00] Ticket chưa xong mà quá dueDate → nâng 1 mức ưu tiên
 * (LOW→MEDIUM→HIGH→URGENT, đã URGENT thì giữ), tối đa 1 lần/ngày, báo Trưởng BQL + KTV phụ trách.
 * Gồm cả ticket NEW chưa ai nhận (quá hạn vẫn phải có người chịu trách nhiệm — mục tiêu G6) và ticket chờ linh kiện;
 * bỏ qua ticket chờ cư dân đồng ý phí (TICKET_SLA_STATUSES — SLA tạm dừng); chờ linh kiện được cộng bù tối đa
 * TICKET_PARTS_PAUSE_HOURS (M5-2).
 * Trả về số ticket đã leo thang (affectedCount cho cron_runs).
 *
 * Mỗi ticket được cập nhật bằng updateOne có điều kiện (status còn mở + chưa leo thang hôm nay):
 * 2 lần chạy chồng nhau (cron + chạy tay) hoặc KTV vừa đóng ticket → chỉ 1 bên cập nhật được.
 */
export async function escalateOverdueTickets(now = new Date()) {
  const todayStart = startOfVnDay(now);
  const notEscalatedToday = { $or: [{ escalatedAt: null }, { escalatedAt: { $lt: todayStart } }] };
  const tickets = await Ticket.find({
    status: { $in: TICKET_SLA_STATUSES },
    dueDate: { $lt: now },
    ...notEscalatedToday,
  })
    .select('code title priority status assignedTo dueDate slaPausedAt')
    .lean();
  const partsMs = await partsPauseMs();

  let affected = 0;
  for (const ticket of tickets) {
    if (!isOverdue(ticket, now, partsMs)) continue; // chờ linh kiện còn trong thời gian dừng SLA
    const from = ticket.priority;
    const idx = PRIORITY_ORDER.indexOf(from);
    const to = PRIORITY_ORDER[Math.min(idx + 1, PRIORITY_ORDER.length - 1)];

    const res = await Ticket.updateOne(
      { _id: ticket._id, status: { $in: TICKET_SLA_STATUSES }, priority: from, ...notEscalatedToday },
      {
        $set: { priority: to, priorityRank: PRIORITY_ORDER.indexOf(to), escalatedAt: now },
        $inc: { escalationCount: 1, __v: 1 },
        $push: {
          history: {
            at: now,
            by: null,
            action: ACT.ESCALATED,
            fromStatus: ticket.status,
            toStatus: ticket.status,
            note: from === to ? `Quá hạn — giữ mức ${to}` : `Quá hạn — nâng ưu tiên ${from} → ${to}`,
          },
        },
      },
    );
    if (!res.modifiedCount) continue; // bên khác đã xử lý
    affected += 1;

    await logAudit({
      action: AUDIT_ACTIONS.TICKET_ESCALATED,
      user: null,
      targetType: AUDIT_TARGETS.TICKET,
      targetId: ticket._id,
      metadata: { code: ticket.code, from, to, dueDate: ticket.dueDate },
    });

    const payload = {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Phản ánh ${ticket.code} quá hạn xử lý`,
      content: `"${ticket.title}" đã quá hạn${from === to ? '' : `, ưu tiên nâng ${from} → ${to}`}.`,
      refId: ticket._id,
      link: `/app/tickets/${ticket._id}`,
    };
    await notifyRoles(['MANAGER'], { ...payload, email: true });
    if (ticket.assignedTo) await notify(ticket.assignedTo, payload);
  }
  return affected;
}

/**
 * M5-1 — Ticket WAITING_CONFIRM quá TICKET_AUTO_CLOSE_DAYS (mặc định 3) ngày cư dân không phản hồi
 * → tự chuyển Đã nghiệm thu (CLOSED, không có rating; phí sửa trong căn vẫn vào thông báo phí kỳ sau);
 * trước hạn 1 ngày nhắc cư dân của căn (1 lần). Cập nhật có điều kiện status để không đóng đè lên
 * cư dân vừa xác nhận/không đồng ý, hoặc 2 lần chạy chồng nhau.
 */
export async function autoCloseTickets(now = new Date()) {
  const days = Number(await getConfig(CONFIG_KEYS.TICKET_AUTO_CLOSE_DAYS));
  const filter = {
    status: TICKET_STATUS.WAITING_CONFIRM,
    resolvedAt: { $lt: new Date(now.getTime() - days * DAY_MS) },
  };
  const tickets = await Ticket.find(filter).select('code title').lean();

  let affected = 0;
  for (const ticket of tickets) {
    const res = await Ticket.updateOne(
      { _id: ticket._id, ...filter },
      {
        $set: { status: TICKET_STATUS.CLOSED, closedAt: now, autoClosed: true },
        $inc: { __v: 1 },
        $push: {
          history: {
            at: now,
            by: null,
            action: ACT.AUTO_CLOSED,
            fromStatus: TICKET_STATUS.WAITING_CONFIRM,
            toStatus: TICKET_STATUS.CLOSED,
            note: `Tự nghiệm thu sau ${days} ngày cư dân không phản hồi`,
          },
        },
      },
    );
    if (!res.modifiedCount) continue;
    affected += 1;
    await logAudit({
      action: AUDIT_ACTIONS.TICKET_CLOSED,
      user: null,
      targetType: AUDIT_TARGETS.TICKET,
      targetId: ticket._id,
      metadata: { code: ticket.code, autoClosed: true },
    });
    await closeMergedChildren({ _id: ticket._id, code: ticket.code, title: ticket.title, status: TICKET_STATUS.CLOSED }, now);
  }

  // Nhắc trước 1 ngày: phiếu sẽ tự nghiệm thu ở lần chạy tới
  const remind = {
    status: TICKET_STATUS.WAITING_CONFIRM,
    confirmRemindedAt: null,
    resolvedAt: { $lt: new Date(now.getTime() - Math.max(days - 1, 0) * DAY_MS) },
  };
  const due = await Ticket.find(remind).select('code title apartmentId resolvedAt').lean();
  for (const ticket of due) {
    const res = await Ticket.updateOne({ _id: ticket._id, ...remind }, { $set: { confirmRemindedAt: now } });
    if (!res.modifiedCount) continue;
    affected += 1;
    await notifyApartment(ticket.apartmentId, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Nhắc nghiệm thu ${ticket.code}`,
      content: `"${ticket.title}" đã xử lý xong. Vui lòng nghiệm thu; nếu không phản hồi, phiếu tự chuyển Đã nghiệm thu sau ${fmtDateTimeVn(
        new Date(new Date(ticket.resolvedAt).getTime() + days * DAY_MS),
      )}.`,
      refId: ticket._id,
      link: `/r/tickets/${ticket._id}`,
    });
  }
  return affected;
}

// Cột đánh dấu đã cảnh báo theo loại vi phạm (chống báo lặp) + nội dung thông báo
const SLA_ALERTS = {
  ACK: { field: 'ackAlertedAt', text: (t) => `Sự cố ${t.code} quá hạn nhận nhưng chưa có kỹ thuật viên nào nhận` },
  RESPONSE: { field: 'responseAlertedAt', text: (t) => `Phản ánh ${t.code} quá hạn phản hồi cư dân` },
  PARTS: { field: 'partsAlertedAt', text: (t) => `Sự cố ${t.code} chờ linh kiện quá thời gian dừng SLA` },
};

/**
 * [Cron 5 phút] Cảnh báo SLA: sự cố chưa ai nhận quá hạn nhận phiếu (TICKET_ACK_MINUTES, ngoài giờ hành chính thì
 * tính từ đầu giờ làm việc tiếp theo với sự cố mức thường) → báo Trưởng BQL kèm email; phản ánh chưa phản hồi quá hạn
 * (COMPLAINT_RESPONSE_HOURS) → báo Trưởng BQL.
 * Chờ linh kiện quá TICKET_PARTS_PAUSE_HOURS → báo Trưởng BQL (M5-2), SLA chạy tiếp.
 * Mỗi vi phạm chỉ báo 1 lần (updateOne có điều kiện trên cột *AlertedAt). Trả về số cảnh báo đã gửi.
 */
export async function alertSlaBreaches(now = new Date()) {
  const partsMs = await partsPauseMs();
  const tickets = await Ticket.find({
    $or: [
      {
        status: TICKET_STATUS.WAITING_PARTS,
        partsAlertedAt: null,
        slaPausedAt: { $ne: null, $lt: new Date(now.getTime() - partsMs) },
      },
      { type: { $ne: TICKET_TYPES.COMPLAINT }, status: TICKET_STATUS.NEW, assignedTo: null, ackAlertedAt: null, ackDueAt: { $lt: now } },
      {
        type: TICKET_TYPES.COMPLAINT,
        status: { $nin: TICKET_FINAL_STATUSES },
        respondedAt: null,
        responseAlertedAt: null,
        responseDueAt: { $lt: now },
      },
    ],
  })
    .select('code title type status assignedTo ackDueAt ackAlertedAt responseDueAt respondedAt responseAlertedAt slaPausedAt partsAlertedAt')
    .lean();

  let affected = 0;
  for (const ticket of tickets) {
    const kinds = [...slaBreaches(ticket, now), ...(partsPauseExceeded(ticket, now, partsMs) ? ['PARTS'] : [])];
    for (const kind of kinds) {
      const { field, text } = SLA_ALERTS[kind];
      // PARTS: phiếu phải còn đang chờ linh kiện từ đúng lần dừng này (KTV chưa chuyển trạng thái)
      const still = kind === 'PARTS' ? { status: TICKET_STATUS.WAITING_PARTS, slaPausedAt: ticket.slaPausedAt } : {};
      const res = await Ticket.updateOne(
        { _id: ticket._id, [field]: null, ...still },
        {
          $set: { [field]: now },
          $inc: { __v: 1 },
          $push: {
            history: { at: now, by: null, action: ACT.SLA_ALERTED, fromStatus: ticket.status, toStatus: ticket.status, note: text(ticket) },
          },
        },
      );
      if (!res.modifiedCount) continue;
      affected += 1;

      const payload = {
        type: NOTIFICATION_TYPES.TICKET,
        title: text(ticket),
        content: `"${ticket.title}" đã quá hạn, cần Trưởng BQL điều phối.`,
        refId: ticket._id,
        link: `/app/tickets/${ticket._id}`,
      };
      await notifyRoles(['MANAGER'], { ...payload, email: true });
    }
  }
  return affected;
}
