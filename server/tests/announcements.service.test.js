import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createApartment,
  createHousehold,
  createManager,
  createReceptionist,
  createResident,
  createUser,
  linkResident,
  tokenFor,
} from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import * as service from '../src/modules/announcements/announcements.service.js';
import { Announcement, AuditLog, Notification } from '../src/models/index.js';

const body = (extra) => ({ title: 'Thông báo cắt nước', content: 'Cắt nước từ 8h-12h', isPinned: false, sendEmail: false, ...extra });

describe('announcements.service', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('publish (UC-E09) — người nhận theo phạm vi', () => {
    it('ALL → mọi tài khoản đang hoạt động (trừ bị khóa), ghi audit', async () => {
      const manager = await createManager();
      const h = await createHousehold();
      await createUser('ACCOUNTANT', { isActive: false });
      const doc = await service.publish(asUser(manager), body({ targetScope: 'ALL' }));
      expect(doc.recipientCount).toBe(2);
      const to = (await Notification.find({ type: 'ANNOUNCEMENT' }).lean()).map((n) => String(n.userId)).sort();
      expect(to).toEqual([String(manager._id), String(h.user._id)].sort());
      expect(await AuditLog.countDocuments({ action: 'ANNOUNCEMENT_PUBLISHED' })).toBe(1);
    });

    it('BUILDING → cư dân đang ở các căn thuộc tòa; APARTMENT → cư dân căn đó (không tính người đã chuyển đi)', async () => {
      const manager = await createManager();
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const apt1b = await createApartment(h1.building);
      const r1b = await createResident();
      await linkResident(r1b, apt1b);
      const movedOut = await createResident();
      await linkResident(movedOut, h1.apartment, { isActive: false });

      const byBuilding = await service.publish(asUser(manager), body({ targetScope: 'BUILDING', targetId: String(h1.building._id) }));
      expect(byBuilding.recipientCount).toBe(2);
      const to = (await Notification.find({ refId: byBuilding._id }).lean()).map((n) => String(n.userId)).sort();
      expect(to).toEqual([String(h1.user._id), String(r1b._id)].sort());
      expect(to).not.toContain(String(h2.user._id));

      const byApt = await service.publish(asUser(manager), body({ targetScope: 'APARTMENT', targetId: String(h1.apartment._id) }));
      expect(byApt.recipientCount).toBe(1);
      expect(String((await Notification.findOne({ refId: byApt._id })).userId)).toBe(String(h1.user._id));
    });

    it('targetId không tồn tại → VALIDATION_ERROR, không tạo bài', async () => {
      const manager = await createManager();
      await expect(service.publish(asUser(manager), body({ targetScope: 'BUILDING', targetId: String(manager._id) }))).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
      await expect(service.publish(asUser(manager), body({ targetScope: 'APARTMENT', targetId: String(manager._id) }))).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
      expect(await Announcement.countDocuments()).toBe(0);
    });
  });

  describe('list / getById — visibility', () => {
    it('cư dân thấy ALL + tòa mình + căn mình, không thấy tòa/căn khác; bài ghim lên đầu', async () => {
      const manager = await createManager();
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const all = await service.publish(asUser(manager), body({ targetScope: 'ALL', title: 'ALL' }));
      const b1 = await service.publish(asUser(manager), body({ targetScope: 'BUILDING', targetId: String(h1.building._id), title: 'B1', isPinned: true }));
      const a1 = await service.publish(asUser(manager), body({ targetScope: 'APARTMENT', targetId: String(h1.apartment._id), title: 'A1' }));
      const b2 = await service.publish(asUser(manager), body({ targetScope: 'BUILDING', targetId: String(h2.building._id), title: 'B2' }));
      const a2 = await service.publish(asUser(manager), body({ targetScope: 'APARTMENT', targetId: String(h2.apartment._id), title: 'A2' }));

      const res = await service.list(asUser(h1.user), { page: 1, limit: 20 });
      const ids = res.items.map((x) => String(x._id));
      expect(ids[0]).toBe(String(b1._id));
      expect(new Set(ids)).toEqual(new Set([String(all._id), String(b1._id), String(a1._id)]));
      expect(ids).not.toContain(String(b2._id));
      expect(ids).not.toContain(String(a2._id));

      await expect(service.getById(asUser(h1.user), a2._id)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
      await expect(service.getById(asUser(h1.user), a1._id)).resolves.toMatchObject({ title: 'A1' });
      // nội bộ thấy tất cả, lọc được theo phạm vi
      const internal = await service.list(asUser(manager), { page: 1, limit: 20, targetScope: 'APARTMENT' });
      expect(internal.pagination.total).toBe(2);
    });
  });

  describe('update / remove', () => {
    it('lễ tân chỉ sửa/xóa bài của mình; Manager sửa được bài bất kỳ; không gửi lại thông báo', async () => {
      const manager = await createManager();
      const receptionist = await createReceptionist();
      await createHousehold();
      const byManager = await service.publish(asUser(manager), body({ targetScope: 'ALL' }));
      const byReceptionist = await service.publish(asUser(receptionist), body({ targetScope: 'ALL' }));
      const before = await Notification.countDocuments();

      await expect(service.update(asUser(receptionist), byManager._id, { isPinned: true })).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      await expect(service.remove(asUser(receptionist), byManager._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      await expect(service.update(asUser(receptionist), byReceptionist._id, { title: 'Sửa lại' })).resolves.toMatchObject({ title: 'Sửa lại' });
      await expect(service.update(asUser(manager), byReceptionist._id, { isPinned: true })).resolves.toMatchObject({ isPinned: true });
      expect(await service.remove(asUser(manager), byReceptionist._id)).toEqual({ deleted: true });
      expect(await Notification.countDocuments()).toBe(before);
    });
  });

  describe('routes', () => {
    const app = createApp();
    const call = (user) => (m, url, body) => request(app)[m](url).send(body).set('Authorization', `Bearer ${tokenFor(user)}`);

    it('cư dân/KTV/ADMIN không đăng được bài; PATCH không nhận field lạ (mass assignment)', async () => {
      const h = await createHousehold();
      const admin = await createUser('ADMIN');
      const manager = await createManager();
      for (const u of [h.user, admin]) {
        expect((await call(u)('post', '/api/announcements', body({ targetScope: 'ALL' }))).status).toBe(403);
      }
      const created = await call(manager)('post', '/api/announcements', body({ targetScope: 'ALL' }));
      expect(created.status).toBe(201);
      const id = created.body.data._id;
      const patched = await call(manager)('patch', `/api/announcements/${id}`, { isPinned: true, createdBy: String(h.user._id), recipientCount: 999 });
      expect(patched.status).toBe(200);
      const doc = await Announcement.findById(id).lean();
      expect(String(doc.createdBy)).toBe(String(manager._id));
      expect(doc.recipientCount).not.toBe(999);
      // targetScope != ALL mà thiếu targetId → 400
      expect((await call(manager)('post', '/api/announcements', body({ targetScope: 'BUILDING' }))).status).toBe(400);
    });

    it('GET /announcements/:id theo phạm vi cư dân → 404 với bài căn khác', async () => {
      const manager = await createManager();
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const a2 = await service.publish(asUser(manager), body({ targetScope: 'APARTMENT', targetId: String(h2.apartment._id) }));
      expect((await call(h1.user)('get', `/api/announcements/${a2._id}`)).status).toBe(404);
      expect((await call(h2.user)('get', `/api/announcements/${a2._id}`)).status).toBe(200);
    });
  });
});
