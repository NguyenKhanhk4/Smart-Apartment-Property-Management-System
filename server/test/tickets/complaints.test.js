import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Notification, Ticket } from '../../src/models/index.js';
import { respondComplaint, confirmTicket } from '../../src/modules/tickets/tickets.service.js';
import { alertSlaBreaches } from '../../src/modules/tickets/tickets.jobs.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApp } from '../helpers/http.js';
import { asUser, createHousehold, createManager, createReceptionist, createTechnician, createTicket } from '../helpers/fixtures.js';

let app;
before(async () => { await connectTestDB(); app = await startApp(); });
afterEach(clearTestDB);
after(async () => { await app.close(); await closeTestDB(); });

async function complaint() {
  const { user, apartment } = await createHousehold();
  const manager = asUser(await createManager());
  const ticket = await createTicket({ apartment, createdBy: user, type: 'COMPLAINT',
    responseDueAt: new Date(Date.now() - 60000) });
  return { user, apartment, manager, ticket };
}

test('UC42: manager phản hồi, đóng trực tiếp; cư dân đánh giá sau đóng và không mở lại', async () => {
  const { user, manager, ticket } = await complaint();
  const first = await respondComplaint(manager, ticket.id, { status: 'IN_PROGRESS', note: 'Đang xác minh với bảo vệ.' });
  const respondedAt = first.respondedAt.getTime();
  assert.equal(await alertSlaBreaches(), 0);
  const done = await respondComplaint(manager, ticket.id, { status: 'CLOSED', note: 'Đã nhắc nhở và khắc phục tiếng ồn.' });
  assert.equal(done.respondedAt.getTime(), respondedAt);
  assert.equal(done.status, 'CLOSED');
  assert.ok(done.closedAt);
  const closedAt = done.closedAt.getTime();
  await assert.rejects(confirmTicket(asUser(user), ticket.id, { accepted: false, reason: 'Yêu cầu mở lại' }));
  const rated = await confirmTicket(asUser(user), ticket.id, { accepted: true, rating: 4, comment: 'Đã được giải quyết' });
  assert.equal(rated.status, 'CLOSED');
  assert.equal(rated.closedAt.getTime(), closedAt);
  assert.equal(rated.rating, 4);
  await assert.rejects(confirmTicket(asUser(user), ticket.id, { accepted: true, rating: 5 }));
  assert.equal(await AuditLog.countDocuments({ action: 'TICKET_COMPLAINT_RESPONDED' }), 2);
  assert.equal(await Notification.countDocuments({ userId: user._id, refId: ticket._id }), 2);
});

test('UC42: API chỉ cho manager, bắt buộc nội dung và trạng thái đúng; có thể giải quyết ngay', async () => {
  const { user, manager, ticket } = await complaint();
  for (const actor of [asUser(user), asUser(await createReceptionist()), asUser(await createTechnician())]) {
    const res = await app.request('PATCH', `/tickets/${ticket.id}/respond-complaint`, {
      user: actor, body: { status: 'CLOSED', note: 'Đã giải quyết phản ánh.' },
    });
    assert.equal(res.status, 403);
  }
  for (const body of [{ status: 'CLOSED', note: '   ' }, { status: 'WAITING_CONFIRM', note: 'Kết quả xử lý' }]) {
    assert.equal((await app.request('PATCH', `/tickets/${ticket.id}/respond-complaint`, { user: manager, body })).status, 400);
  }
  const res = await app.request('PATCH', `/tickets/${ticket.id}/respond-complaint`, {
    user: manager, body: { status: 'CLOSED', note: 'Đã phối hợp bảo vệ xử lý.' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'CLOSED');
});

test('UC42: không dùng luồng phản ánh cho sự cố kỹ thuật hoặc phiếu đã kết thúc', async () => {
  const { manager, ticket } = await complaint();
  await Ticket.updateOne({ _id: ticket._id }, { type: 'INCIDENT' });
  await assert.rejects(respondComplaint(manager, ticket.id, { status: 'CLOSED', note: 'Đã xử lý xong.' }));
  await Ticket.updateOne({ _id: ticket._id }, { type: 'COMPLAINT', status: 'REJECTED' });
  await assert.rejects(respondComplaint(manager, ticket.id, { status: 'IN_PROGRESS', note: 'Thử mở lại phiếu.' }));
  assert.equal(await AuditLog.countDocuments({ action: 'TICKET_COMPLAINT_RESPONDED' }), 0);
});

test('UC42: người ở căn khác không được đánh giá phản ánh', async () => {
  const { manager, ticket } = await complaint();
  await respondComplaint(manager, ticket.id, { status: 'CLOSED', note: 'Đã hoàn tất xử lý.' });
  const { user: other } = await createHousehold();
  await assert.rejects(confirmTicket(asUser(other), ticket.id, { accepted: true, rating: 5 }), { status: 403 });
  assert.equal((await Ticket.findById(ticket.id)).rating, null);
});
