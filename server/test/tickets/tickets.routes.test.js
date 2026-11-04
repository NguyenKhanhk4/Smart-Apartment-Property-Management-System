// API phiếu sự cố (Người 4): phân quyền + validate (dừng trước khi truy vấn DB).
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

test('hàng chờ: chỉ Kỹ thuật viên', async () => {
  assert.equal((await app.request('GET', '/tickets/queue', { user: USERS.manager })).status, 403);
  assert.equal((await app.request('PATCH', `/tickets/${ID}/claim`, { user: USERS.receptionist })).status, 403);
});

test('Kanban: chỉ Trưởng BQL', async () => {
  assert.equal((await app.request('GET', '/tickets/board', { user: USERS.technician })).status, 403);
});

test('Lễ tân tạo hộ: chỉ Lễ tân, bắt buộc apartmentId', async () => {
  assert.equal((await app.request('POST', '/tickets/staff', { user: USERS.resident, body: {} })).status, 403);
  const res = await app.request('POST', '/tickets/staff', {
    user: USERS.receptionist,
    body: { categoryId: ID, title: 'Thang máy kẹt', description: 'Thang máy số 2 kẹt tầng 7' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.details.some((d) => d.field === 'apartmentId'));
});

test('tạo phiếu: loại / phạm vi phải hợp lệ', async () => {
  const res = await app.request('POST', '/tickets', {
    user: USERS.resident,
    body: { categoryId: ID, title: 'Rò nước', description: 'Rò nước từ trần nhà tắm', type: 'KHAC' },
  });
  assert.equal(res.status, 400);
});

test('đồng ý báo giá: chỉ cư dân, accepted bắt buộc', async () => {
  assert.equal((await app.request('PATCH', `/tickets/${ID}/quote-decision`, { user: USERS.technician, body: { accepted: true } })).status, 403);
  assert.equal((await app.request('PATCH', `/tickets/${ID}/quote-decision`, { user: USERS.resident, body: {} })).status, 400);
});

test('tiến độ: nhận trạng thái chờ báo giá / chờ linh kiện', async () => {
  const res = await app.request('PATCH', `/tickets/${ID}/progress`, { user: USERS.technician, body: { status: 'CLOSED' } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /WAITING_PARTS/);
});

test('cron cảnh báo SLA đã đăng ký', () => {
  assert.ok(JOBS.some((j) => j.name === 'TICKET_SLA_ALERT'));
});
