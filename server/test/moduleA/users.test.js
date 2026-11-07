// Tài khoản nội bộ: BR-R1/R2 (1 Trưởng BQL, 1 Trưởng BQT đang hoạt động), trùng email 409, không tự đổi vai trò.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../../src/models/index.js';
import * as users from '../../src/modules/users/users.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createTechnician, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const manager = async () => asUser(await createManager());

test('createInternal: đã có Trưởng BQL hoạt động → MANAGER_ALREADY_EXISTS', async () => {
  await assert.rejects(
    users.createInternal(await manager(), { fullName: 'BQL 2', email: 'bql2@test.local', phone: '0912000001', role: 'MANAGER' }),
    { errorCode: 'MANAGER_ALREADY_EXISTS' },
  );
});

test('createInternal: đã có Trưởng BQT hoạt động → 409 CHAIRMAN_ALREADY_EXISTS', async () => {
  await createUser('BOARD', { boardTitle: 'CHAIRMAN' });
  await assert.rejects(
    users.createInternal(await manager(), { fullName: 'BQT', email: 'bqt@test.local', phone: '0912000001', role: 'BOARD', boardTitle: 'CHAIRMAN' }),
    { status: 409, errorCode: 'CHAIRMAN_ALREADY_EXISTS' },
  );
});

test('createInternal: email trùng → 409 EMAIL_EXISTS; không tạo và không trả mật khẩu (BR-S02)', async () => {
  const a = await manager();
  const res = await users.createInternal(a, { fullName: 'KTV', email: 'ktv@test.local', phone: '0912000001', role: 'STAFF', roleTitle: 'TECHNICIAN' });
  assert.equal(res.inviteSent, false);
  assert.equal('temporaryPassword' in res, false);
  await assert.rejects(
    users.createInternal(a, { fullName: 'KTV 2', email: 'KTV@test.local', phone: '0912000002', role: 'STAFF', roleTitle: 'TECHNICIAN' }),
    { errorCode: 'EMAIL_EXISTS', status: 409 },
  );
});

test('updateInternal: Trưởng BQL không tự đổi được vai trò của chính mình', async () => {
  const a = await manager();
  await assert.rejects(users.updateInternal(a, a.id, { role: 'STAFF', roleTitle: 'TECHNICIAN' }), {
    errorCode: 'VALIDATION_ERROR',
  });
});

test('updateInternal: đổi vai trò thì thu hồi phiên cũ (tokenVersion tăng)', async () => {
  const tech = await createTechnician();
  await users.updateInternal(await manager(), tech._id, { roleTitle: 'SECURITY' });
  const after = await User.findById(tech._id).select('+tokenVersion');
  assert.equal(after.roleTitle, 'SECURITY');
  assert.equal(after.tokenVersion, 1);
});

test('setStatus: mở khóa Trưởng BQL thứ 2 → MANAGER_ALREADY_EXISTS', async () => {
  const a = await manager();
  const locked = await createUser('MANAGER', { isActive: false });
  await assert.rejects(users.setStatus(a, locked._id, { isActive: true }), { errorCode: 'MANAGER_ALREADY_EXISTS' });
});
