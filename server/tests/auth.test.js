import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { authenticate } from '../src/middlewares/auth.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { ok } from '../src/utils/response.js';

const app = express();
app.get('/me', authenticate, (req, res) => ok(res, req.user));
app.use(errorHandler);

const call = (token) => request(app).get('/me').set('Authorization', `Bearer ${token}`);
const sign = (payload, options = {}) => jwt.sign(payload, env.jwt.accessSecret, { expiresIn: '5m', ...options });

describe('authenticate — độ chặt của JWT', () => {
  it('payload thiếu sub hoặc role không hợp lệ → 401 (không tạo req.user rỗng)', async () => {
    expect((await call(sign({ role: 'MANAGER' }))).status).toBe(401);
    expect((await call(sign({ sub: 'u1' }))).status).toBe(401);
    expect((await call(sign({ sub: 'u1', role: 'SUPERUSER' }))).status).toBe(401);
    expect((await call(sign({ sub: '', role: 'MANAGER' }))).status).toBe(401);
  });

  it('chỉ chấp nhận thuật toán HS256', async () => {
    expect((await call(sign({ sub: 'u1', role: 'MANAGER' }, { algorithm: 'HS512' }))).status).toBe(401);
    expect((await call(sign({ sub: 'u1', role: 'MANAGER' }))).status).toBe(200);
  });

  it('token ký bằng refresh secret không dùng được làm access token', async () => {
    const refresh = jwt.sign({ sub: 'u1', role: 'MANAGER' }, env.jwt.refreshSecret, { expiresIn: '5m' });
    expect((await call(refresh)).status).toBe(401);
  });

  it('header sai dạng → 401', async () => {
    expect((await request(app).get('/me').set('Authorization', sign({ sub: 'u1', role: 'MANAGER' }))).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', 'Basic abc')).status).toBe(401);
  });
});
