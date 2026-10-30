// Ticket dùng nhóm trạng thái chung: chờ linh kiện vẫn tính SLA, chờ cư dân đồng ý phí tạm dừng SLA.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticket } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { escalateOverdueTickets } from '../../src/modules/tickets/tickets.jobs.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createCategory, createHousehold, createManager, createTechnician, createTicket } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const past = () => new Date(Date.now() - 3_600_000);

test('danh sách quá hạn gồm ticket chờ linh kiện, không gồm ticket chờ cư dân đồng ý phí', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const parts = await createTicket({ apartment, createdBy: user, status: 'WAITING_PARTS', dueDate: past() });
  await createTicket({ apartment, createdBy: user, status: 'WAITING_QUOTE_APPROVAL', dueDate: past() });
  await createTicket({ apartment, createdBy: user, status: 'WAITING_CONFIRM', dueDate: past() });

  const { items } = await service.listTickets(manager, { overdue: true, page: 1, limit: 20 });
  assert.deepEqual(items.map((t) => String(t._id)), [String(parts._id)]);
});

test('chi tiết: cờ quá hạn bật cho chờ linh kiện, tắt khi chờ đồng ý phí', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const parts = await createTicket({ apartment, createdBy: user, status: 'WAITING_PARTS', dueDate: past() });
  const quote = await createTicket({ apartment, createdBy: user, status: 'WAITING_QUOTE_APPROVAL', dueDate: past() });
  assert.equal((await service.getTicket(manager, parts._id)).isOverdue, true);
  assert.equal((await service.getTicket(manager, quote._id)).isOverdue, false);
});

test('leo thang: gồm chờ linh kiện, bỏ qua chờ đồng ý phí', async () => {
  const { user, apartment } = await createHousehold();
  const parts = await createTicket({ apartment, createdBy: user, status: 'WAITING_PARTS', dueDate: past(), priority: 'LOW' });
  const quote = await createTicket({ apartment, createdBy: user, status: 'WAITING_QUOTE_APPROVAL', dueDate: past(), priority: 'LOW' });
  assert.equal(await escalateOverdueTickets(), 1);
  assert.equal((await Ticket.findById(parts._id).lean()).priority, 'MEDIUM');
  assert.equal((await Ticket.findById(quote._id).lean()).priority, 'LOW');
});

test('lịch sử ticket: hành động phải thuộc TICKET_HISTORY_ACTIONS', async () => {
  const { user, apartment } = await createHousehold();
  const t = await createTicket({ apartment, createdBy: user });
  t.history.push({ action: 'LAM_GI_DO' });
  await assert.rejects(t.save(), /action/);
});

test('SLA: tạo theo slaHours của loại phản ánh; đổi ưu tiên thì tính lại từ lúc đổi theo SLA_HOURS_<ưu tiên>', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const category = await createCategory({ slaHours: 10 });
  const ticket = await createTicket({ apartment, createdBy: user, category });
  const before = Date.now();
  const updated = await service.assignTicket(manager, ticket._id, { assignedTo: tech._id, priority: 'URGENT' });
  const hours = (updated.dueDate.getTime() - before) / 3_600_000;
  assert.ok(Math.abs(hours - 24) < 0.01, `hạn mới phải là 24h (SLA_HOURS_URGENT), được ${hours}`);
});

test('2 lần phân công đồng thời: lần sau bị từ chối do ghi đè, không mất dữ liệu', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  const ticket = await createTicket({ apartment, createdBy: user });
  const results = await Promise.allSettled([
    service.assignTicket(manager, ticket._id, { assignedTo: a._id }),
    service.assignTicket(manager, ticket._id, { assignedTo: b._id }),
  ]);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.name, 'VersionError'); // errorHandler đổi thành 409 CONCURRENT_UPDATE
});

test('sắp xếp theo ưu tiên: theo mức độ nghiêm trọng, không theo bảng chữ cái', async () => {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  for (const priority of ['MEDIUM', 'URGENT', 'LOW', 'HIGH']) await createTicket({ apartment, createdBy: user, priority });
  const { items } = await service.listTickets(manager, { sort: '-priority', page: 1, limit: 20 });
  assert.deepEqual(items.map((t) => t.priority), ['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
});
