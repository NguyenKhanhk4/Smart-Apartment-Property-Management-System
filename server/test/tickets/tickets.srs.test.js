// Bổ sung theo SRS: cảnh báo khẩn lặp 15 phút (BR-X6), chặn ảnh khi chưa đồng ý điều khoản (BR-X7 / UC38 Alt 3b),
// giao lại báo cả KTV cũ (UC41), lọc Kanban theo danh mục / KTV, vị trí sự cố (UC38).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DutyShift, Notification, Ticket, User } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createCategory, createHousehold, createManager, createReceptionist, createSecurity, createTechnician, createTicket } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const MIN = 60_000;
const onDuty = (user, now) =>
  DutyShift.create({ roleTitle: user.roleTitle, userId: user._id, startAt: new Date(now.getTime() - 60 * MIN), endAt: new Date(now.getTime() + 6 * 60 * MIN) });

test('BR-X6: sự cố khẩn cấp quá hạn nhận → báo Trưởng BQL + người đang trực, lặp sau 15 phút, dừng khi có người tiếp nhận', async () => {
  const now = new Date();
  const { user, apartment } = await createHousehold();
  const manager = await createManager();
  const tech = await createTechnician();
  const offDuty = await createTechnician();
  const guard = await createSecurity();
  await Promise.all([onDuty(tech, now), onDuty(guard, now)]);
  const urgent = await createTicket({ apartment, createdBy: user, type: 'INCIDENT', priority: 'URGENT', status: 'NEW', ackDueAt: new Date(now.getTime() - MIN) });
  await createTicket({ apartment, createdBy: user, type: 'INCIDENT', priority: 'MEDIUM', status: 'NEW', ackDueAt: new Date(now.getTime() - MIN) });
  const count = (u) => Notification.countDocuments({ userId: u._id, refId: urgent._id });

  assert.equal(await service.dispatchEmergencies(now), 1, 'chỉ phiếu Khẩn cấp');
  assert.deepEqual([await count(manager), await count(tech), await count(guard), await count(offDuty)], [1, 1, 1, 0]);
  assert.equal(await service.dispatchEmergencies(new Date(now.getTime() + 5 * MIN)), 0, 'chưa đủ 15 phút');
  assert.equal(await service.dispatchEmergencies(new Date(now.getTime() + 16 * MIN)), 1, 'lặp sau 15 phút');
  assert.equal(await count(manager), 2);

  // Banner: Trưởng BQL, lễ tân thấy; KTV ngoài ca không thấy; người đang trực tiếp nhận được
  assert.equal((await service.emergencyAlerts(asUser(manager))).length, 1);
  assert.equal((await service.emergencyAlerts(asUser(await createReceptionist())))[0].canAcknowledge, false);
  assert.equal((await service.emergencyAlerts(asUser(offDuty))).length, 0);
  await assert.rejects(service.acknowledgeEmergency(asUser(offDuty), urgent._id), { status: 403 });
  await service.acknowledgeEmergency(asUser(tech), urgent._id);
  assert.equal(await service.dispatchEmergencies(new Date(now.getTime() + 40 * MIN)), 0, 'đã tiếp nhận thì dừng lặp');
  assert.equal((await service.emergencyAlerts(asUser(manager))).length, 0);
  const saved = await Ticket.findById(urgent._id).lean();
  assert.equal(String(saved.emergency.ackBy), String(tech._id));
  assert.equal(saved.history.at(-1).action, 'EMERGENCY_ACKED');
});

test('BR-X6: phiếu khẩn đã có người nhận thì không cảnh báo nữa', async () => {
  const now = new Date();
  const { user, apartment } = await createHousehold();
  await createManager();
  const tech = await createTechnician();
  const t = await createTicket({ apartment, createdBy: user, type: 'INCIDENT', priority: 'URGENT', status: 'NEW', ackDueAt: new Date(now.getTime() - MIN) });
  assert.equal(await service.dispatchEmergencies(now), 1);
  await Ticket.updateOne({ _id: t._id }, { $set: { status: 'ASSIGNED', assignedTo: tech._id } });
  assert.equal(await service.dispatchEmergencies(new Date(now.getTime() + 20 * MIN)), 0);
});

test('BR-X7: cư dân chưa đồng ý điều khoản không đính kèm ảnh được, vẫn gửi phiếu không ảnh; lưu vị trí sự cố', async () => {
  const { user, apartment } = await createHousehold();
  await User.updateOne({ _id: user._id }, { $set: { consents: [] } });
  const category = await createCategory();
  const body = { apartmentId: apartment._id, categoryId: category._id, title: 'Đèn hành lang hỏng', description: 'Đèn hành lang tầng 5 không sáng', location: 'Hành lang tầng 5, gần thang B' };
  const fakeFile = { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg' };
  await assert.rejects(service.createTicket(asUser(user), body, [fakeFile]), { errorCode: 'CONSENT_REQUIRED' });
  const ticket = await service.createTicket(asUser(user), body, []);
  assert.equal(ticket.location, 'Hành lang tầng 5, gần thang B');
});

test('UC41: giao lại thì báo cả KTV cũ; Kanban lọc theo danh mục và KTV', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  const [catA, catB] = await Promise.all([createCategory(), createCategory()]);
  const t = await createTicket({ apartment, createdBy: user, category: catA, type: 'INCIDENT', status: 'NEW' });
  await createTicket({ apartment, createdBy: user, category: catB, type: 'INCIDENT', status: 'NEW' });

  await service.assignTicket(manager, t._id, { assignedTo: a._id });
  await service.assignTicket(manager, t._id, { assignedTo: b._id });
  const toOld = await Notification.findOne({ userId: a._id, refId: t._id, title: /chuyển cho người khác/ }).lean();
  assert.ok(toOld, 'KTV cũ nhận thông báo đã chuyển phiếu');

  const all = (board) => board.columns.flatMap((c) => c.items);
  assert.equal(all(await service.getBoard(manager, { categoryId: catA._id })).length, 1);
  assert.equal(all(await service.getBoard(manager, { assignedTo: b._id }))[0]._id.toString(), t._id.toString());
});
