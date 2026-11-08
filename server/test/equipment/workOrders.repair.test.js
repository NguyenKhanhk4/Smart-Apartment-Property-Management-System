// Người 1 (Mô đun 10) — UC09: báo hư hỏng → (UC10) duyệt chi phí vận hành → đang sửa → tải biên bản → Trưởng BQL nghiệm thu (Q12)
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, AuditLog, Notification, SystemConfig, WorkOrder } from '../../src/models/index.js';
import * as assetsService from '../../src/modules/assets/assets.service.js';
import * as inspection from '../../src/modules/workOrders/workOrders.inspection.js';
import { generateMaintenanceWorkOrders, warnEquipment } from '../../src/modules/workOrders/workOrders.jobs.js';
import * as decision from '../../src/modules/workOrders/workOrders.decision.js';
import * as repair from '../../src/modules/workOrders/workOrders.repair.js';
import * as service from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApi, stubCloudinary } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createTechnician } from '../helpers/fixtures.js';

let server;
let api;
let upload;


const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PHOTO = { originalname: 'anh.jpg', mimetype: 'image/jpeg', buffer: JPEG };
const CHECKLIST = [{ label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400, required: true }];
const FAULT = { faultDesc: 'Biến áp tủ điều khiển cháy', vendorName: 'Công ty Toàn Phát', vendorProposal: 'Thay biến áp mới', estimatedCost: 12_500_000 };

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api, upload } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('UC09 — báo hư hỏng và nghiệm thu sửa chữa', () => {
  beforeEach(() => {
    stubCloudinary();
  });
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

  /** Phiếu đã kiểm tra Có sự cố (UC08) của KTV; `until` dừng ở bước: 'faulty' | 'reported' | 'approved' | 'uploaded' */
  const setup = async (until = 'faulty', { nextInDays = -10 } = {}) => {
    const manager = await createManager();
    const tech = await createTechnician();
    const building = await createBuilding();
    const asset = await Asset.create({
      buildingId: building._id, code: 'TM-01', name: 'Thang máy 1', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH',
      checklist: CHECKLIST, nextMaintenanceDate: new Date(Date.now() + nextInDays * DAY_MS),
    });
    const wo = await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì Thang máy 1', scheduledDate: asset.nextMaintenanceDate, checklist: CHECKLIST });
    const ctx = { mUser: asUser(manager), manager, tech, tUser: asUser(tech), asset, wo };
    await inspection.scanWorkOrder(ctx.tUser, wo._id, asset.qrCode);
    await inspection.submitInspection(ctx.tUser, wo._id, { result: 'FAULTY', note: 'Điện áp vượt ngưỡng', results: [{ value: 420 }] }, [PHOTO]);
    if (until === 'faulty') return ctx;
    await repair.reportFault(ctx.tUser, wo._id, FAULT, [PHOTO]);
    if (until === 'reported') return ctx;
    await decision.decideRepair(ctx.mUser, wo._id, { decision: 'APPROVE', costSource: 'OPERATING', comment: 'Làm ngay' });
    if (until === 'approved') return ctx;
    await repair.uploadAcceptance(ctx.tUser, wo._id, { note: 'Nhà thầu đã thay biến áp' }, [PHOTO]);
    return ctx;
  };
  const reload = (wo) => WorkOrder.findById(wo._id).lean();

  it('báo hư hỏng: chỉ phiếu Có sự cố của mình; thiếu ảnh → MSG-G01; thành công → Chờ duyệt sửa, báo Trưởng BQL (MSG-E06)', async () => {
    const { tUser, wo } = await setup();
    await assert.rejects(repair.reportFault(asUser(await createTechnician()), wo._id, FAULT, [PHOTO]), { errorCode: 'FORBIDDEN_ROLE' });
    await assert.rejects(repair.reportFault(tUser, wo._id, FAULT, []), { errorCode: 'VALIDATION_ERROR' });

    const res = await repair.reportFault(tUser, wo._id, FAULT, [PHOTO]);
    assert.equal(res.status, 'AWAITING_REPAIR_APPROVAL');
    assert.equal(res.repair.estimatedCost, 12_500_000);
    assert.equal(res.repair.faultImages.length, 1);
    assert.deepEqual(res.repair.history.map((h) => h.action), ['REPORTED']);
    const note = await Notification.findOne({ title: 'Báo cáo hư hỏng thiết bị' }).lean();
    assert.match(note.content, /TM-01 – Thang máy 1/);
    await assert.rejects(repair.reportFault(tUser, wo._id, FAULT, [PHOTO]), { errorCode: 'WORKORDER_INVALID_STATUS' }); // không báo 2 lần
  });

  it('báo hư hỏng khi kết quả không phải Có sự cố → WORKORDER_INVALID_STATUS', async () => {
    const manager = await createManager();
    const tUser = asUser(await createTechnician());
    const asset = await Asset.create({ buildingId: (await createBuilding())._id, code: 'B-1', name: 'Bơm', category: 'PUMP', cycleValue: 30, cycleUnit: 'DAY', nextMaintenanceDate: new Date() });
    const wo = await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: 'x', scheduledDate: new Date(), assignedTo: tUser.id, assignedBy: manager._id });
    await inspection.scanWorkOrder(tUser, wo._id, asset.qrCode);
    await assert.rejects(repair.reportFault(tUser, wo._id, FAULT, [PHOTO]), { errorCode: 'WORKORDER_INVALID_STATUS' });
  });

  it('duyệt sửa: chi phí vận hành → Đang sửa, báo KTV (MSG-E07); tải biên bản trước khi duyệt bị chặn', async () => {
    const { tUser, mUser, wo } = await setup('reported');
    await assert.rejects(repair.uploadAcceptance(tUser, wo._id, {}, [PHOTO]), { errorCode: 'WORKORDER_INVALID_STATUS' });
    const res = await decision.decideRepair(mUser, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' });
    assert.equal(res.status, 'UNDER_REPAIR');
    assert.equal(res.repair.costSource, 'OPERATING');
    assert.ok(await Notification.exists({ userId: tUser.id, title: 'Sửa chữa đã được duyệt' }));
    await assert.rejects(decision.decideRepair(mUser, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }), { errorCode: 'WORKORDER_INVALID_STATUS' });
  });

  it('tải biên bản: bắt buộc ảnh; chỉ chuyển Chờ nghiệm thu (chưa hoàn thành, thiết bị chưa dời lịch); báo Trưởng BQL (MSG-E13)', async () => {
    const { tUser, wo, asset } = await setup('approved');
    await assert.rejects(repair.uploadAcceptance(tUser, wo._id, {}, []), { errorCode: 'VALIDATION_ERROR' });
    const res = await repair.uploadAcceptance(tUser, wo._id, { note: 'Xong' }, [PHOTO]);
    assert.equal(res.status, 'AWAITING_ACCEPTANCE');
    assert.equal(res.completedAt, undefined);
    assert.equal((await Asset.findById(asset._id).lean()).nextMaintenanceDate.getTime(), asset.nextMaintenanceDate.getTime());
    assert.ok(await Notification.exists({ title: 'Sửa chữa chờ nghiệm thu' }));
  });

  it('Q12: KTV không tự nghiệm thu được; Trưởng BQL nghiệm thu → Hoàn thành, dời lịch khi đã đến hạn, báo KTV (MSG-E11); bấm 2 lần chỉ 1 lần có hiệu lực', async () => {
    const { tUser, mUser, wo, asset } = await setup('uploaded');
    const res403 = await api('POST', `/work-orders/${wo._id}/accept`, tUser);
    assert.equal(res403.status, 403);

    const results = await Promise.allSettled([repair.acceptRepair(mUser, wo._id), repair.acceptRepair(mUser, wo._id)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const saved = await reload(wo);
    assert.equal(saved.status, 'DONE');
    assert.ok(saved.completedAt && saved.repair.acceptedAt);
    assert.deepEqual(saved.repair.history.map((h) => h.action), ['REPORTED', 'APPROVED', 'ACCEPTANCE_UPLOADED', 'ACCEPTED']);
    const a = await Asset.findById(asset._id).lean();
    assert.equal(a.lastMaintenanceDate.getTime(), startOfVnDay().getTime());
    assert.equal(a.nextMaintenanceDate.getTime(), assetsService.computeNextMaintenance(startOfVnDay(), { cycleValue: 1, cycleUnit: 'MONTH' }).getTime());
    assert.equal(await Notification.countDocuments({ userId: tUser.id, title: 'Sửa chữa đã được nghiệm thu' }), 1);
    assert.deepEqual((await AuditLog.find({ targetId: wo._id }).sort({ createdAt: 1, _id: 1 }).lean()).map((l) => l.action).slice(-4),
      ['WORKORDER_FAULT_REPORTED', 'WORKORDER_REPAIR_APPROVED', 'WORKORDER_ACCEPTANCE_UPLOADED', 'WORKORDER_REPAIR_ACCEPTED']);
  });

  it('nghiệm thu khi lịch kế tiếp còn ở tương lai thì giữ nguyên ngày đó', async () => {
    const { mUser, wo, asset } = await setup('uploaded', { nextInDays: 20 });
    await repair.acceptRepair(mUser, wo._id);
    assert.equal((await Asset.findById(asset._id).lean()).nextMaintenanceDate.getTime(), asset.nextMaintenanceDate.getTime());
  });

  it('nghiệm thu khi chưa có biên bản bị từ chối; transaction: lỗi lưu thiết bị thì phiếu vẫn Chờ nghiệm thu', async () => {
    const { mUser, wo } = await setup('approved');
    await assert.rejects(repair.acceptRepair(mUser, wo._id), { errorCode: 'WORKORDER_INVALID_STATUS' });
    const { tUser } = { tUser: asUser({ _id: (await reload(wo)).assignedTo, role: 'STAFF', roleTitle: 'TECHNICIAN' }) };
    await repair.uploadAcceptance(tUser, wo._id, {}, [PHOTO]);
    mock.method(Asset.prototype, 'save', async () => { throw new Error('boom'); });
    await assert.rejects(repair.acceptRepair(mUser, wo._id), /boom/);
    assert.equal((await reload(wo)).status, 'AWAITING_ACCEPTANCE');
  });

  it('yêu cầu sửa lại: thiếu lý do → 400; thành công → Đang sửa, biên bản cũ giữ trong lịch sử, báo KTV; KTV tải biên bản mới được', async () => {
    const { tUser, mUser, wo, manager } = await setup('uploaded');
    const bad = await api('POST', `/work-orders/${wo._id}/return-repair`, manager, { comment: '' });
    assert.equal(bad.status, 400);
    const res = await repair.returnRepair(mUser, wo._id, { comment: 'Biên bản thiếu chữ ký nhà thầu' });
    assert.equal(res.status, 'UNDER_REPAIR');
    assert.deepEqual(res.repair.acceptanceImages, []);
    const uploaded = res.repair.history.find((h) => h.action === 'ACCEPTANCE_UPLOADED');
    assert.equal(uploaded.images.length, 1); // biên bản cũ vẫn còn trong lịch sử
    assert.equal(res.repair.history.at(-1).note, 'Biên bản thiếu chữ ký nhà thầu');
    assert.ok(await Notification.exists({ userId: tUser.id, title: 'Yêu cầu sửa lại' }));
    assert.equal((await repair.uploadAcceptance(tUser, wo._id, {}, [PHOTO])).status, 'AWAITING_ACCEPTANCE');
  });

  it('job: thiết bị đang sửa chữa không bị tạo phiếu mới; không tính quá hạn kiểm tra; chờ nghiệm thu quá 3 ngày thì nhắc', async () => {
    const { wo } = await setup('uploaded');
    assert.equal(await generateMaintenanceWorkOrders(), 0);
    assert.equal(service.isOverdue(await reload(wo)), false);
    assert.equal(await warnEquipment(), 0); // vừa tải biên bản

    await WorkOrder.updateOne({ _id: wo._id }, { 'repair.acceptanceUploadedAt': new Date(Date.now() - 4 * DAY_MS) });
    assert.equal(await warnEquipment(), 1);
    assert.match((await Notification.findOne({ title: 'Sửa chữa chờ nghiệm thu' }).sort({ createdAt: -1 }).lean()).content, /hơn 3 ngày/);

    await SystemConfig.create({ key: 'REPAIR_ACCEPTANCE_REMIND_DAYS', value: 7, scope: 'BUSINESS' });
    assert.equal(await warnEquipment(), 0); // theo tham số
  });

  it('không ngừng theo dõi thiết bị khi đang sửa chữa; Trưởng BQL không giao lại phiếu đang sửa', async () => {
    const { mUser, wo, asset } = await setup('approved');
    await assert.rejects(assetsService.setAssetStatus(asset._id, false), { errorCode: 'ASSET_HAS_OPEN_WORKORDER' });
    const other = await createTechnician();
    await assert.rejects(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(other._id) }), { errorCode: 'WORKORDER_INVALID_STATUS' });
  });

  it('API: báo hư hỏng multipart thiếu chi phí → 400; Trưởng BQL duyệt; KTV gọi duyệt → 403; checklist ca hiện phiếu đang sửa của mình', async () => {
    const { tech, manager, wo } = await setup();
    const missing = await upload('POST', `/work-orders/${wo._id}/fault-report`, tech, { faultDesc: FAULT.faultDesc, vendorProposal: FAULT.vendorProposal }, [['a.jpg', JPEG, 'image/jpeg']]);
    assert.equal(missing.status, 400);
    const ok = await upload('POST', `/work-orders/${wo._id}/fault-report`, tech, { ...FAULT, estimatedCost: String(FAULT.estimatedCost) }, [['a.jpg', JPEG, 'image/jpeg']]);
    assert.equal(ok.status, 200);
    assert.equal((await api('PATCH', `/work-orders/${wo._id}/repair-decision`, tech, { decision: 'APPROVE', costSource: 'OPERATING' })).status, 403);
    assert.equal((await api('PATCH', `/work-orders/${wo._id}/repair-decision`, manager, { decision: 'APPROVE', costSource: 'OPERATING' })).status, 200);
    const shift = await api('GET', '/work-orders/shift-checklist', tech);
    assert.deepEqual(shift.body.data.items.map((i) => i.status), ['UNDER_REPAIR']);
  });
});
