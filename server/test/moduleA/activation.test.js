// UC11: kích hoạt tài khoản bằng OTP email và đồng ý điều khoản (BR-X4, BR-X7, BR-S02, BR-S05, BR-S06)
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { requireConsent } from '../../src/middlewares/requireConsent.js';
import { Apartment, AuditLog, Contract, Resident, User, VerificationCode } from '../../src/models/index.js';
import { confirmActivation, login, startActivation } from '../../src/modules/auth/auth.service.js';
import { OTP_DAILY_LIMIT } from '../../src/modules/auth/verification.service.js';
import * as contracts from '../../src/modules/contracts/contracts.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager, createReceptionist, createUser, linkResident } from '../helpers/fixtures.js';
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

test('UC22: chỉ Ban quản lý cấp quyền theo hồ sơ mua bán; chủ sở hữu tự kích hoạt và căn vẫn trống', async () => {
  const receptionist = asUser(await createReceptionist());
  const manager = asUser(await createManager());
  const apartment = await createApartment(null, { code: 'C-5', status: 'VACANT', handoverDate: new Date('2025-01-01') });
  const identity = { phone: '0912000090', apartmentCode: 'C-5', email: 'chumoi@example.com' };
  const { contract } = await contracts.createContract(receptionist, {
    apartmentId: apartment._id,
    type: 'SALE',
    startDate: new Date('2025-01-01'),
    owner: { phone: identity.phone, fullName: 'Chủ Mới', idNumber: '001200000001' },
  });
  assert.equal(contract.ownerIdNumberEnc, undefined);
  const created = await User.findById(contract.ownerId).select('+passwordHash').lean();
  assert.equal(created.activatedAt, null);
  assert.equal(created.passwordHash, undefined);
  assert.equal(mails.length, 0);
  assert.equal(await Resident.countDocuments({ userId: created._id }), 0);
  await assert.rejects(startActivation(identity), { errorCode: 'ACTIVATION_DATA_MISMATCH' });
  assert.equal((await app.request('POST', '/activation-codes', {
    user: receptionist, body: { userId: created._id },
  })).status, 403);
  const moveInPath = `/apartments/${apartment.id}/confirm-move-in`;
  assert.equal((await app.request('PATCH', moveInPath, { user: receptionist })).status, 409);

  const path = `/apartments/${apartment.id}/owner-account`;
  const issue = (user, changes = {}) => app.request('POST', path, {
    user, body: { contractId: contract.id, phone: '+84912000090', email: identity.email, identityVerified: true, ...changes },
  });
  assert.equal((await issue(receptionist)).status, 403);
  assert.equal((await issue(manager, { identityVerified: false })).status, 400);
  assert.equal((await issue(manager, { phone: '0912000091' })).status, 400);

  const results = await Promise.all([issue(manager), issue(manager)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(results.find((result) => result.status === 201).body.data.activationInviteSent, true);
  const link = await Resident.findOne({ userId: created._id, apartmentId: apartment._id, relationType: 'OWNER' });
  assert.equal(String(link.contractId), contract.id);
  assert.ok(link.idNumberEnc);
  assert.equal(await AuditLog.countDocuments({ action: 'OWNER_ACCOUNT_ISSUED', performedBy: manager.id, targetId: link._id }), 1);
  const detail = await app.request('GET', `/apartments/${apartment.id}`, { user: manager });
  assert.ok(detail.body.data.activeContracts[0].ownerAccountIssuedAt);
  assert.equal(detail.body.data.activeContracts[0].ownerAccountIssuedBy._id, manager.id);
  assert.equal((await Apartment.findById(apartment._id)).occupancyStatus, 'VACANT');
  const report = await app.request('GET', '/residents/occupancy', { user: manager });
  assert.deepEqual(report.body.data[0].apartments[0].residents, []);
  assert.ok(mails.at(-1).text.includes('/activate'));
  assert.equal(/mật khẩu tạm/i.test(mails.at(-1).text), false);

  await startActivation(identity);
  await confirmActivation({ phone: identity.phone, code: lastOtp(), password: PASSWORD, consent: 'ACCEPTED' });
  assert.ok((await login({ phone: identity.phone, password: PASSWORD })).accessToken);
  assert.equal((await app.request('PATCH', moveInPath, { user: receptionist })).body.data.occupancyStatus, 'OWNER_OCCUPIED');
});

test('UC22: dùng lại tài khoản đã kích hoạt để liên kết thêm căn, chặn hồ sơ sai căn hoặc đổi chủ', async () => {
  const manager = asUser(await createManager());
  const receptionist = asUser(await createReceptionist());
  const owner = await pendingUser('RESIDENT', { activatedAt: new Date(), passwordHash: 'saved-hash' });
  const firstApartment = await createApartment();
  await linkResident(owner, firstApartment, { relationType: 'OWNER' });
  const newApartment = await createApartment(null, { status: 'VACANT' });
  const { contract } = await contracts.createContract(receptionist, {
    apartmentId: newApartment.id, type: 'SALE', startDate: new Date('2025-01-01'),
    owner: { userId: owner.id, phone: owner.phone },
  });
  assert.equal(await Resident.countDocuments({ userId: owner.id }), 1);
  const issue = (id) => app.request('POST', `/apartments/${id}/owner-account`, {
    user: manager, body: { contractId: contract.id, phone: owner.phone, identityVerified: true },
  });
  assert.equal((await issue(firstApartment.id)).status, 409);

  const otherOwner = await pendingUser();
  const otherLink = await linkResident(otherOwner, newApartment, { relationType: 'OWNER' });
  assert.equal((await issue(newApartment.id)).status, 409);
  await Resident.deleteOne({ _id: otherLink._id });
  const issued = await issue(newApartment.id);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  assert.equal(issued.body.data.activationInviteSent, null);
  assert.equal(await Resident.countDocuments({ userId: owner.id, relationType: 'OWNER', isActive: true }), 2);
  assert.equal((await User.findById(owner.id).select('+passwordHash')).passwordHash, 'saved-hash');
  assert.equal((await Contract.findById(contract.id)).ownerAccountPending, false);
  assert.equal(mails.length, 0);
});

test('UC22: chủ sở hữu không có email kích hoạt bằng mã tại quầy sau khi được cấp', async () => {
  const manager = asUser(await createManager());
  const receptionist = asUser(await createReceptionist());
  const apartment = await createApartment(null, { status: 'VACANT' });
  const phone = '0912000092';
  const { contract } = await contracts.createContract(receptionist, {
    apartmentId: apartment.id, type: 'SALE', startDate: new Date('2025-01-01'),
    owner: { phone, fullName: 'Chủ Sở Hữu' },
  });
  const issue = await app.request('POST', `/apartments/${apartment.id}/owner-account`, {
    user: manager, body: { contractId: contract.id, phone, identityVerified: true },
  });
  assert.equal(issue.status, 201, JSON.stringify(issue.body));
  assert.equal(issue.body.data.activationInviteSent, false);
  assert.equal(mails.length, 0);
  const desk = await app.request('POST', '/activation-codes', {
    user: receptionist, body: { userId: contract.ownerId },
  });
  assert.equal(desk.status, 201, JSON.stringify(desk.body));
  await confirmActivation({ phone, code: desk.body.data.code, password: PASSWORD, consent: 'ACCEPTED' });
  assert.ok((await login({ phone, password: PASSWORD })).accessToken);
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
