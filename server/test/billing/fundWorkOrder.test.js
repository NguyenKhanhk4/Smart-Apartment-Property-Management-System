// UC10 × Quỹ bảo trì theo hướng mới: Trưởng BQL chọn nguồn (ngưỡng + cộng dồn 30 ngày + bảo hành) → lập đề xuất gắn phiếu
// → Kế toán xác nhận / trả lại → Ban quản trị biểu quyết → Đang sửa → Trưởng BQL nghiệm thu kỹ thuật → Ban quản trị xác nhận
// → phiếu chi. Kèm: sửa khẩn cấp (sửa trước, hồ sơ sau), ghi chi phí vận hành, job nhắc.
import { after, afterEach, before, beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, AuditLog, FundProposal, MaintenanceFund, Notification, SystemConfig, WorkOrder } from '../../src/models/index.js';
import {
  acceptWork,
  cancelProposal,
  createProposal,
  getOverview,
  getProposal,
  listAwaitingWorkOrders,
  recordExpense,
  recordIncome,
  vote,
  workOrderPrefill,
} from '../../src/modules/fund/fund.service.js';
import * as board from '../../src/modules/workOrders/workOrders.board.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as expense from '../../src/modules/workOrders/workOrders.expense.js';
import * as inspection from '../../src/modules/workOrders/workOrders.inspection.js';
import { generateMaintenanceWorkOrders, remindRepairFollowups } from '../../src/modules/workOrders/workOrders.jobs.js';
import * as repair from '../../src/modules/workOrders/workOrders.repair.js';
import { listWorkOrders } from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, startOfVnDay } from '../../src/utils/time.js';
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PHOTO = { originalname: 'anh.jpg', mimetype: 'image/jpeg', buffer: JPEG };
const DOCS = { images: [PHOTO], certificates: [PHOTO] };
const CHECKLIST = [{ label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400, required: true }];
const FAULT = { faultDesc: 'Biến áp tủ điều khiển cháy', vendorName: 'Công ty Toàn Phát', vendorProposal: 'Thay biến áp mới', estimatedCost: 12_500_000 };

/** Tạo thiết bị + phiếu đã báo hư hỏng (Chờ duyệt sửa) của KTV */
async function faultyOrder(tech, { code = 'TM-01', name = 'Thang máy 1', category = 'ELEVATOR', estimatedCost = FAULT.estimatedCost, warrantyEnd = null, assetId = null } = {}) {
  const asset = assetId
    ? await Asset.findById(assetId)
    : await Asset.create({
      buildingId: (await createBuilding())._id, code, name, category, cycleValue: 1, cycleUnit: 'MONTH',
      checklist: CHECKLIST, nextMaintenanceDate: new Date(Date.now() - 10 * DAY_MS), warrantyEnd,
    });
  const wo = await WorkOrder.create({
    assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: `Bảo trì ${asset.name}`, scheduledDate: asset.nextMaintenanceDate, checklist: CHECKLIST,
  });
  await inspection.scanWorkOrder(tech, wo._id, asset.qrCode);
  await inspection.submitInspection(tech, wo._id, { result: 'FAULTY', note: 'Điện áp vượt ngưỡng', results: [{ value: 420 }] }, [PHOTO]);
  await repair.reportFault(tech, wo._id, { ...FAULT, estimatedCost }, [PHOTO]);
  return { asset, wo };
}

/** Quỹ có tiền, Ban quản trị 3 người, phiếu bảo trì đã báo hư hỏng (Chờ duyệt sửa) */
async function setup({ fund = true, balance = 500_000_000, ...order } = {}) {
  const manager = asUser(await createManager());
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const tech = asUser(await createTechnician());
  const members = [];
  for (let i = 0; i < 3; i += 1) members.push(asUser(await createUser('BOARD', { boardTitle: i === 0 ? 'CHAIRMAN' : 'MEMBER' })));
  if (balance) await recordIncome(accountant, { incomeSource: 'INITIAL_HANDOVER', amount: balance, documentNo: 'BB-001' });
  const { asset, wo } = await faultyOrder(tech, order);
  if (fund) await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', comment: 'Chi phí lớn' });
  return { manager, accountant, tech, board: members, asset, wo };
}

const body = (wo, extra = {}) => ({
  title: 'Sửa thang máy 1',
  description: 'Thay biến áp tủ điều khiển',
  amount: 13_000_000,
  planType: 'UNSCHEDULED',
  urgentReason: 'Thang máy dừng, ảnh hưởng cư dân',
  contractNo: 'BG-TM-01',
  workOrderId: String(wo._id),
  ...extra,
});
const reload = (wo) => WorkOrder.findById(wo._id).lean();
const approveBy = async (members, p) => {
  await vote(members[0], p._id, { decision: 'AGREE' });
  return vote(members[1], p._id, { decision: 'AGREE' });
};

test('duyệt: Trưởng BQL lập đề xuất gắn phiếu → Ban quản trị biểu quyết → Đang sửa → nghiệm thu kỹ thuật → Ban quản trị xác nhận → phiếu chi', async () => {
  const { manager, accountant, tech, board: members, wo, asset } = await setup();

  const awaiting = await listAwaitingWorkOrders();
  assert.deepEqual(awaiting.map((w) => String(w._id)), [String(wo._id)]);
  assert.equal(awaiting[0].assetId.code, 'TM-01');
  const prefill = await workOrderPrefill(wo._id);
  assert.equal(prefill.amount, 12_500_000);
  assert.match(prefill.title, /TM-01/);

  const p = await createProposal(manager, body(wo, { largeRepair: false }), [PHOTO]);
  assert.equal(String(p.workOrderId), String(wo._id));
  assert.equal(p.status, 'PENDING');
  assert.equal(p.largeRepair, true); // sửa chữa thiết bị luôn là sửa chữa lớn
  assert.equal(p.attachmentUrls.length, prefill.attachmentUrls.length + 1); // ảnh hư hỏng + báo giá
  assert.deepEqual(await listAwaitingWorkOrders(), []); // đã có đề xuất đang xử lý → không còn trong danh sách
  await assert.rejects(createProposal(manager, body(wo)), { errorCode: 'WORKORDER_FUND_PENDING' });
  await assert.rejects(workOrderPrefill(wo._id), { errorCode: 'WORKORDER_FUND_PENDING' });
  // Đang chờ biểu quyết: Trưởng BQL không quyết định lại
  await assert.rejects(decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_PENDING' });
  assert.equal((await decision.listRepairs({ tab: 'pending' })).items[0].pendingFund.status, 'PENDING');

  assert.equal((await approveBy(members, p)).outcome, 'APPROVED');
  let w = await reload(wo);
  assert.equal(w.status, 'UNDER_REPAIR');
  assert.equal(w.repair.history.at(-1).action, 'FUND_APPROVED');
  assert.equal(String(w.repair.history.at(-1).refId), String(p._id));
  assert.equal(await Notification.countDocuments({ userId: tech.id, title: 'Sửa chữa đã được duyệt' }), 1);

  const detail = await getProposal(accountant, p._id);
  assert.equal(detail.workOrderId.status, 'UNDER_REPAIR');
  assert.equal(detail.workOrderId.assetId.code, 'TM-01');

  // Đã duyệt + gắn phiếu: không rút, không nghiệm thu tay ở quỹ, chưa nghiệm thu thì chưa chi
  await assert.rejects(cancelProposal(manager, p._id, { reason: 'Đổi phương án' }), /không rút được/);
  await assert.rejects(acceptWork(manager, p._id), /nghiệm thu trên phiếu bảo trì/);
  await assert.rejects(recordExpense(accountant, p._id, { amount: 12_000_000, documentNo: 'HD-01', varianceReason: 'Giảm giá' }), /nghiệm thu/);

  await repair.uploadAcceptance(tech, wo._id, { note: 'Nhà thầu đã thay biến áp' }, DOCS);
  await repair.acceptRepair(manager, wo._id);
  w = await reload(wo);
  assert.equal(w.status, 'AWAITING_BOARD_ACCEPTANCE');
  assert.equal((await Asset.findById(asset._id).lean()).lastMaintenanceDate, null); // chưa dời lịch
  for (const m of members) assert.ok(await Notification.exists({ userId: m.id, title: 'Chờ xác nhận nghiệm thu sửa chữa bằng Quỹ' }));
  // Kế toán lập phiếu chi lúc này → chặn
  await assert.rejects(recordExpense(accountant, p._id, { amount: 13_000_000, documentNo: 'HD-01' }), /Ban quản trị xác nhận/);
  assert.equal((await board.listAwaitingBoard()).workOrders[0].proposal.code, p.code);

  await board.boardAccept(members[2], wo._id, { note: 'Đã xem biên bản kiểm định' });
  w = await reload(wo);
  assert.equal(w.status, 'DONE');
  assert.equal((await Asset.findById(asset._id).lean()).lastMaintenanceDate.getTime(), startOfVnDay().getTime());
  const doc = await FundProposal.findById(p._id).lean();
  assert.ok(doc.workAcceptedAt && doc.boardAcceptedAt);
  assert.ok(await Notification.exists({ userId: accountant.id, title: /lập phiếu chi/ }));

  const tx = await recordExpense(accountant, p._id, { amount: 12_000_000, documentNo: 'HD-01', varianceReason: 'Nhà thầu giảm giá' });
  assert.match(tx.code, /^PCQ-/);
  assert.equal((await FundProposal.findById(p._id).lean()).status, 'PAID');
});

test('từ chối / rút → phiếu bỏ nguồn Quỹ, Trưởng BQL quyết định lại; rút rồi lập lại được', async () => {
  const { manager, board: members, wo } = await setup();

  const p1 = await createProposal(manager, body(wo));
  let w;

  await vote(members[0], p1._id, { decision: 'DISAGREE', comment: 'Báo giá cao' });
  const { outcome } = await vote(members[1], p1._id, { decision: 'DISAGREE', comment: 'Lấy thêm báo giá' });
  assert.equal(outcome, 'REJECTED');
  w = await reload(wo);
  assert.equal(w.status, 'AWAITING_REPAIR_APPROVAL');
  assert.equal(w.repair.costSource, null);
  assert.equal(w.repair.history.at(-1).action, 'FUND_REJECTED');
  assert.equal(await Notification.countDocuments({ userId: manager.id, title: 'Ban quản trị từ chối chi quỹ' }), 1);
  // Phiếu 12,5tr (dưới ngưỡng): gợi ý được cả chi phí vận hành
  assert.match((await Notification.findOne({ userId: manager.id, title: 'Ban quản trị từ chối chi quỹ' }).lean()).content, /chi phí vận hành/);
  // Trưởng BQL chỉ nhận 1 thông báo từ chối (từ phiếu bảo trì), không nhận thêm bản của quỹ
  assert.equal(await Notification.countDocuments({ userId: manager.id, title: /không duyệt chi quỹ/ }), 0);
  await assert.rejects(createProposal(manager, body(wo)), { errorCode: 'WORKORDER_NOT_AWAITING_FUND' });

  // Trưởng BQL chọn lại Quỹ → lập đề xuất mới → rút
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const p2 = await createProposal(manager, body(wo));
  await cancelProposal(manager, p2._id, { reason: 'Nhà thầu rút báo giá' });
  w = await reload(wo);
  assert.equal(w.repair.costSource, null);
  assert.equal(w.repair.history.at(-1).action, 'FUND_CANCELLED');

  // Rút rồi tạo lại (rủi ro isOpen lệch status): đề xuất đã rút không còn chặn đề xuất mới của cùng phiếu
  const cancelled = await FundProposal.findById(p2._id).lean();
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.isOpen, false);
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const p3 = await createProposal(manager, body(wo));
  assert.equal(p3.isOpen, true);
  assert.equal(await FundProposal.countDocuments({ workOrderId: wo._id, isOpen: true }), 1);
});

test('phiếu chưa được duyệt bằng Quỹ: không lập đề xuất gắn phiếu; 2 request song song chỉ 1 đề xuất', async () => {
  const { manager, wo } = await setup({ fund: false });
  await assert.rejects(createProposal(manager, body(wo)), { errorCode: 'WORKORDER_NOT_AWAITING_FUND' });
  assert.deepEqual(await listAwaitingWorkOrders(), []);

  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const results = await Promise.allSettled([createProposal(manager, body(wo)), createProposal(manager, body(wo))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'WORKORDER_FUND_PENDING');
  assert.equal(await FundProposal.countDocuments({ workOrderId: wo._id }), 1);
});

test('BR-E08: ngưỡng 50 triệu — dưới ngưỡng dùng vận hành được, từ ngưỡng bắt buộc Quỹ (server chặn dù client không khóa)', async () => {
  const manager = asUser(await createManager());
  const tech = asUser(await createTechnician());
  const below = await faultyOrder(tech, { code: 'B-1', name: 'Bơm 1', category: 'PUMP', estimatedCost: 49_999_999 });
  const res = await decision.decideRepair(manager, below.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
  assert.equal(res.status, 'UNDER_REPAIR');

  const at = await faultyOrder(tech, { code: 'B-2', name: 'Bơm 2', category: 'PUMP', estimatedCost: 50_000_000 });
  const listed = (await decision.listRepairs({ tab: 'pending' })).items.find((w) => String(w._id) === String(at.wo._id));
  assert.equal(listed.policy.fundRequired, true);
  await assert.rejects(decision.decideRepair(manager, at.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), (e) => {
    assert.equal(e.errorCode, 'WORKORDER_FUND_REQUIRED');
    assert.equal(e.status, 422);
    assert.equal(e.details[0].threshold, 50_000_000);
    return true;
  });
  assert.equal((await reload(at.wo)).status, 'AWAITING_REPAIR_APPROVAL');
});

test('BR-E08: cộng dồn chi phí vận hành cùng thiết bị trong 30 ngày (dùng số thực tế nếu đã ghi chi)', async () => {
  const manager = asUser(await createManager());
  const tech = asUser(await createTechnician());
  const first = await faultyOrder(tech, { code: 'B-1', name: 'Bơm B', category: 'PUMP', estimatedCost: 40_000_000 });
  await decision.decideRepair(manager, first.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
  await WorkOrder.updateOne({ _id: first.wo._id }, { status: 'DONE', 'repair.decidedAt': new Date(Date.now() - 10 * DAY_MS) });
  await Asset.updateOne({ _id: first.asset._id }, { nextMaintenanceDate: new Date(Date.now() - DAY_MS) });

  const second = await faultyOrder(tech, { assetId: first.asset._id, estimatedCost: 15_000_000 });
  const policy = await decision.repairPolicy(await reload(second.wo));
  assert.equal(policy.spentInWindow, 40_000_000);
  assert.equal(policy.total, 55_000_000);
  await assert.rejects(decision.decideRepair(manager, second.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_REQUIRED' });

  // Kế toán ghi chi thực tế 30 triệu → tổng 45 triệu, dưới ngưỡng
  await WorkOrder.updateOne({ _id: first.wo._id }, { 'repair.actualCost': 30_000_000 });
  assert.equal((await decision.repairPolicy(await reload(second.wo))).total, 45_000_000);
  // Phiếu cũ cách 31 ngày → không tính
  await WorkOrder.updateOne({ _id: first.wo._id }, { 'repair.actualCost': null, 'repair.decidedAt': new Date(Date.now() - 31 * DAY_MS) });
  const ok = await decision.decideRepair(manager, second.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
  assert.equal(ok.status, 'UNDER_REPAIR');
});

test('BR-E10: còn bảo hành → nguồn khác phải ghi lý do; chọn Bảo hành khi đã hết bảo hành → 400', async () => {
  const manager = asUser(await createManager());
  const tech = asUser(await createTechnician());
  const covered = await faultyOrder(tech, { code: 'MP-C', name: 'Máy phát C', category: 'OTHER', warrantyEnd: new Date(Date.now() + 30 * DAY_MS) });
  const listed = (await decision.listRepairs({ tab: 'pending' })).items[0];
  assert.equal(listed.policy.warrantyActive, true);
  await assert.rejects(decision.decideRepair(manager, covered.wo._id, { decision: 'APPROVE', costSource: 'FUND' }), { errorCode: 'WORKORDER_WARRANTY_REASON_REQUIRED' });
  const res = await decision.decideRepair(manager, covered.wo._id, { decision: 'APPROVE', costSource: 'OPERATING', warrantyOverrideReason: 'Lỗi do cư dân, hãng từ chối bảo hành' });
  assert.equal(res.repair.warrantyOverrideReason, 'Lỗi do cư dân, hãng từ chối bảo hành');

  const other = await faultyOrder(tech, { code: 'MP-D', name: 'Máy phát D', category: 'OTHER', warrantyEnd: new Date(Date.now() + 30 * DAY_MS) });
  const warranty = await decision.decideRepair(manager, other.wo._id, { decision: 'APPROVE', costSource: 'WARRANTY' });
  assert.equal(warranty.status, 'UNDER_REPAIR');
  assert.equal(warranty.repair.costSource, 'WARRANTY');
  assert.ok(await Notification.exists({ userId: tech.id, content: /hãng bảo hành/ }));

  const expired = await faultyOrder(tech, { code: 'MP-E', name: 'Máy phát E', category: 'OTHER', warrantyEnd: new Date(Date.now() - 2 * DAY_MS) });
  await assert.rejects(decision.decideRepair(manager, expired.wo._id, { decision: 'APPROVE', costSource: 'WARRANTY' }), (e) => e.details?.[0]?.field === 'costSource');
});

test('BR-E08, BR-E10: danh sách Phiếu bảo trì (Trưởng BQL) gắn policy như trang Duyệt sửa chữa; KTV không có policy', async () => {
  const manager = asUser(await createManager());
  const tech = asUser(await createTechnician());
  const covered = await faultyOrder(tech, { code: 'CAM-1', name: 'Camera 1', category: 'OTHER', warrantyEnd: new Date(Date.now() + 30 * DAY_MS) });
  const first = await faultyOrder(tech, { code: 'B-1', name: 'Bơm B', category: 'PUMP', estimatedCost: 35_000_000 });
  await decision.decideRepair(manager, first.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
  await WorkOrder.updateOne({ _id: first.wo._id }, { status: 'DONE', 'repair.decidedAt': new Date(Date.now() - 5 * DAY_MS) });
  await Asset.updateOne({ _id: first.asset._id }, { nextMaintenanceDate: new Date(Date.now() - DAY_MS) });
  const second = await faultyOrder(tech, { assetId: first.asset._id, estimatedCost: 20_000_000 });

  const res = await listWorkOrders(manager, { page: 1, limit: 20 });
  const byId = (id) => res.items.find((w) => String(w._id) === String(id));
  assert.equal(byId(covered.wo._id).policy.warrantyActive, true);
  assert.equal(byId(second.wo._id).policy.total, 55_000_000);
  assert.equal(byId(second.wo._id).policy.fundRequired, true);
  assert.equal(byId(first.wo._id).policy, undefined); // phiếu không chờ quyết định thì không tính
  assert.equal(res.settings.fundThreshold, 50_000_000);
  assert.ok(res.settings.postponeMaxDays > 0);

  const mine = await listWorkOrders(tech, { page: 1, limit: 20 });
  assert.ok(mine.items.every((w) => w.policy === undefined));
  assert.equal(mine.settings, undefined);
});

test('BR-E11: sửa khẩn cấp → Đang sửa ngay, báo Ban quản trị; đề xuất lập khi đang sửa; Ban quản trị chỉ xác nhận nghiệm thu khi đề xuất đã duyệt', async () => {
  const { manager, accountant, tech, board: members, wo } = await setup({ fund: false });
  await assert.rejects(
    decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', emergency: true, emergencyReason: 'Kẹt' }),
    (e) => e.details?.[0]?.field === 'emergencyReason',
  );
  const started = await decision.decideRepair(manager, wo._id, {
    decision: 'APPROVE', costSource: 'FUND', emergency: true, emergencyReason: 'Thang máy kẹt người trong cabin',
  });
  assert.equal(started.status, 'UNDER_REPAIR');
  assert.equal(started.repair.isEmergency, true);
  assert.equal(started.nextStep, 'CREATE_PROPOSAL');
  for (const m of members) assert.ok(await Notification.exists({ userId: m.id, title: /Sửa chữa khẩn cấp bằng Quỹ/ }));
  assert.ok(await AuditLog.exists({ action: 'WORKORDER_EMERGENCY_STARTED' }));
  assert.equal((await getOverview()).emergencyCount, 1); // báo cáo quỹ theo dõi số phiếu khẩn cấp

  // Đề xuất lập khi đang sửa, tự gắn Đột xuất + lý do khẩn cấp
  const prefill = await workOrderPrefill(wo._id);
  assert.equal(prefill.planType, 'UNSCHEDULED');
  assert.equal(prefill.urgentReason, 'Thang máy kẹt người trong cabin');
  assert.deepEqual((await listAwaitingWorkOrders()).map((w) => String(w._id)), [String(wo._id)]);

  // Sửa xong trước khi có đề xuất được duyệt
  await repair.uploadAcceptance(tech, wo._id, {}, DOCS);
  await repair.acceptRepair(manager, wo._id);
  assert.equal((await reload(wo)).status, 'AWAITING_BOARD_ACCEPTANCE');
  await assert.rejects(board.boardAccept(members[0], wo._id, {}), /chưa có đề xuất chi quỹ được Ban quản trị duyệt/);
  // Hàng chờ Ban quản trị: vẫn hiện phiếu nhưng chưa tính là việc cần làm (chưa có đề xuất được duyệt)
  let queue = await board.listAwaitingBoard();
  assert.equal(queue.workOrders[0].ready, false);
  assert.equal(queue.readyCount, 0);

  const p = await createProposal(manager, body(wo, { urgentReason: prefill.urgentReason }));
  queue = await board.listAwaitingBoard();
  assert.equal(queue.workOrders[0].proposal.status, 'PENDING');
  assert.equal(queue.readyCount, 0);
  assert.equal((await approveBy(members, p)).outcome, 'APPROVED');
  assert.equal((await reload(wo)).status, 'AWAITING_BOARD_ACCEPTANCE'); // khẩn cấp: kết quả biểu quyết không đổi trạng thái phiếu
  // Thông báo duyệt ghi đúng bước tiếp theo (đã nghiệm thu kỹ thuật) và báo Ban quản trị xác nhận
  const approvedMsg = await Notification.findOne({ userId: manager.id, title: /đã duyệt chi quỹ/ }).lean();
  assert.match(approvedMsg.content, /đã sửa xong và được Trưởng BQL nghiệm thu kỹ thuật: Ban quản trị xác nhận nghiệm thu/);
  assert.doesNotMatch(approvedMsg.content, /Nhà thầu sửa xong/);
  for (const m of members) assert.ok(await Notification.exists({ userId: m.id, title: /^Chờ xác nhận nghiệm thu/ }));
  queue = await board.listAwaitingBoard();
  assert.equal(queue.workOrders[0].ready, true);
  assert.equal(queue.readyCount, 1);
  await board.boardAccept(members[0], wo._id, {});
  const doc = await FundProposal.findById(p._id).lean();
  assert.ok(doc.workAcceptedAt, 'nghiệm thu kỹ thuật trước lúc duyệt được ghi lại khi Ban quản trị xác nhận');
  const tx = await recordExpense(accountant, p._id, { amount: 13_000_000, documentNo: 'HD-KC' });
  assert.equal(tx.amount, 13_000_000);
});

test('bị từ chối khi phiếu bắt buộc Quỹ (≥ ngưỡng): thông báo không gợi ý chi phí vận hành', async () => {
  const { manager, board: members, wo } = await setup({ estimatedCost: 60_000_000 });
  const p = await createProposal(manager, body(wo, { amount: 60_000_000 }));
  await vote(members[0], p._id, { decision: 'DISAGREE', comment: 'Xin thêm báo giá' });
  await vote(members[1], p._id, { decision: 'DISAGREE', comment: 'Xin thêm báo giá' });
  const msg = await Notification.findOne({ userId: manager.id, title: 'Ban quản trị từ chối chi quỹ' }).lean();
  assert.doesNotMatch(msg.content, /chi phí vận hành/);
  assert.ok(msg.content.includes('lập lại đề xuất chi quỹ (chi phí từ ngưỡng, bắt buộc dùng Quỹ), tạm hoãn hoặc ngừng sử dụng'));
  // Thực tế: chọn vận hành bị chặn, khớp với gợi ý
  await assert.rejects(decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_REQUIRED' });
});

test('BR-E11: khoản khẩn cấp bị từ chối → phiếu giữ nguyên, báo Ban quản trị + Trưởng BQL xử lý', async () => {
  const { manager, board: members, wo } = await setup({ fund: false });
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', emergency: true, emergencyReason: 'Thang máy kẹt người trong cabin' });
  const p = await createProposal(manager, body(wo));
  await vote(members[0], p._id, { decision: 'DISAGREE', comment: 'Giá cao' });
  await vote(members[1], p._id, { decision: 'DISAGREE', comment: 'Giá cao' });
  const w = await reload(wo);
  assert.equal(w.status, 'UNDER_REPAIR');
  assert.equal(w.repair.costSource, 'FUND');
  assert.equal(w.repair.history.at(-1).action, 'FUND_REJECTED_EMERGENCY');
  assert.ok(await Notification.exists({ userId: manager.id, title: 'Khoản sửa chữa khẩn cấp không được duyệt chi quỹ' }));
  assert.ok(await Notification.exists({ userId: members[2].id, title: 'Khoản sửa chữa khẩn cấp không được duyệt chi quỹ' }));
});

test('BR-E09: Ban quản trị trả về → Đang sửa, biên bản xóa (giữ lịch sử), bỏ dấu nghiệm thu kỹ thuật; nghiệm thu lại được', async () => {
  const { manager, tech, board: members, wo } = await setup();
  const p = await createProposal(manager, body(wo));
  await approveBy(members, p);
  await repair.uploadAcceptance(tech, wo._id, {}, DOCS);
  await repair.acceptRepair(manager, wo._id);

  await assert.rejects(board.boardReturn(members[0], wo._id, { comment: 'ab' }), { errorCode: 'VALIDATION_ERROR' });
  const returned = await board.boardReturn(members[0], wo._id, { comment: 'Thiếu chữ ký đơn vị kiểm định' });
  assert.equal(returned.status, 'UNDER_REPAIR');
  assert.deepEqual(returned.repair.acceptanceImages, []);
  assert.deepEqual(returned.repair.inspectionCertUrls, []);
  assert.equal(returned.repair.boardReturnNote, 'Thiếu chữ ký đơn vị kiểm định');
  assert.equal((await FundProposal.findById(p._id).lean()).workAcceptedAt, null);
  assert.ok(await Notification.exists({ userId: tech.id, title: 'Ban quản trị yêu cầu sửa lại' }));
  await assert.rejects(board.boardAccept(members[0], wo._id, {}), { errorCode: 'WORKORDER_NOT_AWAITING_BOARD' });

  await repair.uploadAcceptance(tech, wo._id, {}, DOCS);
  await repair.acceptRepair(manager, wo._id);
  assert.equal((await board.boardAccept(members[1], wo._id, {})).status, 'DONE');
});

test('Kế toán ghi chi phí vận hành: chỉ phiếu vận hành đã xong, 1 lần, bắt buộc ảnh hóa đơn; vượt ngưỡng báo Ban quản trị', async () => {
  const manager = asUser(await createManager());
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const tech = asUser(await createTechnician());
  const member = asUser(await createUser('BOARD', { boardTitle: 'MEMBER' }));
  const { wo } = await faultyOrder(tech, { code: 'B-1', name: 'Bơm 1', category: 'PUMP', estimatedCost: 45_000_000 });
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
  await assert.rejects(expense.recordOperatingExpense(accountant, wo._id, { actualCost: 1, invoiceNo: 'HD' }, [PHOTO]), { errorCode: 'WORKORDER_INVALID_STATUS' });
  await repair.uploadAcceptance(tech, wo._id, {}, [PHOTO]);
  await repair.acceptRepair(manager, wo._id);
  assert.deepEqual((await expense.listAwaitingExpense()).map((w) => String(w._id)), [String(wo._id)]);

  await assert.rejects(expense.recordOperatingExpense(accountant, wo._id, { actualCost: 52_000_000, invoiceNo: 'HD-9' }, []), { errorCode: 'VALIDATION_ERROR' });
  // Thực tế khác dự kiến (45 → 52 triệu) mà không ghi lý do chênh lệch → 400 field note; bằng dự kiến thì không bắt
  await assert.rejects(
    expense.recordOperatingExpense(accountant, wo._id, { actualCost: 52_000_000, invoiceNo: 'HD-9', note: 'abc' }, [PHOTO]),
    (e) => e.details?.[0]?.field === 'note' && /cao hơn dự kiến 7\.000\.000/.test(e.message),
  );
  const res = await expense.recordOperatingExpense(accountant, wo._id, { actualCost: 52_000_000, invoiceNo: 'HD-9', note: 'Phát sinh thêm' }, [PHOTO]);
  assert.equal(res.repair.actualCost, 52_000_000);
  assert.equal(res.repair.invoiceUrls.length, 1);
  assert.ok(await AuditLog.exists({ action: 'WORKORDER_EXPENSE_RECORDED', 'metadata.financial': true }));
  assert.ok(await Notification.exists({ userId: member.id, title: 'Chi phí vận hành vượt ngưỡng Quỹ' }));
  await assert.rejects(expense.recordOperatingExpense(accountant, wo._id, { actualCost: 1, invoiceNo: 'HD' }, [PHOTO]), /đã được ghi chi/);
  assert.deepEqual(await expense.listAwaitingExpense(), []);
});

test('job nhắc: hồ sơ khẩn cấp quá 3 ngày (1 lần/ngày), chờ Ban quản trị xác nhận quá 3 ngày, chờ ghi chi quá 3 ngày; không đổi trạng thái', async () => {
  const { manager, accountant, board: members, wo } = await setup({ fund: false });
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', emergency: true, emergencyReason: 'Thang máy kẹt người trong cabin' });
  assert.equal(await remindRepairFollowups(), 0);
  const day4 = new Date(Date.now() + 4 * DAY_MS);
  const both = await Promise.all([remindRepairFollowups(day4), remindRepairFollowups(day4)]);
  assert.equal(both[0] + both[1], 1); // 2 lần chạy chồng chỉ nhắc 1 lần
  assert.equal(await remindRepairFollowups(day4), 0); // cùng ngày
  assert.ok(await Notification.exists({ userId: manager.id, title: 'Sửa chữa khẩn cấp chưa có hồ sơ chi quỹ' }));
  assert.ok(await Notification.exists({ userId: members[0].id, title: 'Sửa chữa khẩn cấp chưa có hồ sơ chi quỹ' }));
  // Có đề xuất rồi thì thôi nhắc
  await createProposal(manager, body(wo));
  assert.equal(await remindRepairFollowups(new Date(Date.now() + 6 * DAY_MS)), 0);
  assert.equal((await reload(wo)).status, 'UNDER_REPAIR');

  // Chờ Ban quản trị xác nhận
  await WorkOrder.updateOne({ _id: wo._id }, { status: 'AWAITING_BOARD_ACCEPTANCE', 'repair.acceptedAt': new Date() });
  assert.equal(await remindRepairFollowups(new Date(Date.now() + 2 * DAY_MS)), 0);
  assert.equal(await remindRepairFollowups(new Date(Date.now() + 3 * DAY_MS + 60_000)), 1);
  assert.ok(await Notification.exists({ userId: members[1].id, title: 'Nhắc xác nhận nghiệm thu sửa chữa bằng Quỹ' }));

  // Chờ ghi chi vận hành (theo tham số)
  await SystemConfig.create({ key: 'OPERATING_EXPENSE_REMIND_DAYS', value: 5, scope: 'BUSINESS' });
  const other = await WorkOrder.create({
    assetId: (await reload(wo)).assetId, type: 'TICKET_LINKED', status: 'DONE', title: 'x', completedAt: new Date(),
    repair: { costSource: 'OPERATING', estimatedCost: 1_000_000 },
  });
  assert.equal(await remindRepairFollowups(new Date(Date.now() + 4 * DAY_MS)), 0);
  assert.equal(await remindRepairFollowups(new Date(Date.now() + 5 * DAY_MS + 60_000)), 1);
  assert.ok(await Notification.exists({ userId: accountant.id, title: 'Sửa chữa chờ ghi chi phí vận hành', refId: other._id }));
});

test('job tạo phiếu: thiết bị đang chờ Ban quản trị xác nhận nghiệm thu vẫn tính là đang sửa', async () => {
  const { wo, asset } = await setup();
  await WorkOrder.updateOne({ _id: wo._id }, { status: 'AWAITING_BOARD_ACCEPTANCE' });
  await Asset.updateOne({ _id: asset._id }, { nextMaintenanceDate: new Date() });
  assert.equal(await generateMaintenanceWorkOrders(), 0);
});

test('E2E WF1-38: thang máy 180 triệu — Vận hành bị chặn → Quỹ → lập đề xuất → 2/3 đồng ý → nghiệm thu 2 lớp → chi 175 triệu có lý do', async () => {
  const { manager, accountant, tech, board: members, wo } = await setup({ fund: false, balance: 200_000_000, estimatedCost: 180_000_000 });
  await assert.rejects(decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_REQUIRED' });
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const p = await createProposal(manager, body(wo, { amount: 180_000_000 }));
  await vote(members[0], p._id, { decision: 'AGREE' });
  await vote(members[1], p._id, { decision: 'AGREE' });
  assert.equal((await reload(wo)).status, 'UNDER_REPAIR');
  await repair.uploadAcceptance(tech, wo._id, { note: 'Đã thay' }, DOCS);
  await repair.acceptRepair(manager, wo._id);
  await board.boardAccept(members[2], wo._id, {});
  await recordExpense(accountant, p._id, { amount: 175_000_000, documentNo: 'HD-TM', varianceReason: 'Thương lượng giảm giá' });

  assert.equal((await reload(wo)).status, 'DONE');
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 25_000_000);
  const doc = await FundProposal.findById(p._id).lean();
  assert.deepEqual(doc.history.map((h) => h.action), ['SUBMITTED', 'APPROVED', 'BOARD_ACCEPTED', 'PAID']);
  const actions = (await AuditLog.find({}).sort({ createdAt: 1, _id: 1 }).lean()).map((l) => `${l.action}:${String(l.performedBy)}`);
  for (const [action, user] of [
    ['WORKORDER_FUND_REQUESTED', manager], ['FUND_PROPOSAL_CREATED', manager], ['FUND_PROPOSAL_APPROVED', members[1]],
    ['WORKORDER_REPAIR_ACCEPTED', manager], ['WORKORDER_BOARD_ACCEPTED', members[2]], ['FUND_EXPENSE_RECORDED', accountant],
  ]) {
    assert.ok(actions.includes(`${action}:${user.id}`), `thiếu ${action} của đúng người`);
  }
});
