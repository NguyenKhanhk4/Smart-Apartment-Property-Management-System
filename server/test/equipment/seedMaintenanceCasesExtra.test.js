// Chạy script 6 trường hợp bổ sung trên DB test: kiểm trạng thái và chính sách nguồn chi của từng thiết bị.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { seedMaintenanceCasesExtra } from '../../scripts/seedMaintenanceCasesExtra.js';
import { Asset, Building, WorkOrder } from '../../src/models/index.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as expense from '../../src/modules/workOrders/workOrders.expense.js';
import { generateMaintenanceWorkOrders, remindRepairFollowups } from '../../src/modules/workOrders/workOrders.jobs.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { stubCloudinary } from '../helpers/equipment.js';
import { createManager, createTechnician, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
beforeEach(() => stubCloudinary());
afterEach(async () => {
  mock.restoreAll();
  await clearTestDB();
});
after(closeTestDB);

const quiet = () => {};

test('chế độ xem không ghi; --apply tạo đủ 6 trường hợp đúng trạng thái và chính sách; chạy lại bị chặn', async () => {
  await createManager();
  await createUser('ACCOUNTANT');
  await createTechnician();
  await createTechnician();
  await Building.create({ code: 'T3', name: 'Block C', address: 'x', floors: 20 });

  await seedMaintenanceCasesExtra({ log: quiet });
  assert.equal(await Asset.countDocuments(), 0);

  assert.equal(await seedMaintenanceCasesExtra({ apply: true, log: quiet }), 7);
  const last = async (code, extra = {}) => WorkOrder.findOne({ assetId: (await Asset.findOne({ code }))._id, ...extra }).sort({ createdAt: -1 }).lean();

  const w13 = await last('TB-013');
  assert.equal(w13.status, 'AWAITING_REPAIR_APPROVAL');
  assert.equal((await decision.repairPolicy(w13)).fundRequired, true);

  const w14 = await last('TB-014', { status: 'AWAITING_REPAIR_APPROVAL' });
  assert.equal(w14.type, 'SCHEDULED');
  const p14 = await decision.repairPolicy(w14);
  assert.equal(p14.spentInWindow, 35_000_000);
  assert.equal(p14.total, 55_000_000);
  assert.equal(p14.fundRequired, true);

  const p15 = await decision.repairPolicy(await last('TB-015'));
  assert.equal(p15.warrantyActive, true);
  assert.equal(p15.fundRequired, false);

  const awaiting = await expense.listAwaitingExpense();
  assert.deepEqual(awaiting.map((w) => w.assetId.code), ['TB-016']);

  const w17 = await last('TB-017');
  assert.equal(w17.status, 'IN_PROGRESS');
  assert.equal(w17.result, 'FAULTY');
  assert.equal(w17.repair, null);

  const w18 = await last('TB-018');
  assert.equal(w18.status, 'PENDING');
  assert.equal(w18.assignedTo, null);

  // Job: không tạo phiếu chồng; nhắc Kế toán ghi chi TB-016 (xong 5 ngày trước, quá 3 ngày)
  assert.equal(await generateMaintenanceWorkOrders(), 0);
  assert.equal(await remindRepairFollowups(), 1);

  await assert.rejects(seedMaintenanceCasesExtra({ apply: true, log: quiet }), /Mã thiết bị đã có/);
});
