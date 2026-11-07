// UC03: tạo tài khoản nhân viên ở trạng thái Chờ kích hoạt, không có mật khẩu (BR-S02); nhân viên tự kích hoạt (UC11, UC02)
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { AuditLog, User } from '../../src/models/index.js';
import { MAX_FAILED_LOGINS, confirmActivation, login, startActivation } from '../../src/modules/auth/auth.service.js';
import { issueDeskCode } from '../../src/modules/auth/deskCodes.service.js';
import * as users from '../../src/modules/users/users.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

const PASSWORD = 'MatKhau123';
const mails = [];
let app;
const accountant = (extra = {}) => ({ fullName: 'Kế Toán Mới', phone: '0912000001', role: 'ACCOUNTANT', ...extra });
const lastOtp = () => /\b(\d{6})\b/.exec(mails.at(-1).text)[1];

before(async () => {
  await connectTestDB();
  env.smtp.enabled = true;
  mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (m) => mails.push(m) }));
  app = await startApp();
});
beforeEach(() => {
  mails.length = 0;
});
afterEach(clearTestDB);
after(async () => {
  mock.restoreAll();
  await app.close();
  await closeTestDB();
});

test('tạo nhân viên có email: chờ kích hoạt, không có mật khẩu, thư mời không chứa mật khẩu; tự kích hoạt rồi đăng nhập bằng SĐT', async () => {
  const manager = asUser(await createManager());

  const res = await users.createInternal(manager, accountant({ email: 'KeToan@Example.com' }));

  assert.equal(res.inviteSent, true);
  assert.equal(res.user.accountStatus, 'PENDING');
  assert.equal('temporaryPassword' in res, false);
  const saved = await User.findById(res.user._id).select('+passwordHash').lean();
  assert.equal(saved.passwordHash, undefined);
  assert.equal(saved.activatedAt, null);
  assert.equal(saved.email, 'ketoan@example.com');
  assert.ok(mails[0].text.includes('/activate'));
  assert.equal(/mật khẩu tạm/i.test(mails[0].text), false);
  const audit = await AuditLog.findOne({ action: 'ROLE_ASSIGNED', targetId: res.user._id }).lean();
  assert.equal(JSON.stringify(audit).toLowerCase().includes('password'), false);

  await assert.rejects(login({ phone: '0912000001', password: PASSWORD }), { errorCode: 'ACCOUNT_NOT_ACTIVATED' });
  await startActivation({ phone: '0912000001', email: 'ketoan@example.com' });
  await confirmActivation({ phone: '0912000001', code: lastOtp(), password: PASSWORD, consent: 'ACCEPTED' });
  const { user } = await login({ phone: '0912000001', password: PASSWORD });
  assert.equal(user.accountStatus, 'ACTIVE');
});

test('tạo nhân viên không có email: không gửi thư; Trưởng BQL cấp mã tại quầy để kích hoạt', async () => {
  const managerUser = await createManager();
  const manager = asUser(managerUser);

  const res = await users.createInternal(manager, accountant({ email: '' }));

  assert.equal(res.inviteSent, false);
  assert.equal(mails.length, 0);
  assert.equal((await User.findById(res.user._id).lean()).email, null);
  const { code } = await issueDeskCode(manager, res.user._id);
  await confirmActivation({ phone: '0912000001', code, password: PASSWORD, consent: 'ACCEPTED' });
  assert.ok((await login({ phone: '0912000001', password: PASSWORD })).accessToken);
});

test('sửa email: đổi được, trùng email người khác → 409, bỏ trống thì xóa email', async () => {
  const manager = asUser(await createManager());
  await createUser('STAFF', { roleTitle: 'SECURITY', email: 'dacodung@example.com' });
  const { user } = await users.createInternal(manager, accountant({ email: 'cu@example.com' }));

  await users.updateInternal(manager, user._id, { email: 'Moi@Example.com' });
  assert.equal((await User.findById(user._id).lean()).email, 'moi@example.com');
  await assert.rejects(users.updateInternal(manager, user._id, { email: 'dacodung@example.com' }), {
    errorCode: 'EMAIL_EXISTS',
    status: 409,
  });
  await users.updateInternal(manager, user._id, { email: '' });
  assert.equal((await User.findById(user._id).lean()).email, null);
});

test('danh sách: trạng thái Chờ kích hoạt / Hoạt động / Đã khóa, lọc theo trạng thái, đánh dấu khóa tạm và gỡ được', async () => {
  const managerUser = await createManager({ activatedAt: new Date() });
  const manager = asUser(managerUser);
  const { user: pending } = await users.createInternal(manager, accountant({ email: '' }));
  await createUser('STAFF', { roleTitle: 'SECURITY', isActive: false, activatedAt: new Date() });
  const hash = (await import('bcryptjs')).default.hashSync(PASSWORD, 4);
  const tech = await createUser('STAFF', { roleTitle: 'TECHNICIAN', activatedAt: new Date(), passwordHash: hash });

  const all = await users.listInternal({ page: 1, limit: 20 });
  const byStatus = (s) => all.items.filter((u) => u.accountStatus === s).length;
  assert.equal(byStatus('PENDING'), 1);
  assert.equal(byStatus('LOCKED'), 1);
  assert.equal(byStatus('ACTIVE'), 2);
  assert.deepEqual((await users.listInternal({ page: 1, limit: 20, status: 'PENDING' })).items.map((u) => String(u._id)), [String(pending._id)]);
  assert.equal((await users.listInternal({ page: 1, limit: 20, status: 'LOCKED' })).pagination.total, 1);

  for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) await login({ phone: tech.phone, password: 'SaiMatKhau9' }).catch(() => {});
  const locked = (await users.listInternal({ page: 1, limit: 20 })).items.find((u) => String(u._id) === String(tech._id));
  assert.ok(locked.tempLockedUntil);
  assert.equal('lockedUntil' in locked, false);

  await users.setStatus(manager, tech._id, { isActive: true });
  const after = (await users.listInternal({ page: 1, limit: 20 })).items.find((u) => String(u._id) === String(tech._id));
  assert.equal(after.tempLockedUntil, null);
  assert.ok((await login({ phone: tech.phone, password: PASSWORD })).accessToken);
});

test('API: không tạo được Trưởng BQL trên giao diện; email không bắt buộc; SĐT bắt buộc', async () => {
  const manager = await createManager();
  const post = (body) => app.request('POST', '/users/internal', { user: asUser(manager), body });

  assert.equal((await post(accountant({ role: 'MANAGER' }))).status, 400);
  assert.equal((await post(accountant({ phone: undefined }))).status, 400);
  const created = await post(accountant());
  assert.equal(created.status, 201);
  assert.equal(created.body.data.inviteSent, false);
  assert.equal(created.body.data.user.accountStatus, 'PENDING');
});
