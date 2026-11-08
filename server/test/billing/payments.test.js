// Mô đun 4 — Bước 5: thu tiền mặt / chuyển khoản, phân bổ cũ nhất trước, Số dư trả trước, phiếu thu, biên lai.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Invoice, Notification, PrepaidBalance, PrepaidTransaction } from '../../src/models/index.js';
import { hasOverdueInvoice } from '../../src/modules/amenities/overdue.js';
import { checkApartmentDebt } from '../../src/modules/debts/debts.check.js';
import { publishInvoices, submitInvoices } from '../../src/modules/invoices/invoices.approval.js';
import { markOverdueInvoices } from '../../src/modules/invoices/invoices.jobs.js';
import { getReceipt, listPayments, recordOfflinePayment } from '../../src/modules/payments/payments.service.js';
import { billingSummary } from '../../src/modules/reports/reports.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createManager, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-10-20T03:00:00Z');
const DUE = new Date('2026-10-30T03:00:00Z');

async function setup() {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const manager = asUser(await createManager());
  const { user: owner, apartment } = await createHousehold();
  const mk = (code, period, totalAmount, extra = {}) =>
    Invoice.create({
      code,
      apartmentId: apartment._id,
      buildingId: apartment.buildingId,
      payerId: owner._id,
      period,
      items: [{ feeCategory: 'CLEANING', description: 'Phí vệ sinh', quantity: 1, unitPrice: totalAmount, amount: totalAmount }],
      totalAmount,
      status: 'UNPAID',
      issuedAt: NOW,
      dueDate: DUE,
      ...extra,
    });
  return { accountant, manager, owner, ownerUser: asUser(owner), apartment, mk };
}

const pay = (user, body) => recordOfflinePayment(user, { method: 'CASH', ...body }, { now: NOW });

test('thu 400k của thông báo 1 triệu → Thanh toán một phần; thu tiếp 800k → Đã thanh toán + số dư 200k', async () => {
  const { accountant, owner, apartment, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);

  const p1 = await pay(accountant, { invoiceId: inv._id, amount: 400_000 });
  assert.match(p1.receiptNo, /^PT-202610-00001$/);
  let doc = await Invoice.findById(inv._id).lean();
  assert.equal(doc.status, 'PARTIALLY_PAID');
  assert.equal(doc.paidAmount, 400_000);

  const p2 = await pay(accountant, { invoiceId: inv._id, amount: 800_000 });
  assert.equal(p2.receiptNo, 'PT-202610-00002');
  assert.equal(p2.creditAmount, 200_000);
  assert.equal(p2.balanceAfter, 200_000);
  doc = await Invoice.findById(inv._id).lean();
  assert.equal(doc.status, 'PAID');
  assert.equal(doc.paidAmount, 1_000_000);
  assert.ok(doc.paidAt);

  assert.equal((await PrepaidBalance.findOne({ apartmentId: apartment._id, payerId: owner._id }).lean()).balance, 200_000);
  const tx = await PrepaidTransaction.findOne({ paymentId: p2._id }).lean();
  assert.equal(tx.type, 'DEPOSIT');
  assert.equal(await Notification.countDocuments({ userId: owner._id, type: 'PAYMENT_RECEIPT' }), 2);
});

test('phân bổ cũ nhất trước qua nhiều kỳ; quá hạn trả một phần vẫn giữ Quá hạn', async () => {
  const { accountant, apartment, owner, mk } = await setup();
  const aug = await mk('HD-08', '2026-08', 300_000, { status: 'OVERDUE' });
  const sep = await mk('HD-09', '2026-09', 300_000, { status: 'OVERDUE' });
  const oct = await mk('HD-10', '2026-10', 300_000);

  const p = await pay(accountant, { apartmentId: apartment._id, payerId: owner._id, amount: 450_000 });
  assert.deepEqual(
    p.allocations.map((a) => [a.code, a.amount]),
    [
      ['HD-08', 300_000],
      ['HD-09', 150_000],
    ],
  );
  assert.equal((await Invoice.findById(aug._id).lean()).status, 'PAID');
  const sepDoc = await Invoice.findById(sep._id).lean();
  assert.equal(sepDoc.status, 'OVERDUE');
  assert.equal(sepDoc.paidAmount, 150_000);
  assert.equal((await Invoice.findById(oct._id).lean()).paidAmount, 0);
});

test('tiền thừa vào số dư → phát hành kỳ sau tự trừ', async () => {
  const { accountant, manager, owner, apartment, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);
  await pay(accountant, { invoiceId: inv._id, amount: 1_200_000 });

  const next = await mk('HD-11', '2026-11', 500_000, { status: 'DRAFT', issuedAt: null, dueDate: null });
  await submitInvoices(accountant, { invoiceIds: [next._id] }, { now: NOW });
  await publishInvoices(manager, { invoiceIds: [next._id] }, { now: NOW });
  const doc = await Invoice.findById(next._id).lean();
  assert.equal(doc.prepaidApplied, 200_000);
  assert.equal(doc.status, 'PARTIALLY_PAID');
  assert.equal((await PrepaidBalance.findOne({ apartmentId: apartment._id, payerId: owner._id }).lean()).balance, 0);
});

test('chuyển khoản: bắt buộc mã giao dịch, trùng mã bị chặn', async () => {
  const { accountant, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);
  await assert.rejects(pay(accountant, { invoiceId: inv._id, amount: 100_000, method: 'BANK_TRANSFER' }), /mã giao dịch/);
  await pay(accountant, { invoiceId: inv._id, amount: 100_000, method: 'BANK_TRANSFER', bankRef: 'FT123' });
  await assert.rejects(pay(accountant, { invoiceId: inv._id, amount: 100_000, method: 'BANK_TRANSFER', bankRef: 'FT123' }), {
    errorCode: 'PAYMENT_DUPLICATE',
  });
  assert.equal((await Invoice.findById(inv._id).lean()).paidAmount, 100_000);
});

test('không thu được vào thông báo đã trả đủ / chưa phát hành', async () => {
  const { accountant, mk } = await setup();
  const paid = await mk('HD-08', '2026-08', 100_000, { status: 'PAID', paidAmount: 100_000 });
  const draft = await mk('HD-11', '2026-11', 100_000, { status: 'DRAFT' });
  await assert.rejects(pay(accountant, { invoiceId: paid._id, amount: 1000 }), /không còn nợ/);
  await assert.rejects(pay(accountant, { invoiceId: draft._id, amount: 1000 }), /không còn nợ/);
});

test('biên lai: phân bổ, còn nợ, số dư; cư dân khác không xem được; danh sách có tổng', async () => {
  const { accountant, ownerUser, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);
  const p = await pay(accountant, { invoiceId: inv._id, amount: 400_000 });

  const r = await getReceipt(ownerUser, p._id);
  assert.equal(r.allocations[0].invoice.code, 'HD-10');
  assert.equal(r.allocations[0].invoice.outstanding, 600_000);
  assert.equal(r.currentOutstanding, 600_000);
  assert.equal(r.prepaidBalance, 0);

  const stranger = asUser(await createUser('RESIDENT'));
  await assert.rejects(getReceipt(stranger, p._id), { status: 404 });

  const list = await listPayments({ page: 1, limit: 20, q: 'PT-2026' });
  assert.equal(list.pagination.total, 1);
  assert.equal(list.totals.amount, 400_000);
});

test('trả một phần: cron quá hạn, chặn tiện ích, công nợ căn hộ, báo cáo đều tính số còn nợ', async () => {
  const { accountant, apartment, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);
  await pay(accountant, { invoiceId: inv._id, amount: 400_000 });

  const afterDue = new Date('2026-11-02T03:00:00Z');
  assert.equal(await hasOverdueInvoice(apartment._id, afterDue), true); // PARTIALLY_PAID qua hạn, cron chưa chạy
  assert.equal(await markOverdueInvoices(afterDue), 1);
  assert.equal((await Invoice.findById(inv._id).lean()).status, 'OVERDUE');

  assert.equal((await checkApartmentDebt(apartment._id)).amount, 600_000);

  const rep = await billingSummary({ from: '2026-10', to: '2026-10' });
  assert.equal(rep.overview.billed, 1_000_000);
  assert.equal(rep.overview.collected, 400_000);
  assert.equal(rep.overview.outstanding, 600_000);
  assert.equal(rep.overview.overdueAmount, 600_000);
  assert.deepEqual(
    rep.byMethod.map((m) => [m.method, m.amount, m.count]),
    [['CASH', 400_000, 1]],
  );
  assert.equal(rep.byFeeCategory[0].collected, 400_000);
});
