// Mô đun 4 — Bước 4: danh sách / chi tiết / thông báo phí của cư dân, phân quyền X1.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Invoice, Payment, PrepaidBalance } from '../../src/models/index.js';
import { getInvoice, listInvoices, myInvoices } from '../../src/modules/invoices/invoices.queries.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createManager, createUser, linkResident } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-10-15T03:00:00Z');

async function setup() {
  const manager = asUser(await createManager());
  const { user: owner, apartment } = await createHousehold();
  const { apartment: otherApt, user: otherOwner } = await createHousehold();
  const base = { apartmentId: apartment._id, buildingId: apartment.buildingId, items: [], payerId: owner._id };
  const [aug, sep, oct, draft] = await Invoice.create([
    { ...base, code: 'HD-08', period: '2026-08', totalAmount: 300_000, paidAmount: 300_000, status: 'PAID', issuedAt: NOW, dueDate: NOW },
    { ...base, code: 'HD-09', period: '2026-09', totalAmount: 400_000, paidAmount: 100_000, status: 'OVERDUE', issuedAt: NOW, dueDate: NOW },
    { ...base, code: 'HD-10', period: '2026-10', totalAmount: 500_000, status: 'UNPAID', issuedAt: NOW, dueDate: NOW },
    { ...base, code: 'HD-11', period: '2026-11', totalAmount: 600_000, status: 'DRAFT' },
  ]);
  await Invoice.create({
    apartmentId: otherApt._id,
    buildingId: otherApt.buildingId,
    payerId: otherOwner._id,
    items: [],
    code: 'HD-X',
    period: '2026-10',
    totalAmount: 1,
    status: 'UNPAID',
  });
  return { manager, owner: asUser(owner), ownerDoc: owner, apartment, otherOwner: asUser(otherOwner), aug, sep, oct, draft };
}

test('quản trị: lọc theo trạng thái + đếm theo trạng thái, có số còn nợ', async () => {
  const { apartment } = await setup();
  const r = await listInvoices({ apartmentId: apartment._id, status: ['OVERDUE', 'UNPAID'], page: 1, limit: 20, sort: 'code' });
  assert.deepEqual(r.items.map((i) => i.code), ['HD-09', 'HD-10']);
  assert.equal(r.items[0].outstanding, 300_000);
  assert.equal(r.pagination.total, 2);
  assert.equal(r.byStatus.DRAFT.count, 1);
  assert.equal(r.byStatus.PAID.count, 1);

  const byCode = await listInvoices({ q: 'hd-x', page: 1, limit: 20 });
  assert.equal(byCode.pagination.total, 1);
});

test('Người nộp phí: thấy mọi thông báo đã phát hành, không thấy Nháp; tổng nợ + số dư', async () => {
  const { owner, apartment } = await setup();
  await PrepaidBalance.create({ apartmentId: apartment._id, payerId: owner.id, balance: 50_000 });
  const r = await myInvoices(owner, { apartmentId: apartment._id, page: 1, limit: 20 });
  assert.deepEqual(r.items.map((i) => i.code), ['HD-10', 'HD-09', 'HD-08']);
  assert.equal(r.summary.isPayer, true);
  assert.equal(r.summary.outstanding, 300_000 + 500_000);
  assert.equal(r.summary.overdue, 300_000);
  assert.equal(r.summary.prepaidBalance, 50_000);
});

test('thành viên khác chỉ xem các kỳ từ khi chuyển vào; không thấy tổng nợ của người nộp', async () => {
  const { apartment, sep, oct } = await setup();
  const member = await createUser('RESIDENT');
  await linkResident(member, apartment, { moveInDate: new Date('2026-09-10T00:00:00+07:00') });

  const r = await myInvoices(asUser(member), { apartmentId: apartment._id, page: 1, limit: 20 });
  assert.deepEqual(r.items.map((i) => i.code), ['HD-10', 'HD-09']);
  assert.equal(r.summary.isPayer, false);
  assert.equal(r.summary.outstanding, 0);

  assert.equal((await getInvoice(asUser(member), oct._id)).code, 'HD-10');
  assert.equal((await getInvoice(asUser(member), sep._id)).isPayer, false);
});

test('cư dân căn khác không xem được; cư dân không xem được Nháp (404)', async () => {
  const { otherOwner, owner, apartment, oct, draft } = await setup();
  await assert.rejects(myInvoices(otherOwner, { apartmentId: apartment._id, page: 1, limit: 20 }), { status: 403 });
  await assert.rejects(getInvoice(otherOwner, oct._id), { status: 404 });
  await assert.rejects(getInvoice(owner, draft._id), { status: 404 });
});

test('chi tiết: kèm các lần thanh toán và số phân bổ cho thông báo này; cư dân không thấy lý do trả lại', async () => {
  const { manager, owner, ownerDoc, apartment, sep, oct } = await setup();
  await Invoice.updateOne({ _id: oct._id }, { $set: { returnNote: 'Sai số xe' } });
  await Payment.create({
    apartmentId: apartment._id,
    payerId: ownerDoc._id,
    method: 'CASH',
    amount: 150_000,
    status: 'SUCCESS',
    paidAt: NOW,
    receiptNo: 'PT-202610-00001',
    allocations: [
      { invoiceId: sep._id, amount: 100_000 },
      { invoiceId: oct._id, amount: 50_000 },
    ],
  });

  const staffView = await getInvoice(manager, oct._id);
  assert.equal(staffView.returnNote, 'Sai số xe');
  assert.equal(staffView.payments.length, 1);
  assert.equal(staffView.payments[0].allocatedAmount, 50_000);

  const residentView = await getInvoice(owner, oct._id);
  assert.equal(residentView.returnNote, undefined);
  assert.equal(residentView.isPayer, true);
  assert.equal(residentView.outstanding, 500_000);
});
