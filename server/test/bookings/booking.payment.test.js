// Logic thuần booking (Người 4): hạn giữ chỗ chờ thanh toán + vé QR ký HMAC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdExpiry } from '../../src/modules/bookings/booking.payment.js';
import { signBookingQr, verifyBookingQr } from '../../src/modules/bookings/bookingQr.js';

const now = new Date('2026-11-01T02:00:00Z');
const ID = '64b0000000000000000000aa';
const KEY = Buffer.alloc(32, 1);

test('holdExpiry: có phí + bật giữ chỗ + cư dân tự đặt → hạn = now + N phút', () => {
  assert.equal(holdExpiry({ fee: 50000, holdMinutes: 15, byStaff: false, now }).getTime(), now.getTime() + 15 * 60_000);
});

test('holdExpiry: không giữ chỗ khi tắt (0), miễn phí, lễ tân đặt hộ (thu tại quầy) hoặc đã thanh toán trước', () => {
  assert.equal(holdExpiry({ fee: 50000, holdMinutes: 0, byStaff: false, now }), null);
  assert.equal(holdExpiry({ fee: 0, holdMinutes: 15, byStaff: false, now }), null);
  assert.equal(holdExpiry({ fee: 50000, holdMinutes: 15, byStaff: true, now }), null);
  assert.equal(holdExpiry({ fee: 50000, holdMinutes: 15, byStaff: false, prepaid: true, now }), null);
});

test('vé QR: ký rồi xác minh ra đúng booking id', () => {
  const token = signBookingQr(ID, KEY);
  assert.match(token, /^BK1\./);
  assert.equal(verifyBookingQr(token, KEY), ID);
});

test('vé QR: sửa id / chữ ký / khóa khác / chuỗi rác → null', () => {
  const token = signBookingQr(ID, KEY);
  const [prefix, , sig] = token.split('.');
  assert.equal(verifyBookingQr(`${prefix}.64b0000000000000000000ab.${sig}`, KEY), null);
  assert.equal(verifyBookingQr(`${token}x`, KEY), null);
  assert.equal(verifyBookingQr(token, Buffer.alloc(32, 2)), null);
  for (const junk of ['', 'abc', 'BK1..', 'A-0501-01', null]) assert.equal(verifyBookingQr(junk, KEY), null);
});
