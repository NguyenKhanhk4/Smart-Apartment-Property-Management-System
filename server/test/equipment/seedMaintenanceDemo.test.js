// Script seed demo luồng bảo trì (giai đoạn 11) chạy trên DB test: chế độ xem không ghi gì; --apply tạo đúng tình huống demo;
// chạy lại không tạo trùng.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { seedMaintenanceDemo } from '../../scripts/seedMaintenanceDemo.js';
import { Asset, MaintenanceFund, WorkOrder } from '../../src/models/index.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as repair from '../../src/modules/workOrders/workOrders.repair.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { stubCloudinary } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createTechnician, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
beforeEach(() => stubCloudinary());
afterEach(async () => {
  mock.restoreAll();
  await clearTestDB();
});
after(closeTestDB);

const quiet = () => {};
async function accounts({ withManager = true } = {}) {
  const manager = withManager ? await createManager() : null;
  await createUser('ACCOUNTANT');
  const tech = await createTechnician();
  for (let i = 0; i < 3; i += 1) await createUser('BOARD', { boardTitle: i === 0 ? 'CHAIRMAN' : 'MEMBER' });
  await createBuilding();
  return { manager: manager && asUser(manager), tech: asUser(tech) };
}

test('thiếu tài khoản → báo lỗi, không tự tạo; chế độ xem không ghi gì (kể cả không tạo quỹ)', async () => {
  await createManager();
  await assert.rejects(seedMaintenanceDemo({ log: quiet }), /Thiếu Kế toán, Kỹ thuật viên, ≥ 3 Ban quản trị/);
  await accounts({ withManager: false });
  const lines = [];
  await seedMaintenanceDemo({ log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /DEMO-TM-A/.test(l)));
  assert.ok(lines.some((l) => /Phiếu thu quỹ 200\.000\.000/.test(l)));
  assert.equal(await Asset.countDocuments(), 0);
  assert.equal(await WorkOrder.countDocuments(), 0);
  assert.equal(await MaintenanceFund.countDocuments(), 0);
});

test('--apply: đủ 3 tình huống demo (bắt buộc Quỹ do cộng dồn, còn bảo hành, thang máy chờ báo hư hỏng) + quỹ 200 triệu; chạy lại bị chặn', async () => {
  const { manager, tech } = await accounts();
  await seedMaintenanceDemo({ apply: true, log: quiet });
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 200_000_000);

  // B: phiếu mới 15 triệu + 40 triệu vận hành 10 ngày trước = 55 triệu → bắt buộc Quỹ
  const pump = await Asset.findOne({ code: 'DEMO-BOM-B' }).lean();
  const pumpOrder = await WorkOrder.findOne({ assetId: pump._id, status: 'AWAITING_REPAIR_APPROVAL' }).lean();
  const policy = await decision.repairPolicy(pumpOrder);
  assert.equal(policy.spentInWindow, 40_000_000);
  assert.equal(policy.fundRequired, true);
  await assert.rejects(decision.decideRepair(manager, pumpOrder._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_REQUIRED' });

  // C: còn bảo hành → chọn Bảo hành được
  const gen = await Asset.findOne({ code: 'DEMO-MP-C' }).lean();
  const genOrder = await WorkOrder.findOne({ assetId: gen._id, status: 'AWAITING_REPAIR_APPROVAL' }).lean();
  assert.equal((await decision.repairPolicy(genOrder)).warrantyActive, true);
  assert.equal((await decision.decideRepair(manager, genOrder._id, { decision: 'APPROVE', costSource: 'WARRANTY' })).status, 'UNDER_REPAIR');

  // A: KTV báo hư hỏng 180 triệu được ngay
  const lift = await Asset.findOne({ code: 'DEMO-TM-A' }).lean();
  const liftOrder = await WorkOrder.findOne({ assetId: lift._id }).lean();
  const photo = { originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]) };
  const reported = await repair.reportFault(tech, liftOrder._id, {
    faultDesc: 'Cáp tải mòn, phanh không ăn', vendorProposal: 'Thay cáp và phanh', estimatedCost: 180_000_000,
  }, [photo]);
  assert.equal(reported.status, 'AWAITING_REPAIR_APPROVAL');
  assert.equal((await decision.repairPolicy(reported)).fundRequired, true);

  await assert.rejects(seedMaintenanceDemo({ apply: true, log: quiet }), /Đã có thiết bị demo/);
  assert.equal(await Asset.countDocuments({ code: /^DEMO-/ }), 3);
});
