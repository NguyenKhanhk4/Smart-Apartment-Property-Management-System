// Xe: hủy / duyệt đồng thời không ghi đè nhau, không vượt sức chứa bãi (BR-A6).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ParkingCard, SystemConfig, Vehicle } from '../../src/models/index.js';
import * as vehicles from '../../src/modules/vehicles/vehicles.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createReceptionist } from '../helpers/fixtures.js';
import { createVehicle } from '../helpers/fixtures.moduleA.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('requestCancel: xe đang chờ duyệt → hủy ngay', async () => {
  const { user, apartment } = await createHousehold();
  const v = await createVehicle({ apartment, registeredBy: user });
  const res = await vehicles.requestCancel(v._id, asUser(user));
  assert.equal(res.status, 'CANCELLED');
});

test('requestCancel: 2 yêu cầu hủy xe đã duyệt gửi cùng lúc → chỉ 1 thành công', async () => {
  const { user, apartment } = await createHousehold();
  const v = await createVehicle({ apartment, registeredBy: user, status: 'APPROVED' });
  const results = await Promise.allSettled([
    vehicles.requestCancel(v._id, asUser(user)),
    vehicles.requestCancel(v._id, asUser(user)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'STATUS_CONFLICT');
});

test('requestCancel: xe vừa được duyệt (không còn PENDING) không bị hủy thẳng', async () => {
  const { user, apartment } = await createHousehold();
  const v = await createVehicle({ apartment, registeredBy: user, status: 'REJECTED' });
  await assert.rejects(vehicles.requestCancel(v._id, asUser(user)), { errorCode: 'STATUS_CONFLICT' });
  assert.equal((await Vehicle.findById(v._id)).status, 'REJECTED');
});

test('approve: 2 lễ tân duyệt cùng lúc khi bãi còn 1 chỗ → không vượt sức chứa', async () => {
  await SystemConfig.create({ key: 'PARKING_CAPACITY_MOTORBIKE', value: 1, scope: 'BUSINESS' });
  const { user, apartment } = await createHousehold();
  const v1 = await createVehicle({ apartment, registeredBy: user });
  const v2 = await createVehicle({ apartment, registeredBy: user });
  const staff = asUser(await createReceptionist());

  const results = await Promise.allSettled([
    vehicles.approve(v1._id, staff, { cardNumber: 'C001' }),
    vehicles.approve(v2._id, staff, { cardNumber: 'C002' }),
  ]);
  assert.ok(results.some((r) => r.status === 'rejected'));
  assert.ok((await Vehicle.countDocuments({ type: 'MOTORBIKE', status: 'APPROVED' })) <= 1);
  assert.ok((await ParkingCard.countDocuments({ status: 'ACTIVE' })) <= 1);
});
