import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Apartment, AuditLog, Building, Contract, Invoice, Resident, Ticket } from '../../src/models/index.js';
import { buildInvoiceDraft } from '../../src/modules/invoices/invoices.builder.js';
import { managementAreaAt } from '../../src/modules/apartments/managementArea.js';
import { periodStart, shiftPeriod, vnPeriod } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createBuilding, createManager, createReceptionist, createResidentUser, createTicket, linkResident } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
before(async () => { await connectTestDB(); app = await startApp(); });
afterEach(clearTestDB);
after(async () => { await app?.close(); await closeTestDB(); });
const sourceReference = 'Biên bản tiếp nhận MB-13, bản vẽ tầng 1 và tầng 3';
const setup = () => ({ code: 'ct13', name: 'Tòa kiểm thử UC13', address: 'Hòa Lạc, Hà Nội', totalFloors: 3,
  sourceReference, floors: [{ floor: 1, expectedCount: 2 }, { floor: 3, expectedCount: 1 }],
  apartments: [{ code: 'CT1301', floor: 1, managementArea: 60 }, { code: 'CT1302', floor: 1, managementArea: 75.5 },
    { code: 'CT13301', floor: 3, managementArea: 85 }],
});
const actor = async () => asUser(await createManager());
const getInventory = async (id, user) => (await app.request('GET', `/buildings/${id}/inventory`, { user })).body.data;
const reviewBody = (building) => ({ sourceReference, expectedRevision: building.inventoryRevision,
  totalFloors: building.totalFloors, floors: building.floorInventory?.length ? building.floorInventory.map(({ floor, expectedCount }) => ({ floor, expectedCount }))
    : [...new Set(building.apartments.map((a) => a.floor))].map((floor) => ({ floor, expectedCount: building.apartments.filter((a) => a.floor === floor).length })),
  apartments: building.apartments.map((row) => ({ id: row.id, code: row.code, floor: row.floor, managementArea: row.managementArea })),
});
const confirm = (id, body, user) => app.request('POST', `/buildings/${id}/inventory/confirm`, { body, user });
const correctionBody = (apartment, extra) => ({ expectedUpdatedAt: apartment.updatedAt.toISOString(),
  reason: 'Đối chiếu lại theo bản vẽ', sourceReference, ...extra });

test('UC13: chỉ Trưởng BQL thiết lập, tạo các tầng khác số căn và khác diện tích, không tự bàn giao/cấp quyền', async () => {
  const manager = await actor();
  const receptionist = asUser(await createReceptionist());
  const resident = asUser(await createResidentUser());
  for (const user of [receptionist, resident]) {
    assert.equal((await app.request('POST', '/buildings', { user, body: setup() })).status, 403);
  }
  const result = await app.request('POST', '/buildings', { user: manager, body: setup() });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const building = result.body.data;
  assert.equal(building.code, 'CT13');
  assert.equal(building.apartmentCount, 3);
  assert.ok(building.inventoryConfirmedAt);
  const apartments = await Apartment.find({ buildingId: building._id }).lean();
  assert.deepEqual(apartments.map((a) => a.netArea).sort((a, b) => a - b), [60, 75.5, 85]);
  assert.ok(apartments.every((a) => a.occupancyStatus === 'NOT_HANDED_OVER' && !a.handoverDate));
  assert.equal(await Resident.countDocuments(), 0);
  assert.equal(await Contract.countDocuments(), 0);
  const log = await AuditLog.findOne({ 'metadata.action': 'INVENTORY_CREATED' }).lean();
  assert.equal(log.metadata.sourceReference, sourceReference);
  assert.equal(String(log.performedBy), manager.id);
  assert.equal((await app.request('GET', `/buildings/${building._id}/inventory/history`, { user: receptionist })).status, 403);
});

test('UC13: chặn thiếu hồ sơ, sai số lượng, trùng mã, tầng trùng/vượt phạm vi, diện tích sai; không lưu một phần', async () => {
  const user = await actor();
  const cases = [
    (body) => { delete body.sourceReference; },
    (body) => { body.floors[0].expectedCount = 3; },
    (body) => { body.apartments[1].code = 'ct1301'; },
    (body) => { body.apartments[0].floor = 2; },
    (body) => { body.floors[1].floor = 4; },
    (body) => { body.floors[1].floor = 1; },
    (body) => { body.apartments[0].managementArea = 0; },
    (body) => { body.apartments[0].id = '64b000000000000000000099'; },
  ];
  for (const mutate of cases) {
    const body = setup(); mutate(body);
    const result = await app.request('POST', '/buildings', { user, body });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(await Building.countDocuments(), 0);
    assert.equal(await Apartment.countDocuments(), 0);
  }
});

test('UC13: rà soát danh mục cũ giữ nguyên ID, cư trú, bàn giao, diện tích gốc và thông báo phí', async () => {
  const user = await actor();
  const building = await createBuilding({ totalFloors: 3 });
  const apartment = await createApartment(building, { floor: 2, handoverDate: new Date('2025-01-01'), occupancyStatus: 'VACANT' });
  const owner = await createResidentUser();
  await linkResident(owner, apartment, { relationType: 'OWNER' });
  const invoice = await Invoice.create({ code: 'HD-UC13-OLD', apartmentId: apartment._id, buildingId: building._id,
    payerId: owner._id, period: '2025-01', items: [], totalAmount: 123456, status: 'PAID', paidAmount: 123456 });
  const before = apartment.toObject();
  const view = await getInventory(building._id, user);
  const result = await confirm(building._id, reviewBody(view), user);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = await Apartment.findById(apartment._id).lean();
  assert.equal(String(after._id), String(before._id));
  assert.equal(after.handoverDate.getTime(), before.handoverDate.getTime());
  assert.equal(after.netArea, undefined);
  assert.equal(after.area, before.area);
  assert.equal(after.occupancyStatus, 'VACANT');
  assert.equal(await Resident.countDocuments({ apartmentId: after._id }), 1);
  assert.equal((await Invoice.findById(invoice._id)).totalAmount, 123456);
  const detail = await app.request('GET', `/apartments/${after._id}`, { user });
  assert.equal(detail.body.data.activeResidentsCount, 0);
  assert.equal(detail.body.data.identityLocked, true);
});

test('UC13: bổ sung căn cần lý do, đủ danh mục và số căn khớp; chặn đường thêm tự do ở tòa đã xác nhận', async () => {
  const user = await actor();
  const created = await app.request('POST', '/buildings', { user, body: setup() });
  const id = created.body.data._id;
  const view = await getInventory(id, user);
  const body = reviewBody(view);
  body.apartments.push({ code: 'CT13302', floor: 3, managementArea: 90 });
  body.floors[1].expectedCount += 1;
  assert.equal((await confirm(id, body, user)).status, 400);
  body.reason = 'Bổ sung một căn bị thiếu theo phụ lục';
  const omitted = structuredClone(body);
  omitted.apartments.shift(); omitted.floors[0].expectedCount -= 1;
  assert.equal((await confirm(id, omitted, user)).status, 409);
  const result = await confirm(id, body, user);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.addedCount, 1);
  assert.equal(await Apartment.countDocuments({ buildingId: id }), 4);
  assert.equal((await app.request('POST', '/apartments', { user, body: {
    buildingId: id, code: 'FREE', floor: 1, area: 80, netArea: 80, reason: 'Thêm', sourceReference,
  } })).status, 409);
  assert.equal((await confirm(id, body, user)).status, 409);
});

test('UC13: hai lượt xác nhận cùng phiên bản chỉ có một lượt thành công', async () => {
  const user = await actor();
  const building = await createBuilding({ totalFloors: 2 });
  await createApartment(building, { floor: 1, netArea: 70 });
  const body = reviewBody(await getInventory(building._id, user));
  const results = await Promise.all([confirm(building._id, body, user), confirm(building._id, body, user)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test('UC13: chỉnh sửa thường không được đổi cấu trúc; mã căn có liên kết bị khóa; điều chỉnh cần căn cứ', async () => {
  const user = await actor();
  const apartment = await createApartment(await createBuilding({ totalFloors: 3 }), { floor: 1, netArea: 70 });
  const owner = await createResidentUser();
  await linkResident(owner, apartment, { relationType: 'OWNER' });
  const path = `/apartments/${apartment._id}`;
  assert.equal((await app.request('PUT', path, { user, body: { netArea: 90 } })).status, 409);
  assert.equal((await app.request('PATCH', `${path}/catalog`, { user, body: { code: 'NEW' } })).status, 400);
  assert.equal((await app.request('PATCH', `${path}/catalog`, { user,
    body: correctionBody(apartment, { code: 'NEW' }) })).status, 409);
  assert.equal((await app.request('PATCH', `${path}/catalog`, { user: asUser(await createReceptionist()),
    body: correctionBody(apartment, { floor: 2 }) })).status, 403);
  const changed = await app.request('PATCH', `${path}/catalog`, { user, body: correctionBody(apartment, { floor: 2 }) });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const stale = await app.request('PATCH', `${path}/catalog`, { user, body: correctionBody(apartment, { floor: 3 }) });
  assert.equal(stale.status, 409);
});

test('UC13: diện tích điều chỉnh áp dụng theo kỳ tương lai; phí kỳ cũ và hóa đơn đã lập không đổi', async () => {
  const user = await actor();
  const building = await createBuilding({ totalFloors: 3 });
  const apartment = await createApartment(building, { floor: 1, netArea: 70, type: 'RESIDENTIAL',
    handoverDate: new Date('2025-01-01'), occupancyStatus: 'OWNER_OCCUPIED' });
  const owner = await createResidentUser();
  await Contract.create({ apartmentId: apartment._id, ownerId: owner._id, type: 'SALE', startDate: new Date('2025-01-01') });
  const current = vnPeriod();
  const future = shiftPeriod(current, 1);
  const path = `/apartments/${apartment._id}/catalog`;
  assert.equal((await app.request('PATCH', path, { user,
    body: correctionBody(apartment, { managementArea: 90, effectivePeriod: current }) })).status, 400);
  const result = await app.request('PATCH', path, { user,
    body: correctionBody(apartment, { managementArea: 90, effectivePeriod: future }) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const updated = await Apartment.findById(apartment._id).populate('buildingId', 'code').lean();
  assert.equal(updated.netArea, 70);
  assert.equal(managementAreaAt(updated, periodStart(current)), 70);
  assert.equal(managementAreaAt(updated, periodStart(future)), 90);
  const prices = new Map([['MANAGEMENT_RESIDENTIAL', { feeCategory: 'MANAGEMENT', calcMethod: 'PER_M2',
    code: 'MANAGEMENT_RESIDENTIAL', name: 'Phí quản lý', unitPrice: 1000 }]]);
  assert.equal((await buildInvoiceDraft(updated, current, prices)).totalAmount, 70000);
  assert.equal((await buildInvoiceDraft(updated, future, prices)).totalAmount, 90000);
  const fresh = await Apartment.findById(apartment._id);
  assert.equal((await app.request('PATCH', path, { user,
    body: correctionBody(fresh, { managementArea: 95, effectivePeriod: future }) })).status, 400);
  const invoice = await Invoice.create({ code: 'HD-UC13-SNAPSHOT', apartmentId: apartment._id, buildingId: building._id,
    period: shiftPeriod(future, 1), items: [], totalAmount: 33333 });
  assert.equal((await app.request('PATCH', path, { user,
    body: correctionBody(fresh, { managementArea: 95, effectivePeriod: invoice.period }) })).status, 409);
  assert.equal((await Invoice.findById(invoice._id)).totalAmount, 33333);
});

test('UC13: chặn xóa căn có ticket hoặc hóa đơn; xóa nhập nhầm có lý do và lịch sử', async () => {
  const user = await actor();
  const created = await app.request('POST', '/buildings', { user, body: setup() });
  const id = created.body.data._id;
  const apartments = await Apartment.find({ buildingId: id }).sort({ code: 1 });
  const owner = await createResidentUser();
  await createTicket({ apartment: apartments[0], createdBy: owner });
  await Invoice.create({ code: 'HD-LOCK', apartmentId: apartments[1]._id, buildingId: id,
    period: '2025-01', items: [], totalAmount: 1 });
  const body = { reason: 'Nhập nhầm một căn ngoài danh mục', sourceReference };
  for (const apartment of apartments.slice(0, 2)) {
    assert.equal((await app.request('DELETE', `/apartments/${apartment._id}`, { user, body })).status, 409);
  }
  assert.equal((await app.request('DELETE', `/apartments/${apartments[2]._id}`, { user })).status, 400);
  const result = await app.request('DELETE', `/apartments/${apartments[2]._id}`, { user, body });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(await Apartment.countDocuments({ buildingId: id }), 2);
  const history = await app.request('GET', `/buildings/${id}/inventory/history`, { user });
  assert.ok(history.body.data.some((row) => row.metadata.action === 'DELETE' && row.metadata.reason === body.reason));
  assert.equal((await app.request('DELETE', `/buildings/${id}`, { user })).status, 409);
  assert.equal(await Ticket.countDocuments(), 1);
});

test('UC13: cập nhật tòa cần căn cứ; khóa mã đã có căn và số tầng đã xác nhận', async () => {
  const user = await actor();
  const created = await app.request('POST', '/buildings', { user, body: setup() });
  const id = created.body.data._id;
  const path = `/buildings/${id}`;
  assert.equal((await app.request('PUT', path, { user, body: { address: 'Địa chỉ mới' } })).status, 400);
  const audit = { sourceReference, reason: 'Đối chiếu thông tin liên hệ' };
  assert.equal((await app.request('PUT', path, { user, body: { ...audit, code: 'OTHER' } })).status, 409);
  assert.equal((await app.request('PUT', path, { user, body: { ...audit, totalFloors: 4 } })).status, 409);
  const result = await app.request('PUT', path, { user, body: { ...audit, address: 'Hòa Lạc cập nhật' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await Building.findById(id)).address, 'Hòa Lạc cập nhật');
  const entry = await AuditLog.findOne({ targetId: id, 'metadata.action': 'UPDATE' });
  assert.equal(entry.metadata.changes.address.to, 'Hòa Lạc cập nhật');
});

test('UC13: sửa căn chưa liên kết giữ ID và cập nhật số căn hai tầng trong cùng giao dịch', async () => {
  const user = await actor();
  const created = await app.request('POST', '/buildings', { user, body: setup() });
  const id = created.body.data._id;
  const apartment = await Apartment.findOne({ buildingId: id, code: 'CT1301' });
  const result = await app.request('PATCH', `/apartments/${apartment._id}/catalog`, { user,
    body: correctionBody(apartment, { code: 'CT13303', floor: 3 }) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data._id, String(apartment._id));
  const building = await Building.findById(id).lean();
  assert.deepEqual(building.floorInventory.map(({ floor, expectedCount }) => ({ floor, expectedCount })),
    [{ floor: 1, expectedCount: 1 }, { floor: 3, expectedCount: 2 }]);
});

test('UC13: không sửa ngầm mã, tầng hoặc diện tích căn cũ qua xác nhận danh mục', async () => {
  const user = await actor();
  const building = await createBuilding({ totalFloors: 3 });
  const apartment = await createApartment(building, { floor: 1, netArea: 70 });
  const view = await getInventory(building._id, user);
  const body = reviewBody(view);
  body.apartments[0].managementArea = 99;
  assert.equal((await confirm(building._id, body, user)).status, 409);
  assert.equal((await Apartment.findById(apartment._id)).netArea, 70);
  assert.equal((await Building.findById(building._id)).inventoryConfirmedAt, undefined);
});
