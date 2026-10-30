// GET /gate-passes và GET /parking-cards: trước đây luôn 500 do gọi paginate()/paginated() sai.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as gatePassService from '../../src/modules/gatePasses/gatePasses.service.js';
import * as parkingCardService from '../../src/modules/parkingCards/parkingCards.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createManager, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createGatePass, createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';
import { startApp } from '../helpers/http.js';

let app;
before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

test('listGatePasses: Trưởng BQL nhận { items, pagination }, mới nhất theo ngày chuyển lên trước', async () => {
  const { user, apartment } = await createHousehold();
  await createGatePass({ apartment, createdBy: user, scheduledDate: new Date(Date.now() + 86_400_000) });
  await createGatePass({ apartment, createdBy: user, scheduledDate: new Date(Date.now() + 3 * 86_400_000) });
  const manager = asUser(await createManager());

  const { items, pagination } = await gatePassService.listGatePasses(manager, { page: 1, limit: 20 });
  assert.equal(pagination.total, 2);
  assert.equal(items.length, 2);
  assert.ok(items[0].scheduledDate > items[1].scheduledDate);
  assert.equal(items[0].apartmentId.code, apartment.code, 'phải populate căn hộ');
  assert.ok(items[0].createdBy.fullName, 'phải populate người tạo');
});

test('listGatePasses: cư dân chỉ thấy đơn căn mình, chủ hộ có canOwnerConfirm với đơn chờ xác nhận', async () => {
  const { user: owner, apartment } = await createHousehold();
  const tenant = await createResidentUser();
  await linkResident(tenant, apartment, { relationType: 'TENANT' });
  await createGatePass({ apartment, createdBy: tenant, creatorRelation: 'TENANT', status: 'AWAITING_OWNER' });
  const other = await createHousehold();
  await createGatePass({ apartment: other.apartment, createdBy: other.user });

  const ownerView = await gatePassService.listGatePasses(asUser(owner), { page: 1, limit: 20 });
  assert.equal(ownerView.items.length, 1);
  assert.equal(ownerView.items[0].canOwnerConfirm, true);

  const tenantView = await gatePassService.listGatePasses(asUser(tenant), { page: 1, limit: 20 });
  assert.equal(tenantView.items[0].canOwnerConfirm, false);
});

test('GET /gate-passes trả 200 + pagination', async () => {
  const { user, apartment } = await createHousehold();
  await createGatePass({ apartment, createdBy: user });
  const manager = await createManager();
  const res = await app.request('GET', '/gate-passes', { user: { id: String(manager._id), role: 'MANAGER' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.pagination.total, 1);
});

test('listParkingCards + GET /parking-cards trả 200, populate xe và căn hộ', async () => {
  const { user, apartment } = await createHousehold();
  const vehicle = await createVehicle({ apartment, registeredBy: user, status: 'APPROVED' });
  await createParkingCard({ vehicle });

  const { items, pagination } = await parkingCardService.listParkingCards({ page: 1, limit: 20 });
  assert.equal(pagination.total, 1);
  assert.equal(items[0].vehicleId.plateNumber, vehicle.plateNumber);
  assert.equal(items[0].apartmentId.code, apartment.code);

  const manager = await createManager();
  const res = await app.request('GET', '/parking-cards', { user: { id: String(manager._id), role: 'MANAGER' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.pagination.total, 1);
});
