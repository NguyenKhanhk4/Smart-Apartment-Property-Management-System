// OI-07 phần Người 4: tự nghiệm thu sau 3 ngày + nhắc trước 1 ngày (M5-1), đổi loại / phạm vi phiếu (M5-5),
// gợi ý và gộp phiếu trùng, phiếu con đóng theo phiếu chính (M5-6).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Notification, Ticket } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { autoCloseTickets } from '../../src/modules/tickets/tickets.jobs.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import {
  asUser,
  createApartment,
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

const DAY = 24 * 3_600_000;
/** Hộ mới trong tòa `building` (createHousehold luôn tạo tòa mới) */
async function householdIn(building) {
  const apartment = await createApartment(building);
  const user = await createResidentUser();
  await linkResident(user, apartment, { relationType: 'OWNER' });
  return { user, apartment };
}
const notified = (user, title) => Notification.exists({ userId: user._id, ...(title && { title }) });

// ----- M5-1 -----
test('M5-1: chờ nghiệm thu quá 2 ngày → nhắc cư dân 1 lần; quá 3 ngày → tự Đã nghiệm thu, không có sao', async () => {
  const { user, apartment } = await createHousehold();
  const now = new Date();
  const ticket = await createTicket({ apartment, createdBy: user, status: 'WAITING_CONFIRM', resolvedAt: new Date(now.getTime() - 2.5 * DAY) });

  assert.equal(await autoCloseTickets(now), 1);
  assert.ok(await notified(user, /Nhắc nghiệm thu/));
  assert.equal((await Ticket.findById(ticket._id).lean()).status, 'WAITING_CONFIRM');
  assert.equal(await autoCloseTickets(now), 0, 'chỉ nhắc 1 lần');

  const later = new Date(now.getTime() + DAY);
  await autoCloseTickets(later);
  const closed = await Ticket.findById(ticket._id).lean();
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.autoClosed, true);
  assert.equal(closed.rating, null);
});

test('M5-1: cư dân bấm Chưa đạt rồi KTV báo xong lại → được nhắc lại ở lần chờ nghiệm thu mới', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  const ticket = await createTicket({ apartment, createdBy: user, status: 'IN_PROGRESS', assignedTo: tech._id, confirmRemindedAt: new Date() });
  // KTV báo xong cần ảnh → đặt trực tiếp trạng thái giống luồng thật
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'IN_PROGRESS' } });
  const doc = await Ticket.findById(ticket._id);
  doc.status = 'WAITING_CONFIRM';
  doc.resolvedAt = new Date(Date.now() - 2.5 * DAY);
  doc.confirmRemindedAt = null; // updateProgress đặt lại khi sang WAITING_CONFIRM
  await doc.save();
  assert.equal(await autoCloseTickets(), 1);
});

// ----- M5-5 -----
test('M5-5: Lễ tân đổi Sự cố → Phản ánh: bỏ KTV, về Mới, có hạn phản hồi, ghi lịch sử + audit, báo cư dân', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  const receptionist = asUser(await createReceptionist());
  const ticket = await createTicket({ apartment, createdBy: user, status: 'ASSIGNED', assignedTo: tech._id });

  const t = await service.reclassifyTicket(receptionist, ticket._id, { type: 'COMPLAINT', reason: 'Thực chất là phản ánh tiếng ồn' });
  assert.equal(t.type, 'COMPLAINT');
  assert.equal(t.scope, 'COMMON_AREA');
  assert.equal(t.status, 'NEW');
  assert.equal(t.assignedTo, null);
  assert.ok(t.responseDueAt);
  assert.equal(t.ackDueAt, null);
  assert.equal(t.history.at(-1).action, 'RECLASSIFIED');
  assert.equal(await AuditLog.countDocuments({ action: 'TICKET_RECLASSIFIED' }), 1);
  assert.ok(await notified(user, /đổi phân loại/));
  assert.ok(await notified(tech, /không còn giao cho bạn/));
});

test('M5-5: KTV được giao đổi phạm vi sau khảo sát (khu vực chung → trong căn) thì phải báo giá trước khi xử lý', async () => {
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  const ticket = await createTicket({ apartment, createdBy: user, status: 'ASSIGNED', assignedTo: tech._id });

  const t = await service.reclassifyTicket(asUser(tech), ticket._id, { scope: 'IN_APARTMENT', reason: 'Hỏng van trong căn, không phải ống chung' });
  assert.equal(t.scope, 'IN_APARTMENT');
  assert.equal(t.status, 'ASSIGNED');
  await assert.rejects(service.updateProgress(asUser(tech), ticket._id, { status: 'IN_PROGRESS' }), { errorCode: 'VALIDATION_ERROR' });
});

test('M5-5: KTV khác / cư dân không đổi được; phiếu đang xử lý không đổi được; không đổi gì thì báo lỗi', async () => {
  const { user, apartment } = await createHousehold();
  const [tech, other] = await Promise.all([createTechnician(), createTechnician()]);
  const manager = asUser(await createManager());
  const assigned = await createTicket({ apartment, createdBy: user, status: 'ASSIGNED', assignedTo: tech._id });
  const working = await createTicket({ apartment, createdBy: user, status: 'IN_PROGRESS', assignedTo: tech._id });

  await assert.rejects(service.reclassifyTicket(asUser(other), assigned._id, { scope: 'IN_APARTMENT', reason: 'abcde' }), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(service.reclassifyTicket(asUser(user), assigned._id, { scope: 'IN_APARTMENT', reason: 'abcde' }), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(service.reclassifyTicket(manager, working._id, { scope: 'IN_APARTMENT', reason: 'abcde' }), /chưa bắt đầu xử lý/);
  await assert.rejects(service.reclassifyTicket(manager, assigned._id, { scope: 'COMMON_AREA', reason: 'abcde' }), /không thay đổi/);
});

// ----- M5-6 -----
test('M5-6: gợi ý phiếu trùng — sự cố khu vực chung đang mở cùng tòa, cùng loại sự cố', async () => {
  const a = await createHousehold();
  const b = await householdIn(a.building);
  const elsewhere = await createHousehold();
  const category = await createCategory();
  const open = await createTicket({ apartment: a.apartment, createdBy: a.user, category });
  await createTicket({ apartment: a.apartment, createdBy: a.user, category, status: 'CLOSED' });
  await createTicket({ apartment: a.apartment, createdBy: a.user, category, scope: 'IN_APARTMENT' });
  await createTicket({ apartment: elsewhere.apartment, createdBy: elsewhere.user, category });

  const items = await service.findSimilarTickets(asUser(b.user), { apartmentId: b.apartment._id, categoryId: category._id });
  assert.deepEqual(items.map((t) => String(t._id)), [String(open._id)]);
  assert.equal(items[0].apartmentId, undefined, 'không lộ căn của người báo');
});

async function mergeSetup() {
  const a = await createHousehold();
  const b = await householdIn(a.building);
  const category = await createCategory();
  const tech = await createTechnician();
  const parent = await createTicket({ apartment: a.apartment, createdBy: a.user, category, status: 'IN_PROGRESS', assignedTo: tech._id });
  const child = await createTicket({ apartment: b.apartment, createdBy: b.user, category });
  return { a, b, tech, parent, child, manager: asUser(await createManager()) };
}

test('M5-6: gộp phiếu trùng → phiếu con MERGED, báo người báo; phiếu chính nghiệm thu → phiếu con đóng theo', async () => {
  const { a, b, tech, parent, child, manager } = await mergeSetup();
  const merged = await service.mergeTicket(manager, child._id, { parentId: parent._id, note: 'Cùng vụ thang máy' });
  assert.equal(merged.status, 'MERGED');
  assert.equal(String(merged.mergedInto), String(parent._id));
  assert.ok(await notified(b.user, /đã được gộp/));

  const view = await service.getTicket(asUser(b.user), child._id);
  assert.equal(view.mergedParent.code, parent.code);
  const parentView = await service.getTicket(manager, parent._id);
  assert.deepEqual(parentView.mergedChildren.map((c) => c.code), [child.code]);

  await assert.rejects(service.assignTicket(manager, child._id, { assignedTo: tech._id }), /gộp vào phiếu khác/);

  await Ticket.updateOne({ _id: parent._id }, { $set: { status: 'WAITING_CONFIRM', resolvedAt: new Date() } });
  await service.confirmTicket(asUser(a.user), parent._id, { accepted: true, rating: 5 });
  const closedChild = await Ticket.findById(child._id).lean();
  assert.equal(closedChild.status, 'CLOSED');
  assert.match(closedChild.history.at(-1).note, /phiếu chính/);
  assert.ok(await notified(b.user, /đã xử lý xong/));
});

test('M5-6: không gộp phiếu trong căn / phiếu đang xử lý / vào chính nó / vào phiếu đã đóng; KTV không gộp được', async () => {
  const { a, tech, parent, child, manager } = await mergeSetup();
  const inApt = await createTicket({ apartment: a.apartment, createdBy: a.user, scope: 'IN_APARTMENT' });
  const closed = await createTicket({ apartment: a.apartment, createdBy: a.user, status: 'CLOSED' });

  await assert.rejects(service.mergeTicket(manager, child._id, { parentId: child._id }), /chính nó/);
  await assert.rejects(service.mergeTicket(manager, inApt._id, { parentId: parent._id }), /khu vực chung/);
  await assert.rejects(service.mergeTicket(manager, parent._id, { parentId: child._id }), /chưa bắt đầu xử lý/);
  await assert.rejects(service.mergeTicket(manager, child._id, { parentId: closed._id }), { errorCode: 'TICKET_ALREADY_CLOSED' });
  assert.ok(tech);
});

test('M5-6: phiếu chính tự nghiệm thu (cron) → phiếu con cũng đóng', async () => {
  const { a, parent, child, manager } = await mergeSetup();
  await service.mergeTicket(manager, child._id, { parentId: parent._id });
  await Ticket.updateOne({ _id: parent._id }, { $set: { status: 'WAITING_CONFIRM', resolvedAt: new Date(Date.now() - 4 * DAY) } });
  await autoCloseTickets();
  assert.equal((await Ticket.findById(child._id).lean()).status, 'CLOSED');
  assert.ok(a);
});
