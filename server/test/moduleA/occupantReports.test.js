// Xuất biến động nhân khẩu: loại biến động theo enum, tên file theo ngày giờ VN.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../../src/models/index.js';
import { exportResidentChangesExcel, listResidentChanges } from '../../src/modules/occupantReports/occupantReports.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createReceptionist, createResidentUser, linkResident } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('listResidentChanges: sự kiện vào ở / chuyển đi', async () => {
  const apartment = await createApartment();
  const user = await createResidentUser();
  await linkResident(user, apartment, { moveInDate: new Date(Date.now() - 86_400_000), moveOutDate: new Date(), isActive: false });
  const rows = await listResidentChanges({});
  assert.deepEqual(rows.map((r) => r.changeType).sort(), ['MOVE_IN', 'MOVE_OUT']);
});

test('exportResidentChangesExcel: 01:00 sáng giờ VN vẫn đặt tên file theo ngày VN, ghi audit vào residents', async () => {
  const actor = asUser(await createReceptionist());
  const now = new Date('2026-10-31T18:00:00Z'); // 01:00 ngày 01/11 giờ VN
  const { filename } = await exportResidentChangesExcel({}, actor, undefined, { now });
  assert.equal(filename, 'bien-dong-nhan-khau-2026-11-01.xlsx');
  const log = await AuditLog.findOne({ action: 'RESIDENT_CHANGES_EXPORTED' }).lean();
  assert.equal(log.targetType, 'residents');
});
