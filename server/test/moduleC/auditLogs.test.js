import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../../src/models/index.js';
import { logAudit } from '../../src/services/auditLog.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';

let app;
before(async () => { await connectTestDB(); app = await startApp(); });
afterEach(clearTestDB);
after(async () => { await app?.close(); await closeTestDB(); });

async function setup() {
  const manager = asUser(await createManager());
  const board = asUser(await createUser('BOARD', { boardTitle: 'MEMBER' }));
  const accountant = asUser(await createUser('ACCOUNTANT'));
  return { manager, board, accountant };
}

test('audit: cần token; chỉ Manager/Board được đọc; không có API sửa/xóa', async () => {
  const { manager, accountant } = await setup();
  assert.equal((await app.request('GET', '/audit-logs')).status, 401);
  assert.equal((await app.request('GET', '/audit-logs', { user: accountant })).status, 403);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    assert.equal((await app.request(method, '/audit-logs', { user: manager, body: {} })).status, 404);
  }
});

test('Board chỉ thấy tài chính dù sửa filter; options không lộ action tài khoản', async () => {
  const { manager, board } = await setup();
  await logAudit({ action: 'ACCOUNT_LOCKED', user: manager, targetType: 'users', metadata: { reason: 'Riêng tư' } });
  await logAudit({ action: 'FUND_INCOME_RECORDED', user: manager, targetType: 'fund_transactions',
    metadata: { amount: 5000, unrelated: 'private-data' }, ip: '127.0.0.2' });
  await logAudit({ action: 'CONFIG_CHANGED', user: manager, targetType: 'system_configs',
    metadata: { key: 'FUND_LOW_BALANCE_THRESHOLD', before: 10, after: 20 } });
  await logAudit({ action: 'CONFIG_CHANGED', user: manager, targetType: 'system_configs',
    metadata: { key: 'SMTP_PASS', value: 'private-smtp-password' } });

  for (const action of ['FUND_PROPOSAL_CREATED', 'FUND_PROPOSAL_CANCELLED', 'FUND_WORK_ACCEPTED', 'FUND_EXPENSE_RECORDED']) {
    await logAudit({ action, user: manager, targetType: 'fund_proposals', metadata: { amount: 1000, code: 'PCQ-TEST', documentNo: 'CT-TEST' } });
    const filtered = await app.request('GET', '/audit-logs?action=' + action, { user: board });
    assert.equal(filtered.body.pagination.total, 1);
    assert.equal(filtered.body.data[0].metadata.code, 'PCQ-TEST');
    assert.equal(filtered.body.data[0].metadata.documentNo, 'CT-TEST');
  }
  const all = await app.request('GET', '/audit-logs', { user: manager });
  assert.equal(all.body.pagination.total, 8);
  const visible = await app.request('GET', '/audit-logs', { user: board });
  assert.equal(visible.body.pagination.total, 6);
  assert.ok(visible.body.data.every((x) => !('ip' in x)));
  assert.ok(!JSON.stringify(visible.body).includes('private-data'));
  assert.ok(!JSON.stringify(visible.body).includes('private-smtp-password'));
  assert.equal((await app.request('GET', '/audit-logs?action=ACCOUNT_LOCKED', { user: board })).body.pagination.total, 0);
  assert.equal((await app.request('GET', '/audit-logs?targetType=users', { user: board })).body.pagination.total, 0);
  const options = await app.request('GET', '/audit-logs/options', { user: board });
  assert.ok(!options.body.data.actions.some((x) => x.value === 'ACCOUNT_LOCKED'));
});

test('audit che secret/CCCD và cấu trúc thay đổi lồng nhau, không sửa log gốc', async () => {
  const { manager } = await setup();
  const original = {
    passwordHash: 'private-password', nested: { refreshToken: 'private-token', idNumber: '012345678901' },
    changes: [{ field: 'phone', before: '0912345678', after: '0987654321' }],
    config: { key: 'SMTP_PASS', value: 'private-smtp-password' }, reason: 'Giữ lý do bình thường',
  };
  const log = await logAudit({ action: 'ACCOUNT_LOCKED', user: manager, targetType: 'users', metadata: original });
  const res = await app.request('GET', '/audit-logs', { user: manager });
  assert.equal(res.status, 200);
  const text = JSON.stringify(res.body.data);
  for (const value of ['private-password', 'private-token', '012345678901', '0912345678', '0987654321', 'private-smtp-password']) {
    assert.ok(!text.includes(value), value);
  }
  assert.equal(res.body.data[0].metadata.reason, original.reason);
  assert.deepEqual((await AuditLog.findById(log._id).lean()).metadata, original);
});

test('audit lọc ngày VN, action, actor, target và phân trang ổn định', async () => {
  const { manager } = await setup();
  const accountant = await createUser('ACCOUNTANT', { fullName: 'Kế toán [TM]' });
  const target = accountant._id;
  for (const createdAt of ['2026-11-06T16:59:59Z', '2026-11-06T17:00:00Z', '2026-11-07T16:59:59Z', '2026-11-07T17:00:00Z']) {
    await AuditLog.create({ action: 'FUND_INCOME_RECORDED', targetType: 'fund_transactions',
      performedBy: accountant._id, targetId: target, createdAt });
  }
  const path = `/audit-logs?from=2026-11-07&to=2026-11-07&action=FUND_INCOME_RECORDED&performedBy=${accountant._id}&targetId=${target}&q=${encodeURIComponent('[TM]')}&limit=1`;
  const first = await app.request('GET', path, { user: manager });
  const second = await app.request('GET', path + '&page=2', { user: manager });
  assert.equal(first.body.pagination.total, 2);
  assert.equal(first.body.data.length, 1);
  assert.notEqual(first.body.data[0]._id, second.body.data[0]._id);
  assert.equal(first.body.data[0].performedBy.fullName, 'Kế toán [TM]');
  assert.ok(!('email' in first.body.data[0].performedBy));
  const bad = await app.request('GET', '/audit-logs?from=2026-11-08&to=2026-11-07', { user: manager });
  assert.equal(bad.status, 400);
  assert.equal((await app.request('GET', '/audit-logs?performedBy=bad', { user: manager })).status, 400);
});
