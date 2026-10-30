// Phí tiện ích gộp hóa đơn + thống kê tiện ích dùng chung nhóm trạng thái BOOKING_BILLABLE_STATUSES.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAmenityCharges } from '../../src/modules/invoices/invoices.builder.js';
import { amenityUsage, ticketReport } from '../../src/modules/reports/reports.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, createTicket } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const at = (iso) => new Date(iso);

test('gộp hóa đơn: tính booking có phí đã giữ slot, bỏ booking đã thanh toán trước / hủy / chờ thanh toán / luồng cũ', async () => {
  const { apartment } = await createHousehold();
  const amenity = await createAmenity();
  const s = (h) => at(`2026-10-10T${String(h).padStart(2, '0')}:00:00Z`);
  const billed = await Promise.all(
    ['APPROVED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].map((status, i) => createBooking({ amenity, apartment, startAt: s(i), status })),
  );
  await createBooking({ amenity, apartment, startAt: s(5), status: 'COMPLETED', paidAt: at('2026-10-09T00:00:00Z') });
  for (const [i, status] of ['CANCELLED', 'PENDING_PAYMENT', 'PENDING', 'REJECTED'].entries()) {
    await createBooking({ amenity, apartment, startAt: s(6 + i), status });
  }

  const { bookingIds } = await collectAmenityCharges(apartment._id, '2026-10');
  assert.deepEqual(bookingIds.map(String).sort(), billed.map((b) => String(b._id)).sort());
});

test('thống kê tiện ích: doanh thu = booking tính phí; không có cột trạng thái luồng cũ', async () => {
  const { apartment } = await createHousehold();
  const amenity = await createAmenity();
  const s = (h) => at(`2026-10-10T${String(h).padStart(2, '0')}:00:00Z`);
  await createBooking({ amenity, apartment, startAt: s(1), status: 'COMPLETED', fee: 100 });
  await createBooking({ amenity, apartment, startAt: s(2), status: 'CHECKED_IN', fee: 200 });
  await createBooking({ amenity, apartment, startAt: s(3), status: 'NO_SHOW', fee: 400 });
  await createBooking({ amenity, apartment, startAt: s(4), status: 'CANCELLED', fee: 800 });
  await createBooking({ amenity, apartment, startAt: s(5), status: 'PENDING', fee: 1600 });

  const report = await amenityUsage({ from: new Date('2026-10-01'), to: new Date('2026-10-31') });
  const [row] = report.byAmenity;
  assert.equal(row.revenue, 700);
  assert.equal(report.revenue, 700);
  assert.equal('pending' in row, false, 'không còn cột PENDING của luồng duyệt cũ');
  assert.equal(row.no_show, 1);
  assert.equal(report.noShowRate, 0.2);
});

test('thống kê phản ánh: "đang mở" gồm cả chờ linh kiện và chờ đồng ý phí', async () => {
  const { user, apartment } = await createHousehold();
  for (const status of ['NEW', 'WAITING_PARTS', 'WAITING_QUOTE_APPROVAL', 'WAITING_CONFIRM', 'CLOSED']) {
    await createTicket({ apartment, createdBy: user, status });
  }
  const today = new Date();
  const report = await ticketReport({ from: today, to: today });
  assert.equal(report.open, 3);
});
