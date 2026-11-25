// Dữ liệu demo 3 ngày 24–26/11 (kèm --reset) chạy trên DB test: xóa đúng phạm vi (giữ tài khoản, dữ liệu module khác), tạo lại
// đúng trạng thái từng ca mỗi ngày, 25 và 26 có 4 thiết bị đến hạn, không có mốc thời gian ở tương lai; chạy lại được.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { DEMO3_CODES, PLAN, seedMaintenanceDemo3Days } from '../../scripts/seedMaintenanceDemo3Days.js';
import { Asset, AuditLog, Building, FundProposal, FundTransaction, MaintenanceFund, Notification, User, WorkOrder } from '../../src/models/index.js';
import { availableBalance, getFund, recordIncome } from '../../src/modules/fund/fund.service.js';
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

const NOW = new Date('2026-11-24T23:30:00+07:00');
const quiet = () => {};
const MIL = 1_000_000;

// ca → [trạng thái phiếu, nguồn chi, trạng thái đề xuất]
const EXPECTED = {
  due1: ['PENDING'], due2: ['PENDING'], due3: ['PENDING'], due4: ['PENDING'], scan: ['IN_PROGRESS'], faulty: ['IN_PROGRESS'], passed: ['DONE'],
  operating: ['AWAITING_REPAIR_APPROVAL', null], warranty: ['AWAITING_REPAIR_APPROVAL', null], cumulative: ['AWAITING_REPAIR_APPROVAL', null],
  over: ['AWAITING_REPAIR_APPROVAL', null], rerequest: ['AWAITING_REPAIR_APPROVAL', null], fundChosen: ['AWAITING_REPAIR_APPROVAL', 'FUND'],
  awaitVendor: ['AWAITING_REPAIR_APPROVAL', 'FUND', 'PENDING'], voting: ['AWAITING_REPAIR_APPROVAL', 'FUND', 'PENDING'],
  blocked: ['AWAITING_REPAIR_APPROVAL', 'FUND', 'PENDING'], rejected: ['AWAITING_REPAIR_APPROVAL', null, 'REJECTED'],
  underOperating: ['UNDER_REPAIR', 'OPERATING'], acceptReturned: ['UNDER_REPAIR', 'OPERATING'], underWarranty: ['UNDER_REPAIR', 'WARRANTY'],
  underFund: ['UNDER_REPAIR', 'FUND', 'APPROVED'], emergency: ['UNDER_REPAIR', 'FUND', 'PENDING'], returned: ['UNDER_REPAIR', 'FUND', 'APPROVED'],
  awaitAccept: ['AWAITING_ACCEPTANCE', 'OPERATING'], awaitBoard: ['AWAITING_BOARD_ACCEPTANCE', 'FUND', 'APPROVED'],
  toPay: ['DONE', 'FUND', 'APPROVED'], paid: ['DONE', 'FUND', 'PAID'], toExpense: ['DONE', 'OPERATING'], expensed: ['DONE', 'OPERATING'],
  warrantyDone: ['DONE', 'WARRANTY'], postponed: ['REPAIR_POSTPONED', null, 'CANCELLED'], closed: ['CLOSED', null],
};

async function people() {
  const manager = await createManager();
  const accountant = await createUser('ACCOUNTANT');
  await createTechnician();
  await createTechnician();
  await createUser('BOARD', { boardTitle: 'CHAIRMAN' });
  await createUser('BOARD', { boardTitle: 'MEMBER' });
  await createUser('BOARD', { boardTitle: 'MEMBER' });
  const [a] = await Building.create(['A', 'B', 'T3'].map((code) => ({ code, name: `Block ${code}`, address: 'x', floors: 20 })));
  return { manager, accountant, a };
}

test('--day: chỉ thay nhóm ngày đó, giờ các bước nằm trong ngày lên lịch và trước lúc chạy, giữ mã QR, quỹ khớp; chưa tới giờ thì không xóa', async () => {
  await people();
  await seedMaintenanceDemo3Days({ apply: true, log: quiet, now: NOW });
  const snapshot = async (day) => {
    const assets = await Asset.find({ code: new RegExp(`^TB${day}-`) }).sort({ code: 1 }).lean();
    const wos = await WorkOrder.find({ assetId: { $in: assets.map((x) => x._id) } }).sort({ _id: 1 }).lean();
    return { assets, wos };
  };
  const before = { 24: await snapshot(24), 25: await snapshot(25), 26: await snapshot(26) };
  const balance = (await getFund()).balance;
  const available = await availableBalance((await getFund())._id);

  await assert.rejects(seedMaintenanceDemo3Days({ apply: true, day: 25, log: quiet, now: new Date('2026-11-25T05:00:00+07:00') }), /06:00/);
  await assert.rejects(seedMaintenanceDemo3Days({ apply: true, day: 26, log: quiet, now: new Date('2026-11-25T23:00:00+07:00') }), /06:00/);
  await assert.rejects(seedMaintenanceDemo3Days({ apply: true, day: 25, reset: true, log: quiet, now: NOW }), /không dùng cả hai/);
  assert.deepEqual((await snapshot(25)).wos, before[25].wos, 'chưa tới giờ: không xóa gì');

  // 25/11 chạy sớm lúc 06:00 (giờ co lại), 26/11 chạy muộn lúc 22:00 (giờ giữ nguyên)
  for (const [day, time] of [[25, '06:00'], [26, '22:00']]) {
    const runAt = new Date(`2026-11-${day}T${time}:00+07:00`);
    await seedMaintenanceDemo3Days({ apply: true, day, log: quiet, now: runAt });
    const { assets } = await snapshot(day);
    assert.deepEqual(assets.map((x) => [x.code, x.qrCode]), before[day].assets.map((x) => [x.code, x.qrCode]), 'giữ mã QR');
    const start = new Date(`2026-11-${day}T00:00:00+07:00`).getTime();
    for (const p of PLAN.filter((x) => x.day === day)) {
      const asset = assets.find((x) => x.code === p.code);
      const wo = await WorkOrder.findOne({ assetId: asset._id }).sort({ scheduledDate: -1 }).lean();
      const label = `${p.code} ${p.key}`;
      assert.equal(wo.status, EXPECTED[p.key][0], label);
      assert.equal((await FundProposal.findOne({ workOrderId: wo._id }).sort({ createdAt: -1 }).lean())?.status, EXPECTED[p.key][2], label);
      const times = [wo.createdAt, wo.assignedAt, wo.scannedAt, wo.inspectedAt, ...(wo.repair?.history ?? []).map((h) => h.at), wo.completedAt].filter(Boolean).map((d) => d.getTime());
      assert.ok(times.every((x) => x >= start && x < runAt.getTime()), `${label}: mọi bước trong ngày ${day}, trước lúc chạy`);
      const steps = (wo.repair?.history ?? []).map((h) => h.at.getTime());
      assert.deepEqual(steps, [...steps].sort((x, y) => x - y), `${label}: thứ tự`);
      assert.equal(new Set(steps).size, steps.length, `${label}: các bước không trùng phút`);
      if (wo.status === 'DONE') assert.ok(asset.nextMaintenanceDate > new Date('2026-12-20'), `${label}: phải dời lịch`);
    }
  }
  assert.deepEqual((await snapshot(24)).wos, before[24].wos, 'không đụng nhóm khác');
  assert.equal(await Asset.countDocuments(), DEMO3_CODES.length);
  assert.equal(await WorkOrder.countDocuments(), PLAN.length + 3);

  // Quỹ: không thêm tiền, sổ khớp số dư từng dòng
  const fund = await getFund();
  assert.equal(fund.balance, balance);
  assert.equal(await availableBalance(fund._id), available);
  let running = 0;
  for (const x of await FundTransaction.find().sort({ createdAt: 1, _id: 1 }).lean()) {
    running += x.type === 'INCOME' ? x.amount : -x.amount;
    assert.equal(x.balanceAfter, running, x.code);
  }
  assert.equal(running, balance);
  // Không còn thông báo / nhật ký trỏ tới bản ghi đã xóa
  const alive = new Set([...(await WorkOrder.distinct('_id')), ...(await FundProposal.distinct('_id'))].map(String));
  const dangling = (await Notification.find({ type: { $in: ['MAINTENANCE', 'FUND_APPROVAL'] }, refId: { $ne: null } }).lean()).filter((x) => !alive.has(String(x.refId)));
  assert.equal(dangling.length, 0);
});

test('xem trước không ghi; --reset xóa đúng phạm vi và tạo lại đủ ca mỗi ngày; chạy lại được; không --reset thì không tạo chồng', async () => {
  const { manager, accountant, a } = await people();
  // Dữ liệu luồng cũ (phải xóa) và dữ liệu module khác (phải giữ)
  const old = await Asset.create({ buildingId: a._id, code: 'TB-001', name: 'Thang máy cũ', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH', nextMaintenanceDate: NOW });
  await WorkOrder.create({ assetId: old._id, type: 'SCHEDULED', status: 'PENDING', title: 'cũ', scheduledDate: NOW });
  await recordIncome(asUser(accountant), { incomeSource: 'INTEREST', amount: 5 * MIL, documentNo: 'CU' });
  await Notification.create({ userId: manager._id, type: 'TICKET', title: 'Sự cố mới', content: 'giữ' });
  await AuditLog.create({ action: 'ROLE_ASSIGNED', targetType: 'users' });
  const users = await User.countDocuments();

  assert.equal(await seedMaintenanceDemo3Days({ reset: true, log: quiet, now: NOW }), null);
  assert.equal(await Asset.countDocuments(), 1, 'xem trước không xóa');
  await assert.rejects(seedMaintenanceDemo3Days({ apply: true, reset: true, log: quiet, now: new Date('2026-11-24T20:00:00+07:00') }), /21:00/);
  assert.equal(await Asset.countDocuments(), 1, 'sai giờ thì dừng trước khi xóa');

  const backupPath = path.join(os.tmpdir(), `sapms-demo3-${process.pid}.json`);
  for (let run = 1; run <= 2; run += 1) {
    const total = await seedMaintenanceDemo3Days({ apply: true, reset: true, backupPath, log: quiet, now: NOW });
    assert.equal(total, PLAN.length + 3, `lần ${run}`); // + 3 phiếu cũ của ca cộng dồn
    if (run === 1) assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).assets.length, 1, 'đã sao lưu dữ liệu cũ');
    assert.equal(await Asset.countDocuments({ code: 'TB-001' }), 0);
    assert.equal(await Asset.countDocuments(), DEMO3_CODES.length);
    assert.equal(await WorkOrder.countDocuments({ title: 'cũ' }), 0);
    assert.equal(await FundTransaction.countDocuments({ documentNo: 'CU' }), 0);
    assert.equal(await User.countDocuments(), users, 'không đụng tài khoản');
    assert.equal(await Notification.countDocuments({ type: 'TICKET' }), 1);
    assert.equal(await AuditLog.countDocuments({ action: 'ROLE_ASSIGNED' }), 1);
  }
  fs.unlinkSync(backupPath);

  const vnDay = (d) => Number(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(8, 10));
  for (const p of PLAN) {
    const asset = await Asset.findOne({ code: p.code }).lean();
    const wo = await WorkOrder.findOne({ assetId: asset._id }).sort({ scheduledDate: -1 }).lean();
    const proposal = await FundProposal.findOne({ workOrderId: wo._id }).sort({ createdAt: -1 }).lean();
    const label = `${p.code} ${p.key}`;
    const [status, source, proposalStatus] = EXPECTED[p.key];
    assert.equal(wo.status, status, label);
    if (source !== undefined) assert.equal(wo.repair.costSource ?? null, source, `${label}: nguồn chi`);
    assert.equal(proposal?.status, proposalStatus, `${label}: đề xuất`);
    assert.equal(vnDay(wo.scheduledDate), p.day, `${label}: ngày lên lịch`);
    const times = [wo.createdAt, wo.assignedAt, wo.scannedAt, wo.inspectedAt, ...(wo.repair?.history ?? []).map((h) => h.at)].filter(Boolean).map((d) => d.getTime());
    assert.deepEqual(times, [...times].sort((x, y) => x - y), `${label}: thứ tự thời gian`);
    assert.ok(times.every((t) => t <= NOW.getTime()), `${label}: có mốc tương lai`);
    if (status === 'DONE') assert.ok(asset.nextMaintenanceDate > new Date('2026-12-20'), `${label}: phải dời lịch`);
    if (proposal && !['CANCELLED'].includes(proposalStatus)) {
      assert.equal(Boolean(proposal.vendor), !['awaitVendor', 'emergency'].includes(p.key), `${label}: nhà thầu`);
    }
    if (['underFund', 'returned', 'awaitBoard', 'toPay', 'paid'].includes(p.key)) assert.ok(wo.repair.contractorName, `${label}: phiếu ghi nhà thầu`);
    if (p.key === 'blocked') assert.ok(proposal.approvalBlockedAt);
  }
  // Mỗi ngày đủ ca như nhau; đến hạn: 24/11 có 1, 25 và 26/11 mỗi ngày 4
  const keys = (day) => PLAN.filter((p) => p.day === day).map((p) => p.key);
  const dues = (day) => keys(day).filter((k) => k.startsWith('due')).length;
  assert.deepEqual([24, 25, 26].map(dues), [1, 4, 4]);
  const common = (day) => keys(day).filter((k) => !k.startsWith('due') && k !== 'blocked').sort();
  assert.deepEqual(common(24), common(25));
  assert.deepEqual(common(25), common(26));

  // Sổ quỹ khớp số dư; đề xuất lớn chưa tự chốt
  const fund = await MaintenanceFund.findOne().lean();
  const txs = await FundTransaction.find().lean();
  assert.equal(txs.reduce((sum, t) => sum + (t.type === 'INCOME' ? t.amount : -t.amount), 0), fund.balance);
  assert.equal(fund.balance, (2000 - 50 - 54 - 54) * MIL);
  assert.ok((await availableBalance((await getFund())._id)) < 1300 * MIL);

  await assert.rejects(seedMaintenanceDemo3Days({ apply: true, log: quiet, now: NOW }), /đã có/);
});
