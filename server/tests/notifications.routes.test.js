import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createManager, createReceptionist, createResident, createTechnician, tokenFor } from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import { Notification } from '../src/models/index.js';
import { findUsersBySpecs, notify, notifyRoles } from '../src/services/notification.service.js';

describe('notifications', () => {
  const app = createApp();
  const call = (user) => (m, url, body) => request(app)[m](url).send(body).set('Authorization', `Bearer ${tokenFor(user)}`);

  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  it('mỗi người chỉ thấy thông báo của mình, kèm unreadCount', async () => {
    const a = await createResident();
    const b = await createResident();
    await notify([a._id, a._id, b._id], { type: 'SYSTEM', title: 'Xin chào', content: 'Nội dung' });
    await notify(a._id, { type: 'TICKET', title: 'T', content: 'C' });

    const res = await call(a)('get', '/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.data.every((n) => n.userId === String(a._id))).toBe(true);

    const filtered = await call(a)('get', '/api/notifications?type=TICKET');
    expect(filtered.body.data).toHaveLength(1);
    expect((await call(b)('get', '/api/notifications/unread-count')).body.data.count).toBe(1);
  });

  it('đánh dấu đã đọc không chạm được thông báo người khác', async () => {
    const a = await createResident();
    const b = await createResident();
    await notify(b._id, { type: 'SYSTEM', title: 'Của B', content: 'x' });
    const ofB = await Notification.findOne({ userId: b._id });

    const byIds = await call(a)('patch', '/api/notifications/read', { ids: [String(ofB._id)] });
    expect(byIds.status).toBe(200);
    expect(byIds.body.data.updated).toBe(0);
    expect((await call(a)('patch', `/api/notifications/${ofB._id}/read`)).status).toBe(404);
    expect((await Notification.findById(ofB._id)).isRead).toBe(false);

    const own = await call(b)('patch', `/api/notifications/${ofB._id}/read`);
    expect(own.status).toBe(200);
    expect(own.body.data.isRead).toBe(true);
    expect((await call(b)('patch', '/api/notifications/read', { all: true })).body.data.updated).toBe(0);
    // ids và all không đi cùng nhau
    expect((await call(b)('patch', '/api/notifications/read', { all: true, ids: [String(ofB._id)] })).status).toBe(400);
  });

  it('notifyRoles chỉ gửi đúng spec (STAFF:RECEPTIONIST không gồm KTV), bỏ user bị khóa', async () => {
    const manager = await createManager();
    const receptionist = await createReceptionist();
    await createTechnician();
    await createManager({ isActive: false, role: 'ACCOUNTANT' });
    const users = await findUsersBySpecs(['MANAGER', 'STAFF:RECEPTIONIST']);
    expect(users.map((u) => String(u._id)).sort()).toEqual([String(manager._id), String(receptionist._id)].sort());
    expect(await notifyRoles(['STAFF:RECEPTIONIST'], { type: 'SYSTEM', title: 't', content: 'c' })).toBe(1);
  });

  it('chưa đăng nhập → 401', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});
