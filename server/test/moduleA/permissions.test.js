// UC04 – Phân quyền theo vai trò (BR-S07, BR-X2, BR-X3): quyền trần đọc từ authorize(), chỉ tắt được trong phạm vi đó
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_PERMISSIONS, FEATURES, ROLE_KEYS, actionOf, featureOf, normalizePath } from '../../src/constants/permissions.js';
import { AuditLog, RolePermission } from '../../src/models/index.js';
import { buildCeiling, invalidatePermissionCache } from '../../src/modules/permissions/permissions.service.js';
import apiRouter from '../../src/routes.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { USERS, startApp } from '../helpers/http.js';

let app;
let ceiling;
before(async () => {
  await connectTestDB();
  app = await startApp();
  ceiling = await buildCeiling(apiRouter);
});
afterEach(async () => {
  await clearTestDB();
  invalidatePermissionCache();
});
after(async () => {
  await app.close();
  await closeTestDB();
});

const get = (path, user) => app.request('GET', path, { user });
const save = (roleKey, granted, user = USERS.manager) => app.request('PUT', `/permissions/roles/${roleKey}`, { user, body: { granted } });
const grantedOf = (matrix) => matrix.features.flatMap((f) => Object.entries(f.actions).filter(([, a]) => a.granted).map(([a]) => `${f.code}:${a}`));

test('suy ra chức năng và hành động từ đường dẫn + phương thức', () => {
  const path = (p) => normalizePath(p);
  assert.equal(path('/tickets/64b000000000000000000001/claim'), '/tickets/:id/claim');
  assert.equal(actionOf('GET', path('/tickets')), 'VIEW');
  assert.equal(actionOf('POST', path('/tickets')), 'CREATE');
  assert.equal(actionOf('POST', path('/invoices/submit')), 'CREATE');
  assert.equal(actionOf('PATCH', path('/tickets/:id/claim')), 'UPDATE');
  assert.equal(actionOf('POST', path('/fund/proposals/:id/expense')), 'UPDATE');
  assert.equal(actionOf('PATCH', path('/vehicles/:id/approve')), 'APPROVE');
  assert.equal(actionOf('POST', path('/fund/proposals/:id/votes')), 'APPROVE');
  assert.equal(actionOf('POST', path('/invoices/publish')), 'APPROVE');
  assert.equal(actionOf('DELETE', path('/announcements/:id')), 'DELETE');
  assert.equal(actionOf('POST', path('/bookings/check-in-by-qr')), 'UPDATE'); // ngoại lệ
  assert.equal(featureOf('/users/internal').code, 'STAFF_ACCOUNTS');
  assert.equal(featureOf('/users/me/password'), null); // hồ sơ của chính mình nằm ngoài ma trận
  assert.equal(featureOf('/auth/login'), null);
  assert.equal(featureOf('/plates/lookup').code, 'PARKING_GATE');
});

test('mọi chức năng trong danh mục đều có route thật; quyền lõi (BR-X3) nằm trong quyền trần của vai trò', () => {
  const allKeys = new Set([...ceiling.values()].flatMap((s) => [...s]));
  const unmounted = FEATURES.filter((f) => ![...allKeys].some((k) => k.startsWith(`${f.code}:`))).map((f) => f.code);
  assert.deepEqual(unmounted, []);
  for (const role of ROLE_KEYS) {
    const missing = CORE_PERMISSIONS[role].filter((k) => !ceiling.get(role).has(k));
    assert.deepEqual(missing, [], `${role}: quyền lõi không còn route nào cho phép (ai đó đã đổi authorize?)`);
  }
});

test('quyền trần đúng authorize(): Kế toán lập được thông báo phí nhưng không duyệt; Ban quản trị duyệt quỹ', () => {
  const accountant = ceiling.get('ACCOUNTANT');
  assert.ok(accountant.has('INVOICES:CREATE'));
  assert.ok(!accountant.has('INVOICES:APPROVE'));
  assert.ok(ceiling.get('BOARD').has('FUND:APPROVE'));
  assert.ok(!ceiling.get('TECHNICIAN').has('STAFF_ACCOUNTS:VIEW'));
  // Báo giá sửa chữa: Bảo vệ không xem. Bảng giá hiện hành: mọi vai trò xem (thiết kế của Khánh), Trưởng BQL tắt riêng được
  assert.ok(!ceiling.get('SECURITY').has('REPAIR_QUOTES:VIEW'));
  assert.ok(ceiling.get('RESIDENT').has('REPAIR_QUOTES:VIEW'));
  assert.ok(ceiling.get('SECURITY').has('FEE_TYPES:VIEW'));
});

test('Bảo vệ gọi thẳng API báo giá của phiếu → 403; giá hiện hành xem được, tắt trong ma trận thì bị chặn', async () => {
  assert.equal((await get('/repair-quotes/ticket/64b000000000000000000009', USERS.security)).status, 403);
  assert.equal((await get('/fee-types/current', USERS.security)).status, 200);
  await save('SECURITY', [...ceiling.get('SECURITY')].filter((k) => k !== 'FEE_TYPES:VIEW'));
  assert.equal((await get('/fee-types/current', USERS.security)).status, 403);
  assert.equal((await get('/fee-types/current', USERS.technician)).status, 200);
});

test('UC04 bước 2: ma trận đánh dấu ô lõi; vai trò Trưởng BQL chỉ đọc; chỉ Trưởng BQL xem và sửa được', async () => {
  const res = await get('/permissions/roles/TECHNICIAN', USERS.manager);
  assert.equal(res.status, 200);
  const tickets = res.body.data.features.find((f) => f.code === 'TICKETS');
  assert.deepEqual(tickets.actions.UPDATE, { available: true, granted: true, core: true });
  assert.equal(tickets.actions.DELETE.available, false);
  assert.equal(res.body.data.readOnly, false);

  assert.equal((await get('/permissions/roles/MANAGER', USERS.manager)).body.data.readOnly, true);
  assert.equal((await get('/permissions/roles/TECHNICIAN', USERS.receptionist)).status, 403);
  assert.equal((await save('TECHNICIAN', [], USERS.receptionist)).status, 403);
  assert.equal((await get('/permissions/roles/KHONG_CO', USERS.manager)).status, 400);
});

test('BR-X2, BR-X3: không sửa vai trò Trưởng BQL; không bỏ được quyền lõi; không cấp được quyền ngoài phạm vi', async () => {
  const readOnly = await save('MANAGER', []);
  assert.equal(readOnly.status, 403);
  assert.equal(readOnly.body.errorCode, 'ROLE_READ_ONLY');

  const all = [...ceiling.get('TECHNICIAN')];
  const core = await save('TECHNICIAN', all.filter((k) => k !== 'TICKETS:UPDATE'));
  assert.equal(core.status, 400);
  assert.equal(core.body.errorCode, 'CORE_PERMISSION');
  assert.match(JSON.stringify(core.body.details), /Sự cố và phản ánh – Sửa/);

  const outside = await save('TECHNICIAN', [...all, 'STAFF_ACCOUNTS:VIEW']);
  assert.equal(outside.status, 400);
  assert.equal(await RolePermission.countDocuments(), 0); // không lưu gì khi lỗi
});

test('UC04 bước 5–6: tắt quyền có hiệu lực ngay ở request kế tiếp (API và menu), bật lại thì dùng lại được; có audit cũ / mới', async () => {
  assert.equal((await get('/announcements', USERS.receptionist)).status, 200);

  const all = [...ceiling.get('RECEPTIONIST')];
  const saved = await save('RECEPTIONIST', all.filter((k) => k !== 'ANNOUNCEMENTS:VIEW'));
  assert.equal(saved.status, 200);
  assert.ok(!grantedOf(saved.body.data).includes('ANNOUNCEMENTS:VIEW'));

  const blocked = await get('/announcements', USERS.receptionist);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.errorCode, 'PERMISSION_REVOKED');
  assert.equal((await get('/announcements', USERS.manager)).status, 200); // Trưởng BQL không bị ảnh hưởng
  assert.equal((await get('/announcements', USERS.technician)).status, 200); // vai trò khác không bị ảnh hưởng
  const me = await get('/permissions/me', USERS.receptionist);
  assert.deepEqual(me.body.data.hiddenMenuKeys, ['announcements']);

  const log = await AuditLog.findOne({ action: 'ROLE_PERMISSIONS_CHANGED' }).lean();
  assert.deepEqual(log.before, { 'Bảng tin – Xem': true });
  assert.deepEqual(log.after, { 'Bảng tin – Xem': false });
  assert.equal(log.metadata.roleKey, 'RECEPTIONIST');

  await save('RECEPTIONIST', all);
  assert.equal((await get('/announcements', USERS.receptionist)).status, 200);
  assert.deepEqual((await get('/permissions/me', USERS.receptionist)).body.data.hiddenMenuKeys, []);
});

test('module đặt authenticate ở cấp router: hành động lấy theo mẫu route, không đoán theo đường dẫn thật', async () => {
  // POST /fund/proposals/:id/expense là "Sửa". Tham số không phải ObjectId mà đoán theo đường dẫn thật sẽ thành "Tạo"
  await save('ACCOUNTANT', [...ceiling.get('ACCOUNTANT')].filter((k) => k !== 'FUND:UPDATE'));
  const res = await app.request('POST', '/fund/proposals/khong-phai-id/expense', { user: { role: 'ACCOUNTANT' }, body: {} });
  assert.equal(res.status, 403);
  assert.equal(res.body.errorCode, 'PERMISSION_REVOKED');
  // Quyền khác của cùng module vẫn dùng được
  assert.notEqual((await get('/fund/proposals', { role: 'ACCOUNTANT' })).status, 403);
});

test('BR-X3: quyền lõi lỡ nằm trong danh sách tắt (sửa thẳng DB) vẫn không bị chặn', async () => {
  await RolePermission.create({ roleKey: 'TECHNICIAN', revoked: ['TICKETS:VIEW', 'ANNOUNCEMENTS:VIEW'] });
  assert.equal((await get('/tickets', USERS.technician)).status, 200);
  assert.equal((await get('/announcements', USERS.technician)).status, 403);
  assert.deepEqual((await get('/permissions/me', USERS.technician)).body.data.revoked, ['ANNOUNCEMENTS:VIEW']);
});
