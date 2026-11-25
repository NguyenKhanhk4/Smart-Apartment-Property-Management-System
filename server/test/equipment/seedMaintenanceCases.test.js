// Chạy script 10 trường hợp luồng bảo trì trên DB test dựng giống DB thật: kiểm trạng thái cuối từng trường hợp.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { seedMaintenanceCases } from '../../scripts/seedMaintenanceCases.js';
import { Asset, AuditLog, Building, FundProposal, MaintenanceFund, WorkOrder } from '../../src/models/index.js';
import { recordIncome } from '../../src/modules/fund/fund.service.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import { generateMaintenanceWorkOrders } from '../../src/modules/workOrders/workOrders.jobs.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { stubCloudinary } from '../helpers/equipment.js';
import { asUser, createManager, createTechnician, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
beforeEach(() => stubCloudinary());
afterEach(async () => {
  mock.restoreAll();
  await clearTestDB();
});
after(closeTestDB);

const quiet = () => {};
async function likeAtlas() {
  await createManager();
  const accountant = await createUser('ACCOUNTANT');
  await createTechnician();
  await createTechnician();
  await createUser('BOARD', { boardTitle: 'CHAIRMAN' });
  await createUser('BOARD', { boardTitle: 'MEMBER' });
  const [a, b] = await Building.create([
    { code: 'A', name: 'Block A', floors: 20 }, { code: 'B', name: 'Block B', floors: 20 }, { code: 'T3', name: 'Block C', floors: 20 },
  ].map((x) => ({ ...x, address: 'x' }))).then((r) => r);
  const specs = [
    ['TB-001', 'Thang máy số 1 Block A', 'ELEVATOR', a, 30], ['TB-002', 'Thang máy số 2 Block A', 'ELEVATOR', a, 30],
    ['TB-004', 'Hệ thống PCCC Block A', 'FIRE_SYSTEM', a, 180], ['TB-005', 'Thang máy số 1 Block B', 'ELEVATOR', b, 30],
    ['TB-006', 'Thang máy số 2 Block B', 'ELEVATOR', b, 30], ['TB-008', 'Hệ thống PCCC Block B', 'FIRE_SYSTEM', b, 180],
  ];
  for (const [code, name, category, bld, days] of specs) {
    await Asset.create({ buildingId: bld._id, code, name, category, cycleValue: days, cycleUnit: 'DAY', nextMaintenanceDate: new Date(Date.now() - 40 * DAY_MS) });
  }
  await recordIncome(asUser(accountant), { incomeSource: 'INITIAL_HANDOVER', amount: 1_264_000_000, documentNo: 'BB-001' });
}

test('chế độ xem không ghi gì; --apply tạo đủ 10 trường hợp đúng trạng thái; chạy lại bị chặn', async () => {
  await likeAtlas();
  await seedMaintenanceCases({ log: quiet });
  assert.equal(await WorkOrder.countDocuments(), 0);
  assert.equal(await Asset.countDocuments(), 6);

  assert.equal(await seedMaintenanceCases({ apply: true, log: quiet }), 11);
  const wo = async (code, extra = {}) => WorkOrder.findOne({ assetId: (await Asset.findOne({ code }))._id, ...extra }).sort({ createdAt: -1 }).lean();
  const prop = async (code) => FundProposal.findOne({ workOrderId: (await wo(code))._id }).sort({ createdAt: -1 }).lean();

  // 1
  assert.equal((await wo('TB-001')).status, 'DONE');
  const p1 = await prop('TB-001');
  assert.equal(p1.status, 'PAID');
  assert.deepEqual(p1.history.map((h) => h.action), ['SUBMITTED', 'VENDOR_SELECTED', 'APPROVED', 'BOARD_ACCEPTED', 'PAID']);
  // 2
  assert.equal((await wo('TB-002')).status, 'AWAITING_BOARD_ACCEPTANCE');
  assert.equal((await prop('TB-002')).status, 'APPROVED');
  // 3
  const w3 = await wo('TB-004');
  assert.equal(w3.status, 'AWAITING_REPAIR_APPROVAL');
  assert.equal(w3.repair.costSource, null); // rút đề xuất → bỏ nguồn Quỹ, chờ quyết định lại
  assert.equal((await prop('TB-004')).status, 'CANCELLED');
  // 4
  const w4 = await wo('TB-005');
  assert.equal(w4.status, 'UNDER_REPAIR');
  assert.equal(w4.repair.isEmergency, true);
  assert.equal((await prop('TB-005')).status, 'PENDING');
  // 5
  assert.equal((await wo('TB-006', { status: 'DONE' })).repair.actualCost, 40_000_000);
  const w5 = await wo('TB-006', { status: 'AWAITING_REPAIR_APPROVAL' });
  const policy = await decision.repairPolicy(w5);
  assert.equal(policy.total, 55_000_000);
  assert.equal(policy.fundRequired, true);
  // 6
  const w6 = await wo('TB-008');
  assert.equal(w6.status, 'REPAIR_POSTPONED');
  assert.deepEqual(w6.repair.history.map((h) => h.action), ['REPORTED', 'FUND_REQUESTED', 'FUND_REJECTED', 'POSTPONED']);
  assert.equal((await prop('TB-008')).status, 'REJECTED');
  // 7
  const w7 = await wo('TB-009');
  assert.equal(w7.status, 'AWAITING_ACCEPTANCE');
  assert.equal(w7.repair.costSource, 'WARRANTY');
  // 8
  const p8 = await prop('TB-010');
  assert.equal(p8.status, 'PENDING');
  assert.equal(p8.votes.length, 1);
  // 9
  assert.equal((await wo('TB-011')).status, 'CLOSED');
  assert.equal((await Asset.findOne({ code: 'TB-011' }).lean()).isActive, false);
  // 10
  const w10 = await wo('TB-012');
  assert.equal(w10.status, 'DONE');
  assert.equal(w10.result, 'PASSED');

  // Số dư: 1.264tr − 175tr đã chi
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 1_089_000_000);
  assert.ok(await AuditLog.countDocuments() > 40);
  // Job tạo phiếu sau đó không sinh phiếu chồng cho thiết bị đang sửa / chờ xác nhận
  assert.equal(await generateMaintenanceWorkOrders(), 0);

  await assert.rejects(seedMaintenanceCases({ apply: true, log: quiet }), /đã có .* phiếu bảo trì/);
});
