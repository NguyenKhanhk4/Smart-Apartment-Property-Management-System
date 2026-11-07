import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PRIORITY_ORDER,
  TICKET_HISTORY_ACTIONS as ACT,
  ROLE_TITLES,
  TICKET_FINAL_STATUSES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { Ticket } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { DAY_MS, startOfVnDay } from '../../utils/time.js';
import { getOnDuty } from '../dutyShifts/dutyShifts.service.js';
import { slaBreaches } from './ticket.rules.js';

/**
 * UC-E06 / BR-O8 — [Cron 09:00] Ticket chưa xong mà quá dueDate → nâng 1 mức ưu tiên
 * (LOW→MEDIUM→HIGH→URGENT, đã URGENT thì giữ), tối đa 1 lần/ngày, báo Trưởng BQL + KTV phụ trách.
 * Gồm cả ticket NEW chưa ai nhận (quá hạn vẫn phải có người chịu trách nhiệm — mục tiêu G6) và ticket chờ linh kiện;
 * bỏ qua ticket chờ cư dân đồng ý phí (TICKET_SLA_STATUSES — SLA tạm dừng).
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
    .select('code title priority status assignedTo dueDate')
    .lean();

  let affected = 0;
  for (const ticket of tickets) {
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
 * BR-O9 — Ticket WAITING_CONFIRM quá TICKET_AUTO_CLOSE_DAYS (mặc định 7) ngày cư dân không phản hồi
 * → tự đóng CLOSED, không có rating. Cập nhật có điều kiện status để không đóng đè lên
 * cư dân vừa xác nhận/không đồng ý, hoặc 2 lần chạy chồng nhau.
 */
export async function autoCloseTickets(now = new Date()) {
  const days = Number(await getConfig(CONFIG_KEYS.TICKET_AUTO_CLOSE_DAYS));
  const filter = {
    status: TICKET_STATUS.WAITING_CONFIRM,
    resolvedAt: { $lt: new Date(now.getTime() - days * DAY_MS) },
  };
  const tickets = await Ticket.find(filter).select('code').lean();

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
            note: `Tự đóng sau ${days} ngày cư dân không phản hồi`,
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
  }
  return affected;
}

// Cột đánh dấu đã cảnh báo theo loại vi phạm (chống báo lặp) + nội dung thông báo
const SLA_ALERTS = {
  ACK: { field: 'ackAlertedAt', text: (t) => `Sự cố ${t.code} quá hạn nhận nhưng chưa có kỹ thuật viên nào nhận` },
  RESPONSE: { field: 'responseAlertedAt', text: (t) => `Phản ánh ${t.code} quá hạn phản hồi cư dân` },
};

/**
 * [Cron 5 phút] Cảnh báo SLA (Người 4): sự cố chưa ai nhận quá hạn nhận phiếu (TICKET_ACK_MINUTES) → báo Trưởng BQL
 * kèm email + KTV trực dự phòng; phản ánh chưa phản hồi quá hạn (COMPLAINT_RESPONSE_HOURS) → báo Trưởng BQL.
 * Mỗi vi phạm chỉ báo 1 lần (updateOne có điều kiện trên cột *AlertedAt). Trả về số cảnh báo đã gửi.
 */
export async function alertSlaBreaches(now = new Date()) {
  const tickets = await Ticket.find({
    $or: [
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
    .select('code title type status assignedTo ackDueAt ackAlertedAt responseDueAt respondedAt responseAlertedAt')
    .lean();

  let affected = 0;
  let backups = null; // KTV trực dự phòng — chỉ đọc khi có sự cố quá hạn nhận
  for (const ticket of tickets) {
    for (const kind of slaBreaches(ticket, now)) {
      const { field, text } = SLA_ALERTS[kind];
      const res = await Ticket.updateOne(
        { _id: ticket._id, [field]: null },
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
      if (kind === 'ACK') {
        backups ??= (await getOnDuty(ROLE_TITLES.TECHNICIAN, now)).backup.map((p) => p._id);
        await notify(backups, payload);
      }
    }
  }
  return affected;
}
