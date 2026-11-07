// Xung đột dữ liệu (trùng mã / biển số) trả 409 với mã riêng, không phải 400 VALIDATION_ERROR.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuilding } from '../../src/modules/buildings/buildings.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('createBuilding: trùng mã / tên → 409 DUPLICATE_VALUE', async () => {
  const manager = asUser(await createManager());
  await createBuilding({ code: 'A', name: 'Tòa A', totalFloors: 10 }, manager);
  await assert.rejects(createBuilding({ code: 'a', name: 'Khác', totalFloors: 10 }, manager), { errorCode: 'DUPLICATE_VALUE', status: 409 });
  await assert.rejects(createBuilding({ code: 'B', name: 'Tòa A', totalFloors: 10 }, manager), { errorCode: 'DUPLICATE_VALUE' });
});
