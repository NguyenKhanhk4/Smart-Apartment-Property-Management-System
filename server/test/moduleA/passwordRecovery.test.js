// UC02: quên mật khẩu bằng OTP email, mã in tại quầy 48 giờ (BR-X4, BR-S02, BR-S05)
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { AuditLog, User, VerificationCode } from '../../src/models/index.js';
import { confirmActivation, forgotPassword, login, refresh, resetPassword } from '../../src/modules/auth/auth.service.js';
import { signRefreshToken } from '../../src/modules/auth/auth.tokens.js';
import { issueDeskCode, lookupForDeskCode } from '../../src/modules/auth/deskCodes.service.js';
import { buildIdNumberFields } from '../../src/modules/residents/idCrypto.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager, createReceptionist, createUser, linkResident } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

const OLD = 'MatKhauCu1';
const NEW = 'MatKhauMoi2';
const mails = [];
let app;

const lastOtp = () => /\b(\d{6})\b/.exec(mails.at(-1).text)[1];
const activeResident = async (extra) => createUser('RESIDENT', { passwordHash: await bcrypt.hash(OLD, 4), activatedAt: new Date(), ...extra });
const reset = (user, code) => resetPassword({ phone: user.phone, code, password: NEW });

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

test('quên mật khẩu: gửi OTP; đặt lại thì đăng nhập bằng mật khẩu mới, mọi phiên cũ bị thu hồi, có audit', async () => {
  const user = await activeResident();
  const oldSession = signRefreshToken(await User.findById(user._id).select('+tokenVersion'));

  await forgotPassword({ phone: `+84${user.phone.slice(1)}` });
  assert.equal(mails.length, 1);
  await reset(user, lastOtp());

  await assert.rejects(login({ email: user.email, password: OLD }), { errorCode: 'AUTH_INVALID_CREDENTIALS' });
  assert.ok((await login({ email: user.email, password: NEW })).accessToken);
  await assert.rejects(refresh({ refreshToken: oldSession }), { errorCode: 'UNAUTHORIZED' });
  const audit = await AuditLog.findOne({ action: 'PASSWORD_RESET', targetId: user._id }).lean();
  assert.equal(audit.metadata.channel, 'EMAIL_OTP');
});

test('quên mật khẩu: SĐT lạ, không có email, chưa kích hoạt, bị khóa, gửi quá sớm → cùng kết quả, không gửi mail', async () => {
  const noEmail = await activeResident({ email: null });
  const pending = await createUser('RESIDENT', { passwordHash: undefined });
  const locked = await activeResident({ isActive: false });
  const normal = await activeResident();
  await forgotPassword({ phone: normal.phone });
  mails.length = 0;

  const results = [];
  for (const phone of ['0999999999', noEmail.phone, pending.phone, locked.phone, normal.phone]) {
    results.push(await forgotPassword({ phone }));
  }
  assert.equal(new Set(results.map((r) => JSON.stringify(r))).size, 1);
  assert.equal(mails.length, 0);
});

test('đặt lại: mã sai 5 lần thì hủy; mã kích hoạt không dùng để đặt lại được; tài khoản khóa thì từ chối', async () => {
  const user = await activeResident();
  await forgotPassword({ phone: user.phone });
  const otp = lastOtp();
  const wrong = otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) await assert.rejects(reset(user, wrong), { errorCode: 'ACTIVATION_CODE_INVALID' });
  await assert.rejects(reset(user, otp), { errorCode: 'ACTIVATION_CODE_INVALID' });

  const other = await activeResident();
  await forgotPassword({ phone: other.phone });
  const otherOtp = lastOtp();
  await User.updateOne({ _id: other._id }, { isActive: false });
  await assert.rejects(reset(other, otherOtp), { errorCode: 'ACTIVATION_CODE_INVALID' });
});

test('tra cứu tại quầy: CCCD đã che, căn hộ, trạng thái; không trả mã; SĐT lạ → 404', async () => {
  const receptionist = asUser(await createReceptionist());
  const user = await createUser('RESIDENT', { passwordHash: undefined, email: null });
  const apartment = await createApartment(null, { code: 'D-7' });
  await linkResident(user, apartment, buildIdNumberFields('079012345678'));

  const info = await lookupForDeskCode(receptionist, user.phone);

  assert.equal(info.status, 'PENDING');
  assert.equal(info.purpose, 'ACTIVATION');
  assert.equal(info.hasEmail, false);
  assert.equal(info.idNumber, '********5678');
  assert.deepEqual(info.apartments, ['D-7']);
  assert.equal(info.canIssue, true);
  assert.equal('code' in info, false);
  await assert.rejects(lookupForDeskCode(receptionist, '0999999999'), { errorCode: 'NOT_FOUND' });
});

test('mã tại quầy cho cư dân chưa có email: kích hoạt được qua trang kích hoạt, hạn 48 giờ, mã mới hủy mã cũ', async () => {
  const receptionist = asUser(await createReceptionist());
  const user = await createUser('RESIDENT', { passwordHash: undefined, email: null });

  const first = await issueDeskCode(receptionist, user._id);
  const second = await issueDeskCode(receptionist, user._id);
  assert.match(second.code, /^[A-HJ-NP-Z2-9]{8}$/);
  const hours = (new Date(second.expiresAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 47.9 && hours <= 48);
  const confirm = (code) => confirmActivation({ phone: user.phone, code, password: NEW, consent: 'ACCEPTED' });

  if (first.code !== second.code) await assert.rejects(confirm(first.code), { errorCode: 'ACTIVATION_CODE_INVALID' });
  // Gõ chữ thường, có gạch ngang như trên phiếu in vẫn được
  const typed = `${second.code.slice(0, 4)}-${second.code.slice(4)}`.toLowerCase();
  assert.deepEqual(await confirm(typed), { mode: 'ACTIVATED' });

  const saved = await User.findById(user._id).lean();
  assert.ok(saved.activatedAt);
  const record = await VerificationCode.findOne({ userId: user._id, usedAt: { $ne: null }, channel: 'DESK_CODE' }).sort({ createdAt: -1 }).lean();
  assert.equal(String(record.issuedBy), receptionist.id);
  assert.ok(await AuditLog.exists({ action: 'ACTIVATION_CODE_ISSUED', targetId: user._id }));
});

test('mã tại quầy cho tài khoản đã kích hoạt: đặt lại mật khẩu qua trang kích hoạt hoặc trang quên mật khẩu, giữ ngày kích hoạt', async () => {
  const receptionist = asUser(await createReceptionist());
  const user = await activeResident({ consents: [{ action: 'ACCEPTED', policyVersion: '1.0', createdAt: new Date() }] });
  const activatedAt = (await User.findById(user._id).lean()).activatedAt;

  const { code, purpose } = await issueDeskCode(receptionist, user._id);
  assert.equal(purpose, 'PASSWORD_RESET');
  assert.deepEqual(await confirmActivation({ phone: user.phone, code, password: NEW, consent: 'ACCEPTED' }), { mode: 'PASSWORD_RESET' });
  const saved = await User.findById(user._id).lean();
  assert.equal(saved.activatedAt.getTime(), activatedAt.getTime());
  assert.equal(saved.consents.length, 1); // chọn lại giống cũ thì không ghi thêm
  assert.ok((await login({ email: user.email, password: NEW })).accessToken);

  const again = await issueDeskCode(receptionist, user._id);
  await resetPassword({ phone: user.phone, code: again.code, password: 'MatKhauBa3' });
  assert.ok((await login({ email: user.email, password: 'MatKhauBa3' })).accessToken);

  // OTP email không dùng được ở trang kích hoạt cho tài khoản đã kích hoạt
  await forgotPassword({ phone: user.phone });
  await assert.rejects(confirmActivation({ phone: user.phone, code: lastOtp(), password: NEW, consent: 'ACCEPTED' }), {
    errorCode: 'ACTIVATION_CODE_INVALID',
  });
});

test('quyền cấp mã: Lễ tân chỉ cho cư dân; Trưởng BQL cho nhân viên; không ai cấp cho Trưởng BQL; tài khoản khóa thì không', async () => {
  const receptionist = asUser(await createReceptionist());
  const manager = await createManager();
  const managerActor = asUser(manager);
  const technician = await createUser('STAFF', { roleTitle: 'TECHNICIAN' });
  const otherReceptionist = await createReceptionist();
  const lockedResident = await activeResident({ isActive: false });

  await assert.rejects(issueDeskCode(receptionist, technician._id), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(issueDeskCode(receptionist, otherReceptionist._id), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(issueDeskCode(receptionist, manager._id), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(issueDeskCode(managerActor, manager._id), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(issueDeskCode(receptionist, lockedResident._id), { errorCode: 'STATUS_CONFLICT' });
  assert.equal((await lookupForDeskCode(receptionist, technician.phone)).canIssue, false);

  // Nhân viên tạo qua fixture chưa kích hoạt nên nhận mã kích hoạt
  assert.equal((await issueDeskCode(managerActor, technician._id)).purpose, 'ACTIVATION');
  assert.equal(await VerificationCode.countDocuments({ userId: manager._id }), 0);
});

test('API: chỉ Lễ tân và Trưởng BQL gọi được; mật khẩu yếu 400; quên mật khẩu luôn 200', async () => {
  const resident = await activeResident();
  const technician = await createUser('STAFF', { roleTitle: 'TECHNICIAN' });
  const receptionist = await createReceptionist();
  const lookup = (actor) => app.request('GET', `/activation-codes/lookup?phone=${resident.phone}`, { user: actor && asUser(actor) });

  assert.equal((await lookup(receptionist)).status, 200);
  assert.equal((await lookup(technician)).status, 403);
  assert.equal((await lookup(resident)).status, 403);
  assert.equal((await lookup(null)).status, 401);
  const issued = await app.request('POST', '/activation-codes', { user: asUser(receptionist), body: { userId: String(resident._id) } });
  assert.equal(issued.status, 201);
  assert.ok(issued.body.data.code);

  assert.equal((await app.request('POST', '/auth/password/forgot', { body: { phone: '0999999999' } })).status, 200);
  const weak = { phone: resident.phone, code: '123456', password: 'ngan1', confirmPassword: 'ngan1' };
  assert.equal((await app.request('POST', '/auth/password/reset', { body: weak })).status, 400);
});
