import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.js';
import { Apartment, AuditLog, Contract, Invoice, ParkingCard, Resident, User, Vehicle } from '../../src/models/index.js';
import { confirmActivation, login, startActivation } from '../../src/modules/auth/auth.service.js';
import { getPayer } from '../../src/modules/contracts/contracts.queries.js';
import { terminateContract } from '../../src/modules/contracts/contracts.service.js';
import { createPayosPayment } from '../../src/modules/payments/payments.payos.js';
import { setPayosForTest } from '../../src/modules/payments/payos.client.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createHousehold, createResidentUser, linkResident } from '../helpers/fixtures.js';
import { createContract, createParkingCard, createVehicle } from '../helpers/fixtures.moduleA.js';
import { createInvoice } from '../helpers/fixtures.moduleBDE.js';
import { startApp, USERS } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

async function ownedApartment() {
  const { user: owner, apartment } = await createHousehold();
  await Apartment.updateOne({ _id: apartment._id }, { $set: { handoverDate: new Date('2025-01-01') } });
  const sale = await createContract({ apartment, owner });
  return { owner, apartment, sale, path: `/residents/me/tenancies/${apartment._id}` };
}

test('UC17 thêm tài khoản mới chờ kích hoạt và khách thuê tự kích hoạt vào đúng căn', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const smtpEnabled = env.smtp.enabled;
  env.smtp.enabled = true;
  t.after(() => { env.smtp.enabled = smtpEnabled; });
  const mails = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail) => { mails.push(mail); } }));
  const { owner, apartment, path } = await ownedApartment();
  const phone = '0987654321';
  const email = 'new-tenant@example.com';
  const result = await app.request('POST', path, {
    user: asUser(owner), body: { phone, email, fullName: 'Nguyễn Khách Thuê' },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(await Contract.countDocuments({ apartmentId: apartment._id, type: 'LEASE' }), 0);
  const account = await User.findOne({ phone }).select('+passwordHash').lean();
  assert.equal(account.activatedAt, null);
  assert.equal(account.passwordHash ?? null, null);
  assert.equal(String((await getPayer(apartment._id)).userId), String(owner._id));

  await startActivation({ phone, apartmentCode: apartment.code, email });
  const otp = /\b(\d{6})\b/.exec(mails.at(-1).text)[1];
  const password = 'MatKhau123';
  await confirmActivation({ phone, code: otp, password, consent: 'ACCEPTED' });
  const session = await login({ phone, password });
  assert.ok(session.apartments.some((row) => String(row.apartmentId) === String(apartment._id) && row.relationType === 'TENANT'));
});

test('UC17 liên kết tài khoản, xử lý phí, rời căn và giữ quyền thanh toán khoản nợ của chính khách thuê', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { owner, apartment, sale, path } = await ownedApartment();
  const residentsPath = `/apartments/${apartment.id}/residents`;
  const listResidents = async (user) => {
    const response = await app.request('GET', residentsPath, { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data;
  };
  const ownerResidents = await listResidents(asUser(owner));
  assert.deepEqual(ownerResidents.map((row) => [row.userId, row.occupancyRole]), [[owner.id, 'HEAD']]);

  const tenant = await createResidentUser();
  const another = await createApartment();
  await linkResident(tenant, another, { relationType: 'OWNER' });
  const data = { phone: tenant.phone, userId: tenant._id, tenantPaysFees: true };
  const lookup = `${path}/lookup?phone=${tenant.phone}`;
  assert.equal((await app.request('GET', lookup, { user: asUser(tenant) })).status, 403);
  const found = await app.request('GET', lookup, { user: asUser(owner) });
  assert.equal(found.body.data.userId, String(tenant._id));
  assert.equal(found.body.data.email, undefined);
  assert.equal((await app.request('POST', path, { user: asUser(owner), body: { ...data, userId: undefined, fullName: 'Nhập nhầm' } })).status, 409);

  const requests = await Promise.all([1, 2].map(() => app.request('POST', path, { user: asUser(owner), body: data })));
  assert.deepEqual(requests.map((row) => row.status).sort(), [201, 409]);
  const memberId = requests.find((row) => row.status === 201).body.data.residentId;
  assert.equal((await Apartment.findById(apartment._id)).occupancyStatus, 'RENTED');
  assert.equal(String((await getPayer(apartment._id)).userId), String(tenant._id));
  await assert.rejects(terminateContract(sale._id, USERS.receptionist), { status: 409 });

  const tenantApartments = await app.request('GET', '/residents/me/apartments', { user: asUser(tenant) });
  assert.equal(tenantApartments.body.data.find((row) => row.apartmentId === apartment.id).canDeclareFamily, true);
  const ownerApartments = await app.request('GET', '/residents/me/apartments', { user: asUser(owner) });
  assert.equal(ownerApartments.body.data.find((row) => row.apartmentId === apartment.id).canDeclareFamily, false);
  const declared = await app.request('POST', '/residents/me/family', {
    user: asUser(tenant), body: { apartmentId: apartment._id, fullName: 'Thành viên ở cùng' },
  });
  assert.equal(declared.status, 201);
  const familyId = declared.body.data._id;
  assert.equal(String((await Resident.findById(familyId)).declaredByResidenceId), memberId);
  const occupancy = async () => {
    const report = await app.request('GET', '/residents/occupancy', { user: USERS.manager });
    return report.body.data.flatMap((building) => building.apartments).find((row) => row._id === apartment.id);
  };
  assert.deepEqual((await occupancy()).residents.map((row) => row._id), [memberId, familyId]);
  for (const viewer of [USERS.manager, asUser(owner), asUser(tenant)]) {
    const residents = await listResidents(viewer);
    assert.equal(residents.find((row) => row.userId === owner.id).occupancyRole, null);
    const roles = Object.fromEntries(residents.filter((row) => row.occupancyRole)
      .map((row) => [row._id, row.occupancyRole]));
    assert.deepEqual(roles, { [memberId]: 'HEAD', [familyId]: 'MEMBER' });
  }

  const invoice = await createInvoice({ apartment, payerId: tenant._id });
  await createInvoice({ apartment, payerId: owner._id, period: '2026-11' });
  const vehicle = await createVehicle({ apartment, registeredBy: tenant, status: 'APPROVED' });
  const card = await createParkingCard({ vehicle });
  const otherVehicle = await createVehicle({ apartment: another, registeredBy: tenant, status: 'APPROVED' });
  const endPath = `${path}/${memberId}/end`;
  assert.equal((await app.request('PATCH', endPath, { user: asUser(tenant) })).status, 403);
  assert.equal((await app.request('PATCH', endPath, { user: asUser(owner) })).status, 200);
  assert.equal((await app.request('PATCH', endPath, { user: asUser(owner) })).status, 409);

  const departed = await Resident.findById(memberId).lean();
  assert.equal(departed.isActive, false);
  assert.ok(departed.moveOutDate);
  assert.equal((await Resident.findById(familyId)).isActive, false);
  assert.deepEqual((await occupancy()).residents, []);
  const afterTenancy = await listResidents(asUser(owner));
  assert.deepEqual(afterTenancy.map((row) => [row.userId, row.occupancyRole]), [[owner.id, null]]);
  assert.equal((await Apartment.findById(apartment._id)).occupancyStatus, 'VACANT');
  assert.equal((await Vehicle.findById(vehicle._id)).status, 'CANCELLED');
  assert.equal((await ParkingCard.findById(card._id)).status, 'DISABLED_TO_COLLECT');
  assert.equal((await Vehicle.findById(otherVehicle._id)).status, 'APPROVED');
  assert.equal(await Resident.countDocuments({ apartmentId: another._id, userId: tenant._id, isActive: true }), 1);
  const tomorrow = new Date(departed.moveOutDate.getTime() + DAY_MS);
  assert.equal(String((await getPayer(apartment._id, tomorrow)).userId), String(owner._id));

  const debtPath = '/invoices/my/departed-tenancies';
  const debt = await app.request('GET', debtPath, { user: asUser(tenant) });
  assert.deepEqual(debt.body.data.map((row) => row._id), [String(apartment._id)]);
  const invoices = await app.request('GET', `/invoices/my?apartmentId=${apartment._id}`, { user: asUser(tenant) });
  assert.deepEqual(invoices.body.data.map((row) => row._id), [String(invoice._id)]);
  assert.equal(invoices.body.data[0].isPayer, true);
  assert.equal((await app.request('GET', `/invoices/${invoice._id}`, { user: asUser(tenant) })).status, 200);
  const checkoutUrl = 'https://payos.test/checkout';
  setPayosForTest({
    config: { enabled: true, clientId: 'test', apiKey: 'test', checksumKey: 'test', apiUrl: 'https://payos.test',
      returnUrl: 'http://localhost:5173/r/payments/result', cancelUrl: 'http://localhost:5173/r/payments/result' },
    fetch: async () => ({ ok: true, json: async () => ({ code: '00', data: { checkoutUrl, paymentLinkId: 'test-link' } }) }),
  });
  t.after(() => setPayosForTest());
  const payment = await createPayosPayment(asUser(tenant), { invoiceIds: [invoice._id] });
  assert.equal(payment.checkoutUrl, checkoutUrl);
  await Invoice.updateOne({ _id: invoice._id }, { $set: { paidAmount: invoice.totalAmount, status: 'PAID' } });
  assert.deepEqual((await app.request('GET', debtPath, { user: asUser(tenant) })).body.data, []);
});

test('UC20 giữ lượt thuê, người ở cùng và thẻ của khách khi chuyển quyền quản lý sang chủ mới', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { owner, apartment, sale, path } = await ownedApartment();
  const newOwner = await createResidentUser({ activatedAt: new Date() });
  const tenant = await createResidentUser();
  const another = await createApartment();
  await linkResident(owner, another, { relationType: 'OWNER' });

  const start = await app.request('POST', path, {
    user: asUser(owner), body: { phone: tenant.phone, userId: tenant.id, tenantPaysFees: false },
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const tenantResidence = start.body.data.residentId;
  const declared = await app.request('POST', '/residents/me/family', {
    user: asUser(tenant), body: { apartmentId: apartment.id, fullName: 'Người ở cùng khách thuê' },
  });
  assert.equal(declared.status, 201);
  const tenantVehicle = await createVehicle({ apartment, registeredBy: tenant, status: 'APPROVED' });
  const tenantCard = await createParkingCard({ vehicle: tenantVehicle });
  const ownerVehicle = await createVehicle({ apartment, registeredBy: owner, status: 'APPROVED' });
  const ownerCard = await createParkingCard({ vehicle: ownerVehicle });
  const invoice = await createInvoice({ apartment, payerId: owner._id });

  const transferPath = `/contracts/apartments/${apartment.id}/ownership-transfer`;
  const debtPath = `${transferPath}/debt-review`;
  const body = {
    contractId: sale.id, owner: { userId: newOwner.id, phone: newOwner.phone },
    ownershipDocumentType: 'TRANSFER_DOCUMENT', ownershipDocumentNumber: 'CN-01', identityVerified: true,
  };
  const transfer = (user) => app.request('POST', transferPath, { user, body });
  assert.equal((await transfer(asUser(owner))).status, 403);
  assert.equal((await transfer(USERS.manager)).status, 409);
  assert.equal((await app.request('POST', debtPath, {
    user: USERS.manager, body: { contractId: sale.id },
  })).status, 200);
  assert.equal((await transfer(USERS.manager)).status, 409);
  const accountant = { role: 'ACCOUNTANT' };
  assert.equal((await app.request('GET', debtPath, { user: accountant })).body.data._id, sale.id);
  assert.equal((await app.request('PATCH', debtPath, {
    user: accountant, body: { contractId: sale.id },
  })).status, 200);

  const results = await Promise.all([transfer(USERS.manager), transfer(USERS.manager)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((result) => result.status === 200).body.data.keptTenancy, true);
  assert.equal((await app.request('GET', path, { user: asUser(owner) })).status, 403);
  const current = await app.request('GET', path, { user: asUser(newOwner) });
  assert.equal(current.body.data._id, tenantResidence);
  assert.equal(current.body.data.userId._id, tenant.id);
  assert.equal((await ParkingCard.findById(tenantCard.id)).status, 'ACTIVE');
  assert.equal((await Vehicle.findById(tenantVehicle.id)).status, 'APPROVED');
  assert.equal((await ParkingCard.findById(ownerCard.id)).status, 'DISABLED_TO_COLLECT');
  assert.equal((await Apartment.findById(apartment.id)).occupancyStatus, 'RENTED');
  assert.equal(await Resident.countDocuments({ apartmentId: another.id, userId: owner.id, isActive: true }), 1);

  const report = await app.request('GET', '/residents/occupancy', { user: USERS.manager });
  const occupants = report.body.data.flatMap((building) => building.apartments).find((row) => row._id === apartment.id);
  assert.deepEqual(occupants.residents.map((row) => row._id), [tenantResidence, declared.body.data._id]);
  const oldContract = await Contract.findById(sale.id);
  assert.ok(oldContract.transferredToContractId);
  assert.equal(String((await getPayer(apartment.id, oldContract.terminatedAt)).userId), newOwner.id);
  assert.equal(String((await getPayer(apartment.id, new Date(oldContract.terminatedAt.getTime() - 1))).userId), owner.id);
  assert.equal(String((await Invoice.findById(invoice.id)).payerId), owner.id);
  const former = await app.request('GET', '/invoices/my/departed-tenancies', { user: asUser(owner) });
  assert.deepEqual(former.body.data.map((row) => row._id), [apartment.id]);

  const ended = await app.request('PATCH', `${path}/${tenantResidence}/end`, { user: asUser(newOwner) });
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
});

test('UC20 có thể xác nhận sau 2 ngày chờ và căn trống cho đến khi xác nhận vào ở', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { owner, apartment, sale } = await ownedApartment();
  await createInvoice({ apartment, payerId: owner.id });
  await Contract.updateOne({ _id: sale.id }, { transferDebtRequestedAt: new Date(Date.now() - 3 * DAY_MS) });
  const result = await app.request('POST', `/contracts/apartments/${apartment.id}/ownership-transfer`, {
    user: USERS.manager, body: {
      contractId: sale.id, owner: { phone: '0912000040', fullName: 'Chủ mới UC20' },
      ownershipDocumentType: 'OWNERSHIP_CERTIFICATE', ownershipDocumentNumber: 'GCN-02', identityVerified: true,
    },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await Apartment.findById(apartment.id)).occupancyStatus, 'VACANT');
  const user = await User.findOne({ phone: '0912000040' }).select('+passwordHash');
  assert.equal(user.activatedAt, null);
  assert.equal(user.passwordHash, undefined);
  assert.equal(await AuditLog.countDocuments({
    action: 'APARTMENT_OWNER_CHANGED', targetId: apartment.id, 'metadata.debtReviewOverdue': true,
  }), 1);
  const movedIn = await app.request('PATCH', `/apartments/${apartment.id}/confirm-move-in`, { user: USERS.receptionist });
  assert.equal(movedIn.status, 200, JSON.stringify(movedIn.body));
  assert.equal(movedIn.body.data.occupancyStatus, 'OWNER_OCCUPIED');
});

test('UC17 cho chủ sở hữu kết thúc lượt thuê cũ, màn hợp đồng chỉ tra cứu', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const { owner, apartment, path } = await ownedApartment();
  const tenant = await createResidentUser();
  const lease = await createContract({ apartment, owner, type: 'LEASE', tenantId: tenant._id,
    tenantPaysFees: true, endDate: new Date('2026-02-01') });
  const resident = await linkResident(tenant, apartment, { relationType: 'TENANT', contractId: lease._id });
  const current = await app.request('GET', path, { user: asUser(owner) });
  assert.equal(current.body.data._id, String(resident._id));
  assert.equal(current.body.data.tenantPaysFees, true);
  assert.equal(String((await getPayer(apartment._id)).userId), String(tenant._id));
  assert.equal((await app.request('GET', `/contracts/${lease.id}`, { user: USERS.receptionist })).status, 200);
  assert.equal((await app.request('POST', '/contracts', { user: USERS.manager, body: {
    apartmentId: apartment.id, type: 'LEASE', startDate: '2026-11-01', owner: { phone: owner.phone },
  } })).status, 400);
  assert.equal((await app.request('PATCH', `/contracts/${lease.id}`, { user: USERS.manager, body: { endDate: '2099-01-01' } })).status, 409);
  assert.equal((await app.request('PATCH', `/contracts/${lease.id}/terminate`, { user: USERS.manager })).status, 409);
  assert.equal((await app.request('POST', path, { user: asUser(owner), body: { phone: '0987654321', fullName: 'Khách mới' } })).status, 409);
  assert.equal((await app.request('PATCH', `${path}/${resident._id}/end`, { user: asUser(owner) })).status, 200);
  const closed = await Contract.findById(lease._id);
  assert.equal(closed.status, 'TERMINATED');
  assert.equal(String((await getPayer(apartment._id, closed.terminatedAt)).userId), String(tenant._id));
  assert.equal(String((await getPayer(apartment._id, new Date(closed.terminatedAt.getTime() + DAY_MS))).userId), String(owner._id));
  assert.equal((await app.request('GET', path, { user: asUser(owner) })).body.data, null);
  assert.equal((await app.request('POST', path, { user: asUser(owner), body: { phone: tenant.phone, userId: tenant.id } })).status, 201);
  assert.equal(await Contract.countDocuments({ apartmentId: apartment._id, type: 'LEASE' }), 1);
});
