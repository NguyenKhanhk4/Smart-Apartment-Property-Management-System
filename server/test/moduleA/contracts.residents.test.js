// Hợp đồng & thành viên căn hộ: ngày theo giờ VN, xung đột 409, cập nhật có điều kiện, không lộ mật khẩu.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Contract, Notification, Resident, User } from '../../src/models/index.js';
import * as contracts from '../../src/modules/contracts/contracts.service.js';
import { remindExpiringLeases } from '../../src/modules/contracts/contracts.jobs.js';
import { getPayer } from '../../src/modules/contracts/contracts.queries.js';
import * as residents from '../../src/modules/residents/residents.service.js';
import { tempPasswordForResponse } from '../../src/modules/residents/residentAccounts.js';
import { periodStart } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager, createReceptionist, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const DAY = 86_400_000;

async function saleWithOwner() {
  const apartment = await createApartment(null, { status: 'OWNED' });
  const owner = await createResidentUser();
  const contract = await createContract({ apartment, owner });
  await linkResident(owner, apartment, { relationType: 'OWNER', contractId: contract._id });
  return { apartment, owner, contract };
}

test('createContract: ngày "YYYY-MM-DD" lưu 00:00 giờ VN → hóa đơn tháng bắt đầu ngày 1 tìm được người nộp', async () => {
  const receptionist = asUser(await createReceptionist());
  const apartment = await createApartment(null, { status: 'VACANT' });
  const { contract } = await contracts.createContract(receptionist, {
    apartmentId: apartment._id,
    type: 'SALE',
    startDate: new Date('2026-11-01'), // Joi.date() parse "2026-11-01" thành 00:00 UTC (07:00 VN)
    owner: { email: 'new-owner@test.local', phone: '0912000001', fullName: 'Chủ Mới' },
  });
  assert.equal(contract.startDate.toISOString(), '2026-10-31T17:00:00.000Z');
  const payer = await getPayer(apartment._id, periodStart('2026-11'));
  assert.ok(payer, 'phải có người nộp phí cho kỳ 2026-11');
});

test('createContract: căn đã có hợp đồng mua bán hiệu lực → 409 CONTRACT_ACTIVE_EXISTS', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  await assert.rejects(
    contracts.createContract(receptionist, {
      apartmentId: apartment._id,
      type: 'SALE',
      startDate: new Date('2026-11-01'),
      owner: { email: 'x@test.local', phone: '0912000002', fullName: 'X' },
    }),
    { errorCode: 'CONTRACT_ACTIVE_EXISTS', status: 409 },
  );
});

test('createContract: SĐT của tài khoản nội bộ → 409 PHONE_EXISTS', async () => {
  const receptionist = asUser(await createReceptionist());
  const manager = await createManager();
  const apartment = await createApartment(null, { status: 'VACANT' });
  await assert.rejects(
    contracts.createContract(receptionist, {
      apartmentId: apartment._id,
      type: 'SALE',
      startDate: new Date('2026-11-01'),
      owner: { phone: manager.phone, fullName: 'X' },
    }),
    { errorCode: 'PHONE_EXISTS', status: 409 },
  );
});

test('updateContract: hợp đồng đã chấm dứt → 409 STATUS_CONFLICT, không ghi đè', async () => {
  const receptionist = asUser(await createReceptionist());
  const { contract } = await saleWithOwner();
  await Contract.updateOne({ _id: contract._id }, { status: 'TERMINATED' });
  await assert.rejects(contracts.updateContract(contract._id, { endDate: '2030-01-01' }, null, receptionist), {
    errorCode: 'STATUS_CONFLICT',
  });
  assert.equal((await Contract.findById(contract._id)).endDate, null);
});

test('addMember: response không chứa passwordHash / tokenVersion; email lỗi thì trả mật khẩu tạm', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  const res = await residents.addMember(receptionist, {
    apartmentId: apartment._id,
    email: 'member@test.local',
    phone: '0912000003',
    fullName: 'Thành Viên',
  });
  const json = JSON.parse(JSON.stringify(res));
  assert.equal(json.user.passwordHash, undefined);
  assert.equal(json.user.tokenVersion, undefined);
  assert.equal(json.user.email, 'member@test.local');
  // SMTP chưa cấu hình trong test → email không gửi được → lễ tân cần mật khẩu để báo trực tiếp
  assert.match(res.temporaryPassword, /^[A-Za-z0-9]{10}$/);
});

test('createContract: SĐT đã có tài khoản mà chưa xác nhận → 409, không tạo gì; không báo gì cho người đó', async () => {
  const receptionist = asUser(await createReceptionist());
  const stranger = await createResidentUser();
  const apartment = await createApartment(null, { status: 'VACANT' });

  await assert.rejects(
    contracts.createContract(receptionist, {
      apartmentId: apartment._id,
      type: 'SALE',
      startDate: new Date('2026-11-01'),
      owner: { phone: stranger.phone, email: 'chu.that@example.com', fullName: 'Chủ Thật', idNumber: '001200000001' },
    }),
    { errorCode: 'ACCOUNT_CONFIRM_REQUIRED', status: 409 },
  );

  assert.equal(await Contract.countDocuments(), 0);
  assert.equal(await Resident.countDocuments({ userId: stranger._id }), 0);
  assert.equal(await Notification.countDocuments({ userId: stranger._id }), 0);
  assert.equal(await User.countDocuments({ email: 'chu.that@example.com' }), 0);
});

test('createContract: đã xác nhận (userId + SĐT khớp) → gắn đúng tài khoản, không ghi đè họ tên, email, ngày sinh', async () => {
  const receptionist = asUser(await createReceptionist());
  const owner = await createResidentUser({ dateOfBirth: new Date('1990-01-01') });
  const apartment = await createApartment(null, { status: 'VACANT' });

  const { contract } = await contracts.createContract(receptionist, {
    apartmentId: apartment._id,
    type: 'SALE',
    startDate: new Date('2026-11-01'),
    owner: { userId: String(owner._id), phone: owner.phone, fullName: 'Tên Khác', email: 'khac@example.com', dateOfBirth: '2001-02-03' },
  });

  assert.equal(String(contract.ownerId), String(owner._id));
  const saved = await User.findById(owner._id).lean();
  assert.equal(saved.fullName, owner.fullName);
  assert.equal(saved.email, owner.email);
  assert.equal(saved.dateOfBirth.getTime(), new Date('1990-01-01').getTime());
});

test('createContract: userId không khớp SĐT đã đối chiếu → 409 ACCOUNT_CONFIRM_REQUIRED', async () => {
  const receptionist = asUser(await createReceptionist());
  const [a, b] = [await createResidentUser(), await createResidentUser()];
  const apartment = await createApartment(null, { status: 'VACANT' });

  await assert.rejects(
    contracts.createContract(receptionist, {
      apartmentId: apartment._id,
      type: 'SALE',
      startDate: new Date('2026-11-01'),
      owner: { userId: String(a._id), phone: b.phone },
    }),
    { errorCode: 'ACCOUNT_CONFIRM_REQUIRED' },
  );
  assert.equal(await Contract.countDocuments(), 0);
});

test('addMember: tài khoản có sẵn đã xác nhận → thêm vào căn, không đổi ngày sinh (BR-X5); chưa xác nhận → 409', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  const member = await createResidentUser({ dateOfBirth: new Date('1990-01-01') });

  await assert.rejects(
    residents.addMember(receptionist, { apartmentId: apartment._id, phone: member.phone, email: 'x@example.com', fullName: 'X' }),
    { errorCode: 'ACCOUNT_CONFIRM_REQUIRED' },
  );
  assert.equal(await Resident.countDocuments({ userId: member._id }), 0);

  await residents.addMember(receptionist, {
    apartmentId: apartment._id,
    userId: String(member._id),
    phone: member.phone,
    dateOfBirth: '2001-02-03',
  });

  assert.equal(await Resident.countDocuments({ userId: member._id, isActive: true }), 1);
  const saved = await User.findById(member._id).lean();
  assert.equal(saved.dateOfBirth.getTime(), new Date('1990-01-01').getTime());
});

test('lookupAccountByPhone: chưa có / cư dân (đã che email, CCCD) / nội bộ (không lộ danh tính)', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  await residents.addMember(receptionist, {
    apartmentId: apartment._id,
    email: 'thanhvien@example.com',
    phone: '0912000009',
    fullName: 'Thành Viên',
    idNumber: '001200001234',
  });
  const manager = await createManager();

  assert.deepEqual(await residents.lookupAccountByPhone('+84912000008'), { phone: '0912000008', exists: false });

  const found = await residents.lookupAccountByPhone('+84912000009');
  assert.equal(found.phone, '0912000009');
  assert.equal(found.isResident, true);
  assert.equal(found.fullName, 'Thành Viên');
  assert.equal(found.email, 't***@example.com');
  assert.equal(found.idNumber, '********1234');

  assert.deepEqual(await residents.lookupAccountByPhone(manager.phone), { phone: manager.phone, exists: true, isResident: false });
});

test('tempPasswordForResponse: chỉ trả mật khẩu tạm khi gửi email thất bại', () => {
  assert.equal(tempPasswordForResponse('Abc123xyzQ', true), null);
  assert.equal(tempPasswordForResponse('Abc123xyzQ', false), 'Abc123xyzQ');
  assert.equal(tempPasswordForResponse(null, false), null);
});

test('removeMember / updateMember: thành viên đã rời căn → 409 STATUS_CONFLICT', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  const member = await createResidentUser();
  const r = await linkResident(member, apartment, { isActive: false });
  await assert.rejects(residents.removeMember(r._id, receptionist), { errorCode: 'STATUS_CONFLICT' });
  await assert.rejects(residents.updateMember(r._id, { idNumber: '012345678901' }, receptionist), {
    errorCode: 'STATUS_CONFLICT',
  });
});

test('updateMember: ghi audit RESIDENT_UPDATED (không lẫn với RESIDENT_ASSIGNED)', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  const member = await createResidentUser();
  const r = await linkResident(member, apartment);
  await residents.updateMember(r._id, { idNumber: '012345678901' }, receptionist);
  const log = await AuditLog.findOne({ targetId: r._id }).lean();
  assert.equal(log.action, 'RESIDENT_UPDATED');
});

test('removeMember: gỡ thành viên đang ở', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment } = await saleWithOwner();
  const member = await createResidentUser();
  const r = await linkResident(member, apartment);
  await residents.removeMember(r._id, receptionist);
  const after = await Resident.findById(r._id);
  assert.equal(after.isActive, false);
  assert.ok(after.moveOutDate);
});

test('remindExpiringLeases: nhắc mọi hợp đồng hết hạn trong 15 ngày chưa nhắc (kể cả khi cron lỡ 1 ngày), đúng 1 lần', async () => {
  const { apartment, owner } = await saleWithOwner();
  const tenant = await createResidentUser();
  const lease = await createContract({
    apartment,
    owner,
    type: 'LEASE',
    tenantId: tenant._id,
    endDate: new Date(Date.now() + 10 * DAY), // cron đã lỡ mốc đúng 15 ngày
  });
  const far = await createContract({
    apartment: await createApartment(),
    owner,
    type: 'LEASE',
    tenantId: tenant._id,
    endDate: new Date(Date.now() + 40 * DAY),
  });

  assert.equal(await remindExpiringLeases(), 1);
  assert.ok((await Contract.findById(lease._id)).remindedAt);
  assert.equal((await Contract.findById(far._id)).remindedAt, null);
  assert.equal(await remindExpiringLeases(), 0, 'không nhắc lần 2');
  assert.ok(await User.exists({ _id: tenant._id }));
});

test('terminateContract: hợp đồng không còn hiệu lực / còn hợp đồng thuê → 409 STATUS_CONFLICT', async () => {
  const receptionist = asUser(await createReceptionist());
  const { apartment, owner, contract } = await saleWithOwner();
  const tenant = await createResidentUser();
  await createContract({ apartment, owner, type: 'LEASE', tenantId: tenant._id, endDate: new Date(Date.now() + 90 * DAY) });
  await assert.rejects(contracts.terminateContract(contract._id, receptionist), { errorCode: 'STATUS_CONFLICT' });
  await Contract.updateOne({ _id: contract._id }, { status: 'TERMINATED' });
  await assert.rejects(contracts.terminateContract(contract._id, receptionist), { errorCode: 'STATUS_CONFLICT' });
});
