// GET /parking-cards: kiểm tra phân trang và dữ liệu xe, căn hộ.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as parkingCardService from '../../src/modules/parkingCards/parkingCards.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, createManager } from '../helpers/fixtures.js';
import { createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';
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
