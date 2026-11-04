// Cron còn thiếu: hoàn tất / không đến booking (BR-O5, BR-O14), hóa đơn quá hạn; cronRunner ghi kết quả.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Booking, CronRun, Invoice } from '../../src/models/index.js';
import { completeBookings } from '../../src/modules/bookings/bookings.jobs.js';
import { markOverdueInvoices } from '../../src/modules/invoices/invoices.jobs.js';
import { runTrackedJob } from '../../src/jobs/cronRunner.js';
import { JOBS } from '../../src/jobs/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold } from '../helpers/fixtures.js';
import { createAmenity, createBooking, createInvoice } from '../helpers/fixtures.moduleBDE.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const MIN = 60_000;

test('BOOKING_COMPLETE: APPROVED quá hạn check-in → NO_SHOW; CHECKED_IN hết giờ → COMPLETED', async () => {
  const { apartment } = await createHousehold();
  const amenity = await createAmenity();
  const now = new Date('2026-11-01T05:00:00Z');
  const noShow = await createBooking({ amenity, apartment, startAt: new Date(now - 20 * MIN) }); // quá 15' ân hạn
  const inGrace = await createBooking({ amenity, apartment, startAt: new Date(now - 10 * MIN) });
  const done = await createBooking({ amenity, apartment, startAt: new Date(now - 70 * MIN), status: 'CHECKED_IN' });
  const playing = await createBooking({ amenity, apartment, startAt: new Date(now - 30 * MIN), status: 'CHECKED_IN' });
  const held = await createBooking({ amenity, apartment, startAt: new Date(now - 90 * MIN), status: 'PENDING_PAYMENT' });

  const affected = await completeBookings(now);
  assert.equal(affected, 2);

  const status = async (b) => (await Booking.findById(b._id).lean()).status;
  assert.equal(await status(noShow), 'NO_SHOW');
  assert.equal(await status(inGrace), 'APPROVED');
  assert.equal(await status(done), 'COMPLETED');
  assert.equal(await status(playing), 'CHECKED_IN');
  assert.equal(await status(held), 'PENDING_PAYMENT'); // giữ chỗ do job hủy giữ chỗ xử lý
  const doc = await Booking.findById(noShow._id).lean();
  assert.ok(doc.noShowAt);
  assert.ok((await Booking.findById(done._id).lean()).completedAt);

  assert.equal(await completeBookings(now), 0, 'chạy lại không đổi gì');
});

test('INVOICE_OVERDUE: UNPAID quá hạn (trước 00:00 hôm nay giờ VN) → OVERDUE', async () => {
  const { apartment } = await createHousehold();
  const now = new Date('2026-11-01T03:00:00Z'); // 10:00 01/11 giờ VN
  const late = await createInvoice({ apartment, period: '2026-09', dueDate: new Date('2026-10-30T17:00:00Z') });
  const dueToday = await createInvoice({ apartment, period: '2026-10', dueDate: new Date('2026-10-31T17:00:00Z') });
  const paid = await createInvoice({ apartment, period: '2026-08', status: 'PAID', dueDate: new Date('2026-09-15T00:00:00Z') });

  assert.equal(await markOverdueInvoices(now), 1);
  assert.equal((await Invoice.findById(late._id).lean()).status, 'OVERDUE');
  assert.equal((await Invoice.findById(dueToday._id).lean()).status, 'UNPAID');
  assert.equal((await Invoice.findById(paid._id).lean()).status, 'PAID');
});

test('jobs/index: đăng ký BOOKING_COMPLETE và INVOICE_OVERDUE', () => {
  const names = JOBS.map((j) => j.name);
  assert.ok(names.includes('BOOKING_COMPLETE'));
  assert.ok(names.includes('INVOICE_OVERDUE'));
});

test('cronRunner: lỗi một phần vẫn giữ số bản ghi đã xử lý, trạng thái FAILED kèm lỗi', async () => {
  const run = await runTrackedJob('INVOICE_GENERATE', async () => ({ affectedCount: 3, failed: [{ message: 'A-01: thiếu đơn giá' }] }), {
    trigger: 'MANUAL',
  });
  assert.equal(run.status, 'FAILED');
  assert.equal(run.affectedCount, 3);
  assert.match(run.errorMessage, /thiếu đơn giá/);
  assert.equal(run.trigger, 'MANUAL');
});

test('CronRun: jobName phải thuộc CRON_JOBS', async () => {
  await assert.rejects(
    CronRun.create({ jobName: 'KHONG_CO', startedAt: new Date(), finishedAt: new Date(), status: 'SUCCESS' }),
    /jobName/,
  );
});
