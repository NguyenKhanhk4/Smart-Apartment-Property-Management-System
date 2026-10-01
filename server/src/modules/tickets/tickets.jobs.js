import {
  AUDIT_ACTIONS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PRIORITY_ORDER,
  TICKET_STATUS,
} from '../../constants/enums.js';
import { Ticket } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { DAY_MS, startOfVnDay } from '../../utils/time.js';
import { OPEN_STATUSES } from './tickets.service.js';

/**
 * UC-E06 / BR-O8 — [Cron 09:00] Ticket chưa xong mà quá dueDate → nâng 1 mức ưu tiên
 * (LOW→MEDIUM→HIGH→URGENT, đã URGENT thì giữ), tối đa 1 lần/ngày, báo Trưởng BQL + KTV phụ trách.
 * Gồm cả ticket NEW chưa ai nhận (quá hạn vẫn phải có người chịu trách nhiệm — mục tiêu G6).
 * Trả về số ticket đã leo thang (affectedCount cho cron_runs).
 *
 * Mỗi ticket được cập nhật bằng updateOne có điều kiện (status còn mở + chưa leo thang hôm nay):
 * 2 lần chạy chồng nhau (cron + chạy tay) hoặc KTV vừa đóng ticket → chỉ 1 bên cập nhật được.
 */
export async function escalateOverdueTickets(now = new Date()) {
  const todayStart = startOfVnDay(now);
  const notEscalatedToday = { $or: [{ escalatedAt: null }, { escalatedAt: { $lt: todayStart } }] };
  const tickets = await Ticket.find({
    status: { $in: OPEN_STATUSES },
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
      { _id: ticket._id, status: { $in: OPEN_STATUSES }, priority: from, ...notEscalatedToday },
      {
        $set: { priority: to, escalatedAt: now },
        $inc: { escalationCount: 1, __v: 1 },
        $push: {
          history: {
            at: now,
            by: null,
            action: 'ESCALATED',
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
      targetType: 'tickets',
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
            action: 'AUTO_CLOSED',
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
      targetType: 'tickets',
      targetId: ticket._id,
      metadata: { code: ticket.code, autoClosed: true },
    });
  }
  return affected;
}
