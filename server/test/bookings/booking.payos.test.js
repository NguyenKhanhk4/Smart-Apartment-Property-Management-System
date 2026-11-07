// Booking tiện ích có phí trả qua payOS (Mô đun 6, M6-1): giữ chỗ 15 phút, link hết hạn cùng lúc hết giữ chỗ,
// webhook xác nhận booking, tiền về muộn: còn chỗ thì khôi phục booking, hết chỗ thì vào Số dư trả trước.
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Booking, Payment, PrepaidBalance } from '../../src/models/index.js';
import { createBooking as placeBooking } from '../../src/modules/bookings/bookings.service.js';
import { expireBookingHolds } from '../../src/modules/bookings/bookings.jobs.js';
import { createBookingPayosPayment, getPayosStatus, handlePayosWebhook } from '../../src/modules/payments/payments.payos.js';
import { setPayosForTest, signatureOf } from '../../src/modules/payments/payos.client.js';
import { toVnYmd } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';

const CONFIG = { enabled: true, clientId: 'cid', apiKey: 'key', checksumKey: 'test-checksum-key', apiUrl: 'https://payos.test' };
const MIN = 60_000;
let created;

function fakeFetch(url, init) {
  const body = init.body ? JSON.parse(init.body) : null;
  if (init.method === 'POST') created.push(body);
  const data = init.method === 'POST' ? { checkoutUrl: `https://pay.payos.vn/web/${body.orderCode}`, qrCode: '0002', paymentLinkId: `pl-${body.orderCode}` } : { status: 'PENDING' };
  return { ok: true, status: 200, json: async () => ({ code: '00', desc: 'success', data }) };
}

const webhook = (orderCode, amount) => {
  const data = { orderCode, amount, reference: `FT${orderCode}`, transactionDateTime: '2026-10-20 10:15:00', code: '00', desc: 'success' };
  return { code: '00', desc: 'success', success: true, data, signature: signatureOf(data) };
};

before(connectTestDB);
beforeEach(() => {
  created = [];
  setPayosForTest({ config: CONFIG, fetch: fakeFetch });
});
afterEach(clearTestDB);
after(async () => {
  setPayosForTest();
  await closeTestDB();
});

const inDays = (n) => toVnYmd(new Date(Date.now() + n * 24 * 60 * MIN));

async function setup(amenityExtra) {
  const { user, apartment } = await createHousehold();
  const amenity = await createAmenity(amenityExtra);
  const resident = asUser(user);
  const booking = await placeBooking(resident, { apartmentId: apartment._id, amenityId: amenity._id, date: inDays(2), slotStart: '10:00' });
  return { user, resident, apartment, amenity, booking };
}

test('tiện ích có phí: giữ chỗ 15 phút, link payOS hết hạn đúng lúc hết giữ chỗ, gọi lại thì dùng lại link', async () => {
  const { resident, booking } = await setup();
  assert.equal(booking.status, 'PENDING_PAYMENT');
  const link = await createBookingPayosPayment(resident, booking._id);
  assert.equal(link.amount, 50000);
  assert.equal(new Date(link.expiredAt).getTime(), new Date(booking.holdExpiresAt).getTime());
  assert.equal(created[0].expiredAt, Math.floor(new Date(booking.holdExpiresAt).getTime() / 1000));

  const again = await createBookingPayosPayment(resident, booking._id);
  assert.equal(again.orderCode, link.orderCode);
  assert.equal(created.length, 1);

  const stranger = asUser((await createHousehold()).user);
  await assert.rejects(createBookingPayosPayment(stranger, booking._id), { errorCode: 'NOT_FOUND' });
});

test('webhook trả tiền → booking Thành công, có vé; gửi lại webhook không xử lý 2 lần', async () => {
  const { resident, booking } = await setup();
  const link = await createBookingPayosPayment(resident, booking._id);
  assert.deepEqual(await handlePayosWebhook(webhook(link.orderCode, 50000)), { handled: true });

  const b = await Booking.findById(booking._id).lean();
  assert.equal(b.status, 'APPROVED');
  assert.ok(b.paidAt);
  assert.equal((await Payment.findById(link.paymentId).lean()).status, 'SUCCESS');
  assert.equal((await handlePayosWebhook(webhook(link.orderCode, 50000))).handled, false);

  const status = await getPayosStatus(resident, link.orderCode);
  assert.equal(status.booking.status, 'APPROVED');
});

test('M6-1: tiền về sau khi cron đã hủy giữ chỗ — slot còn chỗ thì khôi phục booking', async () => {
  const { resident, booking } = await setup();
  const link = await createBookingPayosPayment(resident, booking._id);
  await Booking.updateOne({ _id: booking._id }, { $set: { holdExpiresAt: new Date(Date.now() - MIN) } });
  assert.equal(await expireBookingHolds(), 1);

  await handlePayosWebhook(webhook(link.orderCode, 50000));
  const b = await Booking.findById(booking._id).lean();
  assert.equal(b.status, 'APPROVED');
  assert.equal(b.cancelReason, undefined);
  assert.equal((await Payment.findById(link.paymentId).lean()).creditAmount, 0);
});

test('M6-1: tiền về muộn mà slot đã bị người khác đặt hết → tiền vào Số dư trả trước, booking vẫn hủy', async () => {
  const { user, resident, apartment, amenity, booking } = await setup({ capacityPerSlot: 1 });
  const link = await createBookingPayosPayment(resident, booking._id);
  await Booking.updateOne({ _id: booking._id }, { $set: { holdExpiresAt: new Date(Date.now() - MIN) } });
  await expireBookingHolds();
  const other = await createHousehold();
  await createBooking({ amenity, apartment: other.apartment, startAt: booking.startAt });

  await handlePayosWebhook(webhook(link.orderCode, 50000));
  assert.equal((await Booking.findById(booking._id).lean()).status, 'CANCELLED');
  const p = await Payment.findById(link.paymentId).lean();
  assert.equal(p.status, 'SUCCESS');
  assert.equal(p.creditAmount, 50000);
  const bal = await PrepaidBalance.findOne({ apartmentId: apartment._id, payerId: user._id }).lean();
  assert.equal(bal.balance, 50000);
});

test('booking chưa giữ chỗ / đã hết hạn giữ chỗ thì không tạo link được', async () => {
  const { resident, booking } = await setup();
  await Booking.updateOne({ _id: booking._id }, { $set: { holdExpiresAt: new Date(Date.now() + 30_000) } });
  await assert.rejects(createBookingPayosPayment(resident, booking._id), { errorCode: 'BOOKING_HOLD_EXPIRED' });
  await Booking.updateOne({ _id: booking._id }, { $set: { status: 'APPROVED' } });
  await assert.rejects(createBookingPayosPayment(resident, booking._id), { errorCode: 'BOOKING_INVALID_STATUS' });
});
