// Bước 13 — Dashboard tài chính (UC60), báo cáo giám sát Ban quản trị (5.6), dịch vụ xuất Excel/PDF dùng chung (UC65).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Invoice, Payment, PrepaidBalance } from '../../src/models/index.js';
import { recordIncome } from '../../src/modules/fund/fund.service.js';
import { exportReport } from '../../src/modules/reports/reports.export.js';
import { financeDashboard, supervisionReport } from '../../src/modules/reports/finance.service.js';
import { col, renderReport } from '../../src/services/export.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createUser } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';
import { startApp, tokenFor } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-11-07T03:00:00Z');
const PAST_DUE = new Date('2026-10-30T16:59:00Z');

let seq = 0;
async function invoice(apartment, payerId, period, totalAmount, extra = {}) {
  seq += 1;
  return Invoice.create({
    code: `HD-T-${seq}`,
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    payerId,
    period,
    items: [
      { feeCategory: 'CLEANING', description: 'Phí vệ sinh', quantity: 1, unitPrice: totalAmount - 100_000, amount: totalAmount - 100_000 },
      { feeCategory: 'PARKING', description: 'Gửi xe', quantity: 1, unitPrice: 100_000, amount: 100_000 },
    ],
    totalAmount,
    status: 'UNPAID',
    issuedAt: new Date(`${period}-05T03:00:00Z`),
    dueDate: PAST_DUE,
    ...extra,
  });
}
const payment = (apartment, payerId, amount, method, paidAt) =>
  Payment.create({ apartmentId: apartment._id, payerId, amount, method, status: 'SUCCESS', paidAt, receiptNo: `PT-T-${(seq += 1)}` });

async function seedData() {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const a = await createHousehold();
  const b = await createHousehold();
  const c = await createHousehold();
  // Căn A: kỳ 10 trả đủ (tiền mặt 10/10), kỳ 11 chưa trả
  await invoice(a.apartment, a.user._id, '2026-10', 500_000, { status: 'PAID', paidAmount: 500_000 });
  await invoice(a.apartment, a.user._id, '2026-11', 600_000, { dueDate: new Date('2026-11-20T16:59:00Z') });
  await payment(a.apartment, a.user._id, 500_000, 'CASH', new Date('2026-10-10T03:00:00Z'));
  // Căn B: kỳ 10 quá hạn, trả 1 phần qua payOS
  await invoice(b.apartment, b.user._id, '2026-10', 400_000, { status: 'OVERDUE', paidAmount: 100_000 });
  await payment(b.apartment, b.user._id, 100_000, 'PAYOS', new Date('2026-10-20T03:00:00Z'));
  // Căn C: kỳ 10 trả đủ bằng chuyển khoản ngày 02/11 (thu sau), có số dư trả trước
  await invoice(c.apartment, c.user._id, '2026-10', 300_000, { status: 'PAID', paidAmount: 300_000 });
  await payment(c.apartment, c.user._id, 350_000, 'BANK_TRANSFER', new Date('2026-11-02T03:00:00Z'));
  await PrepaidBalance.create({ apartmentId: c.apartment._id, payerId: c.user._id, balance: 50_000 });
  // Nháp không tính
  await invoice(c.apartment, c.user._id, '2026-11', 999_000, { status: 'DRAFT', issuedAt: null, dueDate: null });
  // Tiện ích trả ngay khi đặt
  const amenity = await createAmenity();
  await createBooking({ amenity, apartment: a.apartment, startAt: new Date('2026-10-15T03:00:00Z'), fee: 80_000, paidAt: new Date('2026-10-14T03:00:00Z') });
  // Quỹ
  await recordIncome(accountant, { incomeSource: 'INTEREST', amount: 12_000_000, documentNo: 'SK-1', occurredAt: new Date('2026-10-01T03:00:00Z') }, [], { now: NOW });
  return { accountant };
}

test('dashboard tài chính: phát hành / đã thu theo kỳ, thu theo tháng và hình thức, cơ cấu phí, tỷ lệ căn còn nợ, quỹ', async () => {
  await seedData();
  const r = await financeDashboard({ from: '2026-10', to: '2026-11' }, { now: NOW });

  const oct = r.byMonth.find((m) => m.period === '2026-10');
  const nov = r.byMonth.find((m) => m.period === '2026-11');
  assert.equal(oct.billed, 1_200_000);
  assert.equal(oct.paidOfPeriod, 900_000);
  assert.equal(oct.collected, 600_000); // tiền mặt 500k + payOS 100k trong tháng 10
  assert.equal(oct.CASH, 500_000);
  assert.equal(oct.PAYOS, 100_000);
  assert.equal(oct.amenityDirect, 80_000);
  assert.equal(nov.billed, 600_000, 'Nháp không tính');
  assert.equal(nov.collected, 350_000);
  assert.equal(nov.BANK_TRANSFER, 350_000);

  assert.equal(r.totals.billed, 1_800_000);
  assert.equal(r.totals.collectionRate, 0.5);
  assert.equal(r.totals.prepaidBalance, 50_000);
  assert.deepEqual(Object.fromEntries(r.byMethod.map((m) => [m.method, m.amount])), { PAYOS: 100_000, CASH: 500_000, BANK_TRANSFER: 350_000 });
  assert.equal(r.byFeeCategory.find((x) => x.feeCategory === 'PARKING').amount, 400_000);

  // A còn nợ kỳ 11 (chưa quá hạn), B quá hạn, C hết nợ
  assert.deepEqual(
    { apartments: r.debt.apartments, clear: r.debt.clear, owing: r.debt.owing, overdue: r.debt.overdueApartments },
    { apartments: 3, clear: 1, owing: 1, overdue: 1 },
  );
  assert.equal(r.debt.outstanding, 900_000);
  assert.equal(r.fund.balance, 12_000_000);
  assert.equal(r.fund.income, 12_000_000);
});

test('tiền tiện ích không đếm trùng: payOS trả phí booking, đổi lịch booking đã trả', async () => {
  const h = await createHousehold();
  const amenity = await createAmenity();
  const paidAt = new Date('2026-10-14T03:00:00Z');
  // payOS trả phí booking, xác nhận được booking → tính 1 lần ở "Tiện ích trả ngay"
  const viaPayos = await createBooking({ amenity, apartment: h.apartment, startAt: new Date('2026-10-15T03:00:00Z'), fee: 100_000, paidAt, paymentRef: '111' });
  await Payment.create({ apartmentId: h.apartment._id, payerId: h.user._id, bookingId: viaPayos._id, amount: 100_000, method: 'PAYOS', status: 'SUCCESS', paidAt, orderCode: 111 });
  // payOS về muộn, hết chỗ → tiền vào Số dư trả trước → là tiền thu payOS
  const lost = await createBooking({ amenity, apartment: h.apartment, startAt: new Date('2026-10-16T03:00:00Z'), fee: 70_000, status: 'CANCELLED' });
  await Payment.create({ apartmentId: h.apartment._id, payerId: h.user._id, bookingId: lost._id, amount: 70_000, creditAmount: 70_000, method: 'PAYOS', status: 'SUCCESS', paidAt, orderCode: 222 });
  // Đổi lịch booking đã trả tại quầy: booking mới chép paidAt → chỉ tính 1 lần
  const old = await createBooking({ amenity, apartment: h.apartment, startAt: new Date('2026-10-17T03:00:00Z'), fee: 50_000, status: 'CANCELLED', paidAt, paymentRef: 'PT-1' });
  await createBooking({ amenity, apartment: h.apartment, startAt: new Date('2026-10-18T03:00:00Z'), fee: 50_000, paidAt, paymentRef: 'PT-1', rescheduledFrom: old._id });

  const oct = (await financeDashboard({ from: '2026-10', to: '2026-10' }, { now: NOW })).byMonth[0];
  assert.equal(oct.amenityDirect, 150_000);
  assert.equal(oct.PAYOS, 70_000);
  assert.equal(oct.collected, 70_000);
});

test('báo cáo giám sát Ban quản trị: quỹ, thu phí, sự cố — không lộ công nợ từng căn', async () => {
  await seedData();
  const r = await supervisionReport({ from: '2026-10', to: '2026-11' }, { now: NOW });
  assert.equal(r.fund.balance, 12_000_000);
  assert.equal(r.fund.transactions.length, 1);
  assert.equal(r.billing.collectionRate, 0.5);
  assert.equal(r.billing.overdueApartments, 1);
  assert.equal(typeof r.tickets.total, 'number');
  assert.equal(r.survey, null);
  assert.equal(JSON.stringify(r).includes('apartmentCode'), false);
});

test('khoảng thời gian không hợp lệ', async () => {
  await assert.rejects(financeDashboard({ from: '2026-11', to: '2026-10' }), /không hợp lệ/);
});

test('xuất Excel / PDF: finance, supervision, ledger, fund', async () => {
  await seedData();
  for (const [type, q] of [
    ['finance', { from: '2026-10', to: '2026-11' }],
    ['supervision', { from: '2026-10', to: '2026-11' }],
    ['ledger', { status: ['OVERDUE'] }],
    ['fund', { from: new Date('2026-01-01T00:00:00Z'), to: NOW }],
  ]) {
    const pdf = await exportReport(type, 'pdf', q);
    assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF', type);
    const xlsx = await exportReport(type, 'xlsx', q);
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK', type); // file zip
    assert.match(xlsx.filename, new RegExp(`^bao-cao-${type}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
  }
});

test('dịch vụ xuất dùng chung dựng file từ spec bất kỳ', async () => {
  const spec = {
    title: 'THỬ',
    filterText: 'x',
    summary: [['Tổng', 1000, 'money']],
    sections: [{ title: 'Bảng', columns: [col('Tên', 'name'), col('Tiền', 'amount', 12, 'money')], rows: [{ name: 'Căn A', amount: 5 }] }],
  };
  const f = await renderReport(spec, 'xlsx', 'thu');
  assert.match(f.filename, /^thu-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal((await renderReport(spec, 'pdf', 'thu')).contentType, 'application/pdf');
});

test('phân quyền: Ban quản trị xem báo cáo giám sát, không xem dashboard tài chính / không xuất sổ công nợ', async () => {
  const app = await startApp();
  try {
    const board = { role: 'BOARD' };
    assert.equal((await app.request('GET', '/reports/finance', { user: board })).status, 403);
    assert.equal((await app.request('GET', '/reports/supervision', { user: { role: 'ACCOUNTANT' } })).status, 403);
    assert.equal((await app.request('GET', '/reports/supervision?from=2026-10&to=2026-11', { user: board })).status, 200);
    const res = await fetch(`${app.base}/reports/export?type=ledger&format=xlsx`, {
      headers: { authorization: `Bearer ${tokenFor(board)}` },
    });
    assert.equal(res.status, 403);
  } finally {
    await app.close();
  }
});
