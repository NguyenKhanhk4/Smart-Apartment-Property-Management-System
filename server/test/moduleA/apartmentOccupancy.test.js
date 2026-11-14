import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Contract } from '../../src/models/index.js';
import { endTenancy } from '../../src/modules/residents/residentTenancies.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createBuilding, createManager, createReceptionist, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app?.close();
  await closeTestDB();
});

test('UC13: tạo block, bàn giao, đổi trạng thái và xem sơ đồ theo tầng', async () => {
  const manager = asUser(await createManager());
  const receptionist = asUser(await createReceptionist());
  const building = await createBuilding({ totalFloors: 3 });
  const blocksPath = `/buildings/${building._id}/blocks`;
  const blockBody = { code: 'a', name: 'Block A' };
  assert.equal((await app.request('POST', blocksPath, { user: receptionist, body: blockBody })).status, 403);
  const block = await app.request('POST', blocksPath, { user: manager, body: blockBody });
  assert.equal(block.status, 201, JSON.stringify(block.body));
  const blockId = block.body.data._id;
  assert.equal((await app.request('POST', blocksPath, { user: manager, body: blockBody })).status, 409);
  const renamed = await app.request('PUT', `${blocksPath}/${blockId}`, {
    user: manager, body: { code: 'A', name: 'Block A mới' },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));

  const properties = {
    buildingId: String(building._id), blockId, floor: 2, code: 'A-201',
    type: 'RESIDENTIAL', grossArea: 75, netArea: 68, technicalShaft: 'Hành lang',
    sourceReference: 'MB-A-201', reason: 'Bổ sung theo hồ sơ tòa cũ',
  };
  const otherBuilding = await createBuilding({ totalFloors: 3 });
  const foreignBlock = await app.request('POST', '/apartments', {
    user: manager, body: { ...properties, buildingId: String(otherBuilding._id) },
  });
  assert.equal(foreignBlock.status, 400, JSON.stringify(foreignBlock.body));
  const invalidDate = await app.request('POST', '/apartments', {
    user: manager, body: { ...properties, handoverDate: '2026-02-30' },
  });
  assert.equal(invalidDate.status, 400, JSON.stringify(invalidDate.body));

  const created = await app.request('POST', '/apartments', { user: manager, body: properties });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.occupancyStatus, 'NOT_HANDED_OVER');
  assert.equal(created.body.data.area, 68);
  const path = `/apartments/${created.body.data._id}`;
  const repair = { status: 'UNDER_REPAIR', reason: 'Sửa hộp kỹ thuật' };
  assert.equal((await app.request('PATCH', `${path}/occupancy-status`, { user: manager, body: repair })).status, 409);

  const handedOver = await app.request('PUT', path, { user: manager, body: { handoverDate: '2025-07-01' } });
  assert.equal(handedOver.status, 200, JSON.stringify(handedOver.body));
  assert.equal(handedOver.body.data.handoverDate, '2025-06-30T17:00:00.000Z');
  assert.equal(handedOver.body.data.occupancyStatus, 'VACANT');
  assert.equal((await app.request('PATCH', `${path}/occupancy-status`, { user: receptionist, body: repair })).status, 403);
  assert.equal((await app.request('PATCH', `${path}/occupancy-status`, {
    user: manager, body: { ...repair, reason: ' ' },
  })).status, 400);
  const changed = await app.request('PATCH', `${path}/occupancy-status`, { user: manager, body: repair });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.data.status, 'VACANT');
  assert.equal(changed.body.data.occupancyStatus, 'UNDER_REPAIR');
  const audit = await AuditLog.findOne({ targetId: created.body.data._id, 'metadata.action': 'SET_OCCUPANCY_STATUS' });
  assert.equal(audit.metadata.reason, repair.reason);
  assert.equal(String(audit.performedBy), manager.id);
  assert.deepEqual(audit.metadata.changes.occupancyStatus, { from: 'VACANT', to: 'UNDER_REPAIR' });

  const floorPlan = await app.request('GET', `/buildings/${building._id}/floor-plan?floor=2&blockId=${blockId}`, {
    user: receptionist,
  });
  assert.equal(floorPlan.status, 200, JSON.stringify(floorPlan.body));
  assert.deepEqual(floorPlan.body.data.map(({ code, occupancyStatus }) => [code, occupancyStatus]), [['A-201', 'UNDER_REPAIR']]);
});

test('UC13: căn cũ thiếu ngày bàn giao giữ dữ liệu gốc khi cập nhật thuộc tính', async () => {
  const manager = asUser(await createManager());
  const building = await createBuilding({ totalFloors: 3 });
  const legacy = await createApartment(building, { floor: 2, area: 70 });
  const result = await app.request('PUT', `/apartments/${legacy._id}`, {
    user: manager, body: { technicalShaft: 'Ghi chú đối chiếu căn cũ', handoverDate: null },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.area, 70);
  assert.equal(result.body.data.status, 'OWNED');
  assert.equal(result.body.data.handoverDate, undefined);
  assert.equal(result.body.data.occupancyStatus, undefined);
});

test('UC13: Lễ tân xác nhận vào ở, trạng thái tự động thắng điều chỉnh thủ công', async () => {
  const manager = asUser(await createManager());
  const receptionist = asUser(await createReceptionist());
  const apartment = await createApartment(null, {
    handoverDate: new Date('2025-01-01'), status: 'OWNED', occupancyStatus: 'UNDER_REPAIR',
  });
  const owner = await createResidentUser();
  const tenant = await createResidentUser();
  const path = `/apartments/${apartment._id}/confirm-move-in`;
  const request = (user) => app.request('PATCH', path, { user });

  assert.equal((await request(manager)).status, 403);
  assert.equal((await request(receptionist)).status, 409);
  const sale = await Contract.create({
    apartmentId: apartment._id, type: 'SALE', ownerId: owner._id, startDate: new Date('2025-01-01'),
  });
  const ownerResult = await request(receptionist);
  assert.equal(ownerResult.status, 200, JSON.stringify(ownerResult.body));
  assert.equal(ownerResult.body.data.occupancyStatus, 'OWNER_OCCUPIED');
  const audit = await AuditLog.findOne({ targetId: apartment._id, 'metadata.action': 'CONFIRM_MOVE_IN' });
  assert.equal(String(audit.metadata.contractId), String(sale._id));
  assert.equal(String(audit.performedBy), receptionist.id);
  assert.equal(audit.metadata.changes.occupancyStatus.from, 'UNDER_REPAIR');

  const lease = await Contract.create({
    apartmentId: apartment._id, type: 'LEASE', ownerId: owner._id, tenantId: tenant._id,
    startDate: new Date('2099-01-01'), endDate: new Date('2099-12-31'),
  });
  const beforeLease = await request(receptionist);
  assert.equal(beforeLease.status, 200, JSON.stringify(beforeLease.body));
  assert.equal(beforeLease.body.data.occupancyStatus, 'OWNER_OCCUPIED');
  lease.startDate = new Date('2025-01-01');
  await lease.save();
  const tenantResult = await request(receptionist);
  assert.equal(tenantResult.status, 200, JSON.stringify(tenantResult.body));
  assert.equal(tenantResult.body.data.occupancyStatus, 'RENTED');
});

test('UC13: chủ sở hữu kết thúc lượt thuê cũ và cập nhật màu căn hộ', async () => {
  const apartment = await createApartment(null, {
    handoverDate: new Date('2025-01-01'), status: 'RENTED', occupancyStatus: 'UNDER_REPAIR',
  });
  const owner = await createResidentUser();
  const tenant = await createResidentUser();
  const base = { apartmentId: apartment._id, ownerId: owner._id, startDate: new Date('2025-01-01'), status: 'ACTIVE' };
  const sale = await Contract.create({ ...base, type: 'SALE' });
  const lease = await Contract.create({ ...base, type: 'LEASE', tenantId: tenant._id, endDate: new Date('2025-03-01') });
  await linkResident(owner, apartment, { relationType: 'OWNER', contractId: sale._id });

  // Một số hợp đồng cũ chưa có bản ghi Resident tương ứng.
  await endTenancy(asUser(owner), apartment.id, lease.id);
  const updated = await apartment.constructor.findById(apartment._id);
  assert.equal(updated.occupancyStatus, 'VACANT');
  assert.equal(updated.status, 'OWNED');
});
