import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createHousehold, createManager, createTechnician, createTicket } from './helpers/fixtures.js';
import { autoCloseTickets, escalateOverdueTickets } from '../src/modules/tickets/tickets.jobs.js';
import { runTrackedJob } from '../src/jobs/cronRunner.js';
import { AuditLog, CronRun, Notification, SystemConfig, Ticket } from '../src/models/index.js';
import { DAY_MS, HOUR_MS } from '../src/utils/time.js';

const hoursAgo = (h, from = Date.now()) => new Date(from - h * HOUR_MS);

describe('tickets.jobs', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('escalateOverdueTickets (UC-E06, BR-O8)', () => {
    it('nâng 1 mức ưu tiên ticket đang mở quá hạn, URGENT giữ nguyên, bỏ qua ticket đã xong/chưa quá hạn', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const tech = await createTechnician();
      const base = { apartment: h.apartment, createdBy: h.user, dueDate: hoursAgo(2) };
      const low = await createTicket({ ...base, priority: 'LOW' });
      const high = await createTicket({ ...base, priority: 'HIGH', status: 'ASSIGNED', assignedTo: tech._id });
      const urgent = await createTicket({ ...base, priority: 'URGENT', status: 'IN_PROGRESS', assignedTo: tech._id });
      const waiting = await createTicket({ ...base, priority: 'LOW', status: 'WAITING_CONFIRM', assignedTo: tech._id });
      const closed = await createTicket({ ...base, priority: 'LOW', status: 'CLOSED' });
      const notDue = await createTicket({ apartment: h.apartment, createdBy: h.user, priority: 'LOW' });

      const count = await escalateOverdueTickets();
      expect(count).toBe(3);

      const byId = Object.fromEntries((await Ticket.find().lean()).map((t) => [String(t._id), t]));
      expect(byId[low._id].priority).toBe('MEDIUM');
      expect(byId[high._id].priority).toBe('URGENT');
      expect(byId[urgent._id].priority).toBe('URGENT');
      expect(byId[urgent._id].escalationCount).toBe(1);
      expect(byId[waiting._id].priority).toBe('LOW');
      expect(byId[closed._id].priority).toBe('LOW');
      expect(byId[notDue._id].escalatedAt).toBeNull();
      expect(byId[low._id].history.at(-1)).toMatchObject({ action: 'ESCALATED', by: null });

      expect(await AuditLog.countDocuments({ action: 'TICKET_ESCALATED' })).toBe(3);
      // Manager nhận 3, KTV nhận 2 (high + urgent)
      expect(await Notification.countDocuments({ userId: manager._id })).toBe(3);
      expect(await Notification.countDocuments({ userId: tech._id })).toBe(2);
    });

    it('tối đa 1 lần/ngày (giờ VN): chạy lại cùng ngày không nâng tiếp, sang ngày mới mới nâng', async () => {
      const h = await createHousehold();
      await createManager();
      // 10:00 VN ngày D = 03:00Z
      const dayD = new Date('2026-03-10T03:00:00Z');
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, priority: 'LOW', dueDate: hoursAgo(5, dayD.getTime()) });

      expect(await escalateOverdueTickets(dayD)).toBe(1);
      expect(await escalateOverdueTickets(new Date(dayD.getTime() + 6 * HOUR_MS))).toBe(0); // 16:00 cùng ngày
      // 00:30 VN hôm sau = 17:30Z ngày D
      expect(await escalateOverdueTickets(new Date('2026-03-10T17:30:00Z'))).toBe(1);

      const t = await Ticket.findById(ticket._id).lean();
      expect(t.priority).toBe('HIGH');
      expect(t.escalationCount).toBe(2);
    });

    it('2 lần chạy chồng nhau (cron + chạy tay) chỉ leo thang 1 lần', async () => {
      const h = await createHousehold();
      await createManager();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, priority: 'LOW', dueDate: hoursAgo(2) });
      const now = new Date();
      const counts = await Promise.all([escalateOverdueTickets(now), escalateOverdueTickets(now)]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      const t = await Ticket.findById(ticket._id).lean();
      expect(t.priority).toBe('MEDIUM');
      expect(t.escalationCount).toBe(1);
      expect(t.history.filter((x) => x.action === 'ESCALATED')).toHaveLength(1);
      expect(await AuditLog.countDocuments({ action: 'TICKET_ESCALATED' })).toBe(1);
    });
  });

  describe('autoCloseTickets (BR-O9)', () => {
    it('WAITING_CONFIRM quá 7 ngày (mặc định) → CLOSED, autoClosed, không rating; chưa đủ ngày giữ nguyên', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const base = { apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id };
      const old = await createTicket({ ...base, resolvedAt: new Date(Date.now() - 8 * DAY_MS) });
      const recent = await createTicket({ ...base, resolvedAt: new Date(Date.now() - 6 * DAY_MS) });

      expect(await autoCloseTickets()).toBe(1);
      const closed = await Ticket.findById(old._id).lean();
      expect(closed.status).toBe('CLOSED');
      expect(closed.autoClosed).toBe(true);
      expect(closed.rating).toBeNull();
      expect(closed.history.at(-1).action).toBe('AUTO_CLOSED');
      expect((await Ticket.findById(recent._id).lean()).status).toBe('WAITING_CONFIRM');
      expect(await AuditLog.countDocuments({ action: 'TICKET_CLOSED' })).toBe(1);
    });

    it('đọc TICKET_AUTO_CLOSE_DAYS từ system_configs', async () => {
      await SystemConfig.create({ key: 'TICKET_AUTO_CLOSE_DAYS', value: 3, scope: 'BUSINESS' });
      const h = await createHousehold();
      const tech = await createTechnician();
      await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id, resolvedAt: new Date(Date.now() - 4 * DAY_MS) });
      expect(await autoCloseTickets()).toBe(1);
    });

    it('chạy chồng nhau không đóng 2 lần / không lỗi', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const t = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id, resolvedAt: new Date(Date.now() - 8 * DAY_MS) });
      const counts = await Promise.all([autoCloseTickets(), autoCloseTickets()]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      const final = await Ticket.findById(t._id).lean();
      expect(final.history.filter((x) => x.action === 'AUTO_CLOSED')).toHaveLength(1);
    });
  });

  describe('runTrackedJob', () => {
    it('ghi cron_runs SUCCESS kèm affectedCount, FAILED kèm errorMessage', async () => {
      const ok = await runTrackedJob('TICKET_ESCALATE', async () => 4, { trigger: 'MANUAL' });
      expect(ok).toMatchObject({ jobName: 'TICKET_ESCALATE', status: 'SUCCESS', affectedCount: 4, trigger: 'MANUAL' });
      const failed = await runTrackedJob('TICKET_AUTO_CLOSE', async () => {
        throw new Error('bùm');
      });
      expect(failed).toMatchObject({ status: 'FAILED', errorMessage: 'bùm' });
      expect(await CronRun.countDocuments()).toBe(2);
    });
  });
});
