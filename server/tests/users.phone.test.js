// N1: 1 SĐT = 1 tài khoản (BR-S01, BR-X5); email không bắt buộc; có trạng thái chờ kích hoạt
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/index.js';
import { normalizePhone } from '../src/utils/validators.js';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createManager, createUser, tokenFor } from './helpers/fixtures.js';

const app = createApp();
const PASSWORD = 'MatKhau123';
const base = { fullName: 'Người Thử', passwordHash: 'x', role: 'RESIDENT' };

beforeAll(connectTestDB, 120000);
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('normalizePhone', () => {
  it('đưa các tiền tố về 0', () => {
    expect(normalizePhone('+84912345678')).toBe('0912345678');
    expect(normalizePhone('84912345678')).toBe('0912345678');
    expect(normalizePhone(' 0912345678 ')).toBe('0912345678');
  });

  it('giữ nguyên giá trị không phải chuỗi', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeUndefined();
  });
});

describe('Model User', () => {
  it('bắt buộc có SĐT và lưu ở dạng đã chuẩn hóa', async () => {
    await expect(User.create({ ...base })).rejects.toThrow(/Số điện thoại là bắt buộc/);

    const user = await User.create({ ...base, phone: '+84912345678' });
    expect(user.phone).toBe('0912345678');
  });

  it('SĐT là duy nhất kể cả khi viết khác tiền tố', async () => {
    await User.create({ ...base, phone: '0912345678' });

    await expect(User.create({ ...base, phone: '+84912345678' })).rejects.toMatchObject({ code: 11000 });
  });

  it('email và mật khẩu không bắt buộc; nhiều tài khoản không có email', async () => {
    const a = await User.create({ fullName: 'A', role: 'RESIDENT', phone: '0912345671' });
    await User.create({ fullName: 'B', role: 'RESIDENT', phone: '0912345672' });

    expect(a.activatedAt).toBeNull();
    expect((await User.findById(a._id).select('+failedLoginCount').lean()).failedLoginCount).toBe(0);
  });

  it('không lộ bộ đếm và thời điểm khóa khi đọc thông thường', async () => {
    const { _id } = await User.create({ ...base, phone: '0912345678' });
    const plain = await User.findById(_id).lean();

    expect(plain).not.toHaveProperty('failedLoginCount');
    expect(plain).not.toHaveProperty('lockedUntil');
    expect(plain).not.toHaveProperty('passwordHash');
  });

  it('consents chỉ nhận hành động hợp lệ', async () => {
    const invalid = { action: 'KHAC', policyVersion: '1.0', createdAt: new Date() };

    await expect(User.create({ ...base, phone: '0912345678', consents: [invalid] })).rejects.toThrow();
  });
});

describe('Đăng nhập khi chưa kích hoạt', () => {
  it('tài khoản chưa có mật khẩu trả 401, không lỗi 500', async () => {
    await User.create({ fullName: 'Chờ', role: 'RESIDENT', phone: '0912345678', email: 'cho@example.com' });

    const res = await request(app).post('/api/auth/login').send({ email: 'cho@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
  });
});

describe('API tạo tài khoản', () => {
  const internal = (actor, body) =>
    request(app).post('/api/users/internal').set('Authorization', `Bearer ${tokenFor(actor)}`).send(body);
  const staff = { fullName: 'Kế Toán', email: 'kt@example.com', role: 'ACCOUNTANT' };
  const register = { fullName: 'Cư Dân', email: 'cd@example.com', password: PASSWORD, confirmPassword: PASSWORD };

  it('đăng ký: thiếu SĐT trả 400; thành công thì đã kích hoạt và lưu dạng chuẩn hóa', async () => {
    expect((await request(app).post('/api/auth/register').send(register)).status).toBe(400);

    const res = await request(app).post('/api/auth/register').send({ ...register, phone: '+84912345678' });

    expect(res.status).toBe(201);
    const saved = await User.findOne({ email: 'cd@example.com' }).lean();
    expect(saved.phone).toBe('0912345678');
    expect(saved.activatedAt).toBeInstanceOf(Date);
  });

  it('đăng ký: trùng SĐT hoặc trùng email trả 400', async () => {
    await createUser('RESIDENT', { phone: '0912345678', email: 'co@example.com' });

    const samePhone = await request(app).post('/api/auth/register').send({ ...register, phone: '84912345678' });
    const sameEmail = await request(app).post('/api/auth/register').send({ ...register, email: 'CO@example.com', phone: '0912345679' });

    expect(samePhone.status).toBe(400);
    expect(samePhone.body.details[0].field).toBe('phone');
    expect(sameEmail.status).toBe(400);
    expect(sameEmail.body.details[0].field).toBe('email');
  });

  it('tài khoản nội bộ: thiếu hoặc sai SĐT trả 400, trùng SĐT trả 400', async () => {
    const manager = await createManager({ phone: '0912345678' });

    expect((await internal(manager, staff)).status).toBe(400);
    expect((await internal(manager, { ...staff, phone: '123' })).status).toBe(400);
    const duplicated = await internal(manager, { ...staff, phone: '0912345678' });
    expect(duplicated.status).toBe(400);
    expect(duplicated.body.details[0].field).toBe('phone');
    expect((await internal(manager, { ...staff, phone: '0912345679' })).status).toBe(201);
  });

  it('không xóa được SĐT của mình; đổi sang SĐT đã có trả 409', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const me = await createUser('RESIDENT', { phone: '0912345671', passwordHash: hash });
    await createUser('RESIDENT', { phone: '0912345672' });
    const patchMe = (body) => request(app).patch('/api/users/me').set('Authorization', `Bearer ${tokenFor(me)}`).send(body);

    expect((await patchMe({ phone: '' })).status).toBe(400);
    expect((await patchMe({ phone: null })).status).toBe(400);
    expect((await patchMe({ phone: '0912345672' })).status).toBe(409);
    expect((await patchMe({ phone: '+84912345673' })).status).toBe(200);
    expect((await User.findById(me._id).lean()).phone).toBe('0912345673');
  });
});
