// N1: 1 SĐT = 1 tài khoản (BR-S01, BR-X5); email không bắt buộc; có trạng thái chờ kích hoạt
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { User } from '../../src/models/index.js';
import { createInternal } from '../../src/modules/users/users.service.js';
import { normalizePhone } from '../../src/utils/validators.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
const PASSWORD = 'MatKhau123';
const base = { fullName: 'Người Thử', passwordHash: 'x', role: 'RESIDENT' };
const staff = { fullName: 'Kế Toán', email: 'kt@example.com', role: 'ACCOUNTANT' };
const internal = (actor, body) => app.request('POST', '/users/internal', { user: asUser(actor), body });

before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

test('normalizePhone: đưa các tiền tố về 0', () => {
  assert.equal(normalizePhone('+84912345678'), '0912345678');
  assert.equal(normalizePhone('84912345678'), '0912345678');
  assert.equal(normalizePhone(' 0912345678 '), '0912345678');
});

test('normalizePhone: giữ nguyên giá trị không phải chuỗi', () => {
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), undefined);
});

test('User: bắt buộc có SĐT và lưu ở dạng đã chuẩn hóa', async () => {
  await assert.rejects(User.create({ ...base }), /Số điện thoại là bắt buộc/);

  const user = await User.create({ ...base, phone: '+84912345678' });
  assert.equal(user.phone, '0912345678');
});

test('User: SĐT là duy nhất kể cả khi viết khác tiền tố', async () => {
  await User.create({ ...base, phone: '0912345678' });

  await assert.rejects(User.create({ ...base, phone: '+84912345678' }), { code: 11000 });
});

test('User: email và mật khẩu không bắt buộc; nhiều tài khoản không có email', async () => {
  const a = await User.create({ fullName: 'A', role: 'RESIDENT', phone: '0912345671' });
  await User.create({ fullName: 'B', role: 'RESIDENT', phone: '0912345672' });

  assert.equal(a.activatedAt, null);
  assert.equal((await User.findById(a._id).select('+failedLoginCount').lean()).failedLoginCount, 0);
});

test('User: không lộ bộ đếm và thời điểm khóa khi đọc thông thường', async () => {
  const { _id } = await User.create({ ...base, phone: '0912345678' });
  const plain = await User.findById(_id).lean();

  assert.equal('failedLoginCount' in plain, false);
  assert.equal('lockedUntil' in plain, false);
  assert.equal('passwordHash' in plain, false);
});

test('User: consents chỉ nhận hành động hợp lệ', async () => {
  const invalid = { action: 'KHAC', policyVersion: '1.0', createdAt: new Date() };

  await assert.rejects(User.create({ ...base, phone: '0912345678', consents: [invalid] }));
});

test('đăng nhập: tài khoản chưa kích hoạt trả 403 ACCOUNT_NOT_ACTIVATED, không lỗi 500', async () => {
  await User.create({ fullName: 'Chờ', role: 'RESIDENT', phone: '0912345678', email: 'cho@example.com' });

  const res = await app.request('POST', '/auth/login', { body: { phone: '0912345678', password: PASSWORD } });

  assert.equal(res.status, 403);
  assert.equal(res.body.errorCode, 'ACCOUNT_NOT_ACTIVATED');
});

test('User: email là duy nhất; nhiều tài khoản có email null vẫn được', async () => {
  await User.create({ ...base, phone: '0912345671', email: 'a@example.com' });
  await assert.rejects(User.create({ ...base, phone: '0912345672', email: 'A@example.com' }), { code: 11000 });

  await User.create({ ...base, phone: '0912345673', email: null });
  await User.create({ ...base, phone: '0912345674', email: null });
});

test('tạo đồng thời cùng email khác SĐT → 1 tài khoản, lần kia 409 EMAIL_EXISTS', async () => {
  const manager = asUser(await createManager());
  const account = (phone) => ({ ...staff, email: 'cung@example.com', phone });

  const results = await Promise.allSettled([
    createInternal(manager, account('0912345671')),
    createInternal(manager, account('0912345672')),
    createInternal(manager, account('0912345673')),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const { reason } of results.filter((r) => r.status === 'rejected')) {
    assert.equal(reason.errorCode, 'EMAIL_EXISTS');
    assert.equal(reason.status, 409);
    assert.equal(reason.details?.[0]?.field, 'email');
  }
  assert.equal(await User.countDocuments({ email: 'cung@example.com' }), 1);
});

test('tài khoản nội bộ: thiếu hoặc sai SĐT trả 400, trùng SĐT trả 409', async () => {
  const manager = await createManager({ phone: '0912345678' });

  assert.equal((await internal(manager, staff)).status, 400);
  assert.equal((await internal(manager, { ...staff, phone: '123' })).status, 400);
  const duplicated = await internal(manager, { ...staff, phone: '0912345678' });
  assert.equal(duplicated.status, 409);
  assert.equal(duplicated.body.errorCode, 'PHONE_EXISTS');
  assert.equal((await internal(manager, { ...staff, phone: '0912345679' })).status, 201);
});

test('API tra SĐT và thêm thành viên: phân quyền, validate; có userId thì không bắt buộc họ tên, email', async () => {
  const receptionist = await createUser('STAFF', { roleTitle: 'RECEPTIONIST' });
  const resident = await createUser('RESIDENT', { phone: '0912345671' });
  const lookup = (actor, phone) => app.request('GET', `/residents/lookup?phone=${encodeURIComponent(phone)}`, { user: asUser(actor) });
  const addMember = (body) => app.request('POST', '/residents', { user: asUser(receptionist), body });
  const apartmentId = '0123456789abcdef01234567';

  const found = await lookup(receptionist, '+84912345671');
  assert.equal(found.status, 200);
  assert.equal(found.body.data.userId, String(resident._id));
  assert.equal(found.body.data.exists, true);
  assert.equal((await lookup(resident, '0912345671')).status, 403);
  assert.equal((await lookup(receptionist, '123')).status, 400);
  assert.equal((await app.request('GET', '/residents/lookup?phone=0912345671')).status, 401);

  assert.equal((await addMember({ apartmentId, phone: '0912345672' })).status, 400);
  // Qua được validate, dừng ở bước tìm căn hộ
  assert.equal((await addMember({ apartmentId, phone: '0912345671', userId: String(resident._id) })).status, 404);
});

test('hồ sơ: không tự đổi được SĐT (tên đăng nhập); đổi email cần mật khẩu, trùng thì 409, bỏ trống thì xóa', async () => {
  const me = await createUser('RESIDENT', { phone: '0912345671', email: 'toi@example.com', passwordHash: bcrypt.hashSync(PASSWORD, 4) });
  await createUser('RESIDENT', { phone: '0912345672', email: 'nguoikhac@example.com' });
  const patchMe = (body) => app.request('PATCH', '/users/me', { user: asUser(me), body: { currentPassword: PASSWORD, ...body } });

  // Trường phone bị bỏ qua (validate bỏ trường lạ): gửi kèm cũng không đổi được SĐT
  await patchMe({ phone: '0912345673', fullName: 'Thử Đổi Số' });
  assert.equal((await User.findById(me._id).lean()).phone, '0912345671');

  const taken = await patchMe({ email: 'NguoiKhac@example.com' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.errorCode, 'EMAIL_EXISTS');
  assert.equal((await patchMe({ email: 'Moi@Example.com', fullName: 'Tên Mới' })).status, 200);
  const saved = await User.findById(me._id).lean();
  assert.equal(saved.email, 'moi@example.com');
  assert.equal(saved.fullName, 'Tên Mới');
  assert.equal((await patchMe({ email: '' })).status, 200);
  assert.equal((await User.findById(me._id).lean()).email, null);
});
