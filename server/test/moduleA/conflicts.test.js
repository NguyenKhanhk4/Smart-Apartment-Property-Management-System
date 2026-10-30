// Xung đột dữ liệu (trùng email / mã / biển số) trả 409 với mã riêng, không phải 400 VALIDATION_ERROR.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/modules/auth/auth.service.js';
import { createBuilding } from '../../src/modules/buildings/buildings.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('register: email đã dùng → 409 EMAIL_EXISTS, có lỗi theo field', async () => {
  await register({ fullName: 'A', email: 'a@test.local', password: 'Abc12345' });
  await assert.rejects(register({ fullName: 'B', email: 'A@test.local', password: 'Abc12345' }), (err) => {
    assert.equal(err.errorCode, 'EMAIL_EXISTS');
    assert.equal(err.status, 409);
    assert.equal(err.details?.[0]?.field, 'email');
    return true;
  });
});

test('createBuilding: trùng mã / tên → 409 DUPLICATE_VALUE', async () => {
  const admin = asUser(await createUser('ADMIN'));
  await createBuilding({ code: 'A', name: 'Tòa A', totalFloors: 10 }, admin);
  await assert.rejects(createBuilding({ code: 'a', name: 'Khác', totalFloors: 10 }, admin), { errorCode: 'DUPLICATE_VALUE', status: 409 });
  await assert.rejects(createBuilding({ code: 'B', name: 'Tòa A', totalFloors: 10 }, admin), { errorCode: 'DUPLICATE_VALUE' });
});
