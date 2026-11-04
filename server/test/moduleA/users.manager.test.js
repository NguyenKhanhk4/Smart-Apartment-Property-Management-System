// N2: MANAGER quản trị tài khoản, không tự đổi vai trò; script thay Trưởng BQL.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { setManager } from '../../scripts/set-manager.js';
import { AuditLog, User } from '../../src/models/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
const patch = (actor, id, body) => app.request('PATCH', `/users/internal/${id}`, { user: asUser(actor), body });
const createAccountant = () => createUser('ACCOUNTANT');

before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

test('MANAGER gọi được các API quản trị; role khác 403', async () => {
  const manager = asUser(await createManager());
  const accountant = asUser(await createAccountant());

  for (const url of ['/users/internal', '/system-dashboard', '/system-configs']) {
    assert.equal((await app.request('GET', url, { user: manager })).status, 200, url);
    assert.equal((await app.request('GET', url, { user: accountant })).status, 403, url);
  }
});

test('không tự đổi được vai trò của chính mình, vẫn sửa được thông tin khác', async () => {
  const manager = await createManager();

  assert.equal((await patch(manager, manager._id, { role: 'ACCOUNTANT' })).status, 400);
  assert.equal((await patch(manager, manager._id, { fullName: 'Tên Mới' })).status, 200);

  const saved = await User.findById(manager._id).lean();
  assert.equal(saved.role, 'MANAGER');
  assert.equal(saved.fullName, 'Tên Mới');
});

test('vẫn đổi được vai trò của nhân viên khác', async () => {
  const manager = await createManager();
  const staff = await createAccountant();

  assert.equal((await patch(manager, staff._id, { role: 'STAFF', roleTitle: 'SECURITY' })).status, 200);
});

test('setManager: tạo Trưởng BQL mới, đăng nhập được, có ghi Audit Log', async () => {
  const { user, lockedCount } = await setManager({
    phone: '+84901234567',
    email: ' Moi@Test.Local ',
    fullName: 'Trưởng BQL Mới',
    password: 'MatKhau123',
  });

  assert.equal(user.phone, '0901234567');
  assert.equal(user.email, 'moi@test.local');
  assert.ok(user.activatedAt instanceof Date);
  assert.equal(lockedCount, 0);
  const saved = await User.findById(user._id).select('+passwordHash').lean();
  assert.equal(await bcrypt.compare('MatKhau123', saved.passwordHash), true);
  assert.ok(await AuditLog.exists({ action: 'ROLE_ASSIGNED', targetId: user._id }));
});

test('setManager: khóa Trưởng BQL cũ, thu hồi phiên của họ', async () => {
  const oldManager = await createManager();

  const { lockedCount } = await setManager({
    phone: '0901234567',
    email: 'moi@test.local',
    fullName: 'Mới',
    password: 'MatKhau123',
  });

  assert.equal(lockedCount, 1);
  const oldManagerNow = await User.findById(oldManager._id).select('+tokenVersion').lean();
  assert.equal(oldManagerNow.isActive, false);
  assert.equal(oldManagerNow.tokenVersion, 1);
});

test('setManager: nâng nhân viên có sẵn lên, giữ mật khẩu nếu không truyền, xóa chức danh cũ', async () => {
  const staff = await createUser('STAFF', { roleTitle: 'SECURITY', phone: '0901234567' });

  const { user } = await setManager({ phone: '0901234567' });

  assert.equal(String(user._id), String(staff._id));
  assert.equal(user.role, 'MANAGER');
  assert.equal(user.roleTitle, null);
  assert.equal(user.passwordHash, 'x');
});

test('setManager: chạy lại với cùng người không khóa chính họ', async () => {
  await setManager({ phone: '0901234567', email: 'moi@test.local', fullName: 'Mới', password: 'MatKhau123' });

  const { user, lockedCount } = await setManager({ phone: '0901234567' });

  assert.equal(lockedCount, 0);
  assert.equal(user.isActive, true);
});

test('setManager: từ chối cư dân, thiếu thông tin khi tạo mới, mật khẩu yếu; không khóa ai khi lỗi', async () => {
  const manager = await createManager();
  await createUser('RESIDENT', { phone: '0901111111' });

  await assert.rejects(setManager({}), /--phone/);
  await assert.rejects(setManager({ phone: '0901111111' }), /cư dân/);
  await assert.rejects(setManager({ phone: '0902222222', fullName: 'Mới' }), /MANAGER_PASSWORD/);
  await assert.rejects(setManager({ phone: '0902222222', fullName: 'Mới', password: 'ngan' }), /Mật khẩu/);

  assert.equal((await User.findById(manager._id).lean()).isActive, true);
});
