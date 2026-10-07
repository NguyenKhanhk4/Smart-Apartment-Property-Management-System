// Module D — UC-D02: Tự động tạo work order khi tài sản đến hạn bảo trì
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  createBuilding,
  createManager,
  createReceptionist,
  createResident,
  createTechnician,
  createUser,
  tokenFor,
} from './helpers/fixtures.js';

const { createApp } = await import('../src/app.js');
const { generateMaintenanceWorkOrders } = await import('../src/modules/workOrders/workOrders.jobs.js');
const { JOBS } = await import('../src/jobs/index.js');
const assetsService = await import('../src/modules/assets/assets.service.js');
const { Asset, CronRun, Notification, WorkOrder } = await import('../src/models/index.js');
const { DAY_MS, endOfVnDay, startOfVnDay } = await import('../src/utils/time.js');

let building;
let seq = 0;
const makeAsset = (extra = {}) => {
  seq += 1;
  return Asset.create({
    buildingId: building._id,
    name: `Tài sản ${seq}`,
    category: 'ELEVATOR',
    maintenanceCycleDays: 30,
    nextMaintenanceDate: startOfVnDay(),
    ...extra,
  });
};
const scheduledWos = (extra = {}) => WorkOrder.find({ type: 'SCHEDULED', ...extra }).lean();

describe('workOrders.jobs (UC-D02)', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  const setup = async () => {
    building = await createBuilding();
    return createManager();
  };

  it('tạo work order PENDING cho tài sản đến hạn (đúng hôm nay, cuối ngày, quá hạn) với tiêu đề và ngày lên lịch đúng', async () => {
    await setup();
    const today = await makeAsset({ name: 'Thang máy 1', nextMaintenanceDate: startOfVnDay() });
    const endToday = await makeAsset({ nextMaintenanceDate: endOfVnDay() });
    const overdue = await makeAsset({ nextMaintenanceDate: new Date(startOfVnDay().getTime() - 5 * DAY_MS) });

    expect(await generateMaintenanceWorkOrders()).toBe(3);

    const wos = await scheduledWos();
    expect(wos).toHaveLength(3);
    const wo = wos.find((w) => String(w.assetId) === String(today._id));
    expect(wo).toMatchObject({ type: 'SCHEDULED', status: 'PENDING', title: 'Bảo trì định kỳ Thang máy 1', assignedTo: null });
    expect(wo.scheduledDate.getTime()).toBe(today.nextMaintenanceDate.getTime());
    const od = wos.find((w) => String(w.assetId) === String(overdue._id));
    expect(od.scheduledDate.getTime()).toBe(overdue.nextMaintenanceDate.getTime());
    expect(wos.some((w) => String(w.assetId) === String(endToday._id))).toBe(true);
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

    expect(await generateMaintenanceWorkOrders()).toBe(0);
    expect(await WorkOrder.countDocuments()).toBe(2);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('work order DONE hoặc TICKET_LINKED đang mở không chặn tạo work order định kỳ', async () => {
    await setup();
    const a = await makeAsset();
    const b = await makeAsset();
    await WorkOrder.create({ assetId: a._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: new Date(), completedAt: new Date() });
    await WorkOrder.create({ assetId: b._id, type: 'TICKET_LINKED', status: 'PENDING' });

    expect(await generateMaintenanceWorkOrders()).toBe(2);
    expect(await scheduledWos({ status: 'PENDING' })).toHaveLength(2);
  });

  it('chạy lại trong ngày không tạo thêm bản ghi', async () => {
    await setup();
    await makeAsset();
    expect(await generateMaintenanceWorkOrders()).toBe(1);
    expect(await generateMaintenanceWorkOrders()).toBe(0);
    expect(await generateMaintenanceWorkOrders(new Date(Date.now() + 3600e3))).toBe(0);
    expect(await WorkOrder.countDocuments()).toBe(1);
  });

  it('chạy 2 lần SONG SONG vẫn chỉ 1 work order/tài sản; lỗi trùng 11000 được bỏ qua và log WORKORDER_DUPLICATE', async () => {
    await setup();
    const assets = await Promise.all([makeAsset(), makeAsset(), makeAsset()]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Làm chậm bước kiểm tra "đã có WO mở" để 2 lần chạy cùng vượt qua nó, unique index phải ra tay
    const realExists = WorkOrder.exists.bind(WorkOrder);
    vi.spyOn(WorkOrder, 'exists').mockImplementation(async (...args) => {
      const res = await realExists(...args);
      await new Promise((r) => setTimeout(r, 30));
      return res;
    });

    const [c1, c2] = await Promise.all([generateMaintenanceWorkOrders(), generateMaintenanceWorkOrders()]);
    expect(c1 + c2).toBe(3);
    expect(await WorkOrder.countDocuments()).toBe(3);
    for (const a of assets) expect(await WorkOrder.countDocuments({ assetId: a._id })).toBe(1);
    expect(warn.mock.calls.some(([m]) => String(m).includes('WORKORDER_DUPLICATE'))).toBe(true);
  });

  it('lỗi bất ngờ ở 1 tài sản → log, tiếp tục tài sản khác; lần chạy sau tạo nốt', async () => {
    await setup();
    const bad = await makeAsset({ name: 'Hỏng' });
    await makeAsset({ name: 'Tốt 1' });
    await makeAsset({ name: 'Tốt 2' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realCreate = WorkOrder.create.bind(WorkOrder);
    vi.spyOn(WorkOrder, 'create').mockImplementation(async (doc, ...rest) => {
      if (String(doc.assetId) === String(bad._id)) throw new Error('boom');
      return realCreate(doc, ...rest);
    });

    expect(await generateMaintenanceWorkOrders()).toBe(2);
    expect(await WorkOrder.countDocuments({ assetId: bad._id })).toBe(0);
    expect(err).toHaveBeenCalled();
    // Thông báo vẫn gửi với số work order thực tế đã tạo
    const [note] = await Notification.find({ type: 'MAINTENANCE' }).lean();
    expect(note.content).toContain('2 work order');

    vi.restoreAllMocks();
    expect(await generateMaintenanceWorkOrders()).toBe(1);
  });

  it('tranh chấp "ngừng theo dõi": tài sản bị tắt ngay sau khi tạo → xóa work order vừa tạo và không tính', async () => {
    await setup();
    const racing = await makeAsset({ name: 'Bị ngừng giữa chừng' });
    await makeAsset({ name: 'Bình thường' });
    const realCreate = WorkOrder.create.bind(WorkOrder);
    vi.spyOn(WorkOrder, 'create').mockImplementation(async (doc, ...rest) => {
      const created = await realCreate(doc, ...rest);
      if (String(doc.assetId) === String(racing._id)) await Asset.updateOne({ _id: racing._id }, { isActive: false });
      return created;
    });

    expect(await generateMaintenanceWorkOrders()).toBe(1);
    expect(await WorkOrder.countDocuments({ assetId: racing._id })).toBe(0);
    expect(await WorkOrder.countDocuments()).toBe(1);
  });

  it('tranh chấp ngược: work order xuất hiện xen giữa lúc ngừng theo dõi → setAssetStatus hoàn tác, báo ASSET_HAS_OPEN_WORKORDER', async () => {
    await setup();
    const asset = await makeAsset();
    // setAssetStatus kiểm tra lần 1 (chưa có WO) → job tạo WO → setAssetStatus ghi isActive=false rồi kiểm tra lại
    const realExists = WorkOrder.exists.bind(WorkOrder);
    let calls = 0;
    vi.spyOn(WorkOrder, 'exists').mockImplementation(async (...args) => {
      const res = await realExists(...args);
      calls += 1;
      if (calls === 1) {
        await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date() });
      }
      return res;
    });
    await expect(assetsService.setAssetStatus(asset._id, false)).rejects.toMatchObject({
      errorCode: 'ASSET_HAS_OPEN_WORKORDER',
    });
    expect((await Asset.findById(asset._id)).isActive).toBe(true);
  });

  it('Manager nhận đúng 1 thông báo MAINTENANCE kèm số work order mới; KTV/Lễ tân/Cư dân không nhận; chạy lại không gửi thêm', async () => {
    const manager = await setup();
    const tech = await createTechnician();
    const recep = await createReceptionist();
    const resident = await createResident();
    await Promise.all([makeAsset(), makeAsset(), makeAsset()]);

    expect(await generateMaintenanceWorkOrders()).toBe(3);

    const notes = await Notification.find({ type: 'MAINTENANCE' }).lean();
    expect(notes).toHaveLength(1);
    expect(String(notes[0].userId)).toBe(String(manager._id));
    expect(notes[0].title).toBe('Có tài sản đến hạn bảo trì');
    expect(notes[0].content).toContain('3 work order');
    expect(await Notification.countDocuments({ userId: { $in: [tech._id, recep._id, resident._id] } })).toBe(0);

    expect(await generateMaintenanceWorkOrders()).toBe(0);
    expect(await Notification.countDocuments({ type: 'MAINTENANCE' })).toBe(1);
  });

  it('không có tài sản đến hạn → không tạo, không thông báo', async () => {
    await setup();
    await makeAsset({ nextMaintenanceDate: new Date(Date.now() + 10 * DAY_MS) });
    expect(await generateMaintenanceWorkOrders()).toBe(0);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('"hôm nay" tính theo giờ VN: 02:00 VN ngày 11/03 (19:00Z) gồm tài sản đến hạn tới 23:59:59 VN hôm đó', async () => {
    await setup();
    const now = new Date('2026-03-10T19:00:00Z');
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-10T17:00:00Z') }); // 00:00 VN 11/03
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-11T16:59:59Z') }); // 23:59:59 VN 11/03
    await makeAsset({ nextMaintenanceDate: new Date('2026-03-11T17:00:00Z') }); // 00:00 VN 12/03 — chưa đến hạn
    expect(await generateMaintenanceWorkOrders(now)).toBe(2);
  });

  it('job được đăng ký lúc 02:00 hằng ngày với tên WORK_ORDER_GENERATE', () => {
    const job = JOBS.find((j) => j.name === 'WORK_ORDER_GENERATE');
    expect(job).toMatchObject({ schedule: '0 2 * * *', handler: generateMaintenanceWorkOrders });
  });

  describe('POST /api/work-orders/jobs/generate/run — chạy thủ công', () => {
    const app = createApp();
    const run = (token) => {
      const req = request(app).post('/api/work-orders/jobs/generate/run');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('Manager → 200, tạo work order và ghi cron_runs (trigger MANUAL, affectedCount = số WO tạo)', async () => {
      const manager = await setup();
      await Promise.all([makeAsset(), makeAsset()]);

      const res = await run(tokenFor(manager));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ jobName: 'WORK_ORDER_GENERATE', trigger: 'MANUAL', status: 'SUCCESS', affectedCount: 2 });
      expect(await WorkOrder.countDocuments()).toBe(2);
      const runs = await CronRun.find({ jobName: 'WORK_ORDER_GENERATE' }).lean();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ trigger: 'MANUAL', affectedCount: 2 });

      const again = await run(tokenFor(manager));
      expect(again.status).toBe(200);
      expect(again.body.data.affectedCount).toBe(0);
      expect(await WorkOrder.countDocuments()).toBe(2);
    });

    it('ADMIN → 200', async () => {
      await setup();
      const admin = await createUser('ADMIN');
      expect((await run(tokenFor(admin))).status).toBe(200);
    });

    it('KTV / Lễ tân / Cư dân → 403; không token → 401; không tạo work order, không ghi cron_runs', async () => {
      await setup();
      await makeAsset();
      for (const user of [await createTechnician(), await createReceptionist(), await createResident()]) {
        expect((await run(tokenFor(user))).status).toBe(403);
      }
      expect((await run()).status).toBe(401);
      expect(await WorkOrder.countDocuments()).toBe(0);
      expect(await CronRun.countDocuments()).toBe(0);
    });
  });
});
