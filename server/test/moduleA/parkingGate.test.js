import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { ParkingCard, ParkingSession, Resident, Vehicle } from '../../src/models/index.js';
import { calculateGuestFee } from '../../src/modules/parkingGate/parkingFees.js';
import { admitGuest, completeGuestExit, quoteGuestExit } from '../../src/modules/parkingGate/parkingGate.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createSecurity } from '../helpers/fixtures.js';
import { revokeDepartedResidentServices } from '../../src/modules/residents/residentExit.service.js';
import { createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';
import { startApp, USERS } from '../helpers/http.js';

const vnTime = (time, day = '2026-11-08') => new Date(`${day}T${time}:00+07:00`);

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('phí xe khách theo loại xe và các mốc giờ Việt Nam đã chốt', () => {
  assert.equal(calculateGuestFee('CAR', vnTime('16:30'), vnTime('17:55')), 40000);
  assert.equal(calculateGuestFee('CAR', vnTime('16:30'), vnTime('18:00')), 80000);
  assert.equal(calculateGuestFee('CAR', vnTime('22:00'), vnTime('05:59', '2026-11-09')), 40000);
  assert.equal(calculateGuestFee('MOTORBIKE', vnTime('06:00'), vnTime('10:00')), 5000);
  assert.equal(calculateGuestFee('MOTORBIKE', vnTime('18:00'), vnTime('19:00')), 15000);
  assert.equal(calculateGuestFee('ELECTRIC_BICYCLE', vnTime('06:00'), vnTime('10:00')), 5000);
  assert.equal(calculateGuestFee('ELECTRIC_BICYCLE', vnTime('02:00'), vnTime('05:59')), 15000);
  assert.equal(calculateGuestFee('BICYCLE', vnTime('06:00'), vnTime('10:00')), 3000);
  assert.equal(calculateGuestFee('BICYCLE', vnTime('18:00'), vnTime('19:00')), 8000);
});

test('các lượt ngoài quy tắc đã chốt trả lỗi rõ ràng', () => {
  const missingTariff = { errorCode: 'PARKING_TARIFF_UNDEFINED' };
  assert.throws(() => calculateGuestFee('CAR', vnTime('22:00'), vnTime('06:00', '2026-11-09')), missingTariff);
  assert.throws(() => calculateGuestFee('CAR', vnTime('16:30'), vnTime('17:00', '2026-11-09')), missingTariff);
  assert.throws(() => calculateGuestFee('BICYCLE', vnTime('16:30'), vnTime('18:00')), missingTariff);
});

test('API quẹt thẻ cư dân và ghi lịch sử áp dụng đúng phân quyền', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const guard = asUser(await createSecurity());
  const { user, apartment } = await createHousehold();
  const vehicle = await createVehicle({ apartment, registeredBy: user, status: 'APPROVED' });
  const card = await createParkingCard({ vehicle });
  const body = { direction: 'IN', cardNumber: card.cardNumber.toLowerCase(), plateNumber: vehicle.plateNumber.toLowerCase() };
  const swipe = (actor, input = body) => app.request('POST', '/parking-gate/resident', { user: actor, body: input });

  assert.equal((await swipe(USERS.manager)).status, 403);
  assert.equal((await swipe(guard, { ...body, plateNumber: '51A11111' })).status, 400);
  await Vehicle.updateOne({ _id: vehicle._id }, { status: 'PENDING' });
  assert.equal((await swipe(guard)).status, 400);
  await Vehicle.updateOne({ _id: vehicle._id }, { status: 'APPROVED' });
  assert.equal(await ParkingSession.countDocuments(), 0);

  const entry = await swipe(guard);
  assert.equal(entry.status, 200);
  assert.equal(entry.body.data.exitedAt, null);
  assert.equal((await swipe(guard)).status, 409);
  const exit = await swipe(guard, { ...body, direction: 'OUT' });
  assert.equal(exit.status, 200);
  assert.equal(exit.body.data._id, entry.body.data._id);
  assert.ok(exit.body.data.exitedAt);
  await ParkingCard.updateOne({ _id: card._id }, { status: 'DISABLED_TO_COLLECT' });
  assert.equal((await swipe(guard)).status, 400);

  const path = `/parking-gate/history?plate=${vehicle.plateNumber}`;
  const history = await app.request('GET', path, { user: USERS.manager });
  assert.equal(history.status, 200);
  assert.equal(history.body.data.length, 1);
  assert.equal((await app.request('GET', path, { user: USERS.resident })).status, 403);
  const lookup = await app.request('GET', `/parking-gate/lookup?plate=${vehicle.plateNumber}`, { user: USERS.manager });
  assert.equal(lookup.body.data.residentVehicle._id, String(vehicle._id));
});

test('thẻ cư dân cấp độc lập, dùng cùng mã cho xe đã duyệt và giữ lượt gửi khi cấp lại', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const guard = asUser(await createSecurity());
  const { user, apartment } = await createHousehold();
  const resident = await Resident.findOne({ userId: user._id, apartmentId: apartment._id });
  const vehicle = await createVehicle({ apartment, registeredBy: user, status: 'APPROVED' });
  const legacy = await createParkingCard({ vehicle });
  const issue = (cardNumber, replacesId, actor = USERS.manager) => app.request('POST', '/parking-cards', {
    user: actor, body: { residentId: resident.id, cardNumber, replacesId },
  });
  const handOver = (id, actor = USERS.receptionist) => app.request('PATCH', '/parking-cards/' + id + '/handover', { user: actor });
  const swipe = (cardNumber, direction = 'IN') => app.request('POST', '/parking-gate/resident', {
    user: guard, body: { cardNumber, direction, plateNumber: vehicle.plateNumber },
  });

  assert.equal((await issue('CD-01', undefined, USERS.receptionist)).status, 403);
  const first = await issue('cd-01');
  assert.equal(first.status, 200);
  const card = first.body.data;
  assert.equal(card.cardNumber, 'CD-01');
  assert.equal(card.vehicleId, null);
  assert.equal((await issue('CD-02')).status, 409);
  assert.equal((await handOver(card._id, USERS.manager)).status, 403);
  assert.equal((await swipe('CD-01')).status, 400);
  const entry = await swipe(legacy.cardNumber);
  assert.equal(entry.status, 200);
  assert.equal((await handOver(card._id)).status, 200);
  assert.equal((await swipe(legacy.cardNumber, 'OUT')).status, 400);

  const list = await app.request('GET', '/parking-cards?status=ACTIVE', { user: USERS.manager });
  assert.equal(list.body.data[0].elevatorAllowed, true);
  assert.equal(list.body.data[0].parkingVehicleCount, 1);

  const exit = await swipe('CD-01', 'OUT');
  assert.equal(exit.status, 200);
  assert.equal(exit.body.data._id, entry.body.data._id);
  assert.equal(exit.body.data.cardNumber, legacy.cardNumber);

  await Vehicle.updateOne({ _id: vehicle._id }, { status: 'CANCELLED' });
  assert.equal((await swipe('CD-01')).status, 400);
  const afterRemoval = await app.request('GET', '/parking-cards?status=ACTIVE', { user: USERS.manager });
  assert.equal(afterRemoval.body.data[0].elevatorAllowed, true);
  assert.equal(afterRemoval.body.data[0].parkingVehicleCount, 0);
  await Vehicle.updateOne({ _id: vehicle._id }, { status: 'APPROVED' });

  const replacement = await issue('CD-02', card._id);
  assert.equal(replacement.status, 200);
  assert.equal((await swipe('CD-01')).status, 400);
  assert.equal((await handOver(replacement.body.data._id)).status, 200);
  assert.equal((await swipe('CD-02')).status, 200);

  const bikeOne = await createVehicle({ apartment, registeredBy: user, type: 'BICYCLE', plateNumber: null });
  const bikeTwo = await createVehicle({ apartment, registeredBy: user, type: 'BICYCLE', plateNumber: null });
  const approve = (bike, actor) => app.request('PATCH', '/vehicles/' + bike.id + '/approve', { user: actor });
  assert.equal((await approve(bikeOne, USERS.receptionist)).status, 403);
  assert.equal((await approve(bikeOne, USERS.manager)).status, 200);
  assert.equal((await approve(bikeTwo, USERS.manager)).status, 200);
  const passBicycle = (vehicleId) => app.request('POST', '/parking-gate/resident', {
    user: guard, body: { cardNumber: 'CD-02', direction: 'IN', vehicleId },
  });
  const ambiguous = await passBicycle();
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.body.details[0].candidates.length, 2);
  assert.equal((await passBicycle(bikeOne.id)).status, 200);
  assert.equal((await passBicycle(bikeTwo.id)).status, 200);

  await Resident.updateOne({ _id: resident._id }, { isActive: false });
  await revokeDepartedResidentServices({ apartmentId: apartment._id, userIds: [user._id], endedAt: new Date() });
  assert.equal((await ParkingCard.findById(replacement.body.data._id)).status, 'DISABLED_TO_COLLECT');
  assert.equal((await swipe('CD-02')).status, 400);
});

test('khách gửi xe không thể trùng thẻ hoặc thu tiền hai lần, thẻ được dùng lại sau khi đóng lượt', async () => {
  const guard = asUser(await createSecurity());
  const input = { cardNumber: 'GUEST-01', plateNumber: '51A-111.11', vehicleType: 'CAR' };
  const started = await admitGuest(input, guard, vnTime('16:30'));
  await assert.rejects(admitGuest({ ...input, plateNumber: '51A22222' }, guard, vnTime('16:30')), { status: 409 });
  await assert.rejects(admitGuest({ ...input, cardNumber: 'GUEST-02' }, guard, vnTime('16:30')), { status: 409 });
  await assert.rejects(quoteGuestExit({ ...input, plateNumber: '51A22222' }, vnTime('17:55')), { status: 400 });
  const quote = await quoteGuestExit(input, vnTime('17:55'));
  assert.equal(quote.feeAmount, 40000);
  await assert.rejects(completeGuestExit(started._id, { ...input, expectedFee: 40000 }, guard, vnTime('18:00')), {
    errorCode: 'PARKING_FEE_CHANGED',
  });
  const close = () => completeGuestExit(started._id, { ...input, expectedFee: 80000 }, guard, vnTime('18:00'));
  const outcomes = await Promise.allSettled([close(), close()]);
  assert.deepEqual(outcomes.map(({ status }) => status).sort(), ['fulfilled', 'rejected']);
  const stored = await ParkingSession.findById(started._id).lean();
  assert.equal(stored.feeAmount, 80000);
  assert.equal(String(stored.exitedBy), guard.id);
  const next = await admitGuest(input, guard, vnTime('18:01'));
  assert.notEqual(String(next._id), String(started._id));
});

test('API xe khách hỗ trợ xe đạp không biển và giữ mở lượt chưa có quy tắc phí', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const guard = asUser(await createSecurity());
  t.mock.timers.enable({ apis: ['Date'], now: vnTime('12:00') });
  const body = { cardNumber: ' temp-01 ', vehicleType: 'BICYCLE' };
  assert.equal((await app.request('POST', '/parking-gate/guests', { user: USERS.manager, body })).status, 403);
  const entry = await app.request('POST', '/parking-gate/guests', { user: guard, body });
  assert.equal(entry.status, 201);
  assert.equal(entry.body.data.cardNumber, 'TEMP-01');
  assert.equal(entry.body.data.plateNumber, null);
  const lookupBody = { cardNumber: 'TEMP-01' };
  const quote = await app.request('POST', '/parking-gate/guests/quote', { user: guard, body: lookupBody });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.data.feeAmount, 3000);
  const closePath = `/parking-gate/guests/${entry.body.data._id}/close`;
  const payment = { ...lookupBody, expectedFee: 3000 };
  assert.equal((await app.request('POST', closePath, { user: USERS.manager, body: payment })).status, 403);
  assert.equal((await app.request('POST', closePath, { user: guard, body: payment })).status, 200);
  assert.equal((await app.request('POST', closePath, { user: guard, body: payment })).status, 409);
  const started = await admitGuest({ ...body, cardNumber: 'TEMP-02' }, guard, vnTime('16:30'));
  await assert.rejects(completeGuestExit(started._id, { cardNumber: 'TEMP-02', expectedFee: 0 }, guard, vnTime('18:00')), {
    errorCode: 'PARKING_TARIFF_UNDEFINED',
  });
  assert.equal((await ParkingSession.findById(started._id)).exitedAt, null);
});

test('API chấp nhận hai cách nhập biển số và chuẩn hóa chữ hoa cho mã thẻ khách', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const guard = asUser(await createSecurity());
  t.mock.timers.enable({ apis: ['Date'], now: vnTime('12:00') });
  const guest = { cardNumber: ' kh-01 ', plateNumber: '51a-123.45', vehicleType: 'CAR' };
  const admit = (body) => app.request('POST', '/parking-gate/guests', { user: guard, body });

  assert.equal((await admit({ ...guest, cardNumber: 'KH@01' })).status, 400);
  assert.equal((await admit({ ...guest, plateNumber: '51A@12345' })).status, 400);
  assert.equal((await admit({ ...guest, plateNumber: 'ABC' })).status, 400);
  assert.equal(await ParkingSession.countDocuments(), 0);

  const entry = await admit(guest);
  assert.equal(entry.status, 201);
  assert.equal(entry.body.data.cardNumber, 'KH-01');
  assert.equal(entry.body.data.plateNumber, '51A12345');

  const quote = await app.request('POST', '/parking-gate/guests/quote', {
    user: guard, body: { cardNumber: 'kh-01', plateNumber: '51A12345' },
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.data._id, entry.body.data._id);
  const lookup = await app.request('GET', '/parking-gate/lookup?plate=51A-123.45', { user: USERS.manager });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.data.guestSession.cardNumber, 'KH-01');
});
