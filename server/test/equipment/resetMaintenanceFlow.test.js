// Script làm mới dữ liệu luồng bảo trì chạy trên DB test dựng giống Atlas (3 thành viên Ban quản trị, dữ liệu cũ lẫn lộn):
// xóa đúng phạm vi, giữ tài khoản + thông báo / nhật ký khác luồng, tạo lại đủ 16 trường hợp; chạy lại được nhiều lần.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { resetMaintenanceFlow } from '../../scripts/resetMaintenanceFlow.js';
import { Asset, AuditLog, Building, FundProposal, FundTransaction, MaintenanceFund, Notification, User, WorkOrder } from '../../src/models/index.js';
import { DAY_MS } from '../../src/utils/time.js';
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

async function likeAtlas() {
  const manager = await createManager();
  await createUser('ACCOUNTANT');
  await createTechnician();
  await createTechnician();
  await createUser('BOARD', { boardTitle: 'CHAIRMAN' });
  await createUser('BOARD', { boardTitle: 'MEMBER' });
  await createUser('BOARD', { boardTitle: 'MEMBER' });
  const [a, b] = await Building.create([
    { code: 'A', name: 'Block A', address: 'x', floors: 20 },
    { code: 'B', name: 'Block B', address: 'x', floors: 20 },
    { code: 'T3', name: 'Block C', address: 'x', floors: 20 },
  ]);
  const specs = [
    ['TB-001', 'ELEVATOR', a, 30], ['TB-002', 'ELEVATOR', a, 30], ['TB-003', 'PUMP', a, 30], ['TB-004', 'FIRE_SYSTEM', a, 180],
    ['TB-005', 'ELEVATOR', b, 30], ['TB-006', 'ELEVATOR', b, 30], ['TB-007', 'PUMP', b, 30], ['TB-008', 'FIRE_SYSTEM', b, 180],
  ];
  for (const [code, category, bld, days] of specs) {
    await Asset.create({ buildingId: bld._id, code, name: `Thiết bị ${code}`, category, cycleValue: days, cycleUnit: 'DAY', nextMaintenanceDate: new Date(Date.now() + 20 * DAY_MS) });
  }
  // Dữ liệu cũ của luồng cần xóa
  const junk = await Asset.create({ buildingId: a._id, code: 'TEST-UC07', name: 'Thiết bị thử', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH', nextMaintenanceDate: new Date() });
  await WorkOrder.create({ assetId: junk._id, type: 'SCHEDULED', status: 'PENDING', title: 'cũ', scheduledDate: new Date() });
  const fund = await MaintenanceFund.create({ buildingId: null, balance: 1_264_000_000 });
  await FundProposal.collection.insertOne({ fundId: fund._id, title: 'Đề xuất cũ không mã', amount: 180_000_000, status: 'APPROVED', proposedBy: manager._id });
  await FundTransaction.create({ fundId: fund._id, type: 'INCOME', amount: 1_264_000_000 });
  await Notification.create({ userId: manager._id, type: 'FUND_APPROVAL', title: 'Đề xuất chi quỹ cần xác nhận tài chính: cũ', content: 'x' });
  await AuditLog.collection.insertOne({ action: 'FUND_PROPOSAL_VERIFIED', targetType: 'fund_proposals', createdAt: new Date() }); // action cũ đã bỏ khỏi enum
  // Dữ liệu khác luồng phải giữ
  await Notification.create({ userId: manager._id, type: 'TICKET', title: 'Sự cố mới', content: 'giữ' });
  await AuditLog.create({ action: 'ROLE_ASSIGNED', targetType: 'users' });
}

test('chế độ xem không ghi gì; --apply xóa đúng phạm vi, giữ tài khoản và dữ liệu khác luồng, tạo lại 16 trường hợp; chạy lại được', async () => {
  await likeAtlas();
  const users = await User.countDocuments();

  const preview = await resetMaintenanceFlow({ log: quiet });
  assert.equal(preview.counts.work_orders, 1);
  assert.equal(preview.counts.assets, 1);
  assert.equal(await WorkOrder.countDocuments(), 1);

  for (let run = 1; run <= 2; run += 1) {
    const r = await resetMaintenanceFlow({ apply: true, log: quiet });
    // 500tr − 175tr đã chi (TB-001)
    assert.equal(r.balance, 325_000_000, `lần ${run}`);
    assert.equal(await User.countDocuments(), users, 'không đụng tài khoản');
    assert.equal(await WorkOrder.countDocuments(), 18); // 11 phiếu (10 trường hợp) + 7 phiếu (6 trường hợp)
    assert.equal(await FundProposal.countDocuments({ title: 'Đề xuất cũ không mã' }), 0);
    assert.equal(await FundProposal.countDocuments({ code: null }), 0);
    assert.equal(await Asset.countDocuments({ code: 'TEST-UC07' }), 0);
    assert.equal(await Asset.countDocuments({ code: /^TB-0(0[1-9]|1[0-8])$/ }), 18);
    assert.equal(await Notification.countDocuments({ title: /cần xác nhận tài chính/ }), 0);
    assert.equal(await Notification.countDocuments({ type: 'TICKET' }), 1, 'giữ thông báo khác luồng');
    assert.equal(await AuditLog.countDocuments({ action: 'FUND_PROPOSAL_VERIFIED' }), 0);
    assert.equal(await AuditLog.countDocuments({ action: 'ROLE_ASSIGNED' }), 1, 'giữ nhật ký khác luồng');
    assert.equal(await FundTransaction.countDocuments({ type: 'INCOME' }), 1);
  }
  // Trạng thái các đề xuất sau khi tạo lại (3 thành viên Ban quản trị)
  const byCode = async (asset) => {
    const wo = await WorkOrder.findOne({ assetId: (await Asset.findOne({ code: asset }))._id }).sort({ createdAt: -1 }).lean();
    return FundProposal.findOne({ workOrderId: wo._id }).sort({ createdAt: -1 }).lean();
  };
  assert.equal((await byCode('TB-001')).status, 'PAID');
  assert.equal((await byCode('TB-002')).status, 'APPROVED');
  assert.equal((await byCode('TB-004')).status, 'CANCELLED');
  assert.equal((await byCode('TB-005')).status, 'PENDING');
  const rejected = await byCode('TB-008');
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.votes.length, 2); // 3 thành viên: 2 không đồng ý là không còn khả năng đạt
  const voting = await byCode('TB-010');
  assert.equal(voting.status, 'PENDING');
  assert.equal(voting.votes.length, 1);
});
