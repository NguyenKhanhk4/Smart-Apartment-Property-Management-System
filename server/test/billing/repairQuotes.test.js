// Bước 8 — báo giá sửa chữa trong căn hộ (UC48, UC40): gửi báo giá, Người nộp phí đồng ý / từ chối, báo giá lại vượt 10%
// phải duyệt lại, nhắc 2 ngày / tự đóng 5 ngày, phiếu đã nghiệm thu → chi phí vào thông báo phí kỳ sau (không cộng 2 lần).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeeType, Invoice, Notification, RepairQuote, Ticket } from '../../src/models/index.js';
import { recalculateDraft } from '../../src/modules/invoices/invoices.drafts.js';
import { generateForApartment } from '../../src/modules/invoices/invoices.service.js';
import { listQuotes, listTicketQuotes, remindQuotes, submitQuote } from '../../src/modules/repairQuotes/repairQuotes.service.js';
import { decideQuote, updateProgress } from '../../src/modules/tickets/tickets.service.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createResidentUser, createTechnician, createTicket, createUser, linkResident } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';
import { USERS, startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-10-10T03:00:00Z');
const later = (days) => new Date(NOW.getTime() + days * DAY_MS);
const items = (...prices) => prices.map((p, i) => ({ description: `Hạng mục ${i + 1}`, quantity: 1, unitPrice: p }));

async function setup() {
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  const techDoc = await createTechnician();
  const tech = asUser(techDoc);
  const ticket = await createTicket({ apartment, createdBy: owner, scope: 'IN_APARTMENT', status: 'ASSIGNED', assignedTo: techDoc._id });
  return { owner, ownerUser: asUser(owner), apartment, tech, techDoc, ticket };
}

const quotesOf = (ticketId) => RepairQuote.find({ ticketId }).sort({ version: 1 }).lean();

test('KTV gửi báo giá → Chờ đồng ý phí, báo Người nộp phí; đồng ý → báo giá ACCEPTED, phiếu Đang xử lý', async () => {
  const { owner, ownerUser, apartment, tech, ticket } = await setup();
  const other = asUser(await createTechnician());
  await assert.rejects(submitQuote(other, { ticketId: ticket._id, items: items(100_000) }), { errorCode: 'FORBIDDEN_ROLE' });

  const r = await submitQuote(tech, { ticketId: ticket._id, items: [{ description: 'Thay vòi sen', quantity: 2, unitPrice: 150_000 }], note: 'Vòi rò nước' }, { now: NOW });
  assert.equal(r.needsApproval, true);
  assert.equal(r.ticketStatus, 'WAITING_QUOTE_APPROVAL');
  assert.match(r.quote.code, /^BG-202610-00001$/);
  assert.equal(r.quote.totalAmount, 300_000);
  assert.equal(String(r.quote.payerId), String(owner._id));
  assert.equal(await Notification.countDocuments({ userId: owner._id, type: 'TICKET' }), 1);

  // Thành viên không phải Người nộp phí không quyết định được (X1, Người 4 kiểm tra)
  const member = await createResidentUser();
  await linkResident(member, apartment);
  await assert.rejects(decideQuote(asUser(member), ticket._id, { accepted: true }), { errorCode: 'FORBIDDEN_ROLE' });

  const t = await decideQuote(ownerUser, ticket._id, { accepted: true, note: 'Đồng ý' }, { now: NOW });
  assert.equal(t.status, 'IN_PROGRESS');
  const [q] = await quotesOf(ticket._id);
  assert.equal(q.status, 'ACCEPTED');
  assert.equal(String(q.decidedBy), String(owner._id));

  const view = await listTicketQuotes(ownerUser, ticket._id);
  assert.equal(view.items.length, 1);
  assert.equal(view.reapprovalPercent, 10);
});

test('không gửi được báo giá cho sự cố khu vực chung; không chuyển trạng thái báo giá trực tiếp', async () => {
  const { owner, apartment, tech, techDoc, ticket } = await setup();
  const common = await createTicket({ apartment, createdBy: owner, scope: 'COMMON_AREA', status: 'ASSIGNED', assignedTo: techDoc._id });
  await assert.rejects(submitQuote(tech, { ticketId: common._id, items: items(100_000) }), /trong căn hộ/);
  await assert.rejects(updateProgress(tech, ticket._id, { status: 'WAITING_QUOTE_APPROVAL', note: 'x' }), { errorCode: 'VALIDATION_ERROR' });
});

test('báo giá lại: trong 10% tự áp dụng; vượt 10% quay lại Chờ đồng ý, đồng ý thì bản cũ bị thay', async () => {
  const { ownerUser, tech, ticket } = await setup();
  await submitQuote(tech, { ticketId: ticket._id, items: items(1_000_000) }, { now: NOW });
  await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: NOW });

  const small = await submitQuote(tech, { ticketId: ticket._id, items: items(1_000_000, 100_000) }, { now: later(1) });
  assert.equal(small.needsApproval, false);
  assert.equal(small.ticketStatus, 'IN_PROGRESS');
  assert.equal(small.quote.status, 'ACCEPTED');
  assert.equal(small.quote.autoAccepted, true);
  assert.deepEqual((await quotesOf(ticket._id)).map((q) => q.status), ['SUPERSEDED', 'ACCEPTED']);

  const big = await submitQuote(tech, { ticketId: ticket._id, items: items(1_000_000, 300_000) }, { now: later(2) });
  assert.equal(big.needsApproval, true);
  assert.equal(big.quote.previousAmount, 1_100_000);
  assert.equal((await Ticket.findById(ticket._id).lean()).status, 'WAITING_QUOTE_APPROVAL');

  await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: later(2) });
  assert.deepEqual((await quotesOf(ticket._id)).map((q) => q.status), ['SUPERSEDED', 'SUPERSEDED', 'ACCEPTED']);
  assert.equal((await Ticket.findById(ticket._id).lean()).status, 'IN_PROGRESS');
});

test('gửi lại khi đang chờ đồng ý: bản cũ bị thay, chỉ 1 bản chờ', async () => {
  const { tech, ticket } = await setup();
  await submitQuote(tech, { ticketId: ticket._id, items: items(500_000) }, { now: NOW });
  await submitQuote(tech, { ticketId: ticket._id, items: items(450_000) }, { now: later(1) });
  assert.deepEqual((await quotesOf(ticket._id)).map((q) => [q.version, q.status]), [
    [1, 'SUPERSEDED'],
    [2, 'PENDING'],
  ]);
});

test('không phản hồi: nhắc 1 lần sau 2 ngày, tự đóng phiếu (Từ chối) sau 5 ngày', async () => {
  const { owner, techDoc, tech, ticket } = await setup();
  await submitQuote(tech, { ticketId: ticket._id, items: items(200_000) }, { now: NOW });
  const ownerNotis = () => Notification.countDocuments({ userId: owner._id });

  await remindQuotes(later(1));
  assert.equal(await ownerNotis(), 1);
  await remindQuotes(later(2));
  await remindQuotes(later(3));
  assert.equal(await ownerNotis(), 2, 'nhắc đúng 1 lần');

  const run = await remindQuotes(later(5));
  assert.equal(run.affectedCount, 1);
  const [q] = await quotesOf(ticket._id);
  assert.equal(q.status, 'EXPIRED');
  const t = await Ticket.findById(ticket._id).lean();
  assert.equal(t.status, 'REJECTED');
  assert.equal(t.quoteDecision.accepted, false);
  assert.equal(t.history.at(-1).action, 'QUOTE_EXPIRED');
  assert.equal(await Notification.countDocuments({ userId: techDoc._id }), 1);
});

test('phiếu đã nghiệm thu → chi phí vào thông báo phí kỳ sau, đánh dấu đã tính, tính lại không cộng 2 lần', async () => {
  const { ownerUser, tech, ticket, apartment } = await setup();
  const accountant = asUser(await createUser('ACCOUNTANT'));
  apartment.type = 'RESIDENTIAL';
  apartment.netArea = 62;
  apartment.handoverDate = new Date('2026-11-16T00:00:00+07:00');
  await apartment.save();
  await FeeType.create({
    code: 'MANAGEMENT_RESIDENTIAL',
    name: 'Phí quản lý căn ở',
    feeCategory: 'MANAGEMENT',
    calcMethod: 'PER_M2',
    unitPrice: 12_000,
    effectiveFrom: new Date('2026-11-01T00:00:00+07:00'),
  });
  await FeeType.create({
    code: 'CLEANING',
    name: 'Phí vệ sinh',
    feeCategory: 'CLEANING',
    calcMethod: 'PER_M2',
    unitPrice: 7000,
    effectiveFrom: new Date('2026-01-01T00:00:00+07:00'),
  });
  await submitQuote(tech, { ticketId: ticket._id, items: items(350_000) }, { now: NOW });
  await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: NOW });

  // Chưa nghiệm thu → kỳ 11 chưa tính
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'WAITING_CONFIRM' } });
  const nov = await generateForApartment(accountant, { period: '2026-11', apartmentId: apartment._id }, { now: new Date('2026-11-20T03:00:00Z') });
  assert.equal(nov.items.filter((i) => i.feeCategory === 'REPAIR').length, 0);

  // Nghiệm thu 20/10 → tính lại Nháp kỳ 11 có dòng sửa chữa
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'CLOSED', closedAt: new Date('2026-10-20T03:00:00Z') } });
  const recalculated = await recalculateDraft(accountant, nov._id);
  const repair = recalculated.items.find((i) => i.feeCategory === 'REPAIR');
  assert.equal(repair.amount, 350_000);
  assert.match(repair.description, /Sửa chữa: .*nghiệm thu 20\/10/);
  const management = recalculated.items.find((i) => i.feeCategory === 'MANAGEMENT');
  assert.equal(management.amount, 372_000);
  assert.match(management.description, /15\/30 ngày/);
  assert.equal(recalculated.totalAmount, 70 * 7000 + 372_000 + 350_000);
  const [q] = await quotesOf(ticket._id);
  assert.equal(String(q.invoiceId), String(nov._id));

  // Tính lại lần nữa vẫn 1 dòng; kỳ 12 không tính lại
  const again = await recalculateDraft(accountant, nov._id);
  assert.equal(again.items.filter((i) => i.feeCategory === 'REPAIR').length, 1);
  assert.equal(again.totalAmount, recalculated.totalAmount);
  await Invoice.updateOne({ _id: nov._id }, { $set: { status: 'UNPAID' } });
  const dec = await generateForApartment(accountant, { period: '2026-12', apartmentId: apartment._id }, { now: new Date('2026-12-02T03:00:00Z') });
  assert.equal(dec.items.filter((i) => i.feeCategory === 'REPAIR').length, 0);

  const pending = await listQuotes({ status: ['ACCEPTED'], billed: false });
  assert.equal(pending.items.length, 0);
});

test('phân quyền API báo giá: chỉ KTV gửi; cư dân không xem danh sách tổng', async () => {
  const app = await startApp();
  try {
    const body = { ticketId: '64b000000000000000000009', items: [{ description: 'Vòi', quantity: 1, unitPrice: 1000 }] };
    assert.equal((await app.request('POST', '/repair-quotes', { user: USERS.manager, body })).status, 403);
    assert.equal((await app.request('POST', '/repair-quotes', { user: USERS.technician, body: { ticketId: body.ticketId, items: [] } })).status, 400);
    assert.equal((await app.request('GET', '/repair-quotes', { user: USERS.resident })).status, 403);
  } finally {
    await app.close();
  }
});

// ----- M5-3: báo giá lại vượt ngưỡng bị từ chối / quá hạn → không đóng phiếu đang sửa dở -----
test('báo giá lại vượt 10% bị Người nộp phí từ chối → phiếu quay về trạng thái trước, giữ báo giá đã đồng ý', async () => {
  const { ownerUser, tech, techDoc, ticket } = await setup();
  await submitQuote(tech, { ticketId: ticket._id, items: items(1_000_000) }, { now: NOW });
  await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: NOW });
  await updateProgress(tech, ticket._id, { status: 'WAITING_PARTS', note: 'Chờ bơm' });

  await submitQuote(tech, { ticketId: ticket._id, items: items(1_500_000) }, { now: later(1) });
  const t = await decideQuote(ownerUser, ticket._id, { accepted: false, note: 'Đắt quá' }, { now: later(1) });
  assert.equal(t.status, 'WAITING_PARTS');
  assert.equal(t.quoteDecision.accepted, true, 'vẫn giữ quyết định đồng ý báo giá cũ');
  assert.equal(t.closedAt, undefined);
  assert.deepEqual((await quotesOf(ticket._id)).map((q) => q.status), ['ACCEPTED', 'DECLINED']);
  assert.match(t.history.at(-1).note, /báo giá đã đồng ý/);

  // KTV làm tiếp được và nghiệm thu thì tính theo báo giá cũ
  const resumed = await updateProgress(tech, ticket._id, { status: 'IN_PROGRESS' });
  assert.equal(resumed.status, 'IN_PROGRESS');
  assert.ok(await Notification.exists({ userId: techDoc._id, title: /từ chối báo giá/ }));
});

test('báo giá lại vượt 10% quá 5 ngày không phản hồi → quay về Đang xử lý, không đóng phiếu', async () => {
  const { ownerUser, tech, ticket } = await setup();
  await submitQuote(tech, { ticketId: ticket._id, items: items(1_000_000) }, { now: NOW });
  await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: NOW });
  await submitQuote(tech, { ticketId: ticket._id, items: items(2_000_000) }, { now: later(1) });

  await remindQuotes(later(7));
  const t = await Ticket.findById(ticket._id).lean();
  assert.equal(t.status, 'IN_PROGRESS');
  assert.equal(t.quoteDecision.accepted, true);
  assert.equal(t.history.at(-1).action, 'QUOTE_EXPIRED');
  assert.deepEqual((await quotesOf(ticket._id)).map((q) => q.status), ['ACCEPTED', 'EXPIRED']);
});

test('M5-2: chờ cư dân đồng ý phí không trừ SLA — đồng ý sau 3 ngày thì hạn được lùi đúng 3 ngày', async () => {
  const { ownerUser, tech, ticket } = await setup();
  const due = (await Ticket.findById(ticket._id).lean()).dueDate.getTime();
  await submitQuote(tech, { ticketId: ticket._id, items: items(500_000) }, { now: NOW });
  const paused = await Ticket.findById(ticket._id).lean();
  assert.equal(paused.slaPausedAt.getTime(), NOW.getTime());

  const t = await decideQuote(ownerUser, ticket._id, { accepted: true }, { now: later(3) });
  assert.equal(t.slaPausedAt, null);
  assert.equal(t.dueDate.getTime(), due + 3 * DAY_MS);
});
