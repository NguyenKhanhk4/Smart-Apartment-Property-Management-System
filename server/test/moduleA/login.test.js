// UC01: đăng nhập bằng SĐT, khóa 15 phút sau 5 lần sai (BR-S01, BR-S03), chưa kích hoạt, chọn căn hộ
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { User } from '../../src/models/index.js';
import { LOGIN_LOCK_MINUTES, MAX_FAILED_LOGINS, login } from '../../src/modules/auth/auth.service.js';
import { setStatus } from '../../src/modules/users/users.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager, createUser, linkResident } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

const PASSWORD = 'MatKhau123';
const MIN = 60_000;
let app;

const activeUser = async (role = 'RESIDENT', extra = {}) =>
  createUser(role, { passwordHash: await bcrypt.hash(PASSWORD, 4), activatedAt: new Date(), ...extra });
const counters = async (user) =>
  User.findById(user._id).select('+failedLoginCount +lockedUntil').lean().then((u) => ({ count: u.failedLoginCount, lockedUntil: u.lockedUntil }));
const wrong = (user, now) => login({ phone: user.phone, password: 'SaiMatKhau9' }, { now });

before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

test('đăng nhập bằng SĐT (cả dạng +84): có token, không lộ bộ đếm, đưa bộ đếm về 0', async () => {
  const user = await activeUser();
  await assert.rejects(wrong(user), { errorCode: 'AUTH_INVALID_CREDENTIALS', status: 401 });
  assert.equal((await counters(user)).count, 1);

  const res = await login({ phone: `+84${user.phone.slice(1)}`, password: PASSWORD });

  assert.ok(res.accessToken && res.refreshToken);
  assert.equal(res.user.phone, user.phone);
  assert.equal('failedLoginCount' in res.user, false);
  assert.equal('lockedUntil' in res.user, false);
  assert.equal((await counters(user)).count, 0);
  assert.ok((await User.findById(user._id).lean()).lastLoginAt);
});

test('sai 4 lần rồi đúng: không khóa và đếm lại từ đầu', async () => {
  const user = await activeUser();
  for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) await assert.rejects(wrong(user), { errorCode: 'AUTH_INVALID_CREDENTIALS' });
  await login({ phone: user.phone, password: PASSWORD });
  for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) await assert.rejects(wrong(user), { errorCode: 'AUTH_INVALID_CREDENTIALS' });
  assert.ok((await login({ phone: user.phone, password: PASSWORD })).accessToken);
});

test('sai lần thứ 5 → khóa 15 phút (423), nhập đúng cũng bị chặn; hết 15 phút đăng nhập lại được', async () => {
  const user = await activeUser();
  const t0 = new Date();
  for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) await assert.rejects(wrong(user, t0), { errorCode: 'AUTH_INVALID_CREDENTIALS' });
  await assert.rejects(wrong(user, t0), { errorCode: 'ACCOUNT_LOCKED_TEMP', status: 423 });

  const { count, lockedUntil } = await counters(user);
  assert.equal(count, 0);
  assert.equal(lockedUntil.getTime(), t0.getTime() + LOGIN_LOCK_MINUTES * MIN);

  const right = (now) => login({ phone: user.phone, password: PASSWORD }, { now });
  await assert.rejects(right(new Date(t0.getTime() + 14 * MIN)), { errorCode: 'ACCOUNT_LOCKED_TEMP' });
  assert.ok((await right(new Date(t0.getTime() + 16 * MIN))).accessToken);
  assert.equal((await counters(user)).lockedUntil, null);
});

test('5 lần sai gửi cùng lúc vẫn khóa đúng (đếm bằng 1 lệnh cập nhật)', async () => {
  const user = await activeUser();
  const results = await Promise.allSettled(Array.from({ length: MAX_FAILED_LOGINS }, () => wrong(user)));
  assert.equal(results.filter((r) => r.reason?.errorCode === 'ACCOUNT_LOCKED_TEMP').length, 1);
  assert.ok((await counters(user)).lockedUntil > new Date());
});

test('SĐT không có tài khoản: MSG-S01, không đếm; chưa kích hoạt: ACCOUNT_NOT_ACTIVATED; bị Trưởng BQL khóa: FORBIDDEN_ROLE', async () => {
  await assert.rejects(login({ phone: '0999999999', password: PASSWORD }), { errorCode: 'AUTH_INVALID_CREDENTIALS' });

  const pending = await createUser('RESIDENT', { passwordHash: undefined });
  await assert.rejects(login({ phone: pending.phone, password: PASSWORD }), { errorCode: 'ACCOUNT_NOT_ACTIVATED', status: 403 });
  assert.equal((await counters(pending)).count, 0);

  const locked = await activeUser('RESIDENT', { isActive: false });
  await assert.rejects(login({ phone: locked.phone, password: PASSWORD }), { errorCode: 'FORBIDDEN_ROLE' });
});

test('Trưởng BQL mở khóa tài khoản thì gỡ cả khóa tạm do nhập sai (BR-S03)', async () => {
  const manager = asUser(await createManager());
  const user = await activeUser();
  for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) await wrong(user).catch(() => {});
  await assert.rejects(login({ phone: user.phone, password: PASSWORD }), { errorCode: 'ACCOUNT_LOCKED_TEMP' });

  await setStatus(manager, user._id, { isActive: true });

  assert.ok((await login({ phone: user.phone, password: PASSWORD })).accessToken);
});

test('trả danh sách căn đang ở: cư dân 2 căn có đủ mã căn, tòa, vai trò; nhân viên và cư dân đã rời căn thì không', async () => {
  const user = await activeUser();
  const [a1, a2, left] = [await createApartment(null, { code: 'A-1' }), await createApartment(null, { code: 'B-2' }), await createApartment()];
  await linkResident(user, a1, { relationType: 'OWNER' });
  await linkResident(user, a2, { relationType: 'TENANT' });
  await linkResident(user, left, { isActive: false });

  const { apartments } = await login({ phone: user.phone, password: PASSWORD });
  assert.deepEqual(apartments.map((a) => [a.code, a.relationType]).sort(), [['A-1', 'OWNER'], ['B-2', 'TENANT']]);
  assert.ok(apartments.every((a) => a.building && a.apartmentId));

  const staff = await activeUser('STAFF', { roleTitle: 'TECHNICIAN' });
  assert.deepEqual((await login({ phone: staff.phone, password: PASSWORD })).apartments, []);
});

test('API: đăng nhập bằng email không còn nhận; giới hạn theo SĐT chỉ đếm lần thất bại, SĐT khác vẫn đăng nhập được', async () => {
  const user = await activeUser();
  const other = await activeUser();
  const post = (body) => app.request('POST', '/auth/login', { body });

  assert.equal((await post({ email: user.email, password: PASSWORD })).status, 400);
  const ok = await post({ phone: user.phone, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.data.apartments));

  // Đăng nhập thành công liên tục không bị tính vào giới hạn
  for (let i = 0; i < 12; i += 1) assert.equal((await post({ phone: user.phone, password: PASSWORD })).status, 200);

  // Tài khoản có thật: lần sai thứ 5 bị khóa tạm (423); lúc đang khóa không tính vào giới hạn nên không ra 429
  const statuses = [];
  for (let i = 0; i < 12; i += 1) statuses.push((await post({ phone: user.phone, password: 'SaiMatKhau9' })).status);
  assert.equal(statuses[4], 423);
  assert.equal(statuses.includes(429), false);

  // Dò SĐT không có tài khoản: quá 10 lần thất bại thì 429
  let probe;
  for (let i = 0; i < 11; i += 1) probe = await post({ phone: '0999999991', password: 'SaiMatKhau9' });
  assert.equal(probe.status, 429);
  assert.equal((await post({ phone: other.phone, password: PASSWORD })).status, 200);
});
