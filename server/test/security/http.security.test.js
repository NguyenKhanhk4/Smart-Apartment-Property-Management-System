// Bảo mật mức HTTP (không cần DB): giới hạn số lần gọi API đăng nhập, dev-login không mở ngoài development.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../../src/config/env.js';
import { startApp } from '../helpers/http.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('dev-login không được gắn khi không phải development', async () => {
  const res = await app.request('GET', '/dev/accounts');
  assert.equal(res.status, 404);
});

test('đăng nhập sai liên tục bị chặn 429 sau AUTH_RATE_LIMIT_MAX lần', async () => {
  const { max } = env.authRateLimit;
  for (let i = 0; i < max; i += 1) {
    const res = await app.request('POST', '/auth/login', { body: {} }); // Joi chặn → 400, vẫn tính lượt
    assert.equal(res.status, 400);
  }
  const blocked = await app.request('POST', '/auth/login', { body: {} });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errorCode, 'TOO_MANY_REQUESTS');
});
