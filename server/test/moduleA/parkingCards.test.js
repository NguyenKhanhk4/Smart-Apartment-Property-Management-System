// Thẻ gửi xe bị vô hiệu khi hợp đồng chấm dứt / hết hạn phải có audit PARKING_CARD_DISABLED.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, ParkingCard } from '../../src/models/index.js';
import { disableActiveCardsByApartment } from '../../src/modules/parkingCards/parkingCards.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createReceptionist } from '../helpers/fixtures.js';
import { createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('disableActiveCardsByApartment: chuyển thẻ ACTIVE sang cần thu hồi và ghi audit từng thẻ', async () => {
  const { user, apartment } = await createHousehold();
  const vehicle = await createVehicle({ apartment, registeredBy: user, status: 'APPROVED' });
  const card = await createParkingCard({ vehicle });
  await createParkingCard({ vehicle, status: 'RETURNED' });
  const receptionist = asUser(await createReceptionist());

  assert.equal(await disableActiveCardsByApartment(apartment._id, null, null, receptionist), 1);
  assert.equal((await ParkingCard.findById(card._id)).status, 'DISABLED_TO_COLLECT');
  const logs = await AuditLog.find({ action: 'PARKING_CARD_DISABLED' }).lean();
  assert.equal(logs.length, 1);
  assert.equal(String(logs[0].targetId), String(card._id));
  assert.equal(logs[0].targetType, 'parking_cards');
});
