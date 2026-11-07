import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/middlewares/auth.js';
import { authorize, hasPermission } from '../src/middlewares/authorize.js';
import { validate } from '../src/middlewares/validate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { ApiError } from '../src/utils/ApiError.js';
import { ok } from '../src/utils/response.js';

const sign = (payload, secret = env.jwt.accessSecret, options = { expiresIn: '5m' }) =>
  jwt.sign(payload, secret, options);

const tokenOf = (role, roleTitle = null, boardTitle = null) =>
  sign({ sub: 'user-1', role, roleTitle, boardTitle });

// App nhỏ chỉ để test middleware, không cần database
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/me', authenticate, (req, res) => ok(res, req.user));
  app.get('/technician', authenticate, authorize('STAFF:TECHNICIAN', 'MANAGER'), (_req, res) =>
    ok(res),
  );
  app.get('/board', authenticate, authorize('BOARD'), (_req, res) => ok(res));
  app.get('/chairman', authenticate, authorize('BOARD:CHAIRMAN'), (_req, res) => ok(res));
  app.post(
    '/items',
    validate({ body: Joi.object({ name: Joi.string().required(), qty: Joi.number().min(1) }) }),
    (req, res) => ok(res, req.body),
  );
  app.get('/boom', () => {
    throw new ApiError('FUND_INSUFFICIENT_BALANCE');
  });
  app.use(errorHandler);
  return app;
}

describe('createApp', () => {
  const app = createApp();

  it('GET /api/health trả về format thành công chuẩn', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('route không tồn tại → 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/khong-co');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, errorCode: 'NOT_FOUND' });
  });

  it('body JSON sai cú pháp → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('Swagger spec được sinh ra', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveProperty('/health');
  });
});

describe('authenticate', () => {
  const app = buildTestApp();

  it('thiếu header → 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('token sai secret → 401', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${sign({ sub: 'x', role: 'ADMIN' }, 'wrong-secret')}`);
    expect(res.status).toBe(401);
  });

  it('token hết hạn → 401 với message hết hạn', async () => {
    const expired = sign({ sub: 'x', role: 'ADMIN' }, env.jwt.accessSecret, { expiresIn: -10 });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/hết hạn/);
  });

  it('token hợp lệ → gắn req.user', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${tokenOf('STAFF', 'TECHNICIAN')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: 'user-1',
      role: 'STAFF',
      roleTitle: 'TECHNICIAN',
      boardTitle: null,
    });
  });
});

describe('authorize', () => {
  const app = buildTestApp();
  const call = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);

  it.each([
    ['technician', tokenOf('STAFF', 'TECHNICIAN'), 200],
    ['manager', tokenOf('MANAGER'), 200],
    ['admin', tokenOf('ADMIN'), 403],
    ['receptionist', tokenOf('STAFF', 'RECEPTIONIST'), 403],
    ['resident', tokenOf('RESIDENT'), 403],
  ])('/technician với %s → %i', async (_name, token, status) => {
    const res = await call('/technician', token);
    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.errorCode).toBe('FORBIDDEN_ROLE');
  });

  it('ADMIN không tự có quyền nghiệp vụ của BOARD (BR-R3)', async () => {
    expect((await call('/board', tokenOf('ADMIN'))).status).toBe(403);
    expect((await call('/board', tokenOf('BOARD', null, 'MEMBER'))).status).toBe(200);
  });

  it('BOARD:CHAIRMAN chỉ cho Trưởng BQT', async () => {
    expect((await call('/chairman', tokenOf('BOARD', null, 'MEMBER'))).status).toBe(403);
    expect((await call('/chairman', tokenOf('BOARD', null, 'CHAIRMAN'))).status).toBe(200);
  });

  it('hasPermission: STAFF chung cho mọi chức danh', () => {
    expect(hasPermission({ role: 'STAFF', roleTitle: 'SECURITY' }, ['STAFF'])).toBe(true);
    expect(hasPermission({ role: 'ADMIN' }, ['STAFF'])).toBe(false);
    expect(hasPermission({ role: 'BOARD' }, ['STAFF'])).toBe(false);
  });

  it('spec gõ sai → lỗi ngay khi khai báo route', () => {
    expect(() => authorize('ADMINN')).toThrow();
    expect(() => authorize('STAFF:DRIVER')).toThrow();
    expect(() => authorize('BOARD:TECHNICIAN')).toThrow();
    expect(() => authorize('MANAGER:CHAIRMAN')).toThrow();
  });
});

describe('validate & errorHandler', () => {
  const app = buildTestApp();

  it('thiếu field → 400 kèm details tiếng Việt', async () => {
    const res = await request(app).post('/items').send({ qty: 0 });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        { field: 'name', message: 'name là bắt buộc' },
        { field: 'qty', message: 'qty phải lớn hơn hoặc bằng 1' },
      ]),
    );
  });

  it('bỏ field lạ và convert kiểu', async () => {
    const res = await request(app).post('/items').send({ name: 'A', qty: '2', hack: true });
    expect(res.body.data).toEqual({ name: 'A', qty: 2 });
  });

  it('ApiError nghiệp vụ → đúng status + errorCode SRS', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: 'Số dư quỹ bảo trì không đủ để duyệt chi',
      errorCode: 'FUND_INSUFFICIENT_BALANCE',
    });
  });
});
