// audit_logs cũ ghi targetType theo tên model ('Contract', 'GatePass'...) → đổi về tên collection (AUDIT_TARGETS).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../../src/models/index.js';
import { ERROR_CODES } from '../../src/constants/errorCodes.js';
import { migrateAuditTargets } from '../../scripts/migrateAuditTargets.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('đổi targetType tên model → tên collection, chạy lại không đổi gì', async () => {
  await AuditLog.collection.insertMany([
    { action: 'CONTRACT_CREATED', targetType: 'Contract' },
    { action: 'GATEPASS_CREATED', targetType: 'GatePass' },
    { action: 'TICKET_ASSIGNED', targetType: 'tickets' },
  ]);
  assert.equal(await migrateAuditTargets(), 2);
  const types = (await AuditLog.find().sort({ action: 1 }).lean()).map((l) => l.targetType);
  assert.deepEqual(types, ['contracts', 'gate_passes', 'tickets']);
  assert.equal(await migrateAuditTargets(), 0);
});

test('có mã lỗi riêng khi đã có Trưởng BQT đang hoạt động', () => {
  assert.equal(ERROR_CODES.CHAIRMAN_ALREADY_EXISTS.status, 409);
});
