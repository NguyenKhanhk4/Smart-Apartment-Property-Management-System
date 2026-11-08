// UC11: kích hoạt tài khoản bằng OTP email và đồng ý điều khoản (BR-X4, BR-X7, BR-S02, BR-S05, BR-S06)
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { requireConsent } from '../../src/middlewares/requireConsent.js';
import { AuditLog, User, VerificationCode } from '../../src/models/index.js';
import { confirmActivation, login, startActivation } from '../../src/modules/auth/auth.service.js';
import { OTP_DAILY_LIMIT } from '../../src/modules/auth/verification.service.js';
import * as contracts from '../../src/modules/contracts/contracts.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createReceptionist, createUser, linkResident } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

const PASSWORD = 'MatKhau123';
const mails = [];
let failMail = false;
let app;

const lastOtp = () => /\b(\d{6})\b/.exec(mails.at(-1).text)[1];
const pendingUser = (role = 'RESIDENT', extra = {}) => createUser(role, { passwordHash: undefined, ...extra });

async function pendingResident(extra) {
  const user = await pendingUser('RESIDENT', extra);
  const apartment = await createApartment(null, { code: 'A-1001' });
  const resident = await linkResident(user, apartment);
  return { user, apartment, resident, identity: { phone: user.phone, apartmentCode: 'a-1001', email: user.email } };
}

/** Làm tới bước có mã: trả về dữ liệu để gọi confirmActivation */
async function readyToConfirm(extra) {
  const pending = await pendingResident(extra);
  await startActivation(pending.identity);
  const request = { phone: pending.user.phone, code: lastOtp(), password: PASSWORD, consent: 'ACCEPTED' };
  return { ...pending, request };
}

const wrongCodeOf = (code) => (code === '000000' ? '111111' : '000000');

before(async () => {
  await connectTestDB();
  env.smtp.enabled = true;
  mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message) => {
      if (failMail) throw new Error('SMTP lỗi');
      mails.push(message);
    },
  }));
  app = await startApp();
});
beforeEach(() => {
  mails.length = 0;
  failMail = false;
});
afterEach(clearTestDB);
after(async () => {
  mock.restoreAll();
  await app.close();
  await closeTestDB();
});

test('start: khớp SĐT + mã căn + email → gửi OTP 6 số, chỉ lưu bản băm, hạn 10 phút', async () => {
  const { user, identity } = await pendingResident();

  const res = await startActivation({ ...identity, phone: `+84${user.phone.slice(1)}` });

  assert.equal(res.expiresInMinutes, 10);
  assert.equal(mails.length, 1);
  assert.ok(String(mails[0].bcc).includes(user.email));
  const otp = lastOtp();
  const [record] = await VerificationCode.find({ userId: user._id }).lean();
  assert.notEqual(record.codeHash, otp);
  assert.equal(JSON.stringify(record).includes(otp), false);
  assert.equal(record.purpose, 'ACTIVATION');
  assert.equal(record.channel, 'EMAIL_OTP');
  const minutesLeft = (record.expiresAt - Date.now()) / 60_000;
  assert.ok(minutesLeft > 9.9 && minutesLeft <= 10);
});

test('start: dữ liệu không khớp hoặc không kích hoạt được → cùng một lỗi, không gửi mail', async () => {
  const { user, resident, identity } = await pendingResident();
  const activated = await createUser('RESIDENT', { activatedAt: new Date() });
  const locked = await pendingUser('RESIDENT', { isActive: false });
  const noEmail = await pendingUser('RESIDENT', { email: null });
  const apartment = await createApartment(null, { code: 'B-1' });
  await Promise.all([activated, locked, noEmail].map((u) => linkResident(u, apartment)));

  const cases = [
    { ...identity, phone: '0999999999' },
    { ...identity, email: 'khac@example.com' },
    { ...identity, apartmentCode: 'Z-9' },
    { phone: identity.phone, email: identity.email },
    { phone: activated.phone, apartmentCode: 'B-1', email: activated.email },
    { phone: locked.phone, apartmentCode: 'B-1', email: locked.email },
    { phone: noEmail.phone, apartmentCode: 'B-1', email: 'gi@example.com' },
  ];
  for (const data of cases) {
    await assert.rejects(startActivation(data), { errorCode: 'ACTIVATION_DATA_MISMATCH', status: 400 });
  }

  // Cư dân đã rời căn thì mã căn đó không còn hợp lệ
  resident.isActive = false;
  await resident.save();
  await assert.rejects(startActivation(identity), { errorCode: 'ACTIVATION_DATA_MISMATCH' });

  assert.equal(mails.length, 0);
  assert.equal(await VerificationCode.countDocuments({ userId: user._id }), 0);
});

test('start: nhân viên không cần mã căn hộ', async () => {
  const staff = await pendingUser('STAFF', { roleTitle: 'TECHNICIAN' });

  await startActivation({ phone: staff.phone, email: staff.email.toUpperCase() });

  assert.equal(mails.length, 1);
});

test('start: gửi lại trong 60 giây → 429; sau đó mã mới làm mã cũ hết hiệu lực', async () => {
  const { user, identity } = await pendingResident();
  await startActivation(identity);
  const oldOtp = lastOtp();

  await assert.rejects(startActivation(identity), { errorCode: 'OTP_RESEND_TOO_SOON', status: 429 });
  assert.equal(mails.length, 1);

  await VerificationCode.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 61_000) } });
  await startActivation(identity);
  const newOtp = lastOtp();
  const base = { phone: user.phone, password: PASSWORD, consent: 'ACCEPTED' };

  if (oldOtp !== newOtp) {
    await assert.rejects(confirmActivation({ ...base, code: oldOtp }), { errorCode: 'ACTIVATION_CODE_INVALID' });
  }
  await confirmActivation({ ...base, code: newOtp });
});

test('start: gửi email thất bại → báo ra quầy, mã vừa tạo không dùng được', async () => {
  const { user, identity } = await pendingResident();
  failMail = true;
  mock.method(console, 'error', () => {});

  await assert.rejects(startActivation(identity), { errorCode: 'ACTIVATION_EMAIL_FAILED', status: 503 });

  assert.equal(await VerificationCode.countDocuments({ userId: user._id, usedAt: null }), 0);
  // Được thử lại ngay, không bị tính là gửi quá sớm
  failMail = false;
  await startActivation(identity);
  assert.equal(mails.length, 1);
});

test('confirm: kích hoạt, tự đặt mật khẩu, ghi đồng ý và audit; đăng nhập được; mã không dùng lại được', async () => {
  const { user, request } = await readyToConfirm();
  await assert.rejects(login({ phone: user.phone, password: PASSWORD }), { errorCode: 'ACCOUNT_NOT_ACTIVATED' });

  await confirmActivation(request, { ip: '1.2.3.4' });

  const saved = await User.findById(user._id).select('+passwordHash').lean();
  assert.ok(saved.activatedAt instanceof Date);
  assert.notEqual(saved.passwordHash, PASSWORD);
  assert.equal(saved.consents.length, 1);
  assert.equal(saved.consents[0].action, 'ACCEPTED');
  assert.equal(saved.consents[0].policyVersion, '1.0');
  const audit = await AuditLog.findOne({ action: 'ACCOUNT_ACTIVATED', targetId: user._id }).lean();
  assert.equal(String(audit.performedBy), String(user._id));
  assert.equal(audit.ip, '1.2.3.4');
  assert.equal(audit.metadata.consent, 'ACCEPTED');
  assert.equal(JSON.stringify(audit).includes(PASSWORD), false);

  const { user: logged, accessToken } = await login({ phone: user.phone, password: PASSWORD });
  assert.ok(accessToken);
  assert.equal(logged.consentStatus, 'ACCEPTED');

  await assert.rejects(confirmActivation(request), { errorCode: 'ACTIVATION_CODE_INVALID' });
});

test('confirm: sai mã 5 lần thì mã đúng cũng bị từ chối; chưa đủ 5 lần vẫn dùng được', async () => {
  const { request } = await readyToConfirm();
  const wrong = { ...request, code: wrongCodeOf(request.code) };

  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(confirmActivation(wrong), { errorCode: 'ACTIVATION_CODE_INVALID', status: 400 });
  }
  await confirmActivation(request);

  const next = await readyToConfirm({ phone: '0912000077' });
  const wrongNext = { ...next.request, code: wrongCodeOf(next.request.code) };
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(confirmActivation(wrongNext), { errorCode: 'ACTIVATION_CODE_INVALID' });
  }
  await assert.rejects(confirmActivation(next.request), { errorCode: 'ACTIVATION_CODE_INVALID' });
  assert.equal((await User.findById(next.user._id).lean()).activatedAt, null);
});

test('confirm: mã hết hạn, SĐT lạ, tài khoản đã kích hoạt hoặc bị khóa → cùng lỗi mã không hợp lệ', async () => {
  const { user, request } = await readyToConfirm();

  await VerificationCode.collection.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(confirmActivation(request), { errorCode: 'ACTIVATION_CODE_INVALID' });
  assert.equal((await User.findById(user._id).lean()).activatedAt, null);

  await assert.rejects(confirmActivation({ ...request, phone: '0999999999' }), { errorCode: 'ACTIVATION_CODE_INVALID' });

  const activated = await createUser('RESIDENT', { activatedAt: new Date() });
  await assert.rejects(confirmActivation({ ...request, phone: activated.phone }), { errorCode: 'ACTIVATION_CODE_INVALID' });

  const fresh = await readyToConfirm({ phone: '0912000078' });
  await User.updateOne({ _id: fresh.user._id }, { isActive: false });
  await assert.rejects(confirmActivation(fresh.request), { errorCode: 'ACTIVATION_CODE_INVALID' });
});

test('confirm: 2 request cùng lúc chỉ 1 thành công, chỉ ghi 1 lần đồng ý', async () => {
  const { user, request } = await readyToConfirm();

  const results = await Promise.allSettled([confirmActivation(request), confirmActivation({ ...request, consent: 'DECLINED' })]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'ACTIVATION_CODE_INVALID');
  assert.equal((await User.findById(user._id).lean()).consents.length, 1);
});

test('từ chối điều khoản: vẫn kích hoạt nhưng bị khóa chức năng; đồng ý lại trong hồ sơ thì mở; rút lại thì khóa (BR-X7)', async () => {
  const { user, request } = await readyToConfirm();
  await confirmActivation({ ...request, consent: 'DECLINED' });
  assert.ok((await User.findById(user._id).lean()).activatedAt);
  const actor = asUser(await User.findById(user._id));

  const guarded = async () => {
    let passed = false;
    await requireConsent({ user: actor }, {}, () => {
      passed = true;
    });
    return passed;
  };
  const setConsent = (action) => app.request('PATCH', '/users/me/consent', { user: actor, body: { action } });

  await assert.rejects(guarded(), { errorCode: 'CONSENT_REQUIRED', status: 403 });

  // Chưa đồng ý thì không có gì để rút
  assert.equal((await setConsent('WITHDRAWN')).status, 409);

  const accepted = await setConsent('ACCEPTED');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.consentStatus, 'ACCEPTED');
  assert.equal(await guarded(), true);

  const withdrawn = await setConsent('WITHDRAWN');
  assert.equal(withdrawn.body.data.consentStatus, 'WITHDRAWN');
  await assert.rejects(guarded(), { errorCode: 'CONSENT_REQUIRED' });

  const saved = await User.findById(user._id).lean();
  assert.deepEqual(saved.consents.map((c) => c.action), ['DECLINED', 'ACCEPTED', 'WITHDRAWN']);
  assert.equal(await AuditLog.countDocuments({ action: 'CONSENT_CHANGED', targetId: user._id }), 2);
  assert.equal((await setConsent('DECLINED')).status, 400);
});

test('API: mật khẩu yếu, không khớp, thiếu lựa chọn điều khoản → 400; đăng ký công khai đã bỏ', async () => {
  const base = { phone: '0912345678', code: '123456', password: PASSWORD, confirmPassword: PASSWORD, consent: 'ACCEPTED' };
  const confirm = (body) => app.request('POST', '/auth/activation/confirm', { body });

  assert.equal((await confirm({ ...base, password: 'ngan1', confirmPassword: 'ngan1' })).status, 400);
  assert.equal((await confirm({ ...base, confirmPassword: 'Khac12345' })).status, 400);
  assert.equal((await confirm({ ...base, consent: undefined })).status, 400);
  assert.equal((await app.request('POST', '/auth/activation/start', { body: { phone: '123', email: 'a@example.com' } })).status, 400);
  assert.equal((await app.request('POST', '/auth/register', { body: base })).status, 404);
});

test('hợp đồng tạo cư dân mới: chờ kích hoạt, không có mật khẩu tạm, email mời không chứa mật khẩu; kích hoạt được', async () => {
  const receptionist = asUser(await createReceptionist());
  const apartment = await createApartment(null, { code: 'C-5', status: 'VACANT' });

  const result = await contracts.createContract(receptionist, {
    apartmentId: apartment._id,
    type: 'SALE',
    startDate: new Date('2026-11-01'),
    owner: { phone: '0912000090', email: 'chumoi@example.com', fullName: 'Chủ Mới' },
  });

  assert.equal(result.activationInviteSent, true);
  assert.equal('temporaryPassword' in result, false);
  const created = await User.findOne({ phone: '0912000090' }).select('+passwordHash').lean();
  assert.equal(created.activatedAt, null);
  assert.equal(created.passwordHash, undefined);
  assert.ok(mails.at(-1).text.includes('/activate'));
  assert.equal(/mật khẩu tạm/i.test(mails.at(-1).text), false);

  await startActivation({ phone: '0912000090', apartmentCode: 'C-5', email: 'chumoi@example.com' });
  await confirmActivation({ phone: '0912000090', code: lastOtp(), password: PASSWORD, consent: 'ACCEPTED' });
  assert.ok((await login({ phone: '0912000090', password: PASSWORD })).accessToken);
});

test('start: mỗi tài khoản tối đa OTP_DAILY_LIMIT mã trong 24 giờ; mã cũ hơn 24 giờ không tính', async () => {
  const { identity } = await pendingResident();
  const ageAll = (ms) => VerificationCode.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - ms) } });

  for (let i = 0; i < OTP_DAILY_LIMIT; i += 1) {
    await startActivation(identity);
    await ageAll(61_000);
  }
  await assert.rejects(startActivation(identity), { errorCode: 'OTP_DAILY_LIMIT', status: 429 });
  assert.equal(mails.length, OTP_DAILY_LIMIT);

  await ageAll(25 * 60 * 60 * 1000);
  await startActivation(identity);
  assert.equal(mails.length, OTP_DAILY_LIMIT + 1);
});

test('BR-X7 qua API: cư dân từ chối thì bị khóa đăng ký xe và tải ảnh; đồng ý thì mở; nhân viên không bị khóa', async () => {
  const { user, request } = await readyToConfirm();
  await confirmActivation({ ...request, consent: 'DECLINED' });
  const resident = asUser(await User.findById(user._id));
  const call = (method, path, actor, body) => app.request(method, path, { user: actor, body });

  const vehicle = await call('POST', '/vehicles', resident, {});
  assert.equal(vehicle.status, 403);
  assert.equal(vehicle.body.errorCode, 'CONSENT_REQUIRED');
  assert.equal((await call('PATCH', '/users/me/avatar', resident)).body.errorCode, 'CONSENT_REQUIRED');

  await call('PATCH', '/users/me/consent', resident, { action: 'ACCEPTED' });
  // Qua được bước điều khoản, dừng ở bước kiểm tra dữ liệu
  assert.equal((await call('POST', '/vehicles', resident, {})).status, 400);
  assert.equal((await call('PATCH', '/users/me/avatar', resident)).status, 400);

  const staff = asUser(await createUser('STAFF', { roleTitle: 'TECHNICIAN' }));
  let passed = false;
  await requireConsent({ user: staff }, {}, () => {
    passed = true;
  });
  assert.equal(passed, true);
  assert.equal((await call('PATCH', '/users/me/avatar', staff)).status, 400);
});

test('điều khoản đổi phiên bản: đồng ý bản cũ thì bị khóa và consentOutdated = true; đồng ý lại bản mới thì mở (BR-X7)', async () => {
  const { user, request } = await readyToConfirm();
  await confirmActivation({ ...request, consent: 'ACCEPTED' });
  // Giả lập: cư dân đồng ý bản 0.9, sau đó điều khoản được cập nhật lên bản hiện hành
  await User.updateOne({ _id: user._id }, { $set: { 'consents.0.policyVersion': '0.9' } });
  const actor = asUser(await User.findById(user._id));

  await assert.rejects(requireConsent({ user: actor }, {}, () => {}), { errorCode: 'CONSENT_REQUIRED' });
  const me = await app.request('GET', '/users/me', { user: actor });
  assert.equal(me.body.data.consentStatus, 'ACCEPTED');
  assert.equal(me.body.data.consentOutdated, true);
  assert.equal(me.body.data.consentPolicyVersion, '0.9');
  assert.equal(me.body.data.currentPolicyVersion, '1.0');

  const accepted = await app.request('PATCH', '/users/me/consent', { user: actor, body: { action: 'ACCEPTED' } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.consentOutdated, false);
  let passed = false;
  await requireConsent({ user: actor }, {}, () => {
    passed = true;
  });
  assert.equal(passed, true);

  const saved = await User.findById(user._id).lean();
  assert.deepEqual(saved.consents.map((c) => c.policyVersion), ['0.9', '1.0']);
  const audit = await AuditLog.findOne({ action: 'CONSENT_CHANGED', targetId: user._id }).lean();
  assert.equal(audit.metadata.previousPolicyVersion, '0.9');
});
