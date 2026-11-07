// Đổi SĐT tại quầy, đổi email có hỏi mật khẩu, sai mật khẩu ở hồ sơ tính chung bộ đếm khóa (BR-S03, BR-X5)
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { AuditLog, Notification, User, VerificationCode } from '../../src/models/index.js';
import { login, refresh } from '../../src/modules/auth/auth.service.js';
import { signRefreshToken } from '../../src/modules/auth/auth.tokens.js';
import { changePhoneAtDesk, issueDeskCode } from '../../src/modules/auth/deskCodes.service.js';
import * as users from '../../src/modules/users/users.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createReceptionist, createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

const PASSWORD = 'MatKhau123';
const mails = [];
let app;
const activeUser = async (role = 'RESIDENT', extra = {}) =>
  createUser(role, { passwordHash: await bcrypt.hash(PASSWORD, 4), activatedAt: new Date(), ...extra });

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

test('đổi SĐT tại quầy: đăng nhập bằng số mới, số cũ hết dùng, mọi phiên bị thu hồi, mã chưa dùng bị hủy, có audit và báo người dùng', async () => {
  const receptionist = asUser(await createReceptionist());
  const user = await activeUser('RESIDENT', { email: 'cudan@example.com' });
  const oldSession = signRefreshToken(await User.findById(user._id).select('+tokenVersion'));
  await issueDeskCode(receptionist, user._id);

  const info = await changePhoneAtDesk(receptionist, user._id, '+84912000099');

  assert.equal(info.phone, '0912000099');
  await assert.rejects(login({ phone: user.phone, password: PASSWORD }), { errorCode: 'AUTH_INVALID_CREDENTIALS' });
  assert.ok((await login({ phone: '0912000099', password: PASSWORD })).accessToken);
  await assert.rejects(refresh({ refreshToken: oldSession }), { errorCode: 'UNAUTHORIZED' });
  assert.equal(await VerificationCode.countDocuments({ userId: user._id, usedAt: null }), 0);

  const audit = await AuditLog.findOne({ action: 'PHONE_CHANGED', targetId: user._id }).lean();
  assert.equal(String(audit.performedBy), receptionist.id);
  assert.equal(audit.metadata.to, '*******099');
  assert.equal(JSON.stringify(audit).includes('0912000099'), false);
  assert.equal(await Notification.countDocuments({ userId: user._id }), 1);
  assert.ok(mails.some((m) => String(m.bcc).includes('cudan@example.com') && m.text.includes('*******099')));
});

test('đổi SĐT tại quầy: số mới đã có tài khoản → từ chối, không gộp; trùng số cũ → 400; tài khoản khóa → 409', async () => {
  const receptionist = asUser(await createReceptionist());
  const user = await activeUser();
  const other = await activeUser();
  const locked = await activeUser('RESIDENT', { isActive: false });

  await assert.rejects(changePhoneAtDesk(receptionist, user._id, other.phone), { errorCode: 'PHONE_EXISTS', status: 409 });
  await assert.rejects(changePhoneAtDesk(receptionist, user._id, user.phone), { errorCode: 'VALIDATION_ERROR' });
  await assert.rejects(changePhoneAtDesk(receptionist, locked._id, '0912000098'), { errorCode: 'STATUS_CONFLICT' });
  assert.equal((await User.findById(user._id).lean()).phone, user.phone);
});

test('đổi SĐT tại quầy: Lễ tân chỉ đổi cho cư dân; Trưởng BQL đổi cho nhân viên; không ai đổi cho Trưởng BQL', async () => {
  const receptionist = asUser(await createReceptionist());
  const manager = await createManager();
  const staff = await activeUser('STAFF', { roleTitle: 'TECHNICIAN' });

  await assert.rejects(changePhoneAtDesk(receptionist, staff._id, '0912000097'), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(changePhoneAtDesk(asUser(manager), manager._id, '0912000097'), { errorCode: 'FORBIDDEN_ROLE' });
  await changePhoneAtDesk(asUser(manager), staff._id, '0912000097');
  assert.equal((await User.findById(staff._id).lean()).phone, '0912000097');
});

test('đổi email trong hồ sơ: bắt buộc mật khẩu hiện tại; đúng thì đổi và báo về email CŨ; đổi tên không cần mật khẩu', async () => {
  const user = await activeUser('RESIDENT', { email: 'cu@example.com' });

  await assert.rejects(users.updateMe(user._id, { email: 'moi@example.com' }), (err) => err.details?.[0]?.field === 'currentPassword');
  await users.updateMe(user._id, { fullName: 'Tên Mới', email: 'cu@example.com' }); // email không đổi
  assert.equal(mails.length, 0);

  await users.updateMe(user._id, { email: 'Moi@Example.com', currentPassword: PASSWORD });

  assert.equal((await User.findById(user._id).lean()).email, 'moi@example.com');
  assert.equal(mails.length, 1);
  assert.ok(String(mails[0].bcc).includes('cu@example.com'));
  assert.ok(mails[0].text.includes('m***@example.com'));
  assert.ok(await AuditLog.exists({ action: 'EMAIL_CHANGED', targetId: user._id }));
});

test('sai mật khẩu ở hồ sơ tính chung với đăng nhập: 3 lần sai đăng nhập + 2 lần sai đổi email → khóa 15 phút', async () => {
  const user = await activeUser('RESIDENT', { email: 'cu@example.com' });
  for (let i = 0; i < 3; i += 1) await login({ phone: user.phone, password: 'Sai12345' }).catch(() => {});

  const wrong = users.updateMe(user._id, { email: 'moi@example.com', currentPassword: 'Sai12345' });
  await assert.rejects(wrong, (err) => err.details?.[0]?.message.includes('Sai thêm 1 lần'));
  await assert.rejects(users.updateMe(user._id, { email: 'moi@example.com', currentPassword: 'Sai12345' }), {
    errorCode: 'ACCOUNT_LOCKED_TEMP',
  });

  // Đang khóa: mật khẩu đúng cũng không dùng được, kể cả ở đổi mật khẩu và đăng nhập
  await assert.rejects(users.updateMe(user._id, { email: 'moi@example.com', currentPassword: PASSWORD }), { errorCode: 'ACCOUNT_LOCKED_TEMP' });
  await assert.rejects(users.changePassword(user._id, { currentPassword: PASSWORD, newPassword: 'MatKhauMoi2' }), {
    errorCode: 'ACCOUNT_LOCKED_TEMP',
  });
  await assert.rejects(login({ phone: user.phone, password: PASSWORD }), { errorCode: 'ACCOUNT_LOCKED_TEMP' });
  assert.equal((await User.findById(user._id).lean()).email, 'cu@example.com');
});

test('đổi mật khẩu: không còn đoán mật khẩu không giới hạn; nhập đúng thì bộ đếm về 0', async () => {
  const user = await activeUser();
  const change = (currentPassword) => users.changePassword(user._id, { currentPassword, newPassword: 'MatKhauMoi2' });

  for (let i = 0; i < 4; i += 1) await assert.rejects(change('Sai12345'), { errorCode: 'VALIDATION_ERROR' });
  await change(PASSWORD);
  assert.equal((await User.findById(user._id).select('+failedLoginCount').lean()).failedLoginCount, 0);

  for (let i = 0; i < 4; i += 1) await assert.rejects(change('Sai12345'), { errorCode: 'VALIDATION_ERROR' });
  await assert.rejects(change('Sai12345'), { errorCode: 'ACCOUNT_LOCKED_TEMP', status: 423 });
});

test('Trưởng BQL đổi SĐT nhân viên: thu hồi phiên, ghi audit; đổi email: ghi audit và báo về email cũ', async () => {
  const manager = asUser(await createManager());
  const staff = await activeUser('STAFF', { roleTitle: 'SECURITY', email: 'baove@example.com' });
  const oldSession = signRefreshToken(await User.findById(staff._id).select('+tokenVersion'));

  await users.updateInternal(manager, staff._id, { phone: '0912000096' });
  await assert.rejects(refresh({ refreshToken: oldSession }), { errorCode: 'UNAUTHORIZED' });
  assert.ok(await AuditLog.exists({ action: 'PHONE_CHANGED', targetId: staff._id }));

  mails.length = 0;
  await users.updateInternal(manager, staff._id, { email: 'baove.moi@example.com' });
  assert.ok(await AuditLog.exists({ action: 'EMAIL_CHANGED', targetId: staff._id }));
  assert.ok(String(mails.at(-1).bcc).includes('baove@example.com'));
});

test('API: Kỹ thuật viên không đổi được SĐT người khác; đổi email qua API thiếu mật khẩu → 400', async () => {
  const tech = await activeUser('STAFF', { roleTitle: 'TECHNICIAN' });
  const resident = await activeUser('RESIDENT', { email: 'a@example.com' });

  const denied = await app.request('POST', '/activation-codes/change-phone', {
    user: asUser(tech),
    body: { userId: String(resident._id), phone: '0912000095' },
  });
  assert.equal(denied.status, 403);
  const noPassword = await app.request('PATCH', '/users/me', { user: asUser(resident), body: { email: 'b@example.com' } });
  assert.equal(noPassword.status, 400);
  assert.equal(noPassword.body.details[0].field, 'currentPassword');
});
