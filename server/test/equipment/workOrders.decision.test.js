// Người 1 (Mô đun 10) — UC10: duyệt sửa chữa lớn (vận hành / Quỹ / tạm hoãn / ngừng sử dụng), gửi yêu cầu sửa lại,
// nhắc phiếu hoãn lặp mỗi N ngày, kiểm tra định kỳ trên thiết bị có lỗi đã biết, nối với module quỹ.
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, AuditLog, FundProposal, Notification, SystemConfig, WorkOrder } from '../../src/models/index.js';
import * as assetsService from '../../src/modules/assets/assets.service.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as fund from '../../src/modules/workOrders/workOrders.fund.js';
import * as inspection from '../../src/modules/workOrders/workOrders.inspection.js';
import { generateMaintenanceWorkOrders, warnEquipment } from '../../src/modules/workOrders/workOrders.jobs.js';
import * as repair from '../../src/modules/workOrders/workOrders.repair.js';
import * as service from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApi, stubCloudinary } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createTechnician, createUser } from '../helpers/fixtures.js';

let server;
let api;
let upload;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PHOTO = { originalname: 'anh.jpg', mimetype: 'image/jpeg', buffer: JPEG };
const CHECKLIST = [{ label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400, required: true }];
const FAULT = { faultDesc: 'Biến áp tủ điều khiển cháy', vendorName: 'Công ty Toàn Phát', vendorProposal: 'Thay biến áp mới', estimatedCost: 12_500_000 };
const inDays = (n, base = new Date()) => new Date(startOfVnDay(base).getTime() + n * DAY_MS);

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api, upload } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('UC10 — duyệt sửa chữa lớn', () => {
  beforeEach(() => {
    stubCloudinary();
  });
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

  /** Phiếu đã báo hư hỏng (Chờ duyệt sửa) */
  const setup = async () => {
    const manager = await createManager();
    const accountant = await createUser('ACCOUNTANT');
    const tech = await createTechnician();
    const building = await createBuilding();
    const asset = await Asset.create({
      buildingId: building._id, code: 'TM-01', name: 'Thang máy 1', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH',
      checklist: CHECKLIST, nextMaintenanceDate: new Date(Date.now() - 10 * DAY_MS),
    });
    const wo = await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì Thang máy 1', scheduledDate: asset.nextMaintenanceDate, checklist: CHECKLIST });
    const ctx = { manager, mUser: asUser(manager), accountant, tech, tUser: asUser(tech), asset, wo };
    await inspection.scanWorkOrder(ctx.tUser, wo._id, asset.qrCode);
    await inspection.submitInspection(ctx.tUser, wo._id, { result: 'FAULTY', note: 'Điện áp vượt ngưỡng', results: [{ value: 420 }] }, [PHOTO]);
    await repair.reportFault(ctx.tUser, wo._id, FAULT, [PHOTO]);
    return ctx;
  };
  const reload = (wo) => WorkOrder.findById(wo._id).lean();
  const postpone = (ctx, days = 30, comment = 'Chờ ngân sách quý sau') =>
    decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'POSTPONE', comment, reviewDate: inDays(days) });
  const pendingProposal = (wo) => FundProposal.collection.insertOne({ workOrderId: wo._id, status: 'PENDING', title: 'Sửa thang máy', amount: 1 });

  it('duyệt Quỹ: giữ Chờ duyệt sửa, ghi nguồn Quỹ, báo Kế toán và KTV; chưa có đề xuất thì Trưởng BQL đổi được quyết định', async () => {
    const ctx = await setup();
    const res = await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'FUND', comment: 'Chi phí lớn' });
    assert.equal(res.status, 'AWAITING_REPAIR_APPROVAL');
    assert.equal(res.repair.costSource, 'FUND');
    assert.deepEqual(res.repair.history.map((h) => h.action), ['REPORTED', 'FUND_REQUESTED']);
    assert.ok(await Notification.exists({ userId: ctx.accountant._id, title: 'Cần lập đề xuất chi quỹ sửa chữa' }));
    assert.ok(await Notification.exists({ userId: ctx.tech._id, title: 'Sửa chữa chờ duyệt chi quỹ' }));
    const audit = await AuditLog.findOne({ action: 'WORKORDER_FUND_REQUESTED' }).lean();
    assert.equal(audit.metadata.financial, true);

    await fund.assertAwaitingFund(ctx.wo._id); // Kế toán lập được đề xuất
    const prefill = await fund.fundPrefill(ctx.wo._id);
    assert.equal(prefill.amount, FAULT.estimatedCost);
    assert.match(prefill.title, /TM-01 – Thang máy 1/);
    assert.equal(prefill.awaitingFund, true);

    // chưa có đề xuất đang chờ → đổi sang chi phí vận hành được
    const changed = await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
    assert.equal(changed.status, 'UNDER_REPAIR');
    await assert.rejects(fund.assertAwaitingFund(ctx.wo._id), { errorCode: 'WORKORDER_NOT_AWAITING_FUND' });
  });

  it('có đề xuất chi quỹ đang chờ: không lập đề xuất thứ 2, không quyết định lại; Ban quản trị từ chối → về chờ Trưởng BQL quyết định lại', async () => {
    const ctx = await setup();
    await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'FUND' });
    await pendingProposal(ctx.wo);
    await assert.rejects(fund.assertAwaitingFund(ctx.wo._id), { errorCode: 'WORKORDER_FUND_PENDING' });
    await assert.rejects(postpone(ctx), { errorCode: 'WORKORDER_FUND_PENDING' });
    await assert.rejects(decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_FUND_PENDING' });

    await FundProposal.collection.updateMany({ workOrderId: ctx.wo._id }, { $set: { status: 'REJECTED' } });
    assert.equal(await fund.onFundDecision(ctx.wo._id, 'REJECTED'), true);
    const wo = await reload(ctx.wo);
    assert.equal(wo.status, 'AWAITING_REPAIR_APPROVAL');
    assert.equal(wo.repair.costSource, null);
    assert.equal(wo.repair.history.at(-1).action, 'FUND_REJECTED');
    assert.match((await Notification.findOne({ userId: ctx.manager._id, title: 'Ban quản trị từ chối chi quỹ' }).lean()).content, /quyết định lại/);
    assert.equal(await fund.onFundDecision(ctx.wo._id, 'REJECTED'), false); // không còn chờ Quỹ → bỏ qua
    assert.equal((await postpone(ctx)).status, 'REPAIR_POSTPONED'); // giờ quyết định lại được
  });

  it('Kế toán rút đề xuất → bỏ nguồn Quỹ; Ban quản trị duyệt → Đang sửa, báo KTV; nghiệm thu tự đánh dấu nghiệm thu bên quỹ (Q12)', async () => {
    const ctx = await setup();
    await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'FUND' });
    assert.equal(await fund.onFundDecision(ctx.wo._id, 'CANCELLED'), true);
    assert.equal((await reload(ctx.wo)).repair.costSource, null);

    await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'FUND' });
    const { insertedId } = await FundProposal.collection.insertOne({ workOrderId: ctx.wo._id, status: 'APPROVED', workAcceptedAt: null });
    assert.equal(await fund.onFundDecision(ctx.wo._id, 'APPROVED', { proposalId: insertedId }), true);
    const wo = await reload(ctx.wo);
    assert.equal(wo.status, 'UNDER_REPAIR');
    assert.equal(String(wo.repair.history.at(-1).refId), String(insertedId));
    assert.ok(await Notification.exists({ userId: ctx.tech._id, title: 'Sửa chữa đã được duyệt' }));

    await repair.uploadAcceptance(ctx.tUser, ctx.wo._id, { note: 'Xong' }, [PHOTO]);
    await repair.acceptRepair(ctx.mUser, ctx.wo._id);
    const proposal = await FundProposal.collection.findOne({ _id: insertedId });
    assert.ok(proposal.workAcceptedAt);
    assert.equal(String(proposal.workAcceptedBy), ctx.mUser.id);
  });

  it('tạm hoãn: thiếu lý do / ngày đã qua / quá 90 ngày → MSG-G01; thành công → dời lịch theo lúc kiểm tra, báo KTV, job không tạo phiếu ngay', async () => {
    const ctx = await setup();
    await assert.rejects(postpone(ctx, 30, 'ab'), { errorCode: 'VALIDATION_ERROR' });
    await assert.rejects(postpone(ctx, 0), { errorCode: 'VALIDATION_ERROR' });
    await assert.rejects(postpone(ctx, 91), { errorCode: 'VALIDATION_ERROR' });
    await SystemConfig.create({ key: 'REPAIR_POSTPONE_MAX_DAYS', value: 120, scope: 'BUSINESS' });

    const res = await postpone(ctx, 91);
    assert.equal(res.status, 'REPAIR_POSTPONED');
    assert.equal(res.repair.reviewDate.getTime(), inDays(91).getTime());
    assert.equal(res.repair.history.at(-1).action, 'POSTPONED');
    assert.equal(res.repair.history.at(-1).reviewDate.getTime(), inDays(91).getTime());
    const asset = await Asset.findById(ctx.asset._id).lean();
    assert.ok(asset.nextMaintenanceDate > new Date(Date.now() + 20 * DAY_MS)); // + 1 tháng từ lúc kiểm tra
    assert.equal(await generateMaintenanceWorkOrders(new Date(Date.now() + DAY_MS)), 0);
    assert.match((await Notification.findOne({ userId: ctx.tech._id, title: 'Sửa chữa tạm hoãn' }).lean()).content, /Chờ ngân sách/);
    await assert.rejects(postpone(ctx), { errorCode: 'WORKORDER_INVALID_STATUS' }); // đang hoãn: gửi yêu cầu lại trước
  });

  it('job nhắc: chưa tới ngày xem lại thì không nhắc; tới ngày nhắc 1 lần; nhắc lại sau đúng N ngày; phiếu vẫn tạm hoãn', async () => {
    const ctx = await setup();
    await postpone(ctx, 10);
    const at = (days) => new Date(inDays(days).getTime() + 7 * HOUR_MS);
    assert.equal(await decision.remindPostponedRepairs(at(9)), 0);
    assert.equal(await decision.remindPostponedRepairs(at(10)), 1);
    assert.equal(await decision.remindPostponedRepairs(at(10)), 0); // chạy lại cùng ngày
    assert.equal(await decision.remindPostponedRepairs(at(16)), 0);
    assert.equal(await decision.remindPostponedRepairs(at(17)), 1); // 7 ngày sau
    const wo = await reload(ctx.wo);
    assert.equal(wo.status, 'REPAIR_POSTPONED');
    assert.equal(wo.repair.remindCount, 2);
    const notes = await Notification.find({ userId: ctx.manager._id, title: 'Đến hạn xem lại sửa chữa tạm hoãn' }).sort({ createdAt: 1 }).lean();
    assert.equal(notes.length, 2);
    assert.match(notes[1].content, /quá 7 ngày, nhắc lần 2/);

    await SystemConfig.create({ key: 'REPAIR_REVIEW_REPEAT_DAYS', value: 3, scope: 'BUSINESS' });
    assert.equal(await decision.remindPostponedRepairs(at(20)), 1); // theo tham số
    // lỡ nhiều ngày vẫn nhắc bù; 2 lần chạy song song không nhắc trùng
    const both = await Promise.all([decision.remindPostponedRepairs(at(40)), decision.remindPostponedRepairs(at(40))]);
    assert.equal(both[0] + both[1], 1);
  });

  it('phiếu hoãn: không vào cảnh báo quá hạn, không giao lại, không ngừng theo dõi thiết bị bằng nút thường; job vẫn tạo phiếu kiểm tra (Q8)', async () => {
    const ctx = await setup();
    await postpone(ctx);
    assert.equal(service.isOverdue(await reload(ctx.wo)), false);
    assert.equal(await warnEquipment(), 0);
    await assert.rejects(service.assignWorkOrder(ctx.mUser, ctx.wo._id, { assignedTo: String((await createTechnician())._id) }), { errorCode: 'WORKORDER_INVALID_STATUS' });
    await assert.rejects(assetsService.setAssetStatus(ctx.asset._id, false), { errorCode: 'ASSET_HAS_OPEN_WORKORDER' });

    await Asset.updateOne({ _id: ctx.asset._id }, { nextMaintenanceDate: new Date() });
    assert.equal(await generateMaintenanceWorkOrders(), 1);
    const detail = await assetsService.getAsset(ctx.asset._id);
    assert.equal(detail.openWorkOrder.status, 'PENDING');
    assert.equal(String(detail.postponedRepair._id), String(ctx.wo._id));
  });

  it('gửi yêu cầu sửa lại: chỉ khi đang hoãn; KTV khác gửi → về Chờ duyệt sửa, giao cho KTV đó, cập nhật chi phí; lịch sử giữ đủ các vòng hoãn', async () => {
    const ctx = await setup();
    await assert.rejects(decision.requestRepair(ctx.tUser, ctx.wo._id, { note: 'Lỗi nặng hơn' }), { errorCode: 'WORKORDER_NOT_POSTPONED' });
    await postpone(ctx);
    await decision.remindPostponedRepairs(new Date(inDays(30).getTime() + 7 * HOUR_MS));

    const tech2 = asUser(await createTechnician());
    const res = await decision.requestRepair(tech2, ctx.wo._id, { note: 'Thang rung mạnh hơn', estimatedCost: 15_000_000 }, [PHOTO]);
    assert.equal(res.status, 'AWAITING_REPAIR_APPROVAL');
    assert.equal(String(res.assignedTo), tech2.id);
    assert.equal(res.repair.estimatedCost, 15_000_000);
    assert.equal(res.repair.reviewDate, null);
    assert.equal(res.repair.remindCount, 0);
    assert.ok(await Notification.exists({ userId: ctx.manager._id, title: 'Yêu cầu sửa lại thiết bị đang hoãn' }));

    await postpone(ctx, 20, 'Hoãn tiếp chờ phụ tùng');
    const wo = await reload(ctx.wo);
    assert.deepEqual(wo.repair.history.map((h) => h.action), ['REPORTED', 'POSTPONED', 'REQUESTED', 'POSTPONED']);
    assert.equal(wo.repair.history[2].cost, 15_000_000);
  });

  it('kiểm tra định kỳ trên thiết bị đang hoãn: hiện lỗi đã biết; Có sự cố → phiếu kiểm tra hoàn thành, ghi vào phiếu hoãn, không báo hư hỏng lần 2', async () => {
    const ctx = await setup();
    await postpone(ctx);
    await Asset.updateOne({ _id: ctx.asset._id }, { nextMaintenanceDate: new Date() });
    await generateMaintenanceWorkOrders();
    const check = await WorkOrder.findOne({ assetId: ctx.asset._id, status: 'PENDING' }).lean();

    const scanned = await inspection.scanWorkOrder(ctx.tUser, check._id, ctx.asset.qrCode);
    assert.equal(String(scanned.knownFault._id), String(ctx.wo._id));
    assert.equal(scanned.knownFault.status, 'REPAIR_POSTPONED');
    assert.equal(scanned.knownFault.faultDesc, FAULT.faultDesc);

    const res = await inspection.submitInspection(ctx.tUser, check._id, { result: 'FAULTY', note: 'Vẫn quá áp', results: [{ value: 425 }] }, [PHOTO]);
    assert.equal(res.status, 'DONE');
    await assert.rejects(repair.reportFault(ctx.tUser, check._id, FAULT, [PHOTO]), { errorCode: 'WORKORDER_INVALID_STATUS' });
    const postponed = await reload(ctx.wo);
    assert.equal(postponed.status, 'REPAIR_POSTPONED');
    const last = postponed.repair.history.at(-1);
    assert.equal(last.action, 'FOLLOWUP_CHECK');
    assert.match(last.note, /lỗi vẫn còn. Vẫn quá áp/);
    assert.equal(String(last.refId), String(check._id));
    assert.ok(await Notification.exists({ userId: ctx.manager._id, title: 'Kiểm tra lại: lỗi vẫn còn' }));
    assert.ok((await Asset.findById(ctx.asset._id).lean()).nextMaintenanceDate > new Date()); // lịch đã dời
  });

  it('ngừng sử dụng: từ phiếu hoãn → Đã đóng, thiết bị ngừng theo dõi, phiếu kiểm tra đang mở cũng đóng; ghi nhật ký; vào lịch sử thiết bị', async () => {
    const ctx = await setup();
    await postpone(ctx);
    await Asset.updateOne({ _id: ctx.asset._id }, { nextMaintenanceDate: new Date() });
    await generateMaintenanceWorkOrders();
    await assert.rejects(decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'RETIRE', comment: 'ab' }), { errorCode: 'VALIDATION_ERROR' });

    const res = await decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'RETIRE', comment: 'Thiết bị quá cũ, thay mới' });
    assert.equal(res.status, 'CLOSED');
    assert.equal(res.repair.history.at(-1).action, 'RETIRED');
    assert.equal((await Asset.findById(ctx.asset._id).lean()).isActive, false);
    assert.equal(await WorkOrder.countDocuments({ assetId: ctx.asset._id, status: { $ne: 'CLOSED' } }), 0);
    assert.ok(await AuditLog.exists({ action: 'WORKORDER_REPAIR_RETIRED' }));
    assert.ok(await AuditLog.exists({ action: 'ASSET_DEACTIVATED', targetId: ctx.asset._id }));
    const history = await assetsService.getAssetHistory(ctx.asset._id, {});
    assert.ok(history.items.some((w) => String(w._id) === String(ctx.wo._id)));
    assert.equal(await generateMaintenanceWorkOrders(new Date(Date.now() + 60 * DAY_MS)), 0);
  });

  it('2 quyết định cùng lúc chỉ 1 thành công', async () => {
    const ctx = await setup();
    const results = await Promise.allSettled([
      decision.decideRepair(ctx.mUser, ctx.wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }),
      postpone(ctx),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(['CONCURRENT_UPDATE', 'WORKORDER_INVALID_STATUS'].includes(results.find((r) => r.status === 'rejected').reason.errorCode));
  });

  it('API: danh sách theo tab kèm số đếm và tham số; hoãn thiếu ngày → 400; KTV gửi yêu cầu lại (multipart) → 200; KTV xem danh sách → 403', async () => {
    const ctx = await setup();
    const pending = await api('GET', '/work-orders/repairs?tab=pending', ctx.manager);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.length, 1);
    assert.deepEqual(pending.body.counts, { pending: 1, postponed: 0, reviewDue: 0 });
    assert.deepEqual(pending.body.settings, { reviewRepeatDays: 7, postponeMaxDays: 90 });
    assert.equal((await api('GET', '/work-orders/repairs', ctx.tech)).status, 403);

    const bad = await api('PATCH', `/work-orders/${ctx.wo._id}/repair-decision`, ctx.manager, { decision: 'POSTPONE', comment: 'Chờ ngân sách' });
    assert.equal(bad.status, 400);
    const okRes = await api('PATCH', `/work-orders/${ctx.wo._id}/repair-decision`, ctx.manager, { decision: 'POSTPONE', comment: 'Chờ ngân sách', reviewDate: inDays(5).toISOString() });
    assert.equal(okRes.status, 200);
    await WorkOrder.updateOne({ _id: ctx.wo._id }, { 'repair.reviewDate': inDays(-2) });
    const tab = await api('GET', '/work-orders/repairs?tab=postponed', ctx.manager);
    assert.equal(tab.body.counts.reviewDue, 1);
    assert.equal(tab.body.data[0].isReviewDue, true);
    assert.equal(tab.body.data[0].reviewOverdueDays, 2);

    const reqRes = await upload('POST', `/work-orders/${ctx.wo._id}/repair-request`, ctx.tech, { note: 'Lỗi nặng hơn', estimatedCost: '14000000' }, [['a.jpg', JPEG, 'image/jpeg']]);
    assert.equal(reqRes.status, 200);
    assert.equal(reqRes.body.data.status, 'AWAITING_REPAIR_APPROVAL');
  });
});
