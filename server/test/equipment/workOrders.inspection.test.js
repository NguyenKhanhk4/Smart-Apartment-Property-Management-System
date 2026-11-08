// Người 1 (Mô đun 10) — UC08: kiểm tra định kỳ. Checklist ca → quét QR (BR-E04) → checklist + ảnh → Đạt / Có sự cố (BR-E05)
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, AuditLog, DutyShift, Notification, WorkOrder } from '../../src/models/index.js';
import * as assetsService from '../../src/modules/assets/assets.service.js';
import * as inspection from '../../src/modules/workOrders/workOrders.inspection.js';
import { generateMaintenanceWorkOrders } from '../../src/modules/workOrders/workOrders.jobs.js';
import * as service from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApi, stubCloudinary } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createReceptionist, createTechnician } from '../helpers/fixtures.js';

let server;
let api;
let upload;
let cloud;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PHOTO = { originalname: 'ket-qua.jpg', mimetype: 'image/jpeg', buffer: JPEG }; // như multer đưa vào req.files
const CHECKLIST = [
  { label: 'Điện áp tủ', unit: 'V', minValue: 370, maxValue: 400, required: true },
  { label: 'Phanh', unit: null, minValue: null, maxValue: null, required: true },
  { label: 'Đèn cabin', unit: null, minValue: null, maxValue: null, required: false },
];
const GOOD = [{ value: 380 }, { ok: true }, {}];

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api, upload } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('UC08 — kiểm tra định kỳ', () => {
  beforeEach(() => {
    cloud = stubCloudinary();
  });
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

  // Thiết bị quá hạn + phiếu định kỳ PENDING chưa ai nhận (có bản sao checklist)
  const setup = async ({ wo: woExtra = {}, checklist = CHECKLIST } = {}) => {
    const manager = await createManager();
    const tech = await createTechnician();
    const building = await createBuilding();
    const asset = await Asset.create({
      buildingId: building._id, code: 'TM-01', name: 'Thang máy 1', category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH',
      checklist, lastMaintenanceDate: new Date(Date.now() - 40 * DAY_MS), nextMaintenanceDate: new Date(Date.now() - 10 * DAY_MS),
    });
    const wo = await WorkOrder.create({
      assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì định kỳ Thang máy 1',
      scheduledDate: asset.nextMaintenanceDate, checklist, ...woExtra,
    });
    return { manager, tech, tUser: asUser(tech), asset, wo };
  };
  const shift = (tech, from = -1, to = 8) =>
    DutyShift.create({ roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(Date.now() + from * HOUR_MS), endAt: new Date(Date.now() + to * HOUR_MS) });
  const reload = (wo) => WorkOrder.findById(wo._id).lean();
  const scan = (tUser, wo, qr) => inspection.scanWorkOrder(tUser, wo._id, qr);
  const submit = (tUser, wo, body = {}, files = [PHOTO]) =>
    inspection.submitInspection(tUser, wo._id, { result: 'PASSED', note: '', results: GOOD, ...body }, files);

  describe('chấm checklist', () => {
    it('mục đo theo khoảng cho phép, mục tick theo đạt / không đạt; thiếu mục bắt buộc; mục không bắt buộc bỏ trống được', () => {
      const ok = inspection.evaluateChecklist(CHECKLIST, GOOD);
      assert.deepEqual(ok.results.map((r) => r.isOk), [true, true, null]);
      assert.deepEqual([ok.missing, ok.failing], [[], []]);

      const bad = inspection.evaluateChecklist(CHECKLIST, [{ value: 410 }, { ok: false }, { ok: false }]);
      assert.deepEqual(bad.failing, [0, 1, 2]);
      assert.equal(bad.results[0].value, 410);

      const empty = inspection.evaluateChecklist(CHECKLIST, [{ value: '' }, {}]);
      assert.deepEqual(empty.missing, [0, 1]);
      assert.deepEqual(inspection.evaluateChecklist(CHECKLIST, [{ value: 370 }, { ok: true }]).failing, []); // biên vẫn đạt
      assert.deepEqual(inspection.evaluateChecklist([{ label: 'Áp', unit: 'bar', minValue: 2 }], [{ value: 1.5 }]).failing, [0]);
    });
  });

  describe('checklist ca và quét QR', () => {
    it('checklist ca: phiếu chưa ai nhận + phiếu của mình, không có phiếu người khác; canClaim theo ca trực', async () => {
      const { tUser, wo, asset } = await setup();
      const other = await createTechnician();
      const asset2 = await Asset.create({ ...asset.toObject(), _id: undefined, code: 'TM-02', qrCode: undefined });
      await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'DONE', title: 'Đã xong', scheduledDate: new Date() });
      await WorkOrder.create({ assetId: asset2._id, type: 'SCHEDULED', status: 'IN_PROGRESS', title: 'Của người khác', assignedTo: other._id, scheduledDate: new Date() });

      const none = await inspection.shiftChecklist(tUser);
      assert.deepEqual(none.items.map((i) => i.title), [wo.title]);
      assert.equal(none.items[0].isOverdue, true);
      assert.equal(none.items[0].checklistCount, 3);
      assert.deepEqual([none.hasSchedule, none.onDuty, none.canClaim], [false, false, true]); // không có lịch trực → ai cũng làm được

      await shift(other);
      assert.deepEqual((await inspection.shiftChecklist(tUser)).canClaim, false); // có ca của người khác, mình không trong ca
      await shift(await createTechnician(), -2, -1); // ca đã qua không tính
      await shift({ _id: tUser.id }); // mình vào ca
      assert.deepEqual((await inspection.shiftChecklist(tUser)).canClaim, true);
    });

    it('BR-E04: sai mã QR → MSG-E03, phiếu không đổi; đúng → Đang kiểm tra, gán KTV, ghi lúc quét; mã QR không lộ ra client; nhập tay chữ thường vẫn khớp', async () => {
      const { tUser, wo, asset } = await setup();
      await assert.rejects(scan(tUser, wo, 'EQ-SAI'), { errorCode: 'WORKORDER_WRONG_ASSET', status: 409 });
      assert.equal((await reload(wo)).status, 'PENDING');

      const res = await scan(tUser, wo, ` ${asset.qrCode.toLowerCase()} `);
      assert.equal(res.status, 'IN_PROGRESS');
      assert.equal(res.assetId.qrCode, undefined);
      assert.deepEqual(res.checklist.map((c) => c.label), CHECKLIST.map((c) => c.label));
      const saved = await reload(wo);
      assert.equal(String(saved.assignedTo), tUser.id);
      assert.ok(saved.scannedAt && saved.startedAt && saved.assignedAt);
      assert.equal((await scan(tUser, wo, asset.qrCode)).status, 'IN_PROGRESS'); // quét lại để mở tiếp
    });

    it('có lịch trực mà KTV không trong ca → không nhận được phiếu chưa ai nhận; phiếu Trưởng BQL giao đích danh thì làm được', async () => {
      const { tUser, wo, asset, manager } = await setup();
      await shift(await createTechnician());
      await assert.rejects(scan(tUser, wo, asset.qrCode), { errorCode: 'WORKORDER_NOT_ON_DUTY', status: 403 });

      await service.assignWorkOrder(asUser(manager), wo._id, { assignedTo: tUser.id });
      assert.equal((await scan(tUser, wo, asset.qrCode)).status, 'IN_PROGRESS');
    });

    it('2 KTV cùng quét 1 phiếu → đúng 1 người nhận, người kia WORKORDER_TAKEN; phiếu đã hoàn thành không quét được', async () => {
      const { tUser, wo, asset } = await setup();
      const other = asUser(await createTechnician());
      const results = await Promise.allSettled([scan(tUser, wo, asset.qrCode), scan(other, wo, asset.qrCode)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.errorCode, 'WORKORDER_TAKEN');

      await WorkOrder.updateOne({ _id: wo._id }, { status: 'DONE' });
      const owner = String((await reload(wo)).assignedTo) === tUser.id ? tUser : other;
      await assert.rejects(scan(owner, wo, asset.qrCode), { errorCode: 'WORKORDER_INVALID_STATUS' });
    });
  });

  describe('nộp kết quả', () => {
    const scanned = async (opts) => {
      const ctx = await setup(opts);
      await scan(ctx.tUser, ctx.wo, ctx.asset.qrCode);
      return ctx;
    };

    it('chưa quét QR thì không nộp được (phiếu chưa nhận, hoặc phiếu cũ đang làm dở chưa quét)', async () => {
      const { tUser, wo } = await setup();
      await assert.rejects(submit(tUser, wo), { errorCode: 'FORBIDDEN_ROLE' }); // chưa nhận
      await WorkOrder.updateOne({ _id: wo._id }, { status: 'IN_PROGRESS', assignedTo: tUser.id });
      await assert.rejects(submit(tUser, wo), { errorCode: 'WORKORDER_NOT_SCANNED' });
    });

    it('6b, MSG-G01: thiếu mục bắt buộc hoặc ảnh → 400 kèm từng mục; phiếu không đổi, không upload', async () => {
      const { tUser, wo } = await scanned();
      await assert.rejects(submit(tUser, wo, { results: [{ value: '' }, {}] }), (err) => {
        assert.equal(err.errorCode, 'VALIDATION_ERROR');
        assert.deepEqual(err.details.map((d) => d.field), ['results.0', 'results.1']);
        return true;
      });
      await assert.rejects(submit(tUser, wo, {}, []), (err) => err.details.some((d) => d.field === 'images'));
      assert.equal((await reload(wo)).result, null);
      assert.deepEqual(cloud.folders, []);
    });

    it('có mục bắt buộc không đạt mà chọn Đạt → WORKORDER_RESULT_CONFLICT; mục không bắt buộc không đạt thì vẫn Đạt được', async () => {
      const { tUser, wo } = await scanned();
      await assert.rejects(submit(tUser, wo, { results: [{ value: 420 }, { ok: true }] }), { errorCode: 'WORKORDER_RESULT_CONFLICT' });
      const res = await submit(tUser, wo, { results: [{ value: 380 }, { ok: true }, { ok: false }] });
      assert.equal(res.status, 'DONE');
    });

    it('Đạt → hoàn thành, lưu kết quả từng mục, dời lịch thiết bị theo chu kỳ (tháng); báo Trưởng BQL; ghi nhật ký; đúng hạn theo lúc kiểm tra', async () => {
      const { tUser, wo, asset } = await scanned();
      const res = await submit(tUser, wo, { note: 'Ổn định' });
      assert.equal(res.status, 'DONE');
      const saved = await reload(wo);
      assert.equal(saved.result, 'PASSED');
      assert.deepEqual(saved.results.map((r) => [r.label, r.isOk]), [['Điện áp tủ', true], ['Phanh', true], ['Đèn cabin', null]]);
      assert.ok(saved.inspectedAt && saved.completedAt);
      assert.equal(saved.completionImages.length, 1);

      const a = await Asset.findById(asset._id).lean();
      assert.equal(a.lastMaintenanceDate.getTime(), startOfVnDay().getTime());
      assert.equal(a.nextMaintenanceDate.getTime(), assetsService.computeNextMaintenance(startOfVnDay(), { cycleValue: 1, cycleUnit: 'MONTH' }).getTime());

      const note = await Notification.findOne({ title: 'Kiểm tra định kỳ đạt' }).lean();
      assert.match(note.content, /TM-01 – Thang máy 1: Đạt/);
      const log = await AuditLog.findOne({ action: 'WORKORDER_INSPECTED' }).lean();
      assert.equal(log.after.result, 'PASSED');
      assert.equal(assetsService.isOnTime({ ...saved, completedAt: new Date(Date.now() + 30 * DAY_MS) }), false); // quá hạn 10 ngày
    });

    it('Có sự cố → lưu kết quả, ảnh, mô tả; phiếu vẫn Đang kiểm tra, không dời lịch; báo Trưởng BQL; job không tạo phiếu mới; không nộp lại được', async () => {
      const { tUser, wo, asset } = await scanned();
      await assert.rejects(submit(tUser, wo, { result: 'FAULTY', note: 'hư', results: [{ value: 420 }, { ok: true }] }), { errorCode: 'VALIDATION_ERROR' });
      const res = await submit(tUser, wo, { result: 'FAULTY', note: 'Điện áp vượt ngưỡng, nghi hỏng biến áp', results: [{ value: 420 }, { ok: true }] });
      assert.equal(res.status, 'IN_PROGRESS');
      assert.equal(res.result, 'FAULTY');
      assert.equal((await Asset.findById(asset._id).lean()).nextMaintenanceDate.getTime(), asset.nextMaintenanceDate.getTime());
      assert.ok(await Notification.exists({ title: 'Phát hiện sự cố khi kiểm tra thiết bị' }));
      assert.equal(await generateMaintenanceWorkOrders(), 0);
      await assert.rejects(submit(tUser, wo), { errorCode: 'WORKORDER_INVALID_STATUS' });
    });

    it('transaction: lỗi khi dời lịch thiết bị → phiếu vẫn Đang kiểm tra, không có kết quả; nộp 2 lần song song → đúng 1 lần thành công', async () => {
      const { tUser, wo } = await scanned();
      mock.method(Asset.prototype, 'save', async () => { throw new Error('boom'); });
      await assert.rejects(submit(tUser, wo), /boom/);
      const saved = await reload(wo);
      assert.deepEqual([saved.status, saved.result], ['IN_PROGRESS', null]);
      mock.restoreAll();
      cloud = stubCloudinary();

      const results = await Promise.allSettled([submit(tUser, wo), submit(tUser, wo)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await Notification.countDocuments({ title: 'Kiểm tra định kỳ đạt' }), 1);
    });

    it('phiếu cũ không có checklist (tạo trước UC07): chỉ cần ảnh', async () => {
      const { tUser, wo } = await scanned({ checklist: [] });
      assert.equal((await submit(tUser, wo, { results: [] })).status, 'DONE');
    });
  });

  describe('API', () => {
    it('KTV: checklist ca → quét → nộp multipart (results JSON) → 200; Trưởng BQL, Lễ tân gọi → 403; results sai JSON → 400', async () => {
      const { tech, wo, asset, manager } = await setup();
      const rec = await createReceptionist();
      const list = await api('GET', '/work-orders/shift-checklist', tech);
      assert.equal(list.status, 200);
      assert.equal(list.body.data.items.length, 1);
      assert.equal((await api('GET', '/work-orders/shift-checklist', manager)).status, 403);
      assert.equal((await api('GET', `/work-orders/${wo._id}`, tech)).status, 200); // xem được phiếu chưa ai nhận

      assert.equal((await api('POST', `/work-orders/${wo._id}/scan`, rec, { qrCode: asset.qrCode })).status, 403);
      const wrong = await api('POST', `/work-orders/${wo._id}/scan`, tech, { qrCode: 'EQ-SAI' });
      assert.deepEqual([wrong.status, wrong.body.errorCode], [409, 'WORKORDER_WRONG_ASSET']);
      assert.equal((await api('POST', `/work-orders/${wo._id}/scan`, tech, { qrCode: asset.qrCode })).status, 200);

      const bad = await upload('POST', `/work-orders/${wo._id}/inspection`, tech, { result: 'PASSED', results: '{khong-phai-json' }, [['a.jpg', JPEG, 'image/jpeg']]);
      assert.equal(bad.status, 400);
      const fake = await upload('POST', `/work-orders/${wo._id}/inspection`, tech, { result: 'PASSED', results: JSON.stringify(GOOD) }, [['a.png', Buffer.from('<?php'), 'image/png']]);
      assert.equal(fake.status, 400);
      const done = await upload('POST', `/work-orders/${wo._id}/inspection`, tech, { result: 'PASSED', results: JSON.stringify(GOOD) }, [['a.jpg', JPEG, 'image/jpeg']]);
      assert.equal(done.status, 200);
      assert.equal(done.body.data.status, 'DONE');
      assert.equal((await api('PATCH', `/work-orders/${wo._id}/status`, tech, { status: 'DONE' })).status, 404); // API cũ đã bỏ
    });
  });
});
