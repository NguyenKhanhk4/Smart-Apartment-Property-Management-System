// Mô đun 4 — Bước 7: kiểm tra công nợ căn (UC23), nhắc nợ 3 ngày/lần tối đa 3 lần → Nợ quá hạn dài, hẹn trả,
// sổ công nợ, PDF Thông báo nợ quá hạn (UC31).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DebtFollowup, Invoice, Notification, PrepaidBalance } from '../../src/models/index.js';
import { buildDebtNotice, recordActivity } from '../../src/modules/debts/debts.cases.js';
import { checkApartmentDebt } from '../../src/modules/debts/debts.check.js';
import { remindDebts } from '../../src/modules/debts/debts.jobs.js';
import { getApartmentLedger, listLedger } from '../../src/modules/debts/debts.ledger.js';
import { getApartmentDebt } from '../../src/modules/gatePasses/debtProvider.js';
import { recordOfflinePayment } from '../../src/modules/payments/payments.service.js';
import { debtReport } from '../../src/modules/reports/reports.service.js';
import { DAY_MS, toVnYmd } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createManager, createResidentUser, createUser } from '../helpers/fixtures.js';
import { USERS, startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-11-05T01:30:00Z'); // 08:30 05/11 giờ VN
const day = (n) => new Date(NOW.getTime() + n * DAY_MS);
const PAST_DUE = new Date('2026-10-30T16:59:00Z'); // hết ngày 30/10 giờ VN
const FUTURE_DUE = new Date('2026-11-20T16:59:00Z');

async function setup() {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const managerDoc = await createManager();
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
      issuedAt: new Date('2026-10-10T03:00:00Z'),
      dueDate: PAST_DUE,
      ...extra,
    });
  return { accountant, manager: asUser(managerDoc), managerDoc, owner, apartment, mk };
}

const reminders = (userId) => Notification.countDocuments({ userId, type: 'DEBT_REMINDER' });

test('nhắc nợ: lần 1 ngay, 3 ngày/lần, tối đa 3 lần → Nợ quá hạn dài, báo Trưởng BQL đúng 1 lần', async () => {
  const { owner, managerDoc, mk } = await setup();
  await mk('HD-10', '2026-10', 500_000); // hạn đã qua nhưng cron quá hạn chưa chạy (vẫn UNPAID)
  await mk('HD-11', '2026-11', 300_000, { dueDate: FUTURE_DUE }); // chưa đến hạn — không tính vào nợ quá hạn

  await remindDebts(NOW);
  let c = await DebtFollowup.findOne({ payerId: owner._id }).lean();
  assert.equal(c.status, 'REMINDING');
  assert.equal(c.reminderCount, 1);
  assert.equal(c.reminders[0].amount, 500_000);
  assert.deepEqual(c.reminders[0].invoiceCodes, ['HD-10']);
  assert.equal(await reminders(owner._id), 1);

  await remindDebts(NOW); // chạy lại cùng ngày không nhắc trùng
  await remindDebts(day(2)); // chưa đủ 3 ngày
  assert.equal(await reminders(owner._id), 1);

  await remindDebts(day(3));
  await remindDebts(day(6));
  c = await DebtFollowup.findById(c._id).lean();
  assert.equal(c.reminderCount, 3);
  assert.equal(await reminders(owner._id), 3);

  await remindDebts(day(8)); // nhắc đủ 3 lần, chưa hết khoảng chờ
  assert.equal((await DebtFollowup.findById(c._id).lean()).status, 'REMINDING');

  await remindDebts(day(9));
  c = await DebtFollowup.findById(c._id).lean();
  assert.equal(c.status, 'LONG_OVERDUE');
  assert.ok(c.longOverdueAt);
  assert.equal(await reminders(managerDoc._id), 1);

  await remindDebts(day(12));
  await remindDebts(day(15));
  assert.equal(await reminders(owner._id), 3, 'Nợ quá hạn dài thì dừng nhắc tự động');
  assert.equal(await reminders(managerDoc._id), 1, 'chỉ báo Trưởng BQL 1 lần');
  assert.equal(await DebtFollowup.countDocuments(), 1);
});

test('hẹn trả: tạm dừng nhắc đến hết ngày hẹn; quá hẹn chưa trả → đóng lời hẹn, báo Trưởng BQL 1 lần', async () => {
  const { owner, manager, managerDoc, mk } = await setup();
  await mk('HD-10', '2026-10', 500_000);
  await remindDebts(NOW);
  const c = await DebtFollowup.findOne({ payerId: owner._id }).lean();

  await assert.rejects(recordActivity(manager, c._id, { method: 'PHONE', promisedDate: '2026-11-01' }, { now: NOW }), /quá khứ/);
  const updated = await recordActivity(
    manager,
    c._id,
    { method: 'PHONE', response: 'Hẹn trả sau lương', promisedDate: toVnYmd(day(5)) },
    { now: NOW },
  );
  assert.equal(updated.activities.length, 1);
  assert.equal(updated.activities[0].by.fullName, managerDoc.fullName);
  assert.ok(updated.promisedDate);

  await remindDebts(day(3));
  await remindDebts(day(5)); // còn trong ngày hẹn
  assert.equal(await reminders(owner._id), 1);
  assert.equal(await reminders(managerDoc._id), 0);

  await remindDebts(day(6)); // quá ngày hẹn
  const after6 = await DebtFollowup.findById(c._id).lean();
  assert.equal(after6.promisedDate, null);
  assert.match(after6.activities.at(-1).note, /Quá ngày hẹn/);
  assert.equal(await reminders(managerDoc._id), 1);
  assert.equal(await reminders(owner._id), 2, 'hết hẹn thì nhắc tự động tiếp');

  await remindDebts(day(7));
  assert.equal(await reminders(managerDoc._id), 1);
});

test('trả hết khoản quá hạn → hồ sơ nợ đóng ngay; không ghi kết quả được nữa', async () => {
  const { accountant, manager, owner, apartment, mk } = await setup();
  await mk('HD-09', '2026-09', 200_000, { status: 'OVERDUE' });
  await mk('HD-10', '2026-10', 300_000);
  await mk('HD-11', '2026-11', 400_000, { dueDate: FUTURE_DUE });
  await remindDebts(NOW);
  const c = await DebtFollowup.findOne({ payerId: owner._id }).lean();

  // Trả 1 phần: vẫn còn quá hạn → giữ hồ sơ
  await recordOfflinePayment(accountant, { method: 'CASH', apartmentId: apartment._id, payerId: owner._id, amount: 200_000 }, { now: NOW });
  assert.equal((await DebtFollowup.findById(c._id).lean()).status, 'REMINDING');

  // Trả nốt kỳ quá hạn (kỳ 11 chưa đến hạn vẫn còn nợ) → đóng
  await recordOfflinePayment(accountant, { method: 'CASH', apartmentId: apartment._id, payerId: owner._id, amount: 300_000 }, { now: NOW });
  const closed = await DebtFollowup.findById(c._id).lean();
  assert.equal(closed.status, 'RESOLVED');
  assert.ok(closed.resolvedAt);
  await assert.rejects(recordActivity(manager, c._id, { method: 'PHONE' }, { now: NOW }), /đã đóng/);

  // Quá hạn lần sau mở hồ sơ mới
  await Invoice.updateOne({ code: 'HD-11' }, { $set: { dueDate: PAST_DUE } });
  await remindDebts(NOW);
  assert.equal(await DebtFollowup.countDocuments({ payerId: owner._id }), 2);
});

test('cron đóng hồ sơ khi khoản quá hạn không còn (vd thông báo bị hủy)', async () => {
  const { owner, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  await remindDebts(NOW);
  await Invoice.updateOne({ _id: inv._id }, { $set: { status: 'CANCELLED' } });
  const run = await remindDebts(day(1));
  assert.equal(run.affectedCount, 1);
  assert.equal((await DebtFollowup.findOne({ payerId: owner._id }).lean()).status, 'RESOLVED');
});

test('UC23: nợ tách theo Người nộp phí, số dư của người này không bù nợ người khác; giữ dạng trả về của debtProvider', async () => {
  const { owner, apartment, mk } = await setup();
  const tenant = await createResidentUser();
  await mk('HD-09', '2026-09', 400_000, { status: 'OVERDUE' }); // chủ hộ
  await mk('HD-10', '2026-10', 300_000, { payerId: tenant._id, dueDate: FUTURE_DUE }); // khách thuê
  await mk('HD-08', '2026-08', 999_000, { status: 'PAID', paidAmount: 999_000 });
  await PrepaidBalance.create({ apartmentId: apartment._id, payerId: tenant._id, balance: 500_000 });

  const debt = await checkApartmentDebt(apartment._id);
  assert.equal(debt.outstanding, 700_000);
  assert.equal(debt.amount, 400_000, 'khách thuê có số dư 500k > nợ 300k → nợ ròng 0; chủ hộ vẫn nợ 400k');
  assert.equal(debt.credit, 200_000);
  assert.equal(debt.overdueAmount, 400_000);
  const ownerRow = debt.byPayer.find((p) => String(p.payerId) === String(owner._id));
  assert.equal(ownerRow.net, 400_000);
  assert.equal(ownerRow.fullName, owner.fullName);

  const gp = await getApartmentDebt(apartment._id);
  assert.equal(gp.amount, 400_000);
  assert.equal(gp.invoiceCount, 2);
  assert.equal(gp.available, true);
});

test('UC23: công nợ tại một ngày trong quá khứ dựng lại từ lịch sử thanh toán', async () => {
  const { accountant, apartment, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 1_000_000);
  const realNow = new Date();
  await recordOfflinePayment(
    accountant,
    { method: 'CASH', invoiceId: inv._id, amount: 600_000, paidAt: new Date('2026-10-25T03:00:00Z') },
    { now: realNow },
  );

  assert.equal((await checkApartmentDebt(apartment._id, { at: new Date('2026-10-20T03:00:00Z') })).amount, 1_000_000);
  const afterPay = await checkApartmentDebt(apartment._id, { at: new Date('2026-10-26T03:00:00Z') });
  assert.equal(afterPay.amount, 400_000);
  assert.equal(afterPay.overdueAmount, 0, 'ngày 26/10 chưa quá hạn 30/10');
  const overdue = await checkApartmentDebt(apartment._id, { at: new Date('2026-11-01T03:00:00Z') });
  assert.equal(overdue.overdueAmount, 400_000);
  assert.equal((await checkApartmentDebt(apartment._id, { at: new Date('2026-10-01T03:00:00Z') })).amount, 0, 'trước ngày phát hành');
});

test('sổ công nợ: mỗi dòng là căn + Người nộp phí, tình trạng nặng nhất, lọc Nợ quá hạn dài, tổng hợp', async () => {
  const { owner, apartment, mk } = await setup();
  const tenant = await createResidentUser();
  await mk('HD-09', '2026-09', 400_000, { status: 'OVERDUE' });
  await mk('HD-10', '2026-10', 300_000, { payerId: tenant._id, dueDate: FUTURE_DUE, status: 'PARTIALLY_PAID', paidAmount: 100_000 });
  const other = await createHousehold();
  await PrepaidBalance.create({ apartmentId: other.apartment._id, payerId: other.user._id, balance: 50_000 }); // nộp trước, chưa có thông báo
  await DebtFollowup.create({
    apartmentId: apartment._id,
    payerId: owner._id,
    status: 'LONG_OVERDUE',
    openedAt: NOW,
    reminderCount: 3,
  });

  const all = await listLedger({}, { now: NOW });
  assert.equal(all.pagination.total, 3);
  const row = (payerId) => all.items.find((r) => String(r.payerId) === String(payerId));
  assert.equal(row(owner._id).ledgerStatus, 'LONG_OVERDUE');
  assert.equal(row(owner._id).case.reminderCount, 3);
  assert.equal(row(tenant._id).ledgerStatus, 'PARTIALLY_PAID');
  assert.equal(row(tenant._id).outstanding, 200_000);
  assert.equal(row(other.user._id).ledgerStatus, 'PAID');
  assert.equal(row(other.user._id).prepaidBalance, 50_000);
  assert.equal(all.items[0].payerId.toString(), owner._id.toString(), 'mặc định sắp còn nợ giảm dần');
  assert.equal(all.summary.outstanding, 600_000);
  assert.equal(all.summary.byStatus.LONG_OVERDUE, 1);

  const longOnly = await listLedger({ status: ['LONG_OVERDUE'] }, { now: NOW });
  assert.equal(longOnly.items.length, 1);
  assert.equal((await listLedger({ hasBalance: true }, { now: NOW })).items.length, 1);
  assert.equal((await listLedger({ q: other.apartment.code }, { now: NOW })).items.length, 1);

  const detail = await getApartmentLedger(apartment._id, { now: NOW });
  assert.equal(detail.payers.length, 2);
  assert.equal(detail.cases.length, 1);
  assert.equal(detail.debt.amount, 600_000);

  const report = await debtReport({});
  assert.equal(report.longOverdue, 1);
  assert.equal(report.items[0].caseStatus, 'LONG_OVERDUE');
});

test('PDF Thông báo nợ quá hạn', async () => {
  const { manager, owner, mk } = await setup();
  await mk('HD-10', '2026-10', 500_000);
  await remindDebts(NOW);
  const c = await DebtFollowup.findOne({ payerId: owner._id }).lean();
  await recordActivity(manager, c._id, { method: 'IN_PERSON', response: 'Từ chối thanh toán' }, { now: NOW });

  const file = await buildDebtNotice(manager, c._id, { now: NOW });
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.buffer.subarray(0, 4).toString(), '%PDF');
  assert.match(file.filename, /^thong-bao-no-.+-2026-11-05\.pdf$/);
});

test('phân quyền API công nợ: cư dân không xem được sổ; chỉ Trưởng BQL ghi kết quả xử lý', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.request('GET', '/debts/ledger', { user: USERS.resident })).status, 403);
    const id = '64b000000000000000000009';
    assert.equal(
      (await app.request('POST', `/debts/cases/${id}/activities`, { user: { role: 'ACCOUNTANT' }, body: { method: 'PHONE' } })).status,
      403,
    );
    const bad = await app.request('POST', `/debts/cases/${id}/activities`, { user: USERS.manager, body: { method: 'FAX' } });
    assert.equal(bad.status, 400);
  } finally {
    await app.close();
  }
});
