// API lịch ca trực: phân quyền và validate đầu vào (không cần DB — các nhánh này dừng trước khi truy vấn).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, startApp } from '../helpers/http.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const validBody = {
  roleTitle: 'TECHNICIAN',
  userId: '64b000000000000000000002',
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-01T08:00:00.000Z',
};

test('GET /duty-shifts: chưa đăng nhập → 401', async () => {
  const res = await app.request('GET', '/duty-shifts');
  assert.equal(res.status, 401);
});

test('GET /duty-shifts: cư dân không xem lịch ca → 403', async () => {
  const res = await app.request('GET', '/duty-shifts', { user: USERS.resident });
  assert.equal(res.status, 403);
});

test('POST /duty-shifts: chỉ Trưởng BQL được xếp ca', async () => {
  for (const user of [USERS.technician, USERS.security, USERS.receptionist, USERS.resident]) {
    const res = await app.request('POST', '/duty-shifts', { user, body: validBody });
    assert.equal(res.status, 403, `${user.role}:${user.roleTitle} phải bị chặn`);
  }
});

test('POST /duty-shifts: không xếp ca cho Lễ tân', async () => {
  const res = await app.request('POST', '/duty-shifts', {
    user: USERS.manager,
    body: { ...validBody, roleTitle: 'RECEPTIONIST' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'VALIDATION_ERROR');
});

test('POST /duty-shifts: lặp tối đa 31 ngày', async () => {
  const res = await app.request('POST', '/duty-shifts', { user: USERS.manager, body: { ...validBody, repeatDays: 32 } });
  assert.equal(res.status, 400);
});

test('GET /duty-shifts/on-duty: bắt buộc chọn chức danh', async () => {
  const res = await app.request('GET', '/duty-shifts/on-duty', { user: USERS.technician });
  assert.equal(res.status, 400);
});

test('GET /duty-shifts/staff: chỉ Trưởng BQL', async () => {
  const res = await app.request('GET', '/duty-shifts/staff?roleTitle=SECURITY', { user: USERS.security });
  assert.equal(res.status, 403);
});

test('DELETE /duty-shifts/:id: id sai định dạng → 400', async () => {
  const res = await app.request('DELETE', '/duty-shifts/abc', { user: USERS.manager });
  assert.equal(res.status, 400);
});

test('GET /duty-shifts: Lễ tân không xem lịch ca (khớp menu)', async () => {
  const res = await app.request('GET', '/duty-shifts', { user: USERS.receptionist });
  assert.equal(res.status, 403);
});
