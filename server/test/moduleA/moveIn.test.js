import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { Apartment, AuditLog, Notification, Resident } from '../../src/models/index.js';
import { assertResidentServiceAccess } from '../../src/services/residency.service.js';
import { createBooking } from '../../src/modules/bookings/bookings.service.js';
import { createTicket } from '../../src/modules/tickets/tickets.service.js';
import { registerGuest } from '../../src/modules/guests/guests.service.js';
import { register } from '../../src/modules/vehicles/vehicles.service.js';
import { issueResidentCard, handOverResidentCard } from '../../src/modules/parkingCards/parkingCards.service.js';
import { getMyCodes } from '../../src/modules/memberCodes/memberCodes.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';
import { startApp, USERS } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

async function home() {
  const apartment = await createApartment(null, { status: 'OWNED', occupancyStatus: 'VACANT', handoverDate: new Date('2025-01-01T00:00:00Z') });
  const owner = await createResidentUser();
  const sale = await createContract({ apartment, owner });
  const resident = await linkResident(owner, apartment, { relationType: 'OWNER', contractId: sale.id, moveInDate: new Date('2025-01-01'), moveInStatus: 'PENDING' });
  return { apartment, owner, resident, sale, actor: asUser(owner) };
}

const bodyFor = (apartment) => ({ apartmentId: apartment.id, moveInDate: '2025-01-02' });

test('chưa vào ở: khóa dịch vụ/xe/thẻ/phản ánh và mã tiện ích, vẫn xem căn và thông báo phí', async (t) => {
  const app = await startApp(); t.after(app.close);
  const { apartment, owner, resident, actor } = await home();
  const linked = await app.request('GET', '/residents/me/apartments', { user: actor });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data[0].canUseServices, false);
  assert.equal(linked.body.data[0].canRequestMoveIn, true);
  assert.equal(linked.body.data[0].canDeclareFamily, false);
  assert.equal((await app.request('GET', `/invoices/my?apartmentId=${apartment.id}`, { user: actor })).status, 200);
  assert.deepEqual(await getMyCodes(owner.id), []);
  const directStatus = await app.request('PATCH', `/apartments/${apartment.id}/occupancy-status`, {
    user: USERS.manager, body: { status: 'OWNER_OCCUPIED', reason: 'Đổi trực tiếp thay xác nhận' },
  });
  assert.equal(directStatus.status, 409);
  assert.equal((await Apartment.findById(apartment.id)).occupancyStatus, 'VACANT');
  const attempts = [
    () => register({ apartmentId: apartment.id, type: 'CAR', plateNumber: '30A88026' }, actor),
    () => createTicket(actor, { apartmentId: apartment.id }, []),
    () => registerGuest(actor, { apartmentId: apartment.id, expectedTime: new Date(Date.now() + 3600000) }),
    () => createBooking(actor, { apartmentId: apartment.id }),
    () => issueResidentCard({ residentId: resident.id, cardNumber: 'CD-B201-01' }, USERS.manager),
  ];
  for (const attempt of attempts) await assert.rejects(attempt, (error) => error.status === 403 && /xác nhận vào ở/.test(error.message));
});

test('cư dân thông báo → BQL nhận hàng chờ → ghi nhận ngày thực tế → mở quyền và UC21 có người', async (t) => {
  const app = await startApp(); t.after(app.close);
  const manager = await createManager();
  const { apartment, owner, resident, actor } = await home();
  const report = () => app.request('POST', '/residents/me/move-in', { user: actor, body: bodyFor(apartment) });
  assert.equal((await report()).status, 201);
  const pending = await app.request('GET', '/residents/move-in-requests', { user: asUser(manager) });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.data[0].userId._id, owner.id);
  assert.equal(pending.body.data[0].apartmentId._id, apartment.id);
  assert.equal(await Notification.countDocuments({ userId: manager.id, title: 'Cư dân thông báo bắt đầu ở' }), 1);
  assert.equal((await report()).status, 409);
  await assert.rejects(assertResidentServiceAccess(owner.id, apartment.id), { status: 403 });
  const before = await app.request('GET', '/residents/occupancy', { user: asUser(manager) });
  assert.equal(before.body.data[0].apartments[0].residents.length, 0);
  const confirm = () => app.request('PATCH', `/apartments/${apartment.id}/confirm-move-in`, { user: asUser(manager) });
  assert.equal((await confirm()).status, 200);
  const confirmed = await Resident.findById(resident.id).lean();
  assert.equal(confirmed.moveInStatus, 'CONFIRMED');
  assert.equal(confirmed.moveInDate.toISOString(), '2025-01-01T17:00:00.000Z');
  assert.equal(String(confirmed.moveInConfirmedBy), manager.id);
  assert.equal(confirmed.moveInRequest, undefined);
  await assertResidentServiceAccess(owner.id, apartment.id);
  assert.equal((await confirm()).status, 409);
  const after = await app.request('GET', '/residents/occupancy', { user: asUser(manager) });
  assert.equal(after.body.data[0].apartments[0].residents.length, 1);
  assert.equal((await app.request('GET', '/residents/move-in-requests', { user: asUser(manager) })).body.data.length, 0);
  const card = await issueResidentCard({ residentId: resident.id, cardNumber: 'CD-B201-01' }, asUser(manager));
  assert.equal(card.status, 'ACTIVE');
  assert.ok((await getMyCodes(owner.id)).length);
  assert.equal((await Apartment.findById(apartment.id)).handoverDate.toISOString(), apartment.handoverDate.toISOString());
  assert.ok(await AuditLog.exists({ targetId: apartment.id, performedBy: manager.id, 'metadata.source': 'RESIDENT_REPORT' }));
});

test('chỉ BQL xác nhận: chặn lễ tân, cư dân tự xác nhận, căn khác và ngày không hợp lệ', async (t) => {
  const app = await startApp(); t.after(app.close);
  const { apartment, actor } = await home();
  const outsider = asUser(await createResidentUser());
  const confirmPath = `/apartments/${apartment.id}/confirm-move-in`;
  for (const user of [USERS.receptionist, USERS.security, actor]) {
    assert.equal((await app.request('PATCH', confirmPath, { user, body: bodyFor(apartment) })).status, 403);
  }
  assert.equal((await app.request('POST', '/residents/me/move-in', { user: outsider, body: bodyFor(apartment) })).status, 403);
  for (const user of [actor, USERS.receptionist]) assert.equal((await app.request('GET', '/residents/move-in-requests', { user })).status, 403);
  for (const date of ['2024-12-31', '2025-02-30', '2999-01-01', '2025-99-99']) {
    const response = await app.request('POST', '/residents/me/move-in', { user: actor, body: { apartmentId: apartment.id, moveInDate: date } });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  }
  assert.equal((await Apartment.findById(apartment.id)).occupancyStatus, 'VACANT');
  assert.equal(await AuditLog.countDocuments({ 'metadata.action': 'REQUEST_MOVE_IN' }), 0);
  assert.equal((await app.request('PATCH', confirmPath, { user: USERS.manager, body: { moveInDate: '2025-01-02' } })).status, 200);
  assert.ok(await AuditLog.exists({ targetId: apartment.id, 'metadata.source': 'MANAGER_RECORDED' }));
});

test('bàn giao và hồ sơ hiệu lực là điều kiện; đã cấp thẻ cũ nhưng chưa ở không được bàn giao', async (t) => {
  const app = await startApp(); t.after(app.close);
  const { apartment, actor, resident } = await home();
  await Apartment.updateOne({ _id: apartment.id }, { $unset: { handoverDate: 1 } });
  assert.equal((await app.request('POST', '/residents/me/move-in', { user: actor, body: bodyFor(apartment) })).status, 409);
  await Apartment.updateOne({ _id: apartment.id }, { $set: { handoverDate: apartment.handoverDate } });
  const { ParkingCard } = await import('../../src/models/index.js');
  const card = await ParkingCard.create({ cardNumber: 'CD-OLD', apartmentId: apartment.id, residentId: resident.id });
  await Resident.updateOne({ _id: resident.id }, { parkingCardId: card.id });
  await assert.rejects(handOverResidentCard(card.id, USERS.receptionist), { status: 403 });
});
