// Kiểm tra cấu hình .env: thiếu/ sai biến quan trọng phải dừng server ngay, không âm thầm chạy chế độ dev.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../src/config/env.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const base = {
  MONGODB_URI: 'mongodb://localhost/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

test('NODE_ENV bắt buộc khai báo rõ (không tự coi là development)', () => {
  assert.throws(() => parseEnv({ ...base }), /NODE_ENV/);
});

test('development: bật dev-login mặc định, có thể tắt', () => {
  assert.equal(parseEnv({ ...base, NODE_ENV: 'development' }).devAuthEnabled, true);
  assert.equal(parseEnv({ ...base, NODE_ENV: 'development', ENABLE_DEV_AUTH: 'false' }).devAuthEnabled, false);
});

test('production: không bao giờ bật dev-login, tắt Swagger mặc định', () => {
  const env = parseEnv({ ...base, NODE_ENV: 'production', ID_ENCRYPTION_KEY: KEY, ENABLE_DEV_AUTH: 'true' });
  assert.equal(env.devAuthEnabled, false);
  assert.equal(env.swaggerEnabled, false);
  assert.equal(parseEnv({ ...base, NODE_ENV: 'production', ID_ENCRYPTION_KEY: KEY, ENABLE_SWAGGER: 'true' }).swaggerEnabled, true);
});

test('production: bắt buộc ID_ENCRYPTION_KEY 32 byte base64 (không dùng JWT secret thay)', () => {
  assert.throws(() => parseEnv({ ...base, NODE_ENV: 'production' }), /ID_ENCRYPTION_KEY/);
  assert.throws(() => parseEnv({ ...base, NODE_ENV: 'production', ID_ENCRYPTION_KEY: 'ngan-qua' }), /ID_ENCRYPTION_KEY/);
  assert.equal(parseEnv({ ...base, NODE_ENV: 'production', ID_ENCRYPTION_KEY: KEY }).idEncryptionKey.length, 32);
});

test('development / test: thiếu ID_ENCRYPTION_KEY thì idEncryptionKey = null (idCrypto tự dùng khóa dev)', () => {
  assert.equal(parseEnv({ ...base, NODE_ENV: 'development' }).idEncryptionKey, null);
});

test('giới hạn đăng nhập: mặc định 10 lần / 15 phút, chỉnh được', () => {
  const env = parseEnv({ ...base, NODE_ENV: 'development' });
  assert.deepEqual(env.authRateLimit, { max: 10, windowMs: 15 * 60 * 1000 });
  assert.equal(parseEnv({ ...base, NODE_ENV: 'development', AUTH_RATE_LIMIT_MAX: '3' }).authRateLimit.max, 3);
});
