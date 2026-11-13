// Bước 10 × UC10 — nối Quỹ bảo trì với phiếu bảo trì của Người 1: Trưởng BQL duyệt sửa bằng Quỹ → Kế toán lập đề xuất
// gắn phiếu (điền sẵn) → Ban quản trị biểu quyết → phiếu sang Đang sửa / bỏ nguồn Quỹ → nghiệm thu trên phiếu → phiếu chi.
import { after, afterEach, before, beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, FundProposal, Notification, WorkOrder } from '../../src/models/index.js';
import {
  acceptWork,
  cancelProposal,
  createProposal,
  getProposal,
  listAwaitingWorkOrders,
  recordExpense,
  recordIncome,
  vote,
  workOrderPrefill,
} from '../../src/modules/fund/fund.service.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as inspection from '../../src/modules/workOrders/workOrders.inspection.js';
import * as repair from '../../src/modules/workOrders/workOrders.repair.js';
import { DAY_MS } from '../../src/utils/time.js';
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
const CHECKLIST = [{ label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400, required: true }];
const FAULT = { faultDesc: 'Biến áp tủ điều khiển cháy', vendorName: 'Công ty Toàn Phát', vendorProposal: 'Thay biến áp mới', estimatedCost: 12_500_000 };

/** Quỹ có tiền, Ban quản trị 3 người, phiếu bảo trì đã báo hư hỏng (Chờ duyệt sửa) */
async function setup({ fund = true } = {}) {
  const manager = asUser(await createManager());
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const tech = asUser(await createTechnician());
  const board = [];
  for (let i = 0; i < 3; i += 1) board.push(asUser(await createUser('BOARD', { boardTitle: i === 0 ? 'CHAIRMAN' : 'MEMBER' })));
  await recordIncome(accountant, { incomeSource: 'INITIAL_HANDOVER', amount: 500_000_000, documentNo: 'BB-001' });

  const building = await createBuilding();
  const asset = await Asset.create({
    buildingId: building._id, code: 'TM-01', name: 'Thang máy 1', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH',
    checklist: CHECKLIST, nextMaintenanceDate: new Date(Date.now() - 10 * DAY_MS),
  });
  const wo = await WorkOrder.create({
    assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì Thang máy 1', scheduledDate: asset.nextMaintenanceDate, checklist: CHECKLIST,
  });
  await inspection.scanWorkOrder(tech, wo._id, asset.qrCode);
  await inspection.submitInspection(tech, wo._id, { result: 'FAULTY', note: 'Điện áp vượt ngưỡng', results: [{ value: 420 }] }, [PHOTO]);
  await repair.reportFault(tech, wo._id, FAULT, [PHOTO]);
  if (fund) await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', comment: 'Chi phí lớn' });
  return { manager, accountant, tech, board, wo };
}

const body = (wo, extra = {}) => ({
  title: 'Sửa thang máy 1',
  description: 'Thay biến áp tủ điều khiển',
  amount: 13_000_000,
  planType: 'UNSCHEDULED',
  urgentReason: 'Thang máy dừng, ảnh hưởng cư dân',
  workOrderId: String(wo._id),
  ...extra,
});
const reload = (wo) => WorkOrder.findById(wo._id).lean();

test('duyệt: phiếu chờ lập đề xuất → đề xuất gắn phiếu (sửa chữa lớn, kèm ảnh hư hỏng) → Đang sửa → nghiệm thu trên phiếu → phiếu chi', async () => {
  const { manager, accountant, tech, board, wo } = await setup();

  const awaiting = await listAwaitingWorkOrders();
  assert.deepEqual(awaiting.map((w) => String(w._id)), [String(wo._id)]);
  assert.equal(awaiting[0].assetId.code, 'TM-01');
  const prefill = await workOrderPrefill(wo._id);
  assert.equal(prefill.amount, 12_500_000);
  assert.match(prefill.title, /TM-01/);

  const p = await createProposal(accountant, body(wo, { largeRepair: false }), [PHOTO]);
  assert.equal(String(p.workOrderId), String(wo._id));
  assert.equal(p.largeRepair, true); // sửa chữa thiết bị luôn là sửa chữa lớn
  assert.equal(p.attachmentUrls.length, prefill.attachmentUrls.length + 1); // ảnh hư hỏng + báo giá
  assert.deepEqual(await listAwaitingWorkOrders(), []); // đã có đề xuất đang chờ → không còn trong danh sách
  await assert.rejects(createProposal(accountant, body(wo)), { errorCode: 'WORKORDER_FUND_PENDING' });
  await assert.rejects(workOrderPrefill(wo._id), { errorCode: 'WORKORDER_FUND_PENDING' });

  await vote(board[0], p._id, { decision: 'AGREE' });
  const { outcome } = await vote(board[1], p._id, { decision: 'AGREE' });
  assert.equal(outcome, 'APPROVED');
  let w = await reload(wo);
  assert.equal(w.status, 'UNDER_REPAIR');
  assert.equal(w.repair.history.at(-1).action, 'FUND_APPROVED');
  assert.equal(String(w.repair.history.at(-1).refId), String(p._id));
  assert.equal(await Notification.countDocuments({ userId: tech.id, title: 'Sửa chữa đã được duyệt' }), 1);

  const detail = await getProposal(accountant, p._id);
  assert.equal(detail.workOrderId.status, 'UNDER_REPAIR');
  assert.equal(detail.workOrderId.assetId.code, 'TM-01');

  // Đã duyệt + gắn phiếu: không rút, không nghiệm thu tay ở quỹ, chưa nghiệm thu thì chưa chi
  await assert.rejects(cancelProposal(accountant, p._id, { reason: 'Đổi phương án' }), /không rút được/);
  await assert.rejects(acceptWork(manager, p._id), /nghiệm thu trên phiếu bảo trì/);
  await assert.rejects(recordExpense(accountant, p._id, { amount: 12_000_000, documentNo: 'HD-01' }), /nghiệm thu/);

  await repair.uploadAcceptance(tech, wo._id, { note: 'Nhà thầu đã thay biến áp' }, [PHOTO]);
  await repair.acceptRepair(manager, wo._id);
  w = await reload(wo);
  assert.equal(w.status, 'DONE');
  assert.ok((await FundProposal.findById(p._id).lean()).workAcceptedAt);

  const tx = await recordExpense(accountant, p._id, { amount: 12_000_000, documentNo: 'HD-01' });
  assert.match(tx.code, /^PCQ-/);
  assert.equal((await FundProposal.findById(p._id).lean()).status, 'PAID');
});

test('từ chối / rút đề xuất đang chờ → phiếu bỏ nguồn Quỹ, Trưởng BQL quyết định lại; phiếu chưa duyệt bằng Quỹ thì không gắn được', async () => {
  const { manager, accountant, board, wo } = await setup();

  const p1 = await createProposal(accountant, body(wo));
  await vote(board[0], p1._id, { decision: 'DISAGREE', comment: 'Báo giá cao' });
  const { outcome } = await vote(board[1], p1._id, { decision: 'DISAGREE', comment: 'Lấy thêm báo giá' });
  assert.equal(outcome, 'REJECTED');
  let w = await reload(wo);
  assert.equal(w.status, 'AWAITING_REPAIR_APPROVAL');
  assert.equal(w.repair.costSource, null);
  assert.equal(w.repair.history.at(-1).action, 'FUND_REJECTED');
  assert.equal(await Notification.countDocuments({ userId: manager.id, title: 'Ban quản trị từ chối chi quỹ' }), 1);
  // Trưởng BQL chỉ nhận 1 thông báo từ chối (từ phiếu bảo trì), không nhận thêm bản của quỹ
  assert.equal(await Notification.countDocuments({ userId: manager.id, title: /không duyệt chi quỹ/ }), 0);
  await assert.rejects(createProposal(accountant, body(wo)), { errorCode: 'WORKORDER_NOT_AWAITING_FUND' });

  // Trưởng BQL chọn lại Quỹ → Kế toán lập đề xuất mới → rút
  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const p2 = await createProposal(accountant, body(wo));
  await cancelProposal(accountant, p2._id, { reason: 'Nhà thầu rút báo giá' });
  w = await reload(wo);
  assert.equal(w.repair.costSource, null);
  assert.equal(w.repair.history.at(-1).action, 'FUND_CANCELLED');
});

test('phiếu chưa được duyệt bằng Quỹ: không lập đề xuất gắn phiếu; 2 request song song chỉ 1 đề xuất', async () => {
  const { manager, accountant, wo } = await setup({ fund: false });
  await assert.rejects(createProposal(accountant, body(wo)), { errorCode: 'WORKORDER_NOT_AWAITING_FUND' });
  assert.deepEqual(await listAwaitingWorkOrders(), []);

  await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' });
  const results = await Promise.allSettled([createProposal(accountant, body(wo)), createProposal(accountant, body(wo))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'WORKORDER_FUND_PENDING');
  assert.equal(await FundProposal.countDocuments({ workOrderId: wo._id }), 1);
});
