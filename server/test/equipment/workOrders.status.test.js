// Người 1 (Mô đun 10) — UC-D04: KTV bắt đầu / hoàn thành work order (hoàn thành chạy trong MongoDB transaction)
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, Notification, WorkOrder } from '../../src/models/index.js';
import * as assetsService from '../../src/modules/assets/assets.service.js';
import { generateMaintenanceWorkOrders } from '../../src/modules/workOrders/workOrders.jobs.js';
import * as service from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { assertMatch, startApi, stubCloudinary } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createReceptionist, createTechnician } from '../helpers/fixtures.js';

let server;
let api;
let upload;
let cloud;

const CYCLE = 30;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
// File như multer đưa vào req.files
const PHOTO = { originalname: 'ket-qua.jpg', mimetype: 'image/jpeg', buffer: JPEG };

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api, upload } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('workOrders UC-D04 — bắt đầu / hoàn thành', () => {
  beforeEach(() => {
    cloud = stubCloudinary();
  });
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

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
      await assert.rejects(start(other, wo), { errorCode: 'FORBIDDEN_ROLE', status: 403 });
      await assert.rejects(finish(other, wo), { errorCode: 'FORBIDDEN_ROLE' });
      const unassigned = await WorkOrder.create({ assetId: wo.assetId, type: 'TICKET_LINKED', status: 'PENDING', title: 'Chưa giao' });
      await assert.rejects(start(other, unassigned), { errorCode: 'FORBIDDEN_ROLE' });
      assert.equal((await reload(wo)).status, 'PENDING');
      await assert.rejects(service.updateWorkOrderStatus(other, '0123456789abcdef01234567', { status: 'IN_PROGRESS' }), {
        errorCode: 'NOT_FOUND',
      });
    });

    it('hoàn thành khi chưa bắt đầu (đang PENDING) → WORKORDER_INVALID_STATUS', async () => {
      const { tUser, wo } = await setup();
      await assert.rejects(finish(tUser, wo), { errorCode: 'WORKORDER_INVALID_STATUS', status: 409 });
      const saved = await reload(wo);
      assert.equal(saved.status, 'PENDING');
      assert.equal(saved.completedAt ?? null, null);
    });

    it('hoàn thành không có ảnh → VALIDATION_ERROR; upload ảnh lỗi → work order vẫn IN_PROGRESS, tài sản không đổi', async () => {
      const { tUser, asset, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      await assert.rejects(finish(tUser, wo, 'Hoàn tất bảo trì', []), { errorCode: 'VALIDATION_ERROR', status: 400 });

      cloud.failNext();
      mock.method(console, 'error', () => {});
      await assert.rejects(finish(tUser, wo), /Upload ảnh thất bại/);
      assert.equal((await reload(wo)).status, 'IN_PROGRESS');
      const a = await Asset.findById(asset._id).lean();
      assert.equal(a.nextMaintenanceDate.getTime(), asset.nextMaintenanceDate.getTime());
    });

    it('bắt đầu → IN_PROGRESS + startedAt; bắt đầu lại → WORKORDER_INVALID_STATUS', async () => {
      const { tUser, wo } = await setup();
      const before = Date.now();
      const res = await start(tUser, wo);
      assert.equal(res.status, 'IN_PROGRESS');
      const saved = await reload(wo);
      assert.ok(saved.startedAt.getTime() >= before);

      await assert.rejects(start(tUser, wo), { errorCode: 'WORKORDER_INVALID_STATUS' });
      assert.equal((await reload(wo)).startedAt.getTime(), saved.startedAt.getTime());
    });

    it('hoàn thành → DONE + completedAt + note; tài sản: last = hôm nay (00:00 VN), next = last + chu kỳ; báo Manager kèm ngày tiếp theo', async () => {
      const { manager, tech, tUser, asset, wo } = await setup();
      await start(tUser, wo);
      const res = await finish(tUser, wo, '  Đã thay phớt, chạy thử ổn định  ');
      assertMatch(res, { status: 'DONE', note: 'Đã thay phớt, chạy thử ổn định', isOverdue: false });

      const saved = await reload(wo);
      assert.equal(saved.status, 'DONE');
      assert.ok(saved.completedAt);
      assert.deepEqual(saved.completionImages, ['https://cdn.test/sapms/work-orders/0']);
      assert.deepEqual(cloud.folders, ['sapms/work-orders']);
      assert.equal(String(saved.assignedTo), String(tech._id));

      const today = startOfVnDay();
      const a = await Asset.findById(asset._id).lean();
      assert.equal(a.lastMaintenanceDate.getTime(), today.getTime());
      assert.equal(a.nextMaintenanceDate.getTime(), today.getTime() + CYCLE * DAY_MS);
      assert.equal(a.nextMaintenanceDate.getTime(), assetsService.computeNextMaintenance(today, CYCLE).getTime());

      const [note] = await Notification.find({ userId: manager._id, type: 'MAINTENANCE' }).lean();
      assert.equal(note.title, 'Work order bảo trì đã hoàn thành');
      assert.ok((note.content).includes(tech.fullName));
      assert.ok((note.content).includes(asset.name));
      const nextVn = new Date(a.nextMaintenanceDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' });
      assert.ok((note.content).includes(`Ngày bảo trì tiếp theo: ${nextVn}`));
      assert.equal(String(note.refId), String(wo._id));
      assert.equal(await Notification.countDocuments({ userId: tech._id }), 0);
    });

    it('sau DONE: hoàn thành lại / bắt đầu lại / giao lại → WORKORDER_INVALID_STATUS, work order bị khóa', async () => {
      const { manager, tUser, wo } = await setup();
      await start(tUser, wo);
      await finish(tUser, wo, 'Kết quả lần đầu');
      const locked = await reload(wo);
      const other = await createTechnician();

      await assert.rejects(finish(tUser, wo, 'Ghi đè kết quả'), { errorCode: 'WORKORDER_INVALID_STATUS' });
      await assert.rejects(start(tUser, wo), { errorCode: 'WORKORDER_INVALID_STATUS' });
      await assert.rejects(service.assignWorkOrder(asUser(manager), wo._id, { assignedTo: String(other._id) }), {
        errorCode: 'WORKORDER_INVALID_STATUS',
      });
      const after = await reload(wo);
      assert.equal(after.note, 'Kết quả lần đầu');
      assert.equal(after.completedAt.getTime(), locked.completedAt.getTime());
      assert.equal(String(after.assignedTo), String(locked.assignedTo));
    });

    it('transaction: lỗi khi cập nhật tài sản → work order vẫn IN_PROGRESS, tài sản không đổi, không gửi thông báo', async () => {
      const { manager, tUser, asset, wo } = await setup();
      await start(tUser, wo);
      mock.method(Asset.prototype, 'save', async () => {
        throw new Error('boom');
      }, { times: 1 });

      await assert.rejects(finish(tUser, wo), /boom/);
      const pending = await reload(wo);
      assert.equal(pending.status, 'IN_PROGRESS');
      assert.equal(pending.completedAt ?? null, null);
      assert.equal(pending.note, undefined);
      const a = await Asset.findById(asset._id).lean();
      assert.equal(a.nextMaintenanceDate.getTime(), asset.nextMaintenanceDate.getTime());
      assert.equal(a.lastMaintenanceDate.getTime(), asset.lastMaintenanceDate.getTime());
      assert.equal(await Notification.countDocuments({ userId: manager._id }), 0);

      // Hết lỗi (mock chỉ áp dụng 1 lần) thì hoàn thành được bình thường
      assert.equal((await finish(tUser, wo)).status, 'DONE');
    });

    it('bấm hoàn thành 2 lần song song → đúng 1 lần thành công, lần kia WORKORDER_INVALID_STATUS; chỉ 1 thông báo', async () => {
      const { manager, tUser, wo } = await setup();
      await start(tUser, wo);
      const results = await Promise.allSettled([finish(tUser, wo, 'Lần bấm thứ nhất'), finish(tUser, wo, 'Lần bấm thứ hai')]);
      assert.equal((results.filter((r) => r.status === 'fulfilled')).length, 1);
      const failed = results.find((r) => r.status === 'rejected');
      assertMatch(failed.reason, { errorCode: 'WORKORDER_INVALID_STATUS' });
      assert.equal(await Notification.countDocuments({ userId: manager._id }), 1);
    });

    it('Manager giao lại giữa lúc KTV đọc và ghi → FORBIDDEN_ROLE, không ghi đè', async () => {
      const { tUser, wo } = await setup();
      const other = await createTechnician();
      const realFindById = WorkOrder.findById.bind(WorkOrder);
      mock.method(WorkOrder, 'findById', (...args) => ({
        select: () => ({
          lean: async () => {
            const stale = await realFindById(...args).lean();
            await WorkOrder.updateOne({ _id: wo._id }, { assignedTo: other._id });
            return stale;
          },
        }),
      }), { times: 1 });
      await assert.rejects(start(tUser, wo), { errorCode: 'FORBIDDEN_ROLE' });
      assertMatch(await reload(wo), { status: 'PENDING', startedAt: null });
    });

    it('lịch sử tài sản có lần bảo trì vừa xong (đúng hạn); cron UC-D02 chạy lại không tạo work order; đến chu kỳ sau thì tạo mới', async () => {
      const { tUser, asset, wo } = await setup();
      await start(tUser, wo);
      await finish(tUser, wo);

      const history = await assetsService.getAssetHistory(asset._id, { page: 1, limit: 10 });
      assert.equal(history.pagination.total, 1);
      assertMatch(history.items[0], { note: 'Đã thay phớt, chạy thử ổn định' });
      assert.equal((await assetsService.getAsset(asset._id)).openWorkOrder, null);

      assert.equal(await generateMaintenanceWorkOrders(), 0);
      assert.equal(await WorkOrder.countDocuments(), 1);

      // Đúng ngày bảo trì kế tiếp → cron tạo work order mới cho chu kỳ sau
      assert.equal(await generateMaintenanceWorkOrders(new Date(Date.now() + CYCLE * DAY_MS)), 1);
      assert.equal(await WorkOrder.countDocuments({ status: 'PENDING' }), 1);
    });

    it('thông báo phân công (UC-D03) trỏ /app/my-work-orders', async () => {
      const { manager, wo } = await setup({ assignedTo: null, assignedBy: null, assignedAt: null });
      const tech = await createTechnician();
      await service.assignWorkOrder(asUser(manager), wo._id, { assignedTo: String(tech._id) });
      const [note] = await Notification.find({ userId: tech._id }).lean();
      assert.equal(note.link, '/app/my-work-orders');
    });
  });

  describe('PATCH /api/work-orders/:id/status — phân quyền & validate', () => {
    // files: [[tên, buffer, mimetype]] → gửi multipart giống trình duyệt; không có files → JSON
    const patch = (wo, user, body, files) => {
      const path = `/work-orders/${wo._id ?? wo}/status`;
      return files ? upload('PATCH', path, user, body, files) : api('PATCH', path, user, body);
    };
    const photos = (n = 1) => Array.from({ length: n }, (_, i) => [`anh-${i}.jpg`, JPEG, 'image/jpeg']);

    it('KTV bắt đầu 200 → hoàn thành 200 (tài sản cập nhật); KTV khác 403', async () => {
      const { tech, asset, wo } = await setup();
      const other = await createTechnician();

      assert.equal((await patch(wo, other, { status: 'IN_PROGRESS' })).status, 403);
      const started = await patch(wo, tech, { status: 'IN_PROGRESS' });
      assert.equal(started.status, 200);
      assert.equal(started.body.message, 'Đã bắt đầu xử lý');
      assertMatch(started.body.data, { status: 'IN_PROGRESS' });

      const done = await patch(wo, tech, { status: 'DONE', note: 'Hoàn tất bảo trì' }, [
        ['truoc.jpg', JPEG, 'image/jpeg'],
        ['sau.png', PNG, 'image/png'],
      ]);
      assert.equal(done.status, 200);
      assert.equal(done.body.message, 'Đã hoàn thành work order');
      assertMatch(done.body.data, { status: 'DONE', note: 'Hoàn tất bảo trì' });
      assert.deepEqual(done.body.data.completionImages, [
        'https://cdn.test/sapms/work-orders/0',
        'https://cdn.test/sapms/work-orders/1',
      ]);
      assert.equal((await Asset.findById(asset._id).lean()).lastMaintenanceDate.getTime(), startOfVnDay().getTime());

      const again = await patch(wo, tech, { status: 'DONE', note: 'Hoàn tất lần nữa' }, photos());
      assert.equal(again.status, 409);
      assert.equal(again.body.errorCode, 'WORKORDER_INVALID_STATUS');
    });

    it('hoàn thành thiếu ghi chú / ghi chú < 5 ký tự / chỉ khoảng trắng → 400 VALIDATION_ERROR; work order không đổi', async () => {
      const { tech, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      for (const body of [{ status: 'DONE' }, { status: 'DONE', note: '' }, { status: 'DONE', note: 'ok' }, { status: 'DONE', note: '      ' }]) {
        const res = await patch(wo, tech, body, photos());
        assert.equal(res.status, 400);
        assert.equal(res.body.errorCode, 'VALIDATION_ERROR');
      }
      assertMatch(await reload(wo), { status: 'IN_PROGRESS' });
    });

    it('status không hợp lệ (PENDING / DONE-không-hợp-lệ / thiếu), id sai định dạng → 400; id không tồn tại → 404', async () => {
      const { tech, wo } = await setup();
      assert.equal((await patch(wo, tech, { status: 'PENDING' })).status, 400);
      assert.equal((await patch(wo, tech, { status: 'XONG', note: 'Hoàn tất bảo trì' })).status, 400);
      assert.equal((await patch(wo, tech, {})).status, 400);
      assert.equal((await patch('khong-phai-id', tech, { status: 'IN_PROGRESS' })).status, 400);
      assert.equal((await patch('0123456789abcdef01234567', tech, { status: 'IN_PROGRESS' })).status, 404);
    });

    it('bắt đầu kèm note thừa vẫn được (bỏ qua); hoàn thành mà chưa bắt đầu → 409', async () => {
      const { tech, wo } = await setup();
      assert.equal((await patch(wo, tech, { status: 'DONE', note: 'Làm xong rồi nhé' })).status, 409);
      assert.equal((await patch(wo, tech, { status: 'IN_PROGRESS', note: '' })).status, 200);
    });

    it('ảnh bằng chứng: không có ảnh → 400; file giả ảnh → 400; quá 5 ảnh → 400; không upload, work order không đổi', async () => {
      const { tech, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      const body = { status: 'DONE', note: 'Hoàn tất bảo trì' };

      const none = await patch(wo, tech, body);
      assert.equal(none.status, 400);
      assert.equal(none.body.errorCode, 'VALIDATION_ERROR');
      assert.deepEqual(none.body.details, [{ field: 'images', message: 'Bắt buộc có ít nhất 1 ảnh' }]);

      const fake = await patch(wo, tech, body, [['virus.png', Buffer.from('<?php echo 1; ?>'), 'image/png']]);
      assert.equal(fake.status, 400);
      assert.equal((await patch(wo, tech, body, photos(6))).status, 400);

      assert.deepEqual(cloud.folders, []);
      const saved = await reload(wo);
      assert.equal(saved.status, 'IN_PROGRESS');
      assert.deepEqual(saved.completionImages, []);
    });

    it('Manager xem được ảnh + ghi chú báo cáo (chi tiết, danh sách, lịch sử tài sản); KTV khác không xem được', async () => {
      const { manager, tech, asset, wo } = await setup({ status: 'IN_PROGRESS', startedAt: new Date() });
      await patch(wo, tech, { status: 'DONE', note: 'Đã thay dây curoa' }, photos(2));

      const detail = await api('GET', `/work-orders/${wo._id}`, manager);
      assert.equal(detail.status, 200);
      assertMatch(detail.body.data, { note: 'Đã thay dây curoa', status: 'DONE' });
      assert.equal(detail.body.data.completionImages.length, 2);

      const list = await api('GET', '/work-orders?status=DONE', manager);
      assert.equal(list.body.data[0].completionImages.length, 2);

      const history = await api('GET', `/assets/${asset._id}/history`, manager);
      assertMatch(history.body.data[0], { note: 'Đã thay dây curoa' });
      assert.equal(history.body.data[0].completionImages.length, 2);

      const other = await createTechnician();
      assert.equal((await api('GET', `/work-orders/${wo._id}`, other)).status, 403);
    });

    it('Manager / Lễ tân gọi /status → 403; không token → 401; work order không đổi', async () => {
      const { manager, wo } = await setup();
      const recep = await createReceptionist();
      assert.equal((await patch(wo, manager, { status: 'IN_PROGRESS' })).status, 403);
      assert.equal((await patch(wo, recep, { status: 'IN_PROGRESS' })).status, 403);
      assert.equal((await patch(wo, null, { status: 'IN_PROGRESS' })).status, 401);
      assert.equal((await reload(wo)).status, 'PENDING');
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

      const open = await api('GET', '/work-orders?status=PENDING,IN_PROGRESS&sort=scheduledDate', tech);
      assert.equal(open.status, 200);
      assert.deepEqual(open.body.data.map((i) => i._id), [String(wo._id), String(later._id)]);

      const finished = await api('GET', '/work-orders?status=DONE&sort=-completedAt', tech);
      assert.deepEqual(finished.body.data.map((i) => i._id), [String(done._id)]);
    });
  });
});
