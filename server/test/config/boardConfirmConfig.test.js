// Giai đoạn 8 (BR-S12): Trưởng BQL đổi tham số tài chính (ngưỡng Quỹ, cửa sổ cộng dồn, tỷ lệ biểu quyết) → chờ Ban quản trị
// xác nhận mới có hiệu lực; tham số khác vẫn đổi trực tiếp.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { AuditLog, Notification, SystemConfig } from '../../src/models/index.js';
import { repairSettings } from '../../src/modules/workOrders/workOrders.decision.js';
import { getConfig } from '../../src/services/systemConfig.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApi } from '../helpers/equipment.js';
import { createUser } from '../helpers/fixtures.js';

let server;
let api;
before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api } = server);
});
afterEach(clearTestDB);
after(async () => {
  await server.close();
  await closeTestDB();
});

const KEY = 'REPAIR_FUND_THRESHOLD';
const setup = async () => ({
  manager: await createUser('MANAGER'),
  accountant: await createUser('ACCOUNTANT'),
  board: [await createUser('BOARD', { boardTitle: 'CHAIRMAN' }), await createUser('BOARD', { boardTitle: 'MEMBER' })],
});

test('đổi ngưỡng → chờ xác nhận, giá trị đang dùng giữ 50 triệu; đổi lần 2 khi đang chờ → 409; Ban quản trị xác nhận → có hiệu lực ngay', async () => {
  const { manager, board } = await setup();
  const res = await api('PATCH', `/system-configs/${KEY}`, manager, { value: 80_000_000 });
  assert.equal(res.status, 200);
  assert.match(res.body.message, /chờ Ban quản trị xác nhận/);
  assert.equal(res.body.data.value, 50_000_000);
  assert.equal(res.body.data.pendingValue, 80_000_000);
  // Giá trị đang dùng chưa đổi: duyệt sửa vẫn so với 50 triệu
  assert.equal(await getConfig(KEY), 50_000_000);
  assert.equal((await repairSettings()).fundThreshold, 50_000_000);
  for (const m of board) assert.ok(await Notification.exists({ userId: m._id, title: 'Thay đổi tham số chờ Ban quản trị xác nhận' }));
  assert.ok(await AuditLog.exists({ action: 'CONFIG_CHANGE_REQUESTED', 'metadata.key': KEY, 'metadata.after': 80_000_000 }));

  const again = await api('PATCH', `/system-configs/${KEY}`, manager, { value: 90_000_000 });
  assert.equal(again.status, 409);
  assert.equal(again.body.errorCode, 'CONFIG_AWAITING_BOARD');
  assert.match(again.body.message, /Đang chờ Ban quản trị xác nhận đổi thành 80000000/);

  const pending = await api('GET', '/system-configs/pending', board[1]);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.data.map((c) => [c.key, c.pendingValue]), [[KEY, 80_000_000]]);
  assert.equal((await api('GET', '/system-configs/pending', manager)).status, 200);

  const ok = await api('POST', `/system-configs/${KEY}/approve`, board[1]);
  assert.equal(ok.status, 200);
  assert.equal(await getConfig(KEY), 80_000_000);
  assert.equal((await repairSettings()).fundThreshold, 80_000_000);
  const doc = await SystemConfig.findOne({ key: KEY }).lean();
  assert.equal(doc.pendingValue, null);
  assert.equal(String(doc.confirmedBy), String(board[1]._id));
  assert.equal(String(doc.updatedBy), String(manager._id)); // người đề nghị đổi
  assert.ok(await AuditLog.exists({ action: 'CONFIG_CHANGE_CONFIRMED', performedBy: board[1]._id, 'metadata.before': 50_000_000, 'metadata.after': 80_000_000 }));
  assert.ok(await Notification.exists({ userId: manager._id, title: 'Ban quản trị đã xác nhận thay đổi tham số' }));

  // Không còn gì chờ → xác nhận lần nữa 409; giờ đổi tiếp được
  assert.equal((await api('POST', `/system-configs/${KEY}/approve`, board[0])).status, 409);
  assert.equal((await api('PATCH', `/system-configs/${KEY}`, manager, { value: 70_000_000 })).status, 200);
});

test('Ban quản trị từ chối (bắt buộc lý do) → giữ giá trị cũ, xóa giá trị chờ, báo Trưởng BQL', async () => {
  const { manager, board } = await setup();
  await api('PATCH', '/system-configs/FUND_APPROVAL_RATIO', manager, { value: 0.6 });
  assert.equal((await api('POST', '/system-configs/FUND_APPROVAL_RATIO/reject', board[0], { reason: 'ab' })).status, 400);
  const res = await api('POST', '/system-configs/FUND_APPROVAL_RATIO/reject', board[0], { reason: 'Giữ quá bán theo quy chế' });
  assert.equal(res.status, 200);
  assert.equal(await getConfig('FUND_APPROVAL_RATIO'), 0.5);
  assert.equal((await SystemConfig.findOne({ key: 'FUND_APPROVAL_RATIO' }).lean()).pendingValue, null);
  assert.ok(await AuditLog.exists({ action: 'CONFIG_CHANGE_REJECTED', 'metadata.proposed': 0.6, 'metadata.reason': 'Giữ quá bán theo quy chế' }));
  assert.match((await Notification.findOne({ userId: manager._id, title: /không đồng ý thay đổi tham số/ }).lean()).content, /Giữ quá bán/);
});

test('giá trị chờ vẫn qua kiểm tra hợp lệ; trùng giá trị đang dùng → 400; tham số khác đổi trực tiếp như cũ', async () => {
  const { manager } = await setup();
  assert.equal((await api('PATCH', '/system-configs/FUND_APPROVAL_RATIO', manager, { value: 1.5 })).status, 400);
  assert.equal((await api('PATCH', '/system-configs/REPAIR_OPERATING_WINDOW_DAYS', manager, { value: 30 })).status, 400);
  assert.equal(await SystemConfig.countDocuments({ pendingValue: { $ne: null } }), 0);

  const direct = await api('PATCH', '/system-configs/PAYMENT_TERM_DAYS', manager, { value: 20 });
  assert.equal(direct.status, 200);
  assert.equal(await getConfig('PAYMENT_TERM_DAYS'), 20);
  assert.ok(await AuditLog.exists({ action: 'CONFIG_CHANGED', 'metadata.key': 'PAYMENT_TERM_DAYS' }));
});

test('phân quyền: chỉ Ban quản trị xác nhận / từ chối; Kế toán không xem danh sách chờ; khóa không cần xác nhận → 404', async () => {
  const { manager, accountant, board } = await setup();
  await api('PATCH', `/system-configs/${KEY}`, manager, { value: 80_000_000 });
  assert.equal((await api('POST', `/system-configs/${KEY}/approve`, manager)).status, 403);
  assert.equal((await api('POST', `/system-configs/${KEY}/reject`, manager, { reason: 'Tự từ chối' })).status, 403);
  assert.equal((await api('GET', '/system-configs/pending', accountant)).status, 403);
  assert.equal((await api('POST', '/system-configs/PAYMENT_TERM_DAYS/approve', board[0])).status, 404);
  assert.equal(await getConfig(KEY), 50_000_000);
});
