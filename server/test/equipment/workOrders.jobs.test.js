// Người 1 (Mô đun 10) — BR-E03, BR-E07: tạo phiếu bảo trì khi thiết bị đến hạn (kèm bản sao checklist), báo khi không có ca, cảnh báo quá hạn / bảo hành
import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS } from '../../src/jobs/index.js';
import { Asset, CronRun, DutyShift, Notification, WorkOrder } from '../../src/models/index.js';
import * as assetsService from '../../src/modules/assets/assets.service.js';
import { generateMaintenanceWorkOrders, warnEquipment } from '../../src/modules/workOrders/workOrders.jobs.js';
import { DAY_MS, endOfVnDay, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { assertMatch, startApi } from '../helpers/equipment.js';
import { createBuilding, createManager, createReceptionist, createResidentUser, createTechnician } from '../helpers/fixtures.js';

let server;
let api;

let building;
let seq = 0;
const makeAsset = (extra = {}) => {
  seq += 1;
  return Asset.create({
    buildingId: building._id,
    name: `Tài sản ${seq}`,
    category: 'ELEVATOR',
    code: `TB-${seq}`,
    cycleValue: 30,
    cycleUnit: 'DAY',
    nextMaintenanceDate: startOfVnDay(),
    ...extra,
  });
};
const scheduledWos = (extra = {}) => WorkOrder.find({ type: 'SCHEDULED', ...extra }).lean();

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('workOrders.jobs (UC-D02)', () => {
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

  // Mặc định có 1 ca kỹ thuật phủ hôm nay (để không phát sinh MSG-E09); noShift: true để thử trường hợp không có ca
  const setup = async ({ noShift = false } = {}) => {
    building = await createBuilding();
    const manager = await createManager();
    if (!noShift) {
      const tech = await createTechnician();
      await DutyShift.create({ roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(startOfVnDay().getTime() + 8 * 3600e3), endAt: new Date(startOfVnDay().getTime() + 17 * 3600e3) });
    }
    return manager;
  };

  it('tạo work order PENDING cho tài sản đến hạn (đúng hôm nay, cuối ngày, quá hạn) với tiêu đề và ngày lên lịch đúng', async () => {
    await setup();
    const today = await makeAsset({ name: 'Thang máy 1', nextMaintenanceDate: startOfVnDay() });
    const endToday = await makeAsset({ nextMaintenanceDate: endOfVnDay() });
    const overdue = await makeAsset({ nextMaintenanceDate: new Date(startOfVnDay().getTime() - 5 * DAY_MS) });

    assert.equal(await generateMaintenanceWorkOrders(), 3);

    const wos = await scheduledWos();
    assert.equal(wos.length, 3);
    const wo = wos.find((w) => String(w.assetId) === String(today._id));
    assertMatch(wo, { type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì định kỳ Thang máy 1', assignedTo: null });
    assert.equal(wo.scheduledDate.getTime(), today.nextMaintenanceDate.getTime());
    const od = wos.find((w) => String(w.assetId) === String(overdue._id));
    assert.equal(od.scheduledDate.getTime(), overdue.nextMaintenanceDate.getTime());
    assert.equal(wos.some((w) => String(w.assetId) === String(endToday._id)), true);
  });

  it('bỏ qua tài sản chưa đến hạn, đã ngừng theo dõi, đã có work order mở PENDING/IN_PROGRESS (BR-O6)', async () => {
    await setup();
    await makeAsset({ nextMaintenanceDate: startOfVnDay(new Date(Date.now() + DAY_MS * 1.5)) }); // ngày kia
    await makeAsset({ nextMaintenanceDate: new Date(endOfVnDay().getTime() + 1) }); // 00:00 ngày mai
    await makeAsset({ isActive: false });
    const pending = await makeAsset();
    const running = await makeAsset();
    await WorkOrder.create({ assetId: pending._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date() });
    await WorkOrder.create({ assetId: running._id, type: 'SCHEDULED', status: 'IN_PROGRESS', scheduledDate: new Date() });

    assert.equal(await generateMaintenanceWorkOrders(), 0);
    assert.equal(await WorkOrder.countDocuments(), 2);
    assert.equal(await Notification.countDocuments(), 0);
  });

  it('work order DONE hoặc TICKET_LINKED đang mở không chặn tạo work order định kỳ', async () => {
    await setup();
    const a = await makeAsset();
    const b = await makeAsset();
    await WorkOrder.create({ assetId: a._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: new Date(), completedAt: new Date() });
    await WorkOrder.create({ assetId: b._id, type: 'TICKET_LINKED', status: 'PENDING' });

    assert.equal(await generateMaintenanceWorkOrders(), 2);
    assert.equal((await scheduledWos({ status: 'PENDING' })).length, 2);
  });

  it('chạy lại trong ngày không tạo thêm bản ghi', async () => {
    await setup();
    await makeAsset();
    assert.equal(await generateMaintenanceWorkOrders(), 1);
    assert.equal(await generateMaintenanceWorkOrders(), 0);
    assert.equal(await generateMaintenanceWorkOrders(new Date(Date.now() + 3600e3)), 0);
    assert.equal(await WorkOrder.countDocuments(), 1);
  });

  it('chạy 2 lần SONG SONG vẫn chỉ 1 work order/tài sản; lỗi trùng 11000 được bỏ qua và log WORKORDER_DUPLICATE', async () => {
    await setup();
    const assets = await Promise.all([makeAsset(), makeAsset(), makeAsset()]);
    const warn = mock.method(console, 'warn', () => {});
    // Làm chậm bước kiểm tra "đã có WO mở" để 2 lần chạy cùng vượt qua nó, unique index phải ra tay
    const realExists = WorkOrder.exists.bind(WorkOrder);
    mock.method(WorkOrder, 'exists', async (...args) => {
      const res = await realExists(...args);
      await new Promise((r) => setTimeout(r, 30));
      return res;
    });

    const [c1, c2] = await Promise.all([generateMaintenanceWorkOrders(), generateMaintenanceWorkOrders()]);
    assert.equal(c1 + c2, 3);
    assert.equal(await WorkOrder.countDocuments(), 3);
    for (const a of assets) assert.equal(await WorkOrder.countDocuments({ assetId: a._id }), 1);
    assert.equal(warn.mock.calls.some(({ arguments: [m] }) => String(m).includes('WORKORDER_DUPLICATE')), true);
  });

  it('lỗi bất ngờ ở 1 tài sản → log, tiếp tục tài sản khác; lần chạy sau tạo nốt', async () => {
    await setup();
    const bad = await makeAsset({ name: 'Hỏng' });
    await makeAsset({ name: 'Tốt 1' });
    await makeAsset({ name: 'Tốt 2' });
    const err = mock.method(console, 'error', () => {});
    const realCreate = WorkOrder.create.bind(WorkOrder);
    mock.method(WorkOrder, 'create', async (doc, ...rest) => {
      if (String(doc.assetId) === String(bad._id)) throw new Error('boom');
      return realCreate(doc, ...rest);
    });

    assert.equal(await generateMaintenanceWorkOrders(), 2);
    assert.equal(await WorkOrder.countDocuments({ assetId: bad._id }), 0);
    assert.ok(err.mock.callCount() > 0);
    // Thông báo vẫn gửi với số work order thực tế đã tạo
    const [note] = await Notification.find({ type: 'MAINTENANCE', title: 'Có tài sản đến hạn bảo trì' }).lean();
    assert.ok((note.content).includes('2 work order'));

    mock.restoreAll();
    assert.equal(await generateMaintenanceWorkOrders(), 1);
  });

  it('tranh chấp "ngừng theo dõi": tài sản bị tắt ngay sau khi tạo → xóa work order vừa tạo và không tính', async () => {
    await setup();
    const racing = await makeAsset({ name: 'Bị ngừng giữa chừng' });
    await makeAsset({ name: 'Bình thường' });
    const realCreate = WorkOrder.create.bind(WorkOrder);
    mock.method(WorkOrder, 'create', async (doc, ...rest) => {
      const created = await realCreate(doc, ...rest);
      if (String(doc.assetId) === String(racing._id)) await Asset.updateOne({ _id: racing._id }, { isActive: false });
      return created;
    });

    assert.equal(await generateMaintenanceWorkOrders(), 1);
    assert.equal(await WorkOrder.countDocuments({ assetId: racing._id }), 0);
    assert.equal(await WorkOrder.countDocuments(), 1);
  });

  it('tranh chấp ngược: work order xuất hiện xen giữa lúc ngừng theo dõi → setAssetStatus hoàn tác, báo ASSET_HAS_OPEN_WORKORDER', async () => {
    await setup();
    const asset = await makeAsset();
    // setAssetStatus kiểm tra lần 1 (chưa có WO) → job tạo WO → setAssetStatus ghi isActive=false rồi kiểm tra lại
    const realExists = WorkOrder.exists.bind(WorkOrder);
    let calls = 0;
    mock.method(WorkOrder, 'exists', async (...args) => {
      const res = await realExists(...args);
      calls += 1;
      if (calls === 1) {
        await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date() });
      }
      return res;
    });
    await assert.rejects(assetsService.setAssetStatus(asset._id, false), {
      errorCode: 'ASSET_HAS_OPEN_WORKORDER',
    });
    assert.equal((await Asset.findById(asset._id)).isActive, true);
  });

  it('Manager nhận đúng 1 thông báo MAINTENANCE kèm số work order mới; KTV không có ca/Lễ tân/Cư dân không nhận; chạy lại không gửi thêm', async () => {
    const manager = await setup();
    const tech = await createTechnician();
    const recep = await createReceptionist();
    const resident = await createResidentUser();
    await Promise.all([makeAsset(), makeAsset(), makeAsset()]);

    assert.equal(await generateMaintenanceWorkOrders(), 3);

    // KTV có ca nhận MSG-E05 riêng (test MSG-E05); ở đây chỉ xét thông báo cho Trưởng BQL
    const notes = await Notification.find({ type: 'MAINTENANCE', title: 'Có tài sản đến hạn bảo trì' }).lean();
    assert.equal(notes.length, 1);
    assert.equal(String(notes[0].userId), String(manager._id));
    assert.equal(notes[0].title, 'Có tài sản đến hạn bảo trì');
    assert.ok((notes[0].content).includes('3 work order'));
    assert.equal(await Notification.countDocuments({ userId: { $in: [tech._id, recep._id, resident._id] } }), 0);

    assert.equal(await generateMaintenanceWorkOrders(), 0);
    assert.equal(await Notification.countDocuments({ type: 'MAINTENANCE', title: 'Có tài sản đến hạn bảo trì' }), 1);
  });

  it('không có tài sản đến hạn → không tạo, không thông báo', async () => {
    await setup();
    await makeAsset({ nextMaintenanceDate: new Date(Date.now() + 10 * DAY_MS) });
    assert.equal(await generateMaintenanceWorkOrders(), 0);
    assert.equal(await Notification.countDocuments(), 0);
  });

  it('"hôm nay" tính theo giờ VN: 02:00 VN ngày 11/03 (19:00Z) gồm tài sản đến hạn tới 23:59:59 VN hôm đó', async () => {
    await setup();
    const now = new Date('2026-03-10T19:00:00Z');
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-10T17:00:00Z') }); // 00:00 VN 11/03
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-11T16:59:59Z') }); // 23:59:59 VN 11/03
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-11T17:00:00Z') }); // 00:00 VN 12/03 — chưa đến hạn
    assert.equal(await generateMaintenanceWorkOrders(now), 2);
  });

  it('job tạo phiếu chạy 01:00, job cảnh báo chạy 07:00 hằng ngày', () => {
    assertMatch(JOBS.find((j) => j.name === 'WORK_ORDER_GENERATE'), { schedule: '0 1 * * *', handler: generateMaintenanceWorkOrders });
    assertMatch(JOBS.find((j) => j.name === 'EQUIPMENT_WARNING'), { schedule: '0 7 * * *', handler: warnEquipment });
  });

  it('UC07: phiếu lưu bản sao checklist lúc tạo; sửa mẫu sau đó không làm đổi phiếu', async () => {
    await setup();
    const checklist = [{ label: 'Áp lực', unit: 'bar', minValue: 2, maxValue: 6, required: true }, { label: 'Rò rỉ', unit: null, minValue: null, maxValue: null, required: false }];
    const asset = await makeAsset({ checklist });
    await generateMaintenanceWorkOrders();
    await Asset.updateOne({ _id: asset._id }, { checklist: [{ label: 'Mục mới' }] });
    const [wo] = await scheduledWos({ assetId: asset._id });
    assert.deepEqual(wo.checklist, checklist);
  });

  it('BR-E03, MSG-E09: cả ngày không có ca kỹ thuật → báo Trưởng BQL xếp ca (liệt kê mã thiết bị); có ca thì không báo', async () => {
    await setup({ noShift: true });
    await makeAsset({ code: 'TM-X' });
    await generateMaintenanceWorkOrders();
    const alert = await Notification.findOne({ title: 'Phiếu bảo trì chưa có ca kỹ thuật' }).lean();
    assert.ok(alert);
    assert.match(alert.content, /TM-X/);
    assert.equal(alert.link, '/app/duty-shifts');

    await clearTestDB();
    await setup(); // có ca
    await makeAsset();
    await generateMaintenanceWorkOrders();
    assert.equal(await Notification.countDocuments({ title: 'Phiếu bảo trì chưa có ca kỹ thuật' }), 0);
  });

  it('MSG-E05: có phiếu mới → báo mọi KTV có ca kỹ thuật trong ngày (1 lần/người); không có phiếu mới hoặc KTV không có ca thì không báo', async () => {
    await setup();
    const shiftTech = (await DutyShift.findOne({ roleTitle: 'TECHNICIAN' }).lean()).userId;
    // Cùng KTV 2 ca trong ngày chỉ nhận 1 thông báo; KTV không có ca không nhận
    await DutyShift.create({ roleTitle: 'TECHNICIAN', userId: shiftTech, startAt: new Date(startOfVnDay().getTime() + 18 * 3600e3), endAt: new Date(startOfVnDay().getTime() + 22 * 3600e3) });
    const offTech = await createTechnician();
    await makeAsset({ code: 'TM-E05' });

    await generateMaintenanceWorkOrders();
    const notes = await Notification.find({ title: 'Có phiếu bảo trì mới trong ca' }).lean();
    assert.equal(notes.length, 1);
    assert.equal(String(notes[0].userId), String(shiftTech));
    assert.match(notes[0].content, /TM-E05/);
    assert.equal(notes[0].link, '/app/my-work-orders');
    assert.equal(await Notification.countDocuments({ userId: offTech._id, title: 'Có phiếu bảo trì mới trong ca' }), 0);

    // Chạy lại trong ngày: không có phiếu mới → không báo thêm
    await generateMaintenanceWorkOrders();
    assert.equal(await Notification.countDocuments({ title: 'Có phiếu bảo trì mới trong ca' }), 1);
  });

  it('BR-E07, MSG-E08: cảnh báo phiếu quá hạn và thiết bị đang theo dõi hết bảo hành trong 30 ngày; không có gì thì không gửi', async () => {
    await setup();
    assert.equal(await warnEquipment(), 0);
    assert.equal(await Notification.countDocuments({ title: 'Cảnh báo bảo trì thiết bị' }), 0);

    const late = await makeAsset({ nextMaintenanceDate: new Date(Date.now() + 90 * DAY_MS) });
    await WorkOrder.create({ assetId: late._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date(startOfVnDay().getTime() - 2 * DAY_MS) });
    await WorkOrder.create({ assetId: late._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: new Date(startOfVnDay().getTime() - 40 * DAY_MS), completedAt: new Date() });
    const soon = (days, extra = {}) => makeAsset({ nextMaintenanceDate: new Date(Date.now() + 90 * DAY_MS), warrantyEnd: new Date(startOfVnDay().getTime() + days * DAY_MS), ...extra });
    await soon(10);
    await soon(30);
    await soon(31); // ngoài 30 ngày
    await soon(-1); // đã hết bảo hành
    await soon(5, { isActive: false }); // đã ngừng theo dõi

    assert.equal(await warnEquipment(), 3);
    const note = await Notification.findOne({ title: 'Cảnh báo bảo trì thiết bị' }).lean();
    assert.equal(note.content, '1 phiếu bảo trì quá hạn; 2 thiết bị hết bảo hành trong 30 ngày tới.');
  });

  describe('POST /api/work-orders/jobs/generate/run — chạy thủ công', () => {
    const run = (user) => api('POST', '/work-orders/jobs/generate/run', user);

    it('Manager → 200, tạo work order và ghi cron_runs (trigger MANUAL, affectedCount = số WO tạo)', async () => {
      const manager = await setup();
      await Promise.all([makeAsset(), makeAsset()]);

      const res = await run(manager);
      assert.equal(res.status, 200);
      assertMatch(res.body.data, { jobName: 'WORK_ORDER_GENERATE', trigger: 'MANUAL', status: 'SUCCESS', affectedCount: 2 });
      assert.equal(await WorkOrder.countDocuments(), 2);
      const runs = await CronRun.find({ jobName: 'WORK_ORDER_GENERATE' }).lean();
      assert.equal(runs.length, 1);
      assertMatch(runs[0], { trigger: 'MANUAL', affectedCount: 2 });

      const again = await run(manager);
      assert.equal(again.status, 200);
      assert.equal(again.body.data.affectedCount, 0);
      assert.equal(await WorkOrder.countDocuments(), 2);
    });

    it('KTV / Lễ tân / Cư dân → 403; không token → 401; không tạo work order, không ghi cron_runs', async () => {
      await setup();
      await makeAsset();
      for (const user of [await createTechnician(), await createReceptionist(), await createResidentUser()]) {
        assert.equal((await run(user)).status, 403);
      }
      assert.equal((await run()).status, 401);
      assert.equal(await WorkOrder.countDocuments(), 0);
      assert.equal(await CronRun.countDocuments(), 0);
    });
  });
});
