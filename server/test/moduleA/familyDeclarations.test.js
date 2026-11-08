import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { AuditLog, Resident, User } from '../../src/models/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createHousehold, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';
import { startApp, USERS } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const endpoint = '/residents/me/family';

test('chủ hộ khai báo tại đúng căn, ban quản lý và UC21 đọc được hồ sơ ngay', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user, apartment: firstApartment, building } = await createHousehold();
  const secondApartment = await createApartment(building);
  const contract = await createContract({ apartment: secondApartment, owner: user });
  await linkResident(user, secondApartment, { relationType: 'OWNER', contractId: contract._id });

  const actor = asUser(user);
  const saved = await app.request('POST', endpoint, {
    user: actor,
    body: { apartmentId: secondApartment._id, fullName: '  Nguyễn An  ' },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.data.fullName, 'Nguyễn An');
  assert.equal(saved.body.data.dateOfBirth, null);
  assert.equal(await User.countDocuments(), 1);

  const member = await Resident.findById(saved.body.data._id).lean();
  assert.equal(member.userId, null);
  assert.equal(member.relationType, 'FAMILY_MEMBER');
  assert.equal(String(member.apartmentId), String(secondApartment._id));
  assert.equal(String(member.contractId), String(contract._id));
  assert.equal(member.isActive, true);
  const head = await Resident.findOne({ apartmentId: secondApartment._id, userId: user._id });
  assert.equal(String(member.declaredByResidenceId), head.id);
  assert.equal(await Resident.countDocuments({ apartmentId: firstApartment._id, relationType: 'FAMILY_MEMBER' }), 0);

  const path = `/apartments/${secondApartment._id}/residents`;
  for (const viewer of [actor, USERS.manager]) {
    const list = await app.request('GET', path, { user: viewer });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.find((row) => row._id === saved.body.data._id)?.fullName, 'Nguyễn An');
  }

  const report = await app.request('GET', '/residents/occupancy', { user: USERS.manager });
  assert.equal(report.status, 200);
  const reportApartment = report.body.data.flatMap((b) => b.apartments).find((a) => a._id === secondApartment.id);
  assert.deepEqual(reportApartment.residents.map((row) => row._id), [head.id, saved.body.data._id]);
  assert.ok(await AuditLog.exists({ targetId: member._id, performedBy: user._id, action: 'RESIDENT_ASSIGNED' }));
});

test('từ chối người không phải chủ hộ đang ở, chủ hộ căn khác và tài khoản nội bộ', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user: owner, apartment, building } = await createHousehold();
  const { user: otherOwner } = await createHousehold();
  const family = await createResidentUser();
  await linkResident(family, apartment);
  const rentedApartment = await createApartment(building, { status: 'RENTED' });
  const tenant = await createResidentUser();
  await linkResident(owner, rentedApartment, { relationType: 'OWNER' });
  await linkResident(tenant, rentedApartment, { relationType: 'TENANT' });

  const attempts = [
    [asUser(family), apartment], [asUser(otherOwner), apartment],
    [asUser(tenant), apartment], [asUser(owner), rentedApartment],
    [USERS.manager, apartment], [USERS.receptionist, apartment],
  ];
  for (const [user, target] of attempts) {
    const result = await app.request('POST', endpoint, {
      user, body: { apartmentId: target._id, fullName: 'Nguyễn An' },
    });
    assert.equal(result.status, 403);
  }
  assert.equal(await Resident.countDocuments({ fullName: 'Nguyễn An' }), 0);
});

test('họ tên bắt buộc, ngày sinh phải hợp lệ khi được cung cấp', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user, apartment } = await createHousehold();
  const declare = (body) => app.request('POST', endpoint, {
    user: asUser(user), body: { apartmentId: apartment._id, ...body },
  });

  assert.equal((await declare({ fullName: '   ' })).status, 400);
  assert.equal((await declare({ fullName: 'Nguyễn An', dateOfBirth: '2000-02-30' })).status, 400);
  assert.equal((await declare({ fullName: 'Nguyễn An', dateOfBirth: '2999-01-01' })).status, 400);
  assert.equal(await Resident.countDocuments({ apartmentId: apartment._id, relationType: 'FAMILY_MEMBER' }), 0);

  const valid = await declare({ fullName: 'Nguyễn An', dateOfBirth: '2000-02-29' });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.data.dateOfBirth, '2000-02-28T17:00:00.000Z');
});
