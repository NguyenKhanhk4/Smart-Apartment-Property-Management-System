import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Apartment, Contract, GatePass, ParkingCard, Resident, User, Vehicle } from '../../src/models/index.js';
import { terminateContract } from '../../src/modules/contracts/contracts.service.js';
import { expireLeases } from '../../src/modules/contracts/contracts.jobs.js';
import { listApartmentResidents, removeMember, updateMember } from '../../src/modules/residents/residents.service.js';
import { linkResident as linkAccount } from '../../src/modules/residents/residentAccounts.js';
import { listResidentChanges, exportResidentChangesExcel } from '../../src/modules/occupantReports/occupantReports.service.js';
import { getBillableVehicles } from '../../src/modules/vehicles/vehicles.queries.js';
import { endOfVnDay, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApp } from '../helpers/http.js';
import { asUser, createApartment, createHousehold, createReceptionist, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createContract, createGatePass, createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';

let app;
before(async () => { await connectTestDB(); app = await startApp(); });
afterEach(clearTestDB);
after(async () => { await app.close(); await closeTestDB(); });

async function leaseFixture(endDate = new Date('2099-12-31T00:00:00+07:00')) {
  const { user: owner, apartment } = await createHousehold();
  const sale = await createContract({ apartment, owner });
  const tenant = await createResidentUser();
  const lease = await createContract({ apartment, owner, type: 'LEASE', tenantId: tenant._id, endDate });
  await linkResident(tenant, apartment, { relationType: 'TENANT', contractId: lease._id });
  const family = await createResidentUser();
  await linkResident(family, apartment, { contractId: lease._id });
  const otherApartment = await createApartment();
  await linkResident(tenant, otherApartment);
  const rows = [];
  for (const [person, apt] of [[owner, apartment], [tenant, apartment], [family, apartment], [tenant, otherApartment]]) {
    const vehicle = await createVehicle({ apartment: apt, registeredBy: person, status: 'APPROVED', approvedAt: new Date('2025-01-01') });
    const card = await createParkingCard({ vehicle });
    const pass = await createGatePass({ apartment: apt, createdBy: person, status: 'APPROVED' });
    rows.push({ vehicle, card, pass });
  }
  await Apartment.updateOne({ _id: apartment._id }, { status: 'RENTED' });
  return { owner, apartment, tenant, family, lease, sale, rows };
}

async function assertRevoked(row, cancelled) {
  assert.equal((await Vehicle.findById(row.vehicle.id)).status, cancelled ? 'CANCELLED' : 'APPROVED');
  assert.equal((await ParkingCard.findById(row.card.id)).status, cancelled ? 'DISABLED_TO_COLLECT' : 'ACTIVE');
  assert.equal((await GatePass.findById(row.pass.id)).status, cancelled ? 'CANCELLED' : 'APPROVED');
}

test('kết thúc thuê: chỉ thu hồi xe/thẻ/đơn của khách thuê và người đi cùng tại đúng căn', async () => {
  const { lease, apartment, tenant, rows } = await leaseFixture();
  await terminateContract(lease.id, asUser(await createReceptionist()));
  await assertRevoked(rows[0], false);
  await assertRevoked(rows[1], true);
  await assertRevoked(rows[2], true);
  await assertRevoked(rows[3], false);
  assert.ok((await Vehicle.findById(rows[1].vehicle.id)).cancelledAt);
  assert.deepEqual((await getBillableVehicles(apartment.id, '2099-01')).map((v) => String(v._id)), [rows[0].vehicle.id]);
  assert.equal((await User.findById(tenant.id)).isActive, true);
});

test('lỗi giữa chừng khi thu hồi: rollback hợp đồng, cư trú và xe cùng transaction', async (t) => {
  const { lease, tenant, rows } = await leaseFixture();
  t.mock.method(ParkingCard, 'updateMany', () => { throw new Error('Lỗi lưu thẻ giả lập'); });
  await assert.rejects(terminateContract(lease.id, asUser(await createReceptionist())), /Lỗi lưu thẻ giả lập/);
  assert.equal((await Contract.findById(lease.id)).status, 'ACTIVE');
  assert.equal((await Resident.findOne({ userId: tenant._id, contractId: lease._id })).isActive, true);
  await assertRevoked(rows[1], false);
});

test('cron hết hạn: dùng hết ngày kết thúc hợp đồng, chạy lại không thay ngày hủy', async () => {
  const endDate = startOfVnDay(new Date(Date.now() - 5 * 86400000));
  const { lease, tenant, rows } = await leaseFixture(endDate);
  assert.equal(await expireLeases(), 1);
  await assertRevoked(rows[0], false);
  await assertRevoked(rows[1], true);
  const ended = endOfVnDay(endDate).getTime();
  assert.equal((await Resident.findOne({ userId: tenant._id, contractId: lease._id })).moveOutDate.getTime(), ended);
  assert.equal((await Vehicle.findById(rows[1].vehicle.id)).cancelledAt.getTime(), ended);
  assert.equal(await expireLeases(), 0);
  assert.equal((await Vehicle.findById(rows[1].vehicle.id)).cancelledAt.getTime(), ended);
});

test('gỡ thành viên: thu hồi đúng dịch vụ và giữ lịch sử, không tác động chủ hộ', async () => {
  const { family, rows } = await leaseFixture();
  const row = await Resident.findOne({ userId: family._id, isActive: true });
  await removeMember(row.id, asUser(await createReceptionist()));
  await assertRevoked(rows[2], true);
  await assertRevoked(rows[0], false);
  assert.equal((await Resident.findById(row.id)).isActive, false);
});

test('nhân khẩu không tài khoản: API thêm nhiều người cùng căn, sửa, xuất Excel và chuyển đi', async () => {
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  const actor = asUser(await createReceptionist());
  const userCount = await User.countDocuments();
  for (const fullName of ['Nguyễn Bé An', 'Nguyễn Bé Bình']) {
    const res = await app.request('POST', '/residents', { user: actor,
      body: { apartmentId: apartment.id, hasAccount: false, fullName, dateOfBirth: '2020-02-03' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.user, null);
    assert.equal(res.body.data.activationInviteSent, null);
    assert.equal(res.body.data.resident.userId, null);
  }
  assert.equal(await User.countDocuments(), userCount);
  const members = await listApartmentResidents(apartment.id, asUser(owner));
  const child = members.find((r) => r.fullName === 'Nguyễn Bé An');
  assert.ok(child.dateOfBirth);
  await updateMember(child._id, { dateOfBirth: '2020-02-04' }, actor);
  assert.equal((await Resident.findById(child._id)).dateOfBirth.toISOString().slice(0, 10), '2020-02-03');
  // parseDateOfBirth lưu 00:00 VN, tương ứng chiều ngày trước theo UTC.
  const exported = await exportResidentChangesExcel({}, actor);
  assert.ok(exported.buffer.byteLength > 0);
  assert.equal((await listResidentChanges({})).filter((r) => r.fullName.startsWith('Nguyễn Bé')).length, 2);
  await removeMember(child._id, actor);
  assert.equal((await listResidentChanges({})).filter((r) => String(r.residentId) === String(child._id)).length, 2);
});

test('quay lại cùng căn: tạo đợt mới, giữ nguyên ngày vào/ra của đợt cũ và chặn hai đợt active', async () => {
  const { user, apartment } = await createHousehold();
  const member = await createResidentUser();
  const entered = new Date(Date.now() - 4 * 86400000);
  const left = new Date(Date.now() - 2 * 86400000);
  const previous = await linkResident(member, apartment, { isActive: false, moveInDate: entered, moveOutDate: left });
  const current = await linkAccount({ userId: member._id, apartmentId: apartment._id, relationType: 'FAMILY_MEMBER' });
  assert.notEqual(current.id, previous.id);
  const old = await Resident.findById(previous.id);
  assert.equal(old.moveInDate.getTime(), entered.getTime());
  assert.equal(old.moveOutDate.getTime(), left.getTime());
  assert.equal(old.isActive, false);
  assert.equal((await listResidentChanges({})).filter((r) => String(r.residentId) === previous.id).length, 2);
  await assert.rejects(linkResident(member, apartment), { code: 11000 });
  assert.equal((await listApartmentResidents(apartment.id, asUser(user))).filter((r) => String(r.userId) === member.id).length, 1);
});

test('nhân khẩu không tài khoản: không được lách để gắn tài khoản hoặc bỏ họ tên', async () => {
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  const actor = asUser(await createReceptionist());
  for (const body of [
    { hasAccount: false },
    { hasAccount: false, fullName: 'Trẻ nhỏ', phone: '0912345678' },
    { hasAccount: false, fullName: 'Trẻ nhỏ', userId: owner.id },
  ]) {
    assert.equal((await app.request('POST', '/residents', { user: actor, body: { apartmentId: apartment.id, ...body } })).status, 400);
  }
  assert.equal(await Resident.countDocuments({ userId: null }), 0);
});

test('thêm tài khoản không email: chờ kích hoạt tại quầy và chỉ trả CCCD đã che', async () => {
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  const actor = asUser(await createReceptionist());
  const res = await app.request('POST', '/residents', {
    user: actor,
    body: { apartmentId: apartment.id, phone: '0912000003', fullName: 'Thành Viên', idNumber: '012345678901' },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { user, resident, activationInviteSent } = res.body.data;
  assert.equal(user.email, null);
  assert.equal(activationInviteSent, false);
  assert.equal(resident.idNumber, '********8901');
  assert.equal(resident.idNumberEnc, undefined);
  assert.equal(resident.idNumberHash, undefined);
});
