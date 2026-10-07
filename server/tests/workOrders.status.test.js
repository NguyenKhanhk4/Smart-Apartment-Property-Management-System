// Module D — UC-D04: KTV bắt đầu / hoàn thành work order (hoàn thành chạy trong MongoDB transaction → replica set)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createBuilding,
  createManager,
  createReceptionist,
  createTechnician,
  tokenFor,
} from './helpers/fixtures.js';

// Không gọi Cloudinary thật: trả URL giả theo tên file, vẫn giữ middleware kiểm tra file thật
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    uploadToCloudinary: vi.fn(async (files = [], folder) => files.map((f, i) => `https://cdn.test/${folder}/${i}-${f.originalname}`)),
  };
});

const { createApp } = await import('../src/app.js');
const { uploadToCloudinary } = await import('../src/services/upload.service.js');
const service = await import('../src/modules/workOrders/workOrders.service.js');
const assetsService = await import('../src/modules/assets/assets.service.js');
const { generateMaintenanceWorkOrders } = await import('../src/modules/workOrders/workOrders.jobs.js');
const { Asset, Notification, WorkOrder } = await import('../src/models/index.js');
const { DAY_MS, startOfVnDay } = await import('../src/utils/time.js');

const CYCLE = 30;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
// File như multer đưa vào req.files
const PHOTO = { originalname: 'ket-qua.jpg', mimetype: 'image/jpeg', buffer: JPEG };

describe('workOrders UC-D04 — bắt đầu / hoàn thành', () => {
  beforeAll(() => connectTestDB({ replSet: true }), 180000);
  afterEach(async () => {
    vi.restoreAllMocks();
    uploadToCloudinary.mockClear();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  // Manager + KTV + tài sản đã quá hạn bảo trì + work order PENDING giao cho KTV
  const setup = async (woExtra = {}) => {
    const manager = await createManager();
    const tech = await createTechnician();
    const building = await createBuilding();
    const asset = await Asset.create({
      buildingId: building._id,
      name: 'Máy bơm tầng hầm',
      category: 'PUMP',
      maintenanceCycleDays: CYCLE,
      lastMaintenanceDate: new Date(Date.now() - 40 * DAY_MS),
      nextMaintenanceDate: new Date(Date.now() - 10 * DAY_MS),
    });
    const wo = await WorkOrder.create({
      assetId: asset._id,
      type: 'SCHEDULED',
      status: 'PENDING',
      title: `Bảo trì định kỳ ${asset.name}`,
      scheduledDate: asset.nextMaintenanceDate,
      assignedTo: tech._id,
      assignedBy: manager._id,
      assignedAt: new Date(),
      ...woExtra,
    });
    return { manager, tech, tUser: asUser(tech), asset, wo };
  };
  const reload = (wo) => WorkOrder.findById(wo._id).lean();
  const start = (tUser, wo) => service.updateWorkOrderStatus(tUser, wo._id, { status: 'IN_PROGRESS' });
  const finish = (tUser, wo, note = 'Đã thay phớt, chạy thử ổn định', files = [PHOTO]) =>
    service.updateWorkOrderStatus(tUser, wo._id, { status: 'DONE', note }, files);

  describe('updateWorkOrderStatus', () => {
    it('KTV khác (hoặc work order chưa giao ai) → FORBIDDEN_ROLE, work order không đổi', async () => {
      const { wo } = await setup();
      const other = asUser(await createTechnician());
      await expect(start(other, wo)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE', status: 403 });
      await expect(finish(other, wo)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      const unassigned = await WorkOrder.create({ assetId: wo.assetId, type: 'TICKET_LINKED', status: 'PENDING', title: 'Chưa giao' });
      await expect(start(other, unassigned)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      expect((await reload(wo)).status).toBe('PENDING');
      await expect(service.updateWorkOrderStatus(other, '0123456789abcdef01234567', { status: 'IN_PROGRESS' })).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
    });

    it('hoàn thành khi chưa bắt đầu (đang PENDING) → WORKORDER_INVALID_STATUS', async () => {
      const { tUser, wo } = await setup();
      await expect(finish(tUser, wo)).rejects.toMatchObject({ errorCode: 'WORKORDER_INVALID_STATUS', status: 409 });
      const saved = await reload(wo);
      expect(saved.status).toBe('PENDING');
      expect(saved.completedAt ?? null).toBeNull();
    });

    it('hoàn thành không có ảnh → VALIDATION_ERROR; upload ảnh lỗi → work order vẫn IN_PROGRESS, tài sản không đổi', async () => {
      const { tUser, asset, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      await expect(finish(tUser, wo, 'Hoàn tất bảo trì', [])).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });

      uploadToCloudinary.mockRejectedValueOnce(new Error('Upload ảnh thất bại'));
      await expect(finish(tUser, wo)).rejects.toThrow('Upload ảnh thất bại');
      expect((await reload(wo)).status).toBe('IN_PROGRESS');
      const a = await Asset.findById(asset._id).lean();
      expect(a.nextMaintenanceDate.getTime()).toBe(asset.nextMaintenanceDate.getTime());
    });

    it('bắt đầu → IN_PROGRESS + startedAt; bắt đầu lại → WORKORDER_INVALID_STATUS', async () => {
      const { tUser, wo } = await setup();
      const before = Date.now();
      const res = await start(tUser, wo);
      expect(res.status).toBe('IN_PROGRESS');
      const saved = await reload(wo);
      expect(saved.startedAt.getTime()).toBeGreaterThanOrEqual(before);

      await expect(start(tUser, wo)).rejects.toMatchObject({ errorCode: 'WORKORDER_INVALID_STATUS' });
      expect((await reload(wo)).startedAt.getTime()).toBe(saved.startedAt.getTime());
    });

    it('hoàn thành → DONE + completedAt + note; tài sản: last = hôm nay (00:00 VN), next = last + chu kỳ; báo Manager kèm ngày tiếp theo', async () => {
      const { manager, tech, tUser, asset, wo } = await setup();
      await start(tUser, wo);
      const res = await finish(tUser, wo, '  Đã thay phớt, chạy thử ổn định  ');
      expect(res).toMatchObject({ status: 'DONE', note: 'Đã thay phớt, chạy thử ổn định', isOverdue: false });

      const saved = await reload(wo);
      expect(saved.status).toBe('DONE');
      expect(saved.completedAt).toBeTruthy();
      expect(saved.completionImages).toEqual(['https://cdn.test/work-orders/0-ket-qua.jpg']);
      expect(uploadToCloudinary).toHaveBeenCalledWith([PHOTO], 'work-orders');
      expect(String(saved.assignedTo)).toBe(String(tech._id));

      const today = startOfVnDay();
      const a = await Asset.findById(asset._id).lean();
      expect(a.lastMaintenanceDate.getTime()).toBe(today.getTime());
      expect(a.nextMaintenanceDate.getTime()).toBe(today.getTime() + CYCLE * DAY_MS);
      expect(a.nextMaintenanceDate.getTime()).toBe(assetsService.computeNextMaintenance(today, CYCLE).getTime());

      const [note] = await Notification.find({ userId: manager._id, type: 'MAINTENANCE' }).lean();
      expect(note.title).toBe('Work order bảo trì đã hoàn thành');
      expect(note.content).toContain(tech.fullName);
      expect(note.content).toContain(asset.name);
      const nextVn = new Date(a.nextMaintenanceDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' });
      expect(note.content).toContain(`Ngày bảo trì tiếp theo: ${nextVn}`);
      expect(String(note.refId)).toBe(String(wo._id));
      expect(await Notification.countDocuments({ userId: tech._id })).toBe(0);
    });

    it('sau DONE: hoàn thành lại / bắt đầu lại / giao lại → WORKORDER_INVALID_STATUS, work order bị khóa', async () => {
      const { manager, tUser, wo } = await setup();
      await start(tUser, wo);
      await finish(tUser, wo, 'Kết quả lần đầu');
      const locked = await reload(wo);
      const other = await createTechnician();

      await expect(finish(tUser, wo, 'Ghi đè kết quả')).rejects.toMatchObject({ errorCode: 'WORKORDER_INVALID_STATUS' });
      await expect(start(tUser, wo)).rejects.toMatchObject({ errorCode: 'WORKORDER_INVALID_STATUS' });
      await expect(service.assignWorkOrder(asUser(manager), wo._id, { assignedTo: String(other._id) })).rejects.toMatchObject({
        errorCode: 'WORKORDER_INVALID_STATUS',
      });
      const after = await reload(wo);
      expect(after.note).toBe('Kết quả lần đầu');
      expect(after.completedAt.getTime()).toBe(locked.completedAt.getTime());
      expect(String(after.assignedTo)).toBe(String(locked.assignedTo));
    });

    it('transaction: lỗi khi cập nhật tài sản → work order vẫn IN_PROGRESS, tài sản không đổi, không gửi thông báo', async () => {
      const { manager, tUser, asset, wo } = await setup();
      await start(tUser, wo);
      vi.spyOn(Asset.prototype, 'save').mockRejectedValueOnce(new Error('boom'));

      await expect(finish(tUser, wo)).rejects.toThrow('boom');
      const pending = await reload(wo);
      expect(pending.status).toBe('IN_PROGRESS');
      expect(pending.completedAt ?? null).toBeNull();
      expect(pending.note).toBeUndefined();
      const a = await Asset.findById(asset._id).lean();
      expect(a.nextMaintenanceDate.getTime()).toBe(asset.nextMaintenanceDate.getTime());
      expect(a.lastMaintenanceDate.getTime()).toBe(asset.lastMaintenanceDate.getTime());
      expect(await Notification.countDocuments({ userId: manager._id })).toBe(0);

      // Hết lỗi thì hoàn thành được bình thường
      vi.restoreAllMocks();
      expect((await finish(tUser, wo)).status).toBe('DONE');
    });

    it('bấm hoàn thành 2 lần song song → đúng 1 lần thành công, lần kia WORKORDER_INVALID_STATUS; chỉ 1 thông báo', async () => {
      const { manager, tUser, wo } = await setup();
      await start(tUser, wo);
      const results = await Promise.allSettled([finish(tUser, wo, 'Lần bấm thứ nhất'), finish(tUser, wo, 'Lần bấm thứ hai')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected');
      expect(failed.reason).toMatchObject({ errorCode: 'WORKORDER_INVALID_STATUS' });
      expect(await Notification.countDocuments({ userId: manager._id })).toBe(1);
    });

    it('Manager giao lại giữa lúc KTV đọc và ghi → FORBIDDEN_ROLE, không ghi đè', async () => {
      const { tUser, wo } = await setup();
      const other = await createTechnician();
      const realFindById = WorkOrder.findById.bind(WorkOrder);
      vi.spyOn(WorkOrder, 'findById').mockImplementationOnce((...args) => ({
        select: () => ({
          lean: async () => {
            const stale = await realFindById(...args).lean();
            await WorkOrder.updateOne({ _id: wo._id }, { assignedTo: other._id });
            return stale;
          },
        }),
      }));
      await expect(start(tUser, wo)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      expect(await reload(wo)).toMatchObject({ status: 'PENDING', startedAt: null });
    });

    it('lịch sử tài sản có lần bảo trì vừa xong (đúng hạn); cron UC-D02 chạy lại không tạo work order; đến chu kỳ sau thì tạo mới', async () => {
      const { tUser, asset, wo } = await setup();
      await start(tUser, wo);
      await finish(tUser, wo);

      const history = await assetsService.getAssetHistory(asset._id, { page: 1, limit: 10 });
      expect(history.pagination.total).toBe(1);
      expect(history.items[0]).toMatchObject({ note: 'Đã thay phớt, chạy thử ổn định' });
      expect((await assetsService.getAsset(asset._id)).openWorkOrder).toBeNull();

      expect(await generateMaintenanceWorkOrders()).toBe(0);
      expect(await WorkOrder.countDocuments()).toBe(1);

      // Đúng ngày bảo trì kế tiếp → cron tạo work order mới cho chu kỳ sau
      expect(await generateMaintenanceWorkOrders(new Date(Date.now() + CYCLE * DAY_MS))).toBe(1);
      expect(await WorkOrder.countDocuments({ status: 'PENDING' })).toBe(1);
    });

    it('thông báo phân công (UC-D03) trỏ /app/my-work-orders', async () => {
      const { manager, wo } = await setup({ assignedTo: null, assignedBy: null, assignedAt: null });
      const tech = await createTechnician();
      await service.assignWorkOrder(asUser(manager), wo._id, { assignedTo: String(tech._id) });
      const [note] = await Notification.find({ userId: tech._id }).lean();
      expect(note.link).toBe('/app/my-work-orders');
    });
  });

  describe('PATCH /api/work-orders/:id/status — phân quyền & validate', () => {
    const app = createApp();
    // files: [[tên, buffer, mimetype]] → gửi multipart giống trình duyệt; không có files → JSON
    const patch = (wo, user, body, files) => {
      let req = request(app).patch(`/api/work-orders/${wo._id ?? wo}/status`);
      if (user) req = req.set('Authorization', `Bearer ${tokenFor(user)}`);
      if (!files) return req.send(body);
      Object.entries(body).forEach(([k, v]) => (req = req.field(k, v)));
      files.forEach(([name, buf, type]) => (req = req.attach('images', buf, { filename: name, contentType: type })));
      return req;
    };
    const photos = (n = 1) => Array.from({ length: n }, (_, i) => [`anh-${i}.jpg`, JPEG, 'image/jpeg']);

    it('KTV bắt đầu 200 → hoàn thành 200 (tài sản cập nhật); KTV khác 403', async () => {
      const { tech, asset, wo } = await setup();
      const other = await createTechnician();

      expect((await patch(wo, other, { status: 'IN_PROGRESS' })).status).toBe(403);
      const started = await patch(wo, tech, { status: 'IN_PROGRESS' });
      expect(started.status).toBe(200);
      expect(started.body.message).toBe('Đã bắt đầu xử lý');
      expect(started.body.data).toMatchObject({ status: 'IN_PROGRESS' });

      const done = await patch(wo, tech, { status: 'DONE', note: 'Hoàn tất bảo trì' }, [
        ['truoc.jpg', JPEG, 'image/jpeg'],
        ['sau.png', PNG, 'image/png'],
      ]);
      expect(done.status).toBe(200);
      expect(done.body.message).toBe('Đã hoàn thành work order');
      expect(done.body.data).toMatchObject({ status: 'DONE', note: 'Hoàn tất bảo trì' });
      expect(done.body.data.completionImages).toEqual([
        'https://cdn.test/work-orders/0-truoc.jpg',
        'https://cdn.test/work-orders/1-sau.png',
      ]);
      expect((await Asset.findById(asset._id).lean()).lastMaintenanceDate.getTime()).toBe(startOfVnDay().getTime());

      const again = await patch(wo, tech, { status: 'DONE', note: 'Hoàn tất lần nữa' }, photos());
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe('WORKORDER_INVALID_STATUS');
    });

    it('hoàn thành thiếu ghi chú / ghi chú < 5 ký tự / chỉ khoảng trắng → 400 VALIDATION_ERROR; work order không đổi', async () => {
      const { tech, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      for (const body of [{ status: 'DONE' }, { status: 'DONE', note: '' }, { status: 'DONE', note: 'ok' }, { status: 'DONE', note: '      ' }]) {
        const res = await patch(wo, tech, body, photos());
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      }
      expect(await reload(wo)).toMatchObject({ status: 'IN_PROGRESS' });
    });

    it('status không hợp lệ (PENDING / DONE-không-hợp-lệ / thiếu), id sai định dạng → 400; id không tồn tại → 404', async () => {
      const { tech, wo } = await setup();
      expect((await patch(wo, tech, { status: 'PENDING' })).status).toBe(400);
      expect((await patch(wo, tech, { status: 'XONG', note: 'Hoàn tất bảo trì' })).status).toBe(400);
      expect((await patch(wo, tech, {})).status).toBe(400);
      expect((await patch('khong-phai-id', tech, { status: 'IN_PROGRESS' })).status).toBe(400);
      expect((await patch('0123456789abcdef01234567', tech, { status: 'IN_PROGRESS' })).status).toBe(404);
    });

    it('bắt đầu kèm note thừa vẫn được (bỏ qua); hoàn thành mà chưa bắt đầu → 409', async () => {
      const { tech, wo } = await setup();
      expect((await patch(wo, tech, { status: 'DONE', note: 'Làm xong rồi nhé' })).status).toBe(409);
      expect((await patch(wo, tech, { status: 'IN_PROGRESS', note: '' })).status).toBe(200);
    });

    it('ảnh bằng chứng: không có ảnh → 400; file giả ảnh → 400; quá 5 ảnh → 400; không upload, work order không đổi', async () => {
      const { tech, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      const body = { status: 'DONE', note: 'Hoàn tất bảo trì' };

      const none = await patch(wo, tech, body);
      expect(none.status).toBe(400);
      expect(none.body.errorCode).toBe('VALIDATION_ERROR');
      expect(none.body.details).toEqual([{ field: 'images', message: 'Bắt buộc có ít nhất 1 ảnh' }]);

      const fake = await patch(wo, tech, body, [['virus.png', Buffer.from('<?php echo 1; ?>'), 'image/png']]);
      expect(fake.status).toBe(400);
      expect((await patch(wo, tech, body, photos(6))).status).toBe(400);

      expect(uploadToCloudinary).not.toHaveBeenCalled();
      const saved = await reload(wo);
      expect(saved.status).toBe('IN_PROGRESS');
      expect(saved.completionImages).toEqual([]);
    });

    it('Manager xem được ảnh + ghi chú báo cáo (chi tiết, danh sách, lịch sử tài sản); KTV khác không xem được', async () => {
      const { manager, tech, asset, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      await patch(wo, tech, { status: 'DONE', note: 'Đã thay dây curoa' }, photos(2));
      const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

      const detail = await request(app).get(`/api/work-orders/${wo._id}`).set(auth(manager));
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ note: 'Đã thay dây curoa', status: 'DONE' });
      expect(detail.body.data.completionImages).toHaveLength(2);

      const list = await request(app).get('/api/work-orders?status=DONE').set(auth(manager));
      expect(list.body.data[0].completionImages).toHaveLength(2);

      const history = await request(app).get(`/api/assets/${asset._id}/history`).set(auth(manager));
      expect(history.body.data[0]).toMatchObject({ note: 'Đã thay dây curoa' });
      expect(history.body.data[0].completionImages).toHaveLength(2);

      const other = await createTechnician();
      expect((await request(app).get(`/api/work-orders/${wo._id}`).set(auth(other))).status).toBe(403);
    });

    it('Manager / Lễ tân gọi /status → 403; không token → 401; work order không đổi', async () => {
      const { manager, wo } = await setup();
      const recep = await createReceptionist();
      expect((await patch(wo, manager, { status: 'IN_PROGRESS' })).status).toBe(403);
      expect((await patch(wo, recep, { status: 'IN_PROGRESS' })).status).toBe(403);
      expect((await patch(wo, null, { status: 'IN_PROGRESS' })).status).toBe(401);
      expect((await reload(wo)).status).toBe('PENDING');
    });

    it('KTV xem danh sách chỉ việc của mình (đang mở trước theo scheduledDate, đã xong theo completedAt)', async () => {
      const { tech, asset, wo } = await setup();
      const other = await createTechnician();
      await WorkOrder.create({ assetId: asset._id, type: 'TICKET_LINKED', status: 'PENDING', title: 'Của người khác', assignedTo: other._id });
      const later = await WorkOrder.create({
        assetId: asset._id,
        type: 'TICKET_LINKED',
        status: 'IN_PROGRESS',
        title: 'Việc sau',
        assignedTo: tech._id,
        scheduledDate: new Date(Date.now() + DAY_MS),
      });
      const done = await WorkOrder.create({ assetId: asset._id, type: 'TICKET_LINKED', status: 'DONE', title: 'Đã xong', assignedTo: tech._id, completedAt: new Date() });

      const open = await request(app)
        .get('/api/work-orders?status=PENDING,IN_PROGRESS&sort=scheduledDate')
        .set('Authorization', `Bearer ${tokenFor(tech)}`);
      expect(open.status).toBe(200);
      expect(open.body.data.map((i) => i._id)).toEqual([String(wo._id), String(later._id)]);

      const finished = await request(app)
        .get('/api/work-orders?status=DONE&sort=-completedAt')
        .set('Authorization', `Bearer ${tokenFor(tech)}`);
      expect(finished.body.data.map((i) => i._id)).toEqual([String(done._id)]);
    });
  });
});
