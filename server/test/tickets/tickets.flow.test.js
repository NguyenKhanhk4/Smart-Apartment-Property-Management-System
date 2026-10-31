// Luồng phiếu sự cố / phản ánh (Người 4) trên MongoDB trong RAM: phân loại, Lễ tân tạo hộ, hàng chờ theo ca, nút Nhận,
// báo giá trong căn hộ, chờ linh kiện, Kanban, cảnh báo SLA.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Contract, DutyShift, Notification, Ticket } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { alertSlaBreaches } from '../../src/modules/tickets/tickets.jobs.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import {
  asUser,
  createCategory,
  createHousehold,
  createManager,
  createReceptionist,
  createResidentUser,
  createTechnician,
  createTicket,
  linkResident,
} from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const H = 3_600_000;
const onShift = (user, extra = {}) =>
  DutyShift.create({ roleTitle: 'TECHNICIAN', userId: user._id, startAt: new Date(Date.now() - H), endAt: new Date(Date.now() + 7 * H), ...extra });
const notified = async (user) => Notification.countDocuments({ userId: user._id });

test('cư dân gửi sự cố: có hạn nhận phiếu; báo KTV đang trực, không báo KTV ngoài ca', async () => {
  const { user, apartment } = await createHousehold();
  const category = await createCategory();
  const [inShift, offShift] = await Promise.all([createTechnician(), createTechnician()]);
  await onShift(inShift);

  const ticket = await service.createTicket(asUser(user), {
    categoryId: category._id, title: 'Rò nước hành lang', description: 'Nước rò từ trần hành lang tầng 5', type: 'INCIDENT', scope: 'COMMON_AREA', apartmentId: apartment._id,
  }, []);
  assert.equal(ticket.type, 'INCIDENT');
  assert.ok(ticket.ackDueAt > new Date());
  assert.equal(ticket.responseDueAt, null);
  assert.equal(await notified(inShift), 1);
  assert.equal(await notified(offShift), 0);
});

test('không có ai trong ca: báo tất cả KTV đang hoạt động', async () => {
  const { user, apartment } = await createHousehold();
  const category = await createCategory();
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  await service.createTicket(asUser(user), { categoryId: category._id, title: 'Mất điện sảnh', description: 'Sảnh tầng 1 mất điện từ sáng', apartmentId: apartment._id }, []);
  assert.equal(await notified(a), 1);
  assert.equal(await notified(b), 1);
});

test('phản ánh: có hạn phản hồi, không vào hàng chờ KTV, không giao được cho KTV', async () => {
  const { user, apartment } = await createHousehold();
  const category = await createCategory();
  const tech = await createTechnician();
  const ticket = await service.createTicket(asUser(user), {
    categoryId: category._id, title: 'Hàng xóm ồn ào', description: 'Căn bên cạnh hát karaoke tới 1h sáng', type: 'COMPLAINT', apartmentId: apartment._id,
  }, []);
  assert.ok(ticket.responseDueAt > new Date());
  assert.equal(ticket.ackDueAt, null);
  assert.equal(await notified(tech), 0);
  const queue = await service.listQueue(asUser(tech));
  assert.equal(queue.items.length, 0);
  const manager = asUser(await createManager());
  await assert.rejects(service.assignTicket(manager, ticket._id, { assignedTo: tech._id }), { errorCode: 'VALIDATION_ERROR' });
});

test('Lễ tân tạo hộ cư dân: ghi createdByStaff, căn bắt buộc', async () => {
  const { apartment } = await createHousehold();
  const category = await createCategory();
  const receptionist = asUser(await createReceptionist());
  const ticket = await service.createTicketByStaff(receptionist, {
    apartmentId: apartment._id, categoryId: category._id, title: 'Thang máy kẹt', description: 'Thang máy số 2 kẹt tầng 7', type: 'INCIDENT',
  }, []);
  assert.equal(String(ticket.createdByStaff), receptionist.id);
  assert.equal(String(ticket.apartmentId), String(apartment._id));
});

test('nút Nhận: 2 KTV bấm cùng lúc chỉ 1 người nhận được, người còn lại TICKET_ALREADY_CLAIMED', async () => {
  const { user, apartment } = await createHousehold();
  const ticket = await createTicket({ apartment, createdBy: user });
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  const results = await Promise.allSettled([service.claimTicket(asUser(a), ticket._id), service.claimTicket(asUser(b), ticket._id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'TICKET_ALREADY_CLAIMED');
  const saved = await Ticket.findById(ticket._id).lean();
  assert.equal(saved.status, 'ASSIGNED');
  assert.equal(saved.history.at(-1).action, 'CLAIMED');
  assert.equal(await AuditLog.countDocuments({ action: 'TICKET_CLAIMED' }), 1);
});

test('nút Nhận: đang có lịch trực mà KTV không trong ca → NOT_ON_DUTY', async () => {
  const { user, apartment } = await createHousehold();
  const ticket = await createTicket({ apartment, createdBy: user });
  const [inShift, offShift] = await Promise.all([createTechnician(), createTechnician()]);
  await onShift(inShift);
  await assert.rejects(service.claimTicket(asUser(offShift), ticket._id), { errorCode: 'NOT_ON_DUTY' });
  await service.claimTicket(asUser(inShift), ticket._id);
});

test('hàng chờ: chỉ sự cố mới chưa ai nhận, khẩn cấp lên đầu; báo KTV có đang trong ca không', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  await createTicket({ apartment, createdBy: user, priority: 'LOW', title: 'thấp' });
  await createTicket({ apartment, createdBy: user, priority: 'URGENT', title: 'khẩn' });
  await createTicket({ apartment, createdBy: user, status: 'ASSIGNED', assignedTo: tech._id, title: 'đã nhận' });
  await createTicket({ apartment, createdBy: user, type: 'COMPLAINT', title: 'phản ánh' });
  const queue = await service.listQueue(asUser(tech));
  assert.deepEqual(queue.items.map((x) => x.title), ['khẩn', 'thấp']);
  assert.equal(queue.onDuty, false);
  assert.equal(queue.hasSchedule, false);
});

test('sự cố trong căn hộ: KTV gửi báo giá → Người nộp phí đồng ý → Đang xử lý', async () => {
  const { user: owner, apartment } = await createHousehold();
  const tenant = await createResidentUser();
  await linkResident(tenant, apartment, { relationType: 'TENANT' });
  await Contract.create({ apartmentId: apartment._id, type: 'SALE', ownerId: owner._id, startDate: new Date(Date.now() - 400 * 24 * H), status: 'ACTIVE' });
  const tech = await createTechnician();
  const ticket = await createTicket({ apartment, createdBy: owner, scope: 'IN_APARTMENT', status: 'ASSIGNED', assignedTo: tech._id });

  await assert.rejects(service.updateProgress(asUser(tech), ticket._id, { status: 'IN_PROGRESS' }), { errorCode: 'VALIDATION_ERROR' });
  await service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_QUOTE_APPROVAL', note: 'Thay van khóa nước 350.000đ' });

  // X1: chỉ Người nộp phí (chủ sở hữu, hợp đồng thuê không bật tenantPaysFees) được quyết định
  await assert.rejects(service.decideQuote(asUser(tenant), ticket._id, { accepted: true }), { errorCode: 'FORBIDDEN_ROLE' });
  const decided = await service.decideQuote(asUser(owner), ticket._id, { accepted: true });
  assert.equal(decided.status, 'IN_PROGRESS');
  assert.equal(decided.quoteDecision.accepted, true);
  assert.equal(String(decided.quoteDecision.by), String(owner._id));
  assert.equal(await AuditLog.countDocuments({ action: 'TICKET_QUOTE_DECIDED' }), 1);
});

test('cư dân từ chối báo giá → phiếu bị từ chối kèm lý do', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  const ticket = await createTicket({ apartment, createdBy: user, scope: 'IN_APARTMENT', status: 'WAITING_QUOTE_APPROVAL', assignedTo: tech._id });
  const decided = await service.decideQuote(asUser(user), ticket._id, { accepted: false, note: 'Tự thuê thợ ngoài' });
  assert.equal(decided.status, 'REJECTED');
  assert.match(decided.rejectReason, /từ chối báo giá/);
  await assert.rejects(service.decideQuote(asUser(user), ticket._id, { accepted: true }), { errorCode: 'TICKET_ALREADY_CLOSED' });
});

test('chờ linh kiện: Đang xử lý → Chờ linh kiện → Đang xử lý', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  const ticket = await createTicket({ apartment, createdBy: user, status: 'IN_PROGRESS', assignedTo: tech._id });
  const waiting = await service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_PARTS', note: 'Đặt bơm mới' });
  assert.equal(waiting.history.at(-1).action, 'WAITING_PARTS');
  const resumed = await service.updateProgress(asUser(tech), ticket._id, { status: 'IN_PROGRESS' });
  assert.equal(resumed.status, 'IN_PROGRESS');
});

test('Kanban: nhóm sự cố đang mở theo cột, không gồm phiếu đã đóng và phản ánh', async () => {
  const { user, apartment } = await createHousehold();
  await createTicket({ apartment, createdBy: user });
  await createTicket({ apartment, createdBy: user, status: 'WAITING_PARTS' });
  await createTicket({ apartment, createdBy: user, status: 'CLOSED' });
  await createTicket({ apartment, createdBy: user, type: 'COMPLAINT' });
  const board = await service.getBoard(asUser(await createManager()));
  const count = (s) => board.columns.find((c) => c.status === s).items.length;
  assert.equal(count('NEW'), 1);
  assert.equal(count('WAITING_PARTS'), 1);
  assert.equal(board.columns.reduce((n, c) => n + c.items.length, 0), 2);
});

test('cron SLA: sự cố quá hạn nhận và phản ánh quá hạn phản hồi → báo Trưởng BQL đúng 1 lần', async () => {
  const { user, apartment } = await createHousehold();
  const manager = await createManager();
  const past = new Date(Date.now() - 60_000);
  await createTicket({ apartment, createdBy: user, ackDueAt: past });
  await createTicket({ apartment, createdBy: user, type: 'COMPLAINT', responseDueAt: past });
  await createTicket({ apartment, createdBy: user, ackDueAt: new Date(Date.now() + H) }); // chưa tới hạn

  assert.equal(await alertSlaBreaches(), 2);
  assert.equal(await notified(manager), 2);
  assert.equal(await alertSlaBreaches(), 0);
  assert.equal(await notified(manager), 2);
});

test('phản hồi phản ánh: từ chối phản ánh ghi nhận respondedAt (dừng cảnh báo SLA phản hồi)', async () => {
  const { user, apartment } = await createHousehold();
  const ticket = await createTicket({ apartment, createdBy: user, type: 'COMPLAINT', responseDueAt: new Date(Date.now() + H) });
  const rejected = await service.rejectTicket(asUser(await createManager()), ticket._id, { reason: 'Không thuộc phạm vi BQL' });
  assert.ok(rejected.respondedAt);
});
