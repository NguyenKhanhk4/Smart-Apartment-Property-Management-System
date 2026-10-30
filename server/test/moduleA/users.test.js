// Tài khoản nội bộ: BR-R1/R2 (1 Trưởng BQL, 1 Trưởng BQT đang hoạt động), trùng email 409, không sửa tài khoản ADMIN.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../../src/models/index.js';
import * as users from '../../src/modules/users/users.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createTechnician, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const admin = async () => asUser(await createUser('ADMIN'));

test('createInternal: đã có Trưởng BQL hoạt động → MANAGER_ALREADY_EXISTS', async () => {
  await createManager();
  await assert.rejects(
    users.createInternal(await admin(), { fullName: 'BQL 2', email: 'bql2@test.local', role: 'MANAGER' }),
    { errorCode: 'MANAGER_ALREADY_EXISTS' },
  );
});

test('createInternal: đã có Trưởng BQT hoạt động → 409 CHAIRMAN_ALREADY_EXISTS', async () => {
  await createUser('BOARD', { boardTitle: 'CHAIRMAN' });
  await assert.rejects(
    users.createInternal(await admin(), { fullName: 'BQT', email: 'bqt@test.local', role: 'BOARD', boardTitle: 'CHAIRMAN' }),
    { status: 409, errorCode: 'CHAIRMAN_ALREADY_EXISTS' },
  );
});

test('createInternal: email trùng → 409 EMAIL_EXISTS; email không gửi được thì trả mật khẩu tạm', async () => {
  const a = await admin();
  const res = await users.createInternal(a, { fullName: 'KTV', email: 'ktv@test.local', role: 'STAFF', roleTitle: 'TECHNICIAN' });
  assert.equal(res.emailSent, false);
  assert.ok(res.temporaryPassword);
  await assert.rejects(
    users.createInternal(a, { fullName: 'KTV 2', email: 'KTV@test.local', role: 'STAFF', roleTitle: 'TECHNICIAN' }),
    { errorCode: 'EMAIL_EXISTS', status: 409 },
  );
});

test('updateInternal: không sửa được tài khoản ADMIN khác', async () => {
  const other = await createUser('ADMIN');
  await assert.rejects(users.updateInternal(await admin(), other._id, { role: 'STAFF', roleTitle: 'TECHNICIAN' }), {
    errorCode: 'FORBIDDEN_ROLE',
  });
});

test('updateInternal: đổi vai trò thì thu hồi phiên cũ (tokenVersion tăng)', async () => {
  const tech = await createTechnician();
  await users.updateInternal(await admin(), tech._id, { roleTitle: 'SECURITY' });
  const after = await User.findById(tech._id).select('+tokenVersion');
  assert.equal(after.roleTitle, 'SECURITY');
  assert.equal(after.tokenVersion, 1);
});

test('setStatus: mở khóa Trưởng BQL thứ 2 → MANAGER_ALREADY_EXISTS', async () => {
  await createManager();
  const locked = await createUser('MANAGER', { isActive: false });
  await assert.rejects(users.setStatus(await admin(), locked._id, { isActive: true }), { errorCode: 'MANAGER_ALREADY_EXISTS' });
});
