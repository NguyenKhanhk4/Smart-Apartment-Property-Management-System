import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { Apartment } from '../../src/models/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createBuilding, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { startApp, USERS } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('lookup căn hộ lọc đồng thời tòa, tầng và mã trước giới hạn 20 kết quả', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const a = await createBuilding({ code: 'A', totalFloors: 3 });
  const b = await createBuilding({ code: 'B', totalFloors: 2 });
  await Apartment.insertMany(Array.from({ length: 21 }, (_, index) => ({
    buildingId: a._id, code: `A1${String(index).padStart(2, '0')}`, floor: 1, area: 70,
  })));
  const a201 = await createApartment(a, { code: 'A201', floor: 2 });
  await createApartment(a, { code: 'A202', floor: 2 });
  await createApartment(a, { code: 'A301', floor: 3 });
  await createApartment(b, { code: 'B201', floor: 2 });
  const query = (suffix) => app.request('GET', `/lookups/apartments${suffix}`, { user: USERS.manager });
  const floor = await query(`?buildingId=${a.id}&floor=2`);
  assert.equal(floor.status, 200);
  assert.deepEqual(floor.body.data.map((row) => row.code), ['A201', 'A202']);
  const search = await query(`?buildingId=${a.id}&floor=2&q=201`);
  assert.deepEqual(search.body.data.map((row) => row._id), [a201.id]);
  const crossBuilding = await query('?floor=2');
  assert.deepEqual(crossBuilding.body.data.map((row) => row.code), ['A201', 'A202', 'B201']);
  assert.equal((await query('')).body.data.length, 20);
  assert.deepEqual((await query(`?buildingId=${b.id}&floor=1`)).body.data, []);
  for (const invalid of ['0', '-1', '1.5', 'abc']) assert.equal((await query(`?floor=${invalid}`)).status, 400);
});

test('lọc tòa/tầng không mở rộng quyền lookup căn hộ của cư dân', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const building = await createBuilding({ totalFloors: 2 });
  const own = await createApartment(building, { code: 'A201', floor: 2 });
  await createApartment(building, { code: 'A202', floor: 2 });
  const otherBuilding = await createBuilding();
  const other = await createApartment(otherBuilding, { code: 'B201', floor: 2 });
  const resident = await createResidentUser();
  await linkResident(resident, own);
  const result = await app.request('GET', `/lookups/apartments?buildingId=${building.id}&floor=2`, { user: asUser(resident) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map((row) => row._id), [own.id]);
  const denied = await app.request('GET', `/lookups/apartments?buildingId=${otherBuilding.id}&floor=2&q=${other.code}`, { user: asUser(resident) });
  assert.equal(denied.status, 200);
  assert.deepEqual(denied.body.data, []);
});
