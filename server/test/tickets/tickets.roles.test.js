// SRS 2.3 / UC41–42: điều phối phiếu (phân công, từ chối, gộp, danh sách KTV) chỉ Trưởng BQL.
// Lễ tân chỉ xem phiếu, tạo hộ cư dân và đổi phân loại; không nhận thông báo mỗi phiếu mới.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Notification } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createCategory, createHousehold, createManager, createReceptionist, createTicket } from '../helpers/fixtures.js';
import { USERS, startApp } from '../helpers/http.js';

let app;
before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

const ID = '64b0000000000000000000aa';

test('lễ tân không phân công, từ chối, gộp phiếu, không xem danh sách KTV để giao (403)', async () => {
  const calls = [
    ['PATCH', `/tickets/${ID}/assign`, { assignedTo: ID }],
    ['PATCH', `/tickets/${ID}/reject`, { reason: 'Không hợp lệ' }],
    ['PATCH', `/tickets/${ID}/merge`, { parentId: ID }],
    ['GET', '/tickets/assignees'],
  ];
  for (const [method, path, body] of calls) {
    const res = await app.request(method, path, { user: USERS.receptionist, body });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
});

test('lễ tân vẫn xem được danh sách và chi tiết phiếu', async () => {
  const { user, apartment } = await createHousehold();
  const ticket = await createTicket({ apartment, createdBy: user });
  const receptionist = await createReceptionist();
  const actor = { id: String(receptionist._id), role: 'STAFF', roleTitle: 'RECEPTIONIST' };

  const list = await app.request('GET', '/tickets', { user: actor });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((t) => String(t._id) === String(ticket._id)));
  assert.equal((await app.request('GET', `/tickets/${ticket._id}`, { user: actor })).status, 200);
});

test('phiếu mới chỉ báo Trưởng BQL, không báo lễ tân', async () => {
  const { user } = await createHousehold();
  const manager = await createManager();
  const receptionist = await createReceptionist();
  const category = await createCategory({ type: 'COMPLAINT' });
  await service.createTicket(asUser(user), { type: 'COMPLAINT', categoryId: category._id, title: 'Ồn ào ban đêm', description: 'Căn tầng trên ồn sau 23h' });

  assert.equal(await Notification.countDocuments({ userId: manager._id }), 1);
  assert.equal(await Notification.countDocuments({ userId: receptionist._id }), 0);
});
