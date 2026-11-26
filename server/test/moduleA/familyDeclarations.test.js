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


test('chủ hộ sửa thông tin đã khai báo, không thêm người, báo cáo và lịch sử được cập nhật', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user, apartment } = await createHousehold();
  const actor = asUser(user);
  const saved = await app.request('POST', endpoint, {
    user: actor, body: { apartmentId: apartment.id, fullName: 'Nguyễn An', dateOfBirth: '2010-03-04' },
  });
  const memberId = saved.body.data._id;
  const before = await Resident.findById(memberId).lean();
  const residentsBefore = await Resident.countDocuments();
  const usersBefore = await User.countDocuments();
  const patch = (body) => app.request('PATCH', `${endpoint}/${memberId}`, {
    user: actor, body: { apartmentId: apartment.id, ...body },
  });
  const edited = await patch({ fullName: '  Nguyễn An Nhiên  ', dateOfBirth: '2012-04-05' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.fullName, 'Nguyễn An Nhiên');
  assert.equal(edited.body.data.dateOfBirth, '2012-04-04T17:00:00.000Z');
  assert.equal(await Resident.countDocuments(), residentsBefore);
  assert.equal(await User.countDocuments(), usersBefore);
  const after = await Resident.findById(memberId).lean();
  assert.equal(String(after.declaredByResidenceId), String(before.declaredByResidenceId));
  assert.equal(String(after.contractId), String(before.contractId));
  assert.equal(after.userId, null);
  const log = await AuditLog.findOne({ targetId: memberId, action: 'RESIDENT_UPDATED' }).lean();
  assert.equal(String(log.performedBy), user.id);
  assert.deepEqual(log.metadata.changes.fullName, { from: 'Nguyễn An', to: 'Nguyễn An Nhiên' });

  const occupants = await app.request('GET', `/apartments/${apartment.id}/residents`, { user: actor });
  assert.equal(occupants.body.data.find((row) => row._id === memberId).fullName, 'Nguyễn An Nhiên');
  const report = await app.request('GET', '/residents/occupancy', { user: USERS.manager });
  const reportMember = report.body.data.flatMap((building) => building.apartments)
    .find((row) => row._id === apartment.id).residents.find((row) => row._id === memberId);
  assert.equal(reportMember.fullName, 'Nguyễn An Nhiên');
  assert.equal(reportMember.dateOfBirth, '2012-04-04T17:00:00.000Z');

  assert.equal((await patch({ fullName: 'Nguyễn An Nhiên' })).status, 200);
  assert.equal((await Resident.findById(memberId)).dateOfBirth.toISOString(), '2012-04-04T17:00:00.000Z');
  assert.equal(await AuditLog.countDocuments({ targetId: memberId, action: 'RESIDENT_UPDATED' }), 1);
  assert.equal((await patch({ fullName: 'Nguyễn An Nhiên', dateOfBirth: null })).status, 200);
  assert.equal((await Resident.findById(memberId)).dateOfBirth, null);
});

test('sửa thành viên: chặn người khác, căn khác, hồ sơ không do mình khai báo và hồ sơ đã rời', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user: owner, apartment } = await createHousehold();
  const { user: stranger, apartment: otherApartment } = await createHousehold();
  const saved = await app.request('POST', endpoint, {
    user: asUser(owner), body: { apartmentId: apartment.id, fullName: 'Nguyễn An' },
  });
  const id = saved.body.data._id;
  const patch = (user, targetId = id, apartmentId = apartment.id) => app.request('PATCH', `${endpoint}/${targetId}`, {
    user, body: { apartmentId, fullName: 'Sửa không đúng quyền', dateOfBirth: null },
  });
  const family = await createResidentUser();
  const accountMember = await linkResident(family, apartment);
  for (const actor of [asUser(stranger), asUser(family), USERS.manager, USERS.receptionist]) {
    assert.equal((await patch(actor)).status, 403);
  }
  assert.equal((await patch(asUser(stranger), id, otherApartment.id)).status, 404);
  assert.equal((await patch(asUser(owner), accountMember.id)).status, 404);
  const ownerResidence = await Resident.findOne({ apartmentId: apartment.id, userId: owner.id });
  assert.equal((await patch(asUser(owner), ownerResidence.id)).status, 404);
  const unrelated = await Resident.create({ apartmentId: apartment.id, fullName: 'Hồ sơ cũ', relationType: 'FAMILY_MEMBER' });
  assert.equal((await patch(asUser(owner), unrelated.id)).status, 403);
  await Resident.updateOne({ _id: id }, { $set: { isActive: false } });
  assert.equal((await patch(asUser(owner))).status, 404);
  assert.equal((await Resident.findById(id)).fullName, 'Nguyễn An');
  assert.equal(await AuditLog.countDocuments({ action: 'RESIDENT_UPDATED' }), 0);
});

test('sửa thành viên: khách thuê đang ở được sửa; chủ sở hữu không ở và khách đã rời bị chặn', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const apartment = await createApartment(null, { status: 'RENTED' });
  const owner = await createResidentUser();
  const tenant = await createResidentUser();
  await linkResident(owner, apartment, { relationType: 'OWNER' });
  const tenantResidence = await linkResident(tenant, apartment, { relationType: 'TENANT' });
  const saved = await app.request('POST', endpoint, {
    user: asUser(tenant), body: { apartmentId: apartment.id, fullName: 'Con khách thuê' },
  });
  assert.equal(saved.status, 201);
  const path = `${endpoint}/${saved.body.data._id}`;
  const body = { apartmentId: apartment.id, fullName: 'Tên đã cập nhật', dateOfBirth: '2015-09-15' };
  assert.equal((await app.request('PATCH', path, { user: asUser(owner), body })).status, 403);
  assert.equal((await app.request('PATCH', path, { user: asUser(tenant), body })).status, 200);
  await Resident.updateOne({ _id: tenantResidence._id }, { $set: { isActive: false } });
  assert.equal((await app.request('PATCH', path, { user: asUser(tenant), body })).status, 403);
});

test('sửa thông tin: chặn tên trống, thiếu tên, ngày sai và tương lai, không ghi thay đổi dở', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { user, apartment } = await createHousehold();
  const saved = await app.request('POST', endpoint, {
    user: asUser(user), body: { apartmentId: apartment.id, fullName: 'Nguyễn An' },
  });
  const path = `${endpoint}/${saved.body.data._id}`;
  for (const invalid of [
    {}, { fullName: ' ' }, { fullName: 'A' }, { fullName: 'A'.repeat(101) },
    { fullName: 'Nguyễn An', dateOfBirth: '2015-02-30' },
    { fullName: 'Tên không được lưu dở', dateOfBirth: '2999-01-01' },
  ]) {
    const result = await app.request('PATCH', path, { user: asUser(user), body: { apartmentId: apartment.id, ...invalid } });
    assert.equal(result.status, 400, JSON.stringify(result.body));
  }
  assert.equal((await app.request('PATCH', path, { body: { apartmentId: apartment.id, fullName: 'Nguyễn An' } })).status, 401);
  const actual = await Resident.findById(saved.body.data._id);
  assert.equal(actual.fullName, 'Nguyễn An');
  assert.equal(actual.dateOfBirth, null);
  assert.equal(await AuditLog.countDocuments({ action: 'RESIDENT_UPDATED' }), 0);
});
