// UC01 / BR-S04: đăng xuất thu hồi refresh token trên mọi thiết bị
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken, signRefreshToken } from '../src/modules/auth/auth.tokens.js';
import { User } from '../src/models/index.js';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createUser } from './helpers/fixtures.js';

describe('POST /auth/logout', () => {
  const app = createApp();
  const logout = (body) => request(app).post('/api/auth/logout').send(body);
  const refresh = (refreshToken) => request(app).post('/api/auth/refresh').send({ refreshToken });
  const versionOf = async (user) => (await User.findById(user._id).select('+tokenVersion').lean()).tokenVersion;

  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  it('không cần access token; sau đăng xuất refresh token cũ trả 401', async () => {
    const user = await createUser('RESIDENT');
    const refreshToken = signRefreshToken(user);
    expect((await refresh(refreshToken)).status).toBe(200);

    expect((await logout({ refreshToken })).status).toBe(200);
    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it('thu hồi trên mọi thiết bị của tài khoản, không ảnh hưởng tài khoản khác', async () => {
    const user = await createUser('RESIDENT');
    const other = await createUser('RESIDENT');
    const firstDevice = signRefreshToken(user);
    const secondDevice = signRefreshToken(user);
    const otherToken = signRefreshToken(other);

    await logout({ refreshToken: firstDevice });

    expect((await refresh(secondDevice)).status).toBe(401);
    expect((await refresh(otherToken)).status).toBe(200);
  });

  it('token đã bị thu hồi không làm mất phiên mới hơn', async () => {
    const user = await createUser('RESIDENT');
    const oldToken = signRefreshToken(user);
    await logout({ refreshToken: oldToken });

    const newToken = signRefreshToken({ _id: user._id, tokenVersion: await versionOf(user) });
    expect((await logout({ refreshToken: oldToken })).status).toBe(200);

    expect((await refresh(newToken)).status).toBe(200);
  });

  it('thiếu refreshToken trả 400; token sai trả 200 và không thu hồi gì', async () => {
    const user = await createUser('RESIDENT');
    const accessToken = signAccessToken(user);

    expect((await logout({})).status).toBe(400);
    expect((await logout({ refreshToken: 'khong-phai-token' })).status).toBe(200);
    expect((await logout({ refreshToken: accessToken })).status).toBe(200);

    expect(await versionOf(user)).toBe(0);
  });
});
