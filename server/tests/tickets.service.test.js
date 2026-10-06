import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createCategory,
  createHousehold,
  createManager,
  createReceptionist,
  createResident,
  createTechnician,
  createTicket,
  linkResident,
  tokenFor,
} from './helpers/fixtures.js';

// Không gọi Cloudinary thật trong test
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, uploadToCloudinary: vi.fn(async (files = []) => files.map((f) => `https://img/${f.originalname}`)) };
});

const { createApp } = await import('../src/app.js');
const service = await import('../src/modules/tickets/tickets.service.js');
const { Notification, SystemConfig, AuditLog, Ticket } = await import('../src/models/index.js');

describe('tickets.service', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  // ===== UC-E02 =====
  describe('createTicket', () => {
    it('tạo ticket NEW, priority = defaultPriority của loại, dueDate theo slaHours (BR-O7), báo Manager/Lễ tân', async () => {
      const { user, apartment } = await createHousehold();
      const manager = await createManager();
      const receptionist = await createReceptionist();
      await createTechnician(); // không được báo
      const category = await createCategory({ defaultPriority: 'HIGH', slaHours: 48 });

      const before = Date.now();
      const ticket = await service.createTicket(
        asUser(user),
        { categoryId: String(category._id), title: 'Hỏng đèn hành lang', description: 'Đèn hành lang tầng 3 hỏng từ tối qua' },
        [],
      );

      expect(ticket.status).toBe('NEW');
      expect(ticket.priority).toBe('HIGH');
      expect(ticket.code).toMatch(/^TK-\d{6}-\d{5}$/);
      expect(String(ticket.apartmentId)).toBe(String(apartment._id));
      const slaMs = ticket.dueDate.getTime() - before;
      expect(slaMs).toBeGreaterThanOrEqual(48 * 3600 * 1000 - 5000);
      expect(slaMs).toBeLessThanOrEqual(48 * 3600 * 1000 + 5000);

      const notified = (await Notification.find({ type: 'TICKET' }).lean()).map((n) => String(n.userId));
      expect(notified.sort()).toEqual([String(manager._id), String(receptionist._id)].sort());
    });

    it('cư dân chưa gán căn → FORBIDDEN_ROLE; loại phản ánh ngưng dùng → VALIDATION_ERROR', async () => {
      const orphan = await createResident();
      const category = await createCategory();
      await expect(
        service.createTicket(asUser(orphan), { categoryId: String(category._id), title: 'Tiêu đề', description: 'Mô tả đủ dài' }, []),
      ).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });

      const { user } = await createHousehold();
      const inactive = await createCategory({ isActive: false });
      await expect(
        service.createTicket(asUser(user), { categoryId: String(inactive._id), title: 'Tiêu đề', description: 'Mô tả đủ dài' }, []),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    });

    it('cư dân không được tạo ticket cho căn của người khác (IDOR)', async () => {
      const { user } = await createHousehold();
      const other = await createHousehold();
      const category = await createCategory();
      await expect(
        service.createTicket(
          asUser(user),
          { categoryId: String(category._id), title: 'Tiêu đề', description: 'Mô tả đủ dài', apartmentId: String(other.apartment._id) },
          [],
        ),
      ).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
    });

    it('mã ticket không trùng khi tạo đồng thời', async () => {
      const { user } = await createHousehold();
      const category = await createCategory();
      const payload = { categoryId: String(category._id), title: 'Tiêu đề', description: 'Mô tả đủ dài' };
      const tickets = await Promise.all([1, 2, 3].map(() => service.createTicket(asUser(user), payload, [])));
      const codes = tickets.map((t) => t.code);
      expect(new Set(codes).size).toBe(3);
    });
  });

  // ===== Danh sách / chi tiết theo quyền =====
  describe('listTickets / getTicket', () => {
    it('cư dân chỉ thấy ticket căn mình, KTV chỉ thấy ticket được giao, Manager thấy tất cả', async () => {
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const tech = await createTechnician();
      const manager = await createManager();
      const t1 = await createTicket({ apartment: h1.apartment, createdBy: h1.user });
      const t2 = await createTicket({ apartment: h2.apartment, createdBy: h2.user, status: 'ASSIGNED', assignedTo: tech._id });

      const mine = await service.listTickets(asUser(h1.user), { page: 1, limit: 20 });
      expect(mine.items.map((t) => String(t._id))).toEqual([String(t1._id)]);

      const techList = await service.listTickets(asUser(tech), { page: 1, limit: 20 });
      expect(techList.items.map((t) => String(t._id))).toEqual([String(t2._id)]);

      const all = await service.listTickets(asUser(manager), { page: 1, limit: 20 });
      expect(all.pagination.total).toBe(2);

      // cư dân cố lọc apartmentId của căn khác vẫn chỉ nhận căn mình
      const sneaky = await service.listTickets(asUser(h1.user), { page: 1, limit: 20, apartmentId: String(h2.apartment._id) });
      expect(sneaky.items.map((t) => String(t._id))).toEqual([String(t1._id)]);
    });

    it('getTicket: cư dân căn khác / KTV không được giao → FORBIDDEN_ROLE', async () => {
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const tech = await createTechnician();
      const ticket = await createTicket({ apartment: h1.apartment, createdBy: h1.user });

      await expect(service.getTicket(asUser(h2.user), ticket._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      await expect(service.getTicket(asUser(tech), ticket._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      const ok = await service.getTicket(asUser(h1.user), ticket._id);
      expect(ok.isOverdue).toBe(false);
    });

    it('listTickets overdue=true chỉ trả ticket đang mở quá hạn', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const past = new Date(Date.now() - 3600 * 1000);
      const overdue = await createTicket({ apartment: h.apartment, createdBy: h.user, dueDate: past });
      await createTicket({ apartment: h.apartment, createdBy: h.user, dueDate: past, status: 'CLOSED' });
      await createTicket({ apartment: h.apartment, createdBy: h.user });
      const res = await service.listTickets(asUser(manager), { page: 1, limit: 20, overdue: true });
      expect(res.items.map((t) => String(t._id))).toEqual([String(overdue._id)]);
    });
  });

  // ===== UC-E03 =====
  describe('assignTicket / rejectTicket', () => {
    it('phân công KTV → ASSIGNED, đổi ưu tiên → tính lại dueDate theo system_configs, ghi audit + thông báo', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const tech = await createTechnician();
      await SystemConfig.create({ key: 'SLA_HOURS_URGENT', value: 12, scope: 'BUSINESS' });
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user });

      const before = Date.now();
      const updated = await service.assignTicket(asUser(manager), ticket._id, { assignedTo: String(tech._id), priority: 'URGENT', note: 'gấp' });
      expect(updated.status).toBe('ASSIGNED');
      expect(String(updated.assignedTo)).toBe(String(tech._id));
      expect(updated.priority).toBe('URGENT');
      expect(updated.dueDate.getTime() - before).toBeLessThanOrEqual(12 * 3600 * 1000 + 5000);
      expect(updated.dueDate.getTime() - before).toBeGreaterThanOrEqual(12 * 3600 * 1000 - 5000);

      expect(await AuditLog.countDocuments({ action: 'TICKET_ASSIGNED' })).toBe(1);
      const to = (await Notification.find().lean()).map((n) => String(n.userId)).sort();
      expect(to).toEqual([String(tech._id), String(h.user._id)].sort());
    });

    it('người được giao không phải KTV đang hoạt động → VALIDATION_ERROR', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const receptionist = await createReceptionist();
      const inactiveTech = await createTechnician({ isActive: false });
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user });
      for (const bad of [receptionist, inactiveTech]) {
        await expect(service.assignTicket(asUser(manager), ticket._id, { assignedTo: String(bad._id) })).rejects.toMatchObject({
          errorCode: 'VALIDATION_ERROR',
        });
      }
    });

    it('ticket đã CLOSED → TICKET_ALREADY_CLOSED; WAITING_CONFIRM → không phân công lại', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const tech = await createTechnician();
      const closed = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'CLOSED' });
      await expect(service.assignTicket(asUser(manager), closed._id, { assignedTo: String(tech._id) })).rejects.toMatchObject({
        errorCode: 'TICKET_ALREADY_CLOSED',
      });
      const waiting = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id });
      await expect(service.assignTicket(asUser(manager), waiting._id, { assignedTo: String(tech._id) })).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
    });

    it('rejectTicket chỉ với NEW/ASSIGNED, lưu lý do và báo người tạo', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const tech = await createTechnician();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user });
      const rejected = await service.rejectTicket(asUser(manager), ticket._id, { reason: 'Không thuộc phạm vi BQL' });
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectReason).toBe('Không thuộc phạm vi BQL');
      expect(await Notification.countDocuments({ userId: h.user._id })).toBe(1);

      const inProgress = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'IN_PROGRESS', assignedTo: tech._id });
      await expect(service.rejectTicket(asUser(manager), inProgress._id, { reason: 'lý do dài' })).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
    });
  });

  // ===== UC-E04 =====
  describe('updateProgress', () => {
    it('KTV được giao: ASSIGNED → IN_PROGRESS → WAITING_CONFIRM (set resolvedAt, báo cư dân căn)', async () => {
      const h = await createHousehold();
      const roommate = await createResident();
      await linkResident(roommate, h.apartment);
      const tech = await createTechnician();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });

      const t1 = await service.updateProgress(asUser(tech), ticket._id, { status: 'IN_PROGRESS', note: 'Đang kiểm tra' });
      expect(t1.status).toBe('IN_PROGRESS');
      expect(t1.resolvedAt).toBeUndefined();

      const t2 = await service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_CONFIRM' });
      expect(t2.status).toBe('WAITING_CONFIRM');
      expect(t2.resolvedAt).toBeInstanceOf(Date);
      const notified = (await Notification.find().lean()).map((n) => String(n.userId)).sort();
      expect(notified).toEqual([String(h.user._id), String(roommate._id)].sort());
    });

    it('KTV khác → FORBIDDEN_ROLE; NEW chưa phân công → không chuyển được', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const other = await createTechnician();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });
      await expect(service.updateProgress(asUser(other), ticket._id, { status: 'IN_PROGRESS' })).rejects.toMatchObject({
        errorCode: 'FORBIDDEN_ROLE',
      });
      const fresh = await createTicket({ apartment: h.apartment, createdBy: h.user });
      await expect(service.updateProgress(asUser(tech), fresh._id, { status: 'IN_PROGRESS' })).rejects.toMatchObject({
        errorCode: 'FORBIDDEN_ROLE',
      });
    });

    it('ticket đã đóng: KTV không liên quan nhận FORBIDDEN_ROLE (không lộ trạng thái), KTV phụ trách nhận TICKET_ALREADY_CLOSED', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const other = await createTechnician();
      const closed = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'CLOSED', assignedTo: tech._id });
      await expect(service.updateProgress(asUser(other), closed._id, { status: 'IN_PROGRESS' })).rejects.toMatchObject({
        errorCode: 'FORBIDDEN_ROLE',
      });
      await expect(service.updateProgress(asUser(tech), closed._id, { status: 'IN_PROGRESS' })).rejects.toMatchObject({
        errorCode: 'TICKET_ALREADY_CLOSED',
      });
    });
  });

  // ===== UC-E05 =====
  describe('confirmTicket', () => {
    it('đồng ý → CLOSED + rating + audit; không đồng ý → IN_PROGRESS, xóa resolvedAt', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const base = { apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id, resolvedAt: new Date() };
      const t1 = await createTicket(base);
      const closed = await service.confirmTicket(asUser(h.user), t1._id, { accepted: true, rating: 5, comment: 'Tốt' });
      expect(closed.status).toBe('CLOSED');
      expect(closed.rating).toBe(5);
      expect(closed.closedAt).toBeInstanceOf(Date);
      expect(await AuditLog.countDocuments({ action: 'TICKET_CLOSED' })).toBe(1);

      const t2 = await createTicket(base);
      const reopened = await service.confirmTicket(asUser(h.user), t2._id, { accepted: false, reason: 'Vẫn còn rò nước' });
      expect(reopened.status).toBe('IN_PROGRESS');
      expect(reopened.resolvedAt == null).toBe(true);
      expect(await Notification.countDocuments({ userId: tech._id })).toBe(2);
    });

    it('cư dân căn khác → FORBIDDEN_ROLE (kể cả ticket đã đóng); chưa WAITING_CONFIRM → VALIDATION_ERROR', async () => {
      const h = await createHousehold();
      const stranger = await createHousehold();
      const tech = await createTechnician();
      const waiting = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id });
      await expect(service.confirmTicket(asUser(stranger.user), waiting._id, { accepted: true, rating: 4 })).rejects.toMatchObject({
        errorCode: 'FORBIDDEN_ROLE',
      });
      const closed = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'CLOSED', assignedTo: tech._id });
      await expect(service.confirmTicket(asUser(stranger.user), closed._id, { accepted: true, rating: 4 })).rejects.toMatchObject({
        errorCode: 'FORBIDDEN_ROLE',
      });
      const assigned = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });
      await expect(service.confirmTicket(asUser(h.user), assigned._id, { accepted: true, rating: 4 })).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
    });

    it('2 request confirm đồng thời → chỉ 1 thành công, ticket không bị ghi đè', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'WAITING_CONFIRM', assignedTo: tech._id, resolvedAt: new Date() });

      const results = await Promise.allSettled([
        service.confirmTicket(asUser(h.user), ticket._id, { accepted: true, rating: 5 }),
        service.confirmTicket(asUser(h.user), ticket._id, { accepted: false, reason: 'Chưa xong việc' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected.reason.status).toBe(409);

      const final = await Ticket.findById(ticket._id).lean();
      expect(final.history.filter((x) => ['CONFIRMED', 'REOPENED'].includes(x.action))).toHaveLength(1);
    });

    it('phân công và cập nhật tiến độ đồng thời không ghi đè nhau', async () => {
      const h = await createHousehold();
      const manager = await createManager();
      const tech = await createTechnician();
      const tech2 = await createTechnician();
      const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });

      const results = await Promise.allSettled([
        service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_CONFIRM' }),
        service.assignTicket(asUser(manager), ticket._id, { assignedTo: String(tech2._id) }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const final = await Ticket.findById(ticket._id).lean();
      // Hoặc đã chuyển WAITING_CONFIRM (còn giao cho tech) hoặc đã giao lại cho tech2 — không có trạng thái lai
      const consistent =
        (final.status === 'WAITING_CONFIRM' && String(final.assignedTo) === String(tech._id)) ||
        (final.status === 'ASSIGNED' && String(final.assignedTo) === String(tech2._id));
      expect(consistent).toBe(true);
    });
  });

  // ===== Route: quyền + validate =====
  describe('routes', () => {
    const app = createApp();

    it('ADMIN không có quyền nghiệp vụ ticket (BR-R3); BOARD/ACCOUNTANT cũng không', async () => {
      for (const role of ['ADMIN', 'BOARD', 'ACCOUNTANT']) {
        const u = await createResident({ role });
        const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${tokenFor(u)}`);
        expect(res.status).toBe(403);
      }
    });

    it('sort chỉ nhận field được phép', async () => {
      const manager = await createManager();
      const bad = await request(app).get('/api/tickets?sort=history.note').set('Authorization', `Bearer ${tokenFor(manager)}`);
      expect(bad.status).toBe(400);
      const ok = await request(app).get('/api/tickets?sort=-dueDate').set('Authorization', `Bearer ${tokenFor(manager)}`);
      expect(ok.status).toBe(200);
    });

    it('query NoSQL operator không lọt vào filter (bị validate loại bỏ)', async () => {
      const manager = await createManager();
      const h = await createHousehold();
      await createTicket({ apartment: h.apartment, createdBy: h.user });
      // ?assignedTo[$ne]= → Express 5 parser đơn giản + stripUnknown → bị bỏ qua, không thành toán tử
      const res = await request(app)
        .get('/api/tickets')
        .query({ assignedTo: { $ne: null }, status: { $regex: '.*' } })
        .set('Authorization', `Bearer ${tokenFor(manager)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const asObj = await request(app)
        .patch('/api/tickets/' + h.user._id + '/assign')
        .send({ assignedTo: { $ne: null } })
        .set('Authorization', `Bearer ${tokenFor(manager)}`);
      expect(asObj.status).toBe(400);
    });

    it('cư dân xem danh sách qua API không lộ history', async () => {
      const h = await createHousehold();
      await createTicket({ apartment: h.apartment, createdBy: h.user });
      const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${tokenFor(h.user)}`);
      expect(res.status).toBe(200);
      expect(res.body.data[0].history).toBeUndefined();
      expect(res.body.data[0].createdBy.email).toBeUndefined();
    });
  });

  describe('listAssignees', () => {
    it('chỉ KTV đang hoạt động, kèm số ticket đang mở', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      await createTechnician({ isActive: false });
      await createReceptionist();
      await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });
      await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'CLOSED', assignedTo: tech._id });
      const list = await service.listAssignees();
      expect(list).toHaveLength(1);
      expect(list[0].openTickets).toBe(1);
      expect(list[0].passwordHash).toBeUndefined();
    });
  });
});
