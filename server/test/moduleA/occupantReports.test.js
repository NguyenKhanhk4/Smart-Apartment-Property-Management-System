import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { AuditLog, Resident } from '../../src/models/index.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import {
  asUser, createApartment, createBuilding, createManager, createReceptionist, createResidentUser, linkResident,
} from '../helpers/fixtures.js';
import { startApp, tokenFor, USERS } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const listPath = '/residents/occupancy';
const previewPath = '/residents/occupancy/preview';
const exportPath = '/residents/occupancy/export';

test('UC21: đếm chủ hộ hiện tại và người do họ khai báo, xuất theo từng tòa', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const manager = asUser(await createManager());
  const staff = await createReceptionist();
  const buildingA = await createBuilding({ code: 'A', name: 'Tòa A', address: '10 Đường Số 1' });
  const buildingB = await createBuilding({ code: 'B', name: 'Tòa B', address: '20 Đường Số 2' });
  const apartmentA = await createApartment(buildingA, { code: '101', floor: 1 });
  const apartmentB = await createApartment(buildingB, { code: '101', floor: 1, status: 'RENTED' });
  const vacant = await createApartment(buildingA, { code: '102', floor: 1, occupancyStatus: 'VACANT' });
  const upperFloor = await createApartment(buildingA, { code: '201', floor: 2 });
  const owner = await createResidentUser({ fullName: 'Chủ hộ đang ở' });
  const landlord = await createResidentUser({ fullName: 'Chủ sở hữu không ở' });
  const tenant = await createResidentUser({ fullName: 'Khách thuê hiện tại' });
  const formerTenant = await createResidentUser();
  const ownerResidence = await linkResident(owner, apartmentA, { relationType: 'OWNER' });
  await linkResident(landlord, apartmentB, { relationType: 'OWNER' });
  const tenantResidence = await linkResident(tenant, apartmentB, { relationType: 'TENANT' });
  const formerResidence = await linkResident(formerTenant, apartmentB, { relationType: 'TENANT', isActive: false });
  await linkResident(landlord, vacant, { relationType: 'OWNER' });
  const upstairsOwner = await createResidentUser({ fullName: 'Chủ hộ tầng 2' });
  await linkResident(upstairsOwner, upperFloor, { relationType: 'OWNER' });

  const family = (apartment, fullName, extra = {}) => Resident.create({
    apartmentId: apartment._id, fullName, relationType: 'FAMILY_MEMBER', ...extra,
  });
  const ownerChild = await family(apartmentA, 'Con chủ hộ', { declaredByResidenceId: ownerResidence._id });
  const previouslyDeclared = await family(apartmentA, 'Chủ hộ đã khai báo trước đây');
  const staffEntry = await family(apartmentA, 'Hồ sơ cũ do nhân viên nhập');
  const tenantChild = await family(apartmentB, 'Người ở cùng khách thuê', { declaredByResidenceId: tenantResidence._id });
  await family(apartmentB, 'Người ở cùng khách thuê cũ', { declaredByResidenceId: formerResidence._id });
  await family(apartmentB, 'Người đã chuyển đi', { declaredByResidenceId: tenantResidence._id, isActive: false });
  await AuditLog.create([
    { action: 'RESIDENT_ASSIGNED', targetType: 'residents', targetId: previouslyDeclared._id, performedBy: owner._id },
    { action: 'RESIDENT_ASSIGNED', targetType: 'residents', targetId: staffEntry._id, performedBy: staff._id },
  ]);

  for (const viewer of [USERS.receptionist, USERS.resident, USERS.security, { role: 'ACCOUNTANT' }, { role: 'BOARD' }]) {
    assert.equal((await app.request('GET', listPath, { user: viewer })).status, 403);
    assert.equal((await app.request('GET', previewPath, { user: viewer })).status, 403);
    assert.equal((await app.request('GET', exportPath, { user: viewer })).status, 403);
  }
  assert.equal((await app.request('GET', '/residents/changes', { user: manager })).status, 404);
  assert.equal((await app.request('GET', '/residents/changes/export', { user: manager })).status, 404);

  const preview = await app.request('GET', listPath, { user: manager });
  assert.equal(preview.status, 200);
  const [a, b] = preview.body.data;
  assert.equal(a.apartments[0].code, b.apartments[0].code);
  assert.equal(a.apartments[0].residents[0].isHead, true);
  assert.deepEqual(a.apartments[0].residents.map((row) => row._id),
    [ownerResidence.id, ownerChild.id, previouslyDeclared.id]);
  assert.deepEqual(a.apartments[1].residents, []);
  assert.equal(b.apartments[0].occupancyStatus, 'RENTED');
  assert.deepEqual(b.apartments[0].residents.map((row) => row._id), [tenantResidence.id, tenantChild.id]);
  assert.ok(await Resident.exists({ _id: staffEntry._id }));

  async function download(path) {
    const response = await fetch(app.base + path, { headers: { authorization: 'Bearer ' + tokenFor(manager) } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /thong-tin-cu-tru-/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    return workbook;
  }

  const scopedQuery = '?floor=2';
  const scoped = await app.request('GET', listPath + scopedQuery, { user: manager });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.data.flatMap((building) => building.apartments.map((row) => row.floor)), [2]);

  const workbookPreview = await app.request('GET', previewPath + scopedQuery, { user: manager });
  assert.equal(workbookPreview.status, 200);
  assert.equal(await AuditLog.countDocuments({ action: 'RESIDENT_OCCUPANCY_EXPORTED' }), 0);
  assert.equal(workbookPreview.body.data.sheets.length, 1);
  const [previewSheet] = workbookPreview.body.data.sheets;
  assert.deepEqual(previewSheet.rows.map((row) => row.fullName), ['Chủ hộ tầng 2']);

  const filteredExport = await download(exportPath + scopedQuery);
  assert.deepEqual(filteredExport.worksheets.map((sheet) => sheet.name), [previewSheet.name]);
  const [sheet] = filteredExport.worksheets;
  assert.equal(sheet.getCell('A1').value, previewSheet.title);
  assert.equal(sheet.getCell('A2').value, previewSheet.summary);
  assert.match(previewSheet.summary, /Tầng 2/);
  const previewColumns = workbookPreview.body.data.columns;
  assert.deepEqual(sheet.getRow(3).values.slice(1), previewColumns.map((column) => column.header));
  const filteredRows = [];
  sheet.eachRow((row, number) => {
    if (number > 3) filteredRows.push(previewColumns.map((_, index) => row.getCell(index + 1).value ?? ''));
  });
  assert.deepEqual(filteredRows, previewSheet.rows.map((row) => previewColumns.map((column) => row[column.key])));

  const all = await download(exportPath);
  assert.deepEqual(all.worksheets.map((sheet) => sheet.name), ['1. Tòa A', '2. Tòa B']);
  for (const [index, sheet] of all.worksheets.entries()) {
    const building = preview.body.data[index];
    const expected = building.apartments.flatMap((apartment) => apartment.residents.map((row) => [apartment.code, row.fullName]));
    const exported = [];
    sheet.eachRow((row, number) => {
      if (number > 3) exported.push([row.getCell(2).value, row.getCell(4).value]);
    });
    assert.equal(sheet.getCell('A1').value, building.name + ' · ' + building.address);
    assert.deepEqual(exported, expected);
  }

  const one = await download(exportPath + '?buildingId=' + buildingB.id);
  assert.deepEqual(one.worksheets.map((sheet) => sheet.name), ['1. Tòa B']);
  assert.equal(one.worksheets[0].getCell('C4').value, 'Đang cho thuê');
  const log = await AuditLog.findOne({ action: 'RESIDENT_OCCUPANCY_EXPORTED', 'metadata.buildingId': buildingB.id }).lean();
  assert.deepEqual(log.metadata, { buildingId: buildingB.id, buildingCount: 1, count: 2 });
});
