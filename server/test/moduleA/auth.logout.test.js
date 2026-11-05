// UC01 / BR-S04: đăng xuất thu hồi refresh token trên mọi thiết bị
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { refresh } from '../../src/modules/auth/auth.service.js';
import { signAccessToken, signRefreshToken } from '../../src/modules/auth/auth.tokens.js';
import { User } from '../../src/models/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
const logout = (body) => app.request('POST', '/auth/logout', { body });
// Gọi service để không tốn lượt của authLimiter (10 request ghi /auth mỗi cửa sổ, dùng chung cả file)
const canRefresh = (refreshToken) => refresh({ refreshToken }).then(() => true, () => false);
const versionOf = async (user) => (await User.findById(user._id).select('+tokenVersion').lean()).tokenVersion;

before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

test('không cần access token; sau đăng xuất refresh token cũ trả 401', async () => {
  const user = await createUser('RESIDENT');
  const refreshToken = signRefreshToken(user);
  assert.equal(await canRefresh(refreshToken), true);

  assert.equal((await logout({ refreshToken })).status, 200);
  assert.equal(await canRefresh(refreshToken), false);
});

test('thu hồi trên mọi thiết bị của tài khoản, không ảnh hưởng tài khoản khác', async () => {
  const user = await createUser('RESIDENT');
  const other = await createUser('RESIDENT');
  const firstDevice = signRefreshToken(user);
  const secondDevice = signRefreshToken(user);
  const otherToken = signRefreshToken(other);

  await logout({ refreshToken: firstDevice });

  assert.equal(await canRefresh(secondDevice), false);
  assert.equal(await canRefresh(otherToken), true);
});

test('token đã bị thu hồi không làm mất phiên mới hơn', async () => {
  const user = await createUser('RESIDENT');
  const oldToken = signRefreshToken(user);
  await logout({ refreshToken: oldToken });

  const newToken = signRefreshToken({ _id: user._id, tokenVersion: await versionOf(user) });
  assert.equal((await logout({ refreshToken: oldToken })).status, 200);

  assert.equal(await canRefresh(newToken), true);
});

test('thiếu refreshToken trả 400; token sai trả 200 và không thu hồi gì', async () => {
  const user = await createUser('RESIDENT');
  const accessToken = signAccessToken(user);

  assert.equal((await logout({})).status, 400);
  assert.equal((await logout({ refreshToken: 'khong-phai-token' })).status, 200);
  assert.equal((await logout({ refreshToken: accessToken })).status, 200);

  assert.equal(await versionOf(user), 0);
});
