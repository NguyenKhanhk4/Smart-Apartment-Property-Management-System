// API booking (Người 4): phân quyền + validate (dừng trước khi truy vấn DB).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS } from '../../src/jobs/index.js';
import { USERS, startApp } from '../helpers/http.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const ID = '64b000000000000000000009';

test('quét QR check-in: chỉ Lễ tân / Bảo vệ, bắt buộc token', async () => {
  assert.equal((await app.request('POST', '/bookings/check-in-by-qr', { user: USERS.resident, body: { token: 'x' } })).status, 403);
  assert.equal((await app.request('POST', '/bookings/check-in-by-qr', { user: USERS.security, body: {} })).status, 400);
});

test('xác nhận đã thu tiền giữ chỗ: chỉ Lễ tân', async () => {
  assert.equal((await app.request('PATCH', `/bookings/${ID}/mark-paid`, { user: USERS.security, body: {} })).status, 403);
});

test('đổi lịch: chỉ cư dân, bắt buộc ngày + giờ đúng định dạng', async () => {
  assert.equal((await app.request('PATCH', `/bookings/${ID}/reschedule`, { user: USERS.receptionist, body: {} })).status, 403);
  const res = await app.request('PATCH', `/bookings/${ID}/reschedule`, { user: USERS.resident, body: { date: '01/11/2026', slotStart: '9h' } });
  assert.equal(res.status, 400);
});

test('cron hủy giữ chỗ quá hạn đã đăng ký', () => {
  assert.ok(JOBS.some((j) => j.name === 'BOOKING_HOLD_EXPIRE'));
});
