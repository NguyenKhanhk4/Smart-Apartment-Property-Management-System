import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Resident } from '../../src/models/index.js';
import { migrateResidentHistoryIndex } from '../../src/modules/residents/residentHistoryIndexes.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, linkResident } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('migration: mặc định chỉ xem trước, thay đúng index cũ, giữ dữ liệu và cho phép lịch sử', async () => {
  const { user, apartment } = await createHousehold();
  await Resident.collection.dropIndex('uniq_active_resident');
  await Resident.collection.createIndex({ userId: 1, apartmentId: 1 }, { unique: true });
  const before = await Resident.countDocuments();
  assert.deepEqual((await migrateResidentHistoryIndex()).drop, ['userId_1_apartmentId_1']);
  assert.ok((await Resident.collection.indexes()).some((index) => index.name === 'userId_1_apartmentId_1'));
  await migrateResidentHistoryIndex({ apply: true });
  assert.equal(await Resident.countDocuments(), before);
  const indexes = await Resident.collection.indexes();
  assert.ok(indexes.some((index) => index.name === 'uniq_active_resident'));
  assert.ok(indexes.some((index) => index.name === 'uniq_active_owner'));
  assert.ok(!indexes.some((index) => index.name === 'userId_1_apartmentId_1'));
  await linkResident(user, apartment, { isActive: false });
  await assert.rejects(linkResident(user, apartment), { code: 11000 });
  assert.deepEqual((await migrateResidentHistoryIndex({ apply: true })).drop, []);
});
