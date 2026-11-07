// UC06 – Xem nhật ký hoạt động: giá trị cũ / mới, IP tự ghi, không sửa / xóa (BR-S10), xuất file (UC65, BR-D02)
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { AUDIT_ACTIONS, values } from '../../src/constants/enums.js';
import { requestContext } from '../../src/middlewares/requestContext.js';
import { AuditLog } from '../../src/models/index.js';
import { LABELS } from '../../src/modules/auditLogs/auditLogs.rules.js';
import { MAX_EXPORT_ROWS } from '../../src/modules/auditLogs/auditLogs.service.js';
import { setStatus, updateInternal } from '../../src/modules/users/users.service.js';
import { logAudit } from '../../src/services/auditLog.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import mongoose from 'mongoose';
import { asUser, createApartment, createManager, createUser } from '../helpers/fixtures.js';
import { startApp, tokenFor } from '../helpers/http.js';

let app;
before(async () => {
  await connectTestDB();
  app = await startApp();
});
afterEach(clearTestDB);
after(async () => {
  await app.close();
  await closeTestDB();
});

const list = (user, query = '') => app.request('GET', `/audit-logs${query}`, { user });
const download = (user, query) =>
  fetch(`${app.base}/audit-logs/export${query}`, { headers: { authorization: `Bearer ${tokenFor(user)}` } });
const readSheet = async (res) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb;
};

test('mọi hành động trong AUDIT_ACTIONS đều có nhãn tiếng Việt', () => {
  assert.deepEqual(values(AUDIT_ACTIONS).filter((a) => !LABELS[a]), []);
});

test('BR-S10: không sửa, không xóa được nhật ký qua model; ghi thêm vẫn được', async () => {
  const log = await logAudit({ action: 'ACCOUNT_LOCKED', targetType: 'users', metadata: { reason: 'gốc' } });
  const blocked = /chỉ được ghi thêm/;
  await assert.rejects(AuditLog.updateOne({ _id: log._id }, { $set: { action: 'ACCOUNT_UNLOCKED' } }), blocked);
  await assert.rejects(AuditLog.updateMany({}, { $set: { ip: 'x' } }), blocked);
  await assert.rejects(AuditLog.findByIdAndUpdate(log._id, { ip: 'x' }), blocked);
  await assert.rejects(AuditLog.deleteOne({ _id: log._id }), blocked);
  await assert.rejects(AuditLog.deleteMany({}), blocked);
  await assert.rejects(AuditLog.findByIdAndDelete(log._id), blocked);
  const doc = await AuditLog.findById(log._id);
  doc.metadata = { reason: 'sửa' };
  await assert.rejects(doc.save(), blocked);
  await assert.rejects(doc.deleteOne(), blocked);

  assert.equal((await AuditLog.findById(log._id).lean()).metadata.reason, 'gốc');
  await logAudit({ action: 'ACCOUNT_UNLOCKED', targetType: 'users' });
  assert.equal(await AuditLog.countDocuments(), 2);
});

test('BR-S10: không truyền ip thì lấy IP của request đang xử lý; ngoài request thì để trống', async () => {
  const inRequest = await new Promise((resolve, reject) => {
    requestContext({ ip: '203.0.113.7' }, {}, () => logAudit({ action: 'TICKET_CLOSED', targetType: 'tickets' }).then(resolve, reject));
  });
  assert.equal(inRequest.ip, '203.0.113.7');
  assert.equal((await logAudit({ action: 'TICKET_CLOSED', targetType: 'tickets', ip: '10.0.0.1' })).ip, '10.0.0.1');
  assert.equal((await logAudit({ action: 'CONTRACT_EXPIRED', targetType: 'contracts' })).ip, undefined);
});

test('UC06 bước 4: giá trị cũ / mới khi đổi vai trò và khóa tài khoản (UC03)', async () => {
  const manager = asUser(await createManager());
  const staff = await createUser('STAFF', { roleTitle: 'TECHNICIAN', activatedAt: new Date() });
  await updateInternal(manager, staff._id, { role: 'ACCOUNTANT' });
  await setStatus(manager, staff._id, { isActive: false });

  const res = await list(manager);
  const byAction = Object.fromEntries(res.body.data.map((l) => [l.action, l]));
  const roleChange = Object.fromEntries(byAction.ROLE_ASSIGNED.changes.map((c) => [c.field, [c.before, c.after]]));
  assert.deepEqual(roleChange.role, ['STAFF', 'ACCOUNTANT']);
  assert.deepEqual(roleChange.roleTitle, ['TECHNICIAN', null]);
  assert.equal(byAction.ROLE_ASSIGNED.actionLabel, 'Gán vai trò tài khoản');
  assert.deepEqual(byAction.ACCOUNT_LOCKED.changes, [{ field: 'isActive', before: true, after: false }]);
  assert.equal(byAction.ACCOUNT_LOCKED.actionLabel, 'Khóa tài khoản');
  assert.equal(byAction.ACCOUNT_LOCKED.targetName, staff.fullName); // bản ghi hiện tên, không hiện ObjectId
});

test('UC06: log cũ ghi targetType theo tên model ("Resident") vẫn hiện "Cư dân" và lọc được, không sửa dữ liệu gốc', async () => {
  const manager = asUser(await createManager());
  await AuditLog.collection.insertOne({ action: 'RESIDENT_CHANGES_EXPORTED', targetType: 'Resident', createdAt: new Date() });
  await logAudit({ action: 'RESIDENT_UPDATED', targetType: 'residents' });

  const res = await list(manager, '?targetType=residents');
  assert.equal(res.body.pagination.total, 2);
  const legacy = res.body.data.find((l) => l.action === 'RESIDENT_CHANGES_EXPORTED');
  assert.equal(legacy.targetType, 'residents');
  assert.equal(legacy.targetLabel, 'Cư dân');
  assert.equal((await AuditLog.findOne({ action: 'RESIDENT_CHANGES_EXPORTED' }).lean()).targetType, 'Resident');
});

test('UC06: bản ghi hiện mã dễ đọc; bản ghi đã xóa dùng metadata.code; không tra được thì null', async () => {
  const manager = asUser(await createManager());
  const apartment = await createApartment(null, { code: 'A-1203' });
  await logAudit({ action: 'APARTMENT_CHANGED', targetType: 'apartments', targetId: apartment._id });
  await logAudit({ action: 'TICKET_CLOSED', targetType: 'tickets', targetId: new mongoose.Types.ObjectId(), metadata: { code: 'TK-DA-XOA' } });
  await logAudit({ action: 'CONTRACT_EXPIRED', targetType: 'contracts', targetId: new mongoose.Types.ObjectId() });

  const { body } = await list(manager);
  const nameOf = (action) => body.data.find((l) => l.action === action).targetName;
  assert.equal(nameOf('APARTMENT_CHANGED'), 'A-1203');
  assert.equal(nameOf('TICKET_CLOSED'), 'TK-DA-XOA');
  assert.equal(nameOf('CONTRACT_EXPIRED'), null);
});

test('UC06 bước 4: đọc được thay đổi các module cũ ghi trong metadata; trường nhạy cảm bị ẩn', async () => {
  const manager = asUser(await createManager());
  await logAudit({ action: 'APARTMENT_CHANGED', targetType: 'apartments', metadata: { changes: { code: { from: 'A-1', to: 'A-2' } } } });
  await logAudit({ action: 'AMENITY_FEE_CHANGED', targetType: 'amenities', metadata: { name: 'Hồ bơi', changes: { bookingFee: [10000, 20000] } } });
  await logAudit({ action: 'CONFIG_CHANGED', targetType: 'system_configs', metadata: { key: 'TICKET_AUTO_CLOSE_DAYS', before: 7, after: 3 } });
  await logAudit({ action: 'PHONE_CHANGED', targetType: 'users', metadata: { from: '*******678', to: '*******999' } });
  await logAudit({ action: 'TICKET_ESCALATED', targetType: 'tickets', metadata: { code: 'TK-1', from: 'HIGH', to: 'URGENT' } });
  await logAudit({ action: 'RESIDENT_UPDATED', targetType: 'residents', before: { phone: '0912345678', note: 'a' }, after: { phone: '0987654321', note: 'b' } });

  const { body } = await list(manager);
  const changesOf = (action) => body.data.find((l) => l.action === action).changes;
  assert.deepEqual(changesOf('APARTMENT_CHANGED'), [{ field: 'code', before: 'A-1', after: 'A-2' }]);
  assert.deepEqual(changesOf('AMENITY_FEE_CHANGED'), [{ field: 'bookingFee', before: 10000, after: 20000 }]);
  assert.deepEqual(changesOf('CONFIG_CHANGED'), [{ field: 'TICKET_AUTO_CLOSE_DAYS', before: 7, after: 3 }]);
  assert.deepEqual(changesOf('PHONE_CHANGED'), [{ field: 'value', before: '*******678', after: '*******999' }]);
  assert.deepEqual(changesOf('TICKET_ESCALATED'), [{ field: 'priority', before: 'HIGH', after: 'URGENT' }]);
  assert.deepEqual(changesOf('RESIDENT_UPDATED'), [
    { field: 'phone', before: '[Đã ẩn]', after: '[Đã ẩn]' },
    { field: 'note', before: 'a', after: 'b' },
  ]);
  assert.equal(body.data.find((l) => l.action === 'AMENITY_FEE_CHANGED').metadata.name, 'Hồ bơi');
  assert.ok(!JSON.stringify(body).includes('0912345678'));
});

test('UC06 bước 5: xuất Excel đúng bộ lọc đang xem, có IP cho Trưởng BQL, việc xuất được ghi lại', async () => {
  const managerDoc = await createManager({ fullName: 'Trưởng BQL Xuất' });
  const manager = asUser(managerDoc);
  await logAudit({ action: 'ACCOUNT_LOCKED', user: manager, targetType: 'users', before: { isActive: true }, after: { isActive: false }, ip: '10.1.1.1' });
  await logAudit({ action: 'ACCOUNT_UNLOCKED', user: manager, targetType: 'users' });
  await logAudit({ action: 'CONTRACT_EXPIRED', targetType: 'contracts' }); // job tự chạy, không có IP

  const system = await readSheet(await download(manager, '?format=xlsx&action=CONTRACT_EXPIRED'));
  const systemRow = system.getWorksheet('Nhật ký').getRow(2).values;
  assert.equal(systemRow[2], 'Hệ thống');
  assert.equal(systemRow.at(-1), 'Hệ thống');

  const res = await download(manager, '?format=xlsx&action=ACCOUNT_LOCKED');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /nhat-ky-hoat-dong-\d{4}-\d{2}-\d{2}\.xlsx/);
  const wb = await readSheet(res);
  const overview = wb.getWorksheet('Tổng quan');
  assert.match(String(overview.getCell('A2').value), /Hành động: Khóa tài khoản/);
  assert.equal(overview.getCell('B5').value, 'Trưởng BQL Xuất');
  const sheet = wb.getWorksheet('Nhật ký');
  assert.equal(sheet.rowCount, 2); // tiêu đề + 1 dòng: chỉ đúng hành động đang lọc
  const header = sheet.getRow(1).values.slice(1);
  const row = Object.fromEntries(header.map((h, i) => [h, sheet.getRow(2).values[i + 1]]));
  assert.equal(row['Hành động'], 'Khóa tài khoản');
  assert.equal(row['Giá trị cũ → mới'], 'isActive: true → false');
  assert.equal(row.IP, '10.1.1.1');

  const exported = await AuditLog.findOne({ action: 'AUDIT_LOG_EXPORTED' }).lean();
  assert.equal(String(exported.performedBy), manager.id);
  assert.equal(exported.metadata.format, 'xlsx');
  assert.equal(exported.metadata.count, 1);
  assert.equal(exported.metadata.filters.action, 'ACCOUNT_LOCKED');
  assert.match(exported.ip, /127\.0\.0\.1/); // IP tự lấy từ request

  const pdf = await download(manager, '?format=pdf');
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('UC06 bước 5: Ban quản trị chỉ xuất phần tài chính, không có cột IP; không có dữ liệu → MSG-D01; Kế toán bị chặn', async () => {
  const manager = asUser(await createManager());
  const board = asUser(await createUser('BOARD', { boardTitle: 'MEMBER' }));
  await logAudit({ action: 'ACCOUNT_LOCKED', user: manager, targetType: 'users', ip: '10.1.1.1' });
  await logAudit({ action: 'FUND_INCOME_RECORDED', user: manager, targetType: 'fund_transactions', metadata: { amount: 5000 }, ip: '10.1.1.2' });

  const res = await download(board, '?format=xlsx');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /nhat-ky-tai-chinh-/);
  const sheet = (await readSheet(res)).getWorksheet('Nhật ký');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getRow(2).getCell(3).value, 'Ghi nhận thu quỹ');
  assert.ok(!sheet.getRow(1).values.includes('IP'));

  const empty = await download(board, '?format=xlsx&action=ACCOUNT_LOCKED');
  assert.equal(empty.status, 404);
  assert.equal((await empty.json()).errorCode, 'NO_DATA');
  assert.equal((await download(asUser(await createUser('ACCOUNTANT')), '?format=xlsx')).status, 403);
  assert.equal((await download(manager, '?format=doc')).status, 400);
});

test('UC06 bước 5: quá giới hạn dòng thì yêu cầu thu hẹp bộ lọc, không cắt bớt (BR-D02)', async () => {
  const manager = asUser(await createManager());
  const now = new Date();
  await AuditLog.collection.insertMany(
    Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ({ action: 'TICKET_CLOSED', targetType: 'tickets', createdAt: now })),
  );
  const res = await download(manager, '?format=xlsx');
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /thu hẹp/);
  assert.equal(await AuditLog.countDocuments({ action: 'AUDIT_LOG_EXPORTED' }), 0);
});
