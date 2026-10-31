// Luồng booking (Người 4) trên MongoDB trong RAM: giữ chỗ chờ thanh toán, xác nhận thanh toán, hủy giữ chỗ quá hạn,
// vé QR + quét check-in, đổi lịch.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Booking, SystemConfig } from '../../src/models/index.js';
import * as service from '../../src/modules/bookings/bookings.service.js';
import { expireBookingHolds } from '../../src/modules/bookings/bookings.jobs.js';
import { signBookingQr } from '../../src/modules/bookings/bookingQr.js';
import { toVnYmd } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createHousehold, createReceptionist, createSecurity } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const MIN = 60_000;
const tomorrow = () => toVnYmd(new Date(Date.now() + 24 * 60 * MIN));
const setConfig = (key, value) => SystemConfig.create({ key, value, scope: 'BUSINESS' });
const enableHold = () => setConfig('BOOKING_PAYMENT_HOLD_MINUTES', 15);

async function setup(amenityExtra) {
  const { user, apartment } = await createHousehold();
  const amenity = await createAmenity(amenityExtra);
  return { resident: asUser(user), apartment, amenity };
}
const book = ({ resident, apartment, amenity }, slotStart = '10:00', date = tomorrow()) =>
  service.createBooking(resident, { apartmentId: apartment._id, amenityId: amenity._id, date, slotStart });

test('giữ chỗ tắt (mặc định): booking có phí xác nhận ngay như cũ', async () => {
  const ctx = await setup();
  const b = await book(ctx);
  assert.equal(b.status, 'APPROVED');
  assert.equal(b.holdExpiresAt, null);
});

test('giữ chỗ bật: booking có phí chờ thanh toán, vẫn chiếm slot; booking miễn phí xác nhận ngay', async () => {
  await enableHold();
  const ctx = await setup({ capacityPerSlot: 1 });
  const held = await book(ctx);
  assert.equal(held.status, 'PENDING_PAYMENT');
  const minutes = (new Date(held.holdExpiresAt) - Date.now()) / MIN;
  assert.ok(minutes > 14 && minutes <= 15);

  const other = await createHousehold();
  await assert.rejects(book({ ...ctx, resident: asUser(other.user), apartment: other.apartment }), { errorCode: 'BOOKING_SLOT_CONFLICT' });

  const free = await setup({ feePerBooking: 0 });
  assert.equal((await book(free)).status, 'APPROVED');
});

test('xác nhận thanh toán trong hạn → APPROVED + paidAt; quá hạn → BOOKING_HOLD_EXPIRED', async () => {
  await enableHold();
  const ctx = await setup();
  const held = await book(ctx);
  const receptionist = asUser(await createReceptionist());
  const paid = await service.confirmBookingPayment(receptionist, held._id, { paymentRef: 'TIEN-MAT-001' });
  assert.equal(paid.status, 'APPROVED');
  assert.ok(paid.paidAt);
  assert.equal(paid.paymentRef, 'TIEN-MAT-001');
  assert.equal(await AuditLog.countDocuments({ action: 'BOOKING_PAYMENT_CONFIRMED' }), 1);

  const late = await book(ctx, '11:00');
  await Booking.updateOne({ _id: late._id }, { $set: { holdExpiresAt: new Date(Date.now() - MIN) } });
  await assert.rejects(service.confirmBookingPayment(receptionist, late._id, {}), { errorCode: 'BOOKING_HOLD_EXPIRED' });
});

test('cron hủy giữ chỗ quá hạn: chỉ booking đã hết hạn, chạy lại không đổi gì', async () => {
  await enableHold();
  const ctx = await setup();
  const expired = await book(ctx, '10:00');
  const active = await book(ctx, '11:00');
  await Booking.updateOne({ _id: expired._id }, { $set: { holdExpiresAt: new Date(Date.now() - MIN) } });

  assert.equal(await expireBookingHolds(), 1);
  assert.equal((await Booking.findById(expired._id).lean()).status, 'CANCELLED');
  assert.equal((await Booking.findById(active._id).lean()).status, 'PENDING_PAYMENT');
  assert.equal(await expireBookingHolds(), 0);
});

test('cư dân hủy được booking đang giữ chỗ chờ thanh toán', async () => {
  await enableHold();
  const ctx = await setup();
  const held = await book(ctx);
  const cancelled = await service.cancelBooking(ctx.resident, held._id, {});
  assert.equal(cancelled.status, 'CANCELLED');
});

test('vé QR: lịch sử đặt trả mã QR cho booking đã xác nhận; quét QR check-in trong khung giờ', async () => {
  const ctx = await setup();
  const soon = await createBooking({ amenity: ctx.amenity, apartment: ctx.apartment, startAt: new Date(Date.now() + 5 * MIN), bookedBy: ctx.resident.id });
  const { items } = await service.listMyBookings(ctx.resident, { scope: 'upcoming', page: 1, limit: 10 });
  const mine = items.find((b) => String(b._id) === String(soon._id));
  assert.equal(mine.qrToken, signBookingQr(String(soon._id)));

  const guard = asUser(await createSecurity());
  const view = await service.checkInByQr(guard, { token: mine.qrToken });
  assert.equal(view.status, 'CHECKED_IN');
  await assert.rejects(service.checkInByQr(guard, { token: mine.qrToken }), { errorCode: 'BOOKING_INVALID_STATUS' });
});

test('vé QR: mã giả / mã cư dân / booking chờ thanh toán → không check-in được', async () => {
  const ctx = await setup();
  const guard = asUser(await createSecurity());
  await assert.rejects(service.checkInByQr(guard, { token: 'A-0501-01' }), { errorCode: 'BOOKING_QR_INVALID' });
  const held = await createBooking({ amenity: ctx.amenity, apartment: ctx.apartment, startAt: new Date(Date.now() + 5 * MIN), status: 'PENDING_PAYMENT' });
  const { items } = await service.listMyBookings(ctx.resident, { scope: 'upcoming', page: 1, limit: 10 });
  assert.equal(items.find((b) => String(b._id) === String(held._id)).qrToken, null);
  await assert.rejects(service.checkInByQr(guard, { token: signBookingQr(String(held._id)) }), { errorCode: 'BOOKING_INVALID_STATUS' });
});

test('đổi lịch: chuyển sang slot khác, booking cũ hủy; không bị tính trùng giới hạn booking của căn', async () => {
  await setConfig('BOOKING_MAX_ACTIVE_PER_APARTMENT', 1);
  const ctx = await setup();
  const first = await book(ctx, '10:00');
  const moved = await service.rescheduleBooking(ctx.resident, first._id, { date: tomorrow(), slotStart: '15:00' });
  assert.equal(moved.slotStart, '15:00');
  assert.equal(moved.status, 'APPROVED');
  const old = await Booking.findById(first._id).lean();
  assert.equal(old.status, 'CANCELLED');
  assert.match(old.cancelReason, /Đổi lịch/);
});

test('đổi lịch booking đã thanh toán: giữ trạng thái đã thanh toán, không phải giữ chỗ lại', async () => {
  await enableHold();
  const ctx = await setup();
  const held = await book(ctx, '10:00');
  await service.confirmBookingPayment(asUser(await createReceptionist()), held._id, { paymentRef: 'CK-01' });
  const moved = await service.rescheduleBooking(ctx.resident, held._id, { date: tomorrow(), slotStart: '16:00' });
  assert.equal(moved.status, 'APPROVED');
  assert.ok(moved.paidAt);
  assert.equal(moved.paymentRef, 'CK-01');
});

test('đổi lịch: slot mới hết chỗ → giữ nguyên booking cũ', async () => {
  const ctx = await setup({ capacityPerSlot: 1 });
  const first = await book(ctx, '10:00');
  // Căn khác đã chiếm hết slot 12:00 (= 10:00 + 2 giờ)
  const twelve = new Date(new Date(first.startAt).getTime() + 2 * 60 * MIN);
  await createBooking({ amenity: ctx.amenity, apartment: await createApartment(), startAt: twelve });
  await assert.rejects(service.rescheduleBooking(ctx.resident, first._id, { date: tomorrow(), slotStart: '12:00' }), { errorCode: 'BOOKING_SLOT_CONFLICT' });
  assert.equal((await Booking.findById(first._id).lean()).status, 'APPROVED');
});
