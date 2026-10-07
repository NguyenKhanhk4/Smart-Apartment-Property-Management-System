// Module D — UC-D03: Danh sách work order, phân công / giao lại kỹ thuật viên
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createBuilding,
  createManager,
  createReceptionist,
  createResident,
  createTechnician,
  tokenFor,
} from './helpers/fixtures.js';

const { createApp } = await import('../src/app.js');
const service = await import('../src/modules/workOrders/workOrders.service.js');
const { Asset, AuditLog, Notification, User, WorkOrder } = await import('../src/models/index.js');
const { DAY_MS, startOfVnDay } = await import('../src/utils/time.js');

let seq = 0;
const makeAsset = (building, extra = {}) => {
  seq += 1;
  return Asset.create({
    buildingId: building._id,
    name: `Tài sản ${seq}`,
    category: 'PUMP',
    maintenanceCycleDays: 30,
    nextMaintenanceDate: startOfVnDay(),
    ...extra,
  });
};
const makeWo = (asset, extra = {}) =>
  WorkOrder.create({
    assetId: asset._id,
    type: 'SCHEDULED',
    status: 'PENDING',
    title: `Bảo trì định kỳ ${asset.name}`,
    scheduledDate: startOfVnDay(),
    ...extra,
  });
const noteCount = (userId) => Notification.countDocuments({ userId, type: 'MAINTENANCE' });

describe('workOrders UC-D03 — phân công / danh sách', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  // Manager + tòa + tài sản + work order PENDING chưa phân công
  const setup = async () => {
    const manager = await createManager();
    const building = await createBuilding();
    const asset = await makeAsset(building);
    const wo = await makeWo(asset);
    return { manager, mUser: asUser(manager), building, asset, wo };
  };

  describe('assignWorkOrder', () => {
    it('phân công giữ nguyên PENDING, ghi assignedTo/assignedBy/assignedAt, báo KTV, audit WORKORDER_ASSIGNED', async () => {
      const { manager, mUser, wo } = await setup();
      const tech = await createTechnician();
      const before = Date.now();

      const { workOrder, changed } = await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id), note: 'Mang theo dầu bôi trơn' });
      expect(changed).toBe(true);
      expect(workOrder).toMatchObject({ status: 'PENDING', isOverdue: false });
      expect(workOrder.assignedTo.fullName).toBe(tech.fullName);
      expect(workOrder.assignedBy.fullName).toBe(manager.fullName);

      const saved = await WorkOrder.findById(wo._id).lean();
      expect(saved.status).toBe('PENDING');
      expect(String(saved.assignedTo)).toBe(String(tech._id));
      expect(String(saved.assignedBy)).toBe(String(manager._id));
      expect(saved.assignedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.startedAt).toBeNull();

      const [note] = await Notification.find({ userId: tech._id }).lean();
      expect(note).toMatchObject({ type: 'MAINTENANCE', title: 'Bạn được giao một work order bảo trì' });
      expect(note.content).toContain(wo.title);
      expect(note.content).toContain('Mang theo dầu bôi trơn');
      expect(String(note.refId)).toBe(String(wo._id));

      const audits = await AuditLog.find({ action: 'WORKORDER_ASSIGNED' }).lean();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ targetType: 'work_orders' });
      expect(String(audits[0].performedBy)).toBe(String(manager._id));
      expect(audits[0].metadata).toMatchObject({ from: null, to: String(tech._id), note: 'Mang theo dầu bôi trơn' });
    });

    it('giao lại: báo cả KTV mới lẫn KTV cũ, 2 audit (from/to), trạng thái IN_PROGRESS giữ nguyên (BR-O20)', async () => {
      const { mUser, wo } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t1._id) });
      await WorkOrder.updateOne({ _id: wo._id }, { status: 'IN_PROGRESS', startedAt: new Date() });

      const { changed } = await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t2._id), note: 'Đổi người' });
      expect(changed).toBe(true);

      const saved = await WorkOrder.findById(wo._id).lean();
      expect(saved.status).toBe('IN_PROGRESS');
      expect(String(saved.assignedTo)).toBe(String(t2._id));
      expect(saved.startedAt).toBeTruthy();

      expect(await noteCount(t2._id)).toBe(1);
      const oldNote = (await Notification.find({ userId: t1._id }).sort({ createdAt: 1 }).lean()).at(-1);
      expect(oldNote.title).toBe('Work order đã được giao lại');
      expect(oldNote.content).toContain(t2.fullName);
      expect(await noteCount(t1._id)).toBe(2); // lần giao đầu + báo bị giao lại

      const audits = await AuditLog.find({ action: 'WORKORDER_ASSIGNED' }).sort({ createdAt: 1 }).lean();
      expect(audits).toHaveLength(2);
      expect(audits[1].metadata).toMatchObject({ from: String(t1._id), to: String(t2._id), note: 'Đổi người' });
    });

    it('chọn lại đúng người đang được giao → không đổi gì, không thông báo, không audit', async () => {
      const { mUser, wo } = await setup();
      const tech = await createTechnician();
      await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id) });
      const first = await WorkOrder.findById(wo._id).lean();

      const { changed, workOrder } = await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id), note: 'Nhắc lại' });
      expect(changed).toBe(false);
      expect(String(workOrder.assignedTo._id)).toBe(String(tech._id));

      const after = await WorkOrder.findById(wo._id).lean();
      expect(after.assignedAt.getTime()).toBe(first.assignedAt.getTime());
      expect(await noteCount(tech._id)).toBe(1);
      expect(await AuditLog.countDocuments({ action: 'WORKORDER_ASSIGNED' })).toBe(1);
    });

    it('người nhận là Lễ tân / Manager / Cư dân / KTV đã nghỉ / id không tồn tại → WORKORDER_INVALID_ASSIGNEE, work order không đổi', async () => {
      const { manager, mUser, wo } = await setup();
      const bad = [
        await createReceptionist(),
        manager,
        await createResident(),
        await createTechnician({ isActive: false }),
        { _id: '0123456789abcdef01234567' },
      ];
      for (const u of bad) {
        await expect(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(u._id) })).rejects.toMatchObject({
          errorCode: 'WORKORDER_INVALID_ASSIGNEE',
          status: 400,
        });
      }
      const saved = await WorkOrder.findById(wo._id).lean();
      expect(saved.assignedTo).toBeNull();
      expect(await Notification.countDocuments()).toBe(0);
      expect(await AuditLog.countDocuments()).toBe(0);
    });

    it('work order DONE → WORKORDER_INVALID_STATUS (409); không tồn tại → NOT_FOUND', async () => {
      const { mUser, asset } = await setup();
      const tech = await createTechnician();
      const done = await makeWo(asset, { status: 'DONE', completedAt: new Date() });
      await expect(service.assignWorkOrder(mUser, done._id, { assignedTo: String(tech._id) })).rejects.toMatchObject({
        errorCode: 'WORKORDER_INVALID_STATUS',
        status: 409,
      });
      await expect(service.assignWorkOrder(mUser, '0123456789abcdef01234567', { assignedTo: String(tech._id) })).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
    });

    it('cập nhật có điều kiện: người được giao bị đổi giữa lúc đọc và ghi → CONCURRENT_UPDATE, không ghi đè, không thông báo', async () => {
      const { mUser, wo } = await setup();
      const [t1, t2, t3] = [await createTechnician(), await createTechnician(), await createTechnician()];
      // Manager khác vừa giao cho t3 sau khi request này đã đọc work order (còn chưa phân công)
      const realFindOne = User.findOne.bind(User);
      vi.spyOn(User, 'findOne').mockImplementationOnce((...args) => ({
        select: () => ({
          lean: async () => {
            await WorkOrder.updateOne({ _id: wo._id }, { assignedTo: t3._id });
            return realFindOne(...args).select('fullName').lean();
          },
        }),
      }));

      await expect(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t1._id) })).rejects.toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
      });
      expect(String((await WorkOrder.findById(wo._id).lean()).assignedTo)).toBe(String(t3._id));
      expect(await Notification.countDocuments()).toBe(0);
      expect(await AuditLog.countDocuments()).toBe(0);
      expect(t2).toBeTruthy();
    });

    it('cập nhật có điều kiện: work order vừa DONE giữa lúc đọc và ghi → CONCURRENT_UPDATE', async () => {
      const { mUser, wo } = await setup();
      const tech = await createTechnician();
      const realFindOne = User.findOne.bind(User);
      vi.spyOn(User, 'findOne').mockImplementationOnce((...args) => ({
        select: () => ({
          lean: async () => {
            await WorkOrder.updateOne({ _id: wo._id }, { status: 'DONE', completedAt: new Date() });
            return realFindOne(...args).select('fullName').lean();
          },
        }),
      }));
      await expect(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id) })).rejects.toMatchObject({
        errorCode: 'CONCURRENT_UPDATE',
      });
      expect((await WorkOrder.findById(wo._id).lean()).assignedTo).toBeNull();
    });
  });

  describe('listWorkOrders / getWorkOrder / listAssignees', () => {
    it('lọc: chưa phân công, theo KTV, trạng thái, tòa, tên tài sản; trả tài sản + tòa + KTV; phân trang', async () => {
      const { mUser, building, asset, wo } = await setup();
      const b2 = await createBuilding();
      const tech = await createTechnician();
      const a2 = await makeAsset(b2, { name: 'Thang máy tòa B' });
      const wo2 = await makeWo(a2, { assignedTo: tech._id, status: 'IN_PROGRESS' });
      const a3 = await makeAsset(building);
      await makeWo(a3, { status: 'DONE', completedAt: new Date(), assignedTo: tech._id });
      const q = (extra) => service.listWorkOrders(mUser, { page: 1, limit: 20, ...extra });

      expect((await q({})).pagination.total).toBe(3);
      expect((await q({ unassigned: true })).items.map((i) => String(i._id))).toEqual([String(wo._id)]);
      expect((await q({ assignedTo: String(tech._id) })).pagination.total).toBe(2);
      expect((await q({ status: ['IN_PROGRESS', 'DONE'] })).pagination.total).toBe(2);
      expect((await q({ status: ['PENDING'] })).items[0].assetId.name).toBe(asset.name);

      const byBuilding = await q({ buildingId: String(b2._id) });
      expect(byBuilding.items.map((i) => String(i._id))).toEqual([String(wo2._id)]);
      expect(byBuilding.items[0].assetId.buildingId.name).toBe(b2.name);
      expect(byBuilding.items[0].assignedTo.fullName).toBe(tech.fullName);

      expect((await q({ q: 'thang máy' })).items.map((i) => String(i._id))).toEqual([String(wo2._id)]);
      expect((await q({ q: 'không có' })).pagination.total).toBe(0);

      const page = await q({ limit: 2, page: 2 });
      expect(page.items).toHaveLength(1);
      expect(page.pagination).toMatchObject({ page: 2, limit: 2, total: 3 });
    });

    it('quá hạn = chưa DONE và scheduledDate + 1 ngày < hiện tại; có cờ isOverdue mỗi dòng và bộ lọc overdue', async () => {
      const { mUser, building, wo } = await setup(); // wo: ngày lên lịch hôm nay → chưa quá hạn
      const now = Date.now();
      const old = await makeWo(await makeAsset(building), { scheduledDate: new Date(now - 2 * DAY_MS) });
      const oldRunning = await makeWo(await makeAsset(building), { scheduledDate: new Date(now - 3 * DAY_MS), status: 'IN_PROGRESS' });
      const edge = await makeWo(await makeAsset(building), { scheduledDate: new Date(now - DAY_MS + 3600e3) }); // còn 1 giờ nữa mới quá
      const oldDone = await makeWo(await makeAsset(building), { scheduledDate: new Date(now - 5 * DAY_MS), status: 'DONE', completedAt: new Date() });

      const all = await service.listWorkOrders(mUser, { page: 1, limit: 50 });
      const flag = Object.fromEntries(all.items.map((i) => [String(i._id), i.isOverdue]));
      expect(flag).toEqual({
        [wo._id]: false,
        [old._id]: true,
        [oldRunning._id]: true,
        [edge._id]: false,
        [oldDone._id]: false,
      });

      const overdue = await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true });
      expect(overdue.items.map((i) => String(i._id)).sort()).toEqual([String(old._id), String(oldRunning._id)].sort());
      // Kết hợp bộ lọc: quá hạn + DONE → không có gì
      expect((await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true, status: ['DONE'] })).pagination.total).toBe(0);
      expect((await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true, status: ['IN_PROGRESS'] })).items).toHaveLength(1);
    });

    it('KTV chỉ thấy work order của mình, kể cả khi cố lọc chưa phân công / KTV khác; xem việc người khác → 403', async () => {
      const { mUser, building, wo } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      const mine = await makeWo(await makeAsset(building), { assignedTo: t1._id });
      const theirs = await makeWo(await makeAsset(building), { assignedTo: t2._id });
      const tUser = asUser(t1);

      const list = await service.listWorkOrders(tUser, { page: 1, limit: 20 });
      expect(list.items.map((i) => String(i._id))).toEqual([String(mine._id)]);
      // Bộ lọc chưa phân công / KTV khác không mở rộng phạm vi: luôn chỉ việc của chính mình
      const sneaky = await service.listWorkOrders(tUser, { page: 1, limit: 20, unassigned: true });
      expect(sneaky.items.map((i) => String(i._id))).toEqual([String(mine._id)]);
      expect((await service.listWorkOrders(tUser, { page: 1, limit: 20, assignedTo: String(t2._id) })).items.map((i) => String(i._id))).toEqual([String(mine._id)]);

      expect((await service.getWorkOrder(tUser, mine._id)).title).toBe(mine.title);
      await expect(service.getWorkOrder(tUser, theirs._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
      await expect(service.getWorkOrder(tUser, wo._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });

      // Manager thấy tất cả
      expect((await service.getWorkOrder(mUser, theirs._id)).assignedTo.fullName).toBe(t2.fullName);
      expect((await service.listWorkOrders(mUser, { page: 1, limit: 20 })).pagination.total).toBe(3);
      await expect(service.getWorkOrder(mUser, '0123456789abcdef01234567')).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    });

    it('listAssignees: chỉ KTV đang hoạt động, đếm đúng số work order đang mở (PENDING + IN_PROGRESS, không tính DONE)', async () => {
      const { building } = await setup();
      const busy = await createTechnician({ fullName: 'An' });
      const free = await createTechnician({ fullName: 'Bình' });
      await createTechnician({ fullName: 'Nghỉ', isActive: false });
      await createReceptionist();
      await makeWo(await makeAsset(building), { assignedTo: busy._id, status: 'PENDING' });
      await makeWo(await makeAsset(building), { assignedTo: busy._id, status: 'IN_PROGRESS' });
      await makeWo(await makeAsset(building), { assignedTo: busy._id, status: 'DONE', completedAt: new Date() });

      const list = await service.listAssignees();
      expect(list.map((t) => [t.fullName, t.openWorkOrders])).toEqual([
        ['An', 2],
        ['Bình', 0],
      ]);
      expect(String(list[1]._id)).toBe(String(free._id));
    });

    it('model: assignedAt / startedAt mặc định null; có index { assetId, completedAt }', async () => {
      const { wo } = await setup();
      expect(wo.assignedAt).toBeNull();
      expect(wo.startedAt).toBeNull();
      const indexes = await WorkOrder.collection.indexes();
      expect(indexes.some((i) => i.key.assetId === 1 && i.key.completedAt === -1)).toBe(true);
    });
  });

  describe('routes — phân quyền & validate', () => {
    const app = createApp();
    const call = (method, path, user, body) => {
      const req = request(app)[method](`/api/work-orders${path}`);
      if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
      return body ? req.send(body) : req;
    };

    it('Manager: danh sách 200 có phân trang + isOverdue; /assignees không bị nuốt bởi /:id; chi tiết 200', async () => {
      const { manager, wo } = await setup();
      await createTechnician();

      const list = await call('get', '?unassigned=true&overdue=false', manager);
      expect(list.status).toBe(200);
      expect(list.body.pagination).toMatchObject({ page: 1, total: 1 });
      expect(list.body.data[0]).toMatchObject({ isOverdue: false });

      const assignees = await call('get', '/assignees', manager);
      expect(assignees.status).toBe(200);
      expect(Array.isArray(assignees.body.data)).toBe(true);
      expect(assignees.body.data[0]).toHaveProperty('openWorkOrders', 0);

      const detail = await call('get', `/${wo._id}`, manager);
      expect(detail.status).toBe(200);
      expect(detail.body.data.assetId.name).toBeTruthy();
    });

    it('Manager PATCH assign → 200 và work order giữ PENDING; chọn lại cùng người → 200 không đổi', async () => {
      const { manager, wo } = await setup();
      const tech = await createTechnician();
      const res = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(tech._id), note: '' });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Đã phân công kỹ thuật viên');
      expect(res.body.data).toMatchObject({ status: 'PENDING' });
      const again = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(tech._id) });
      expect(again.status).toBe(200);
      expect(again.body.message).toBe('Work order đã được giao cho người này');
      expect(await AuditLog.countDocuments({ action: 'WORKORDER_ASSIGNED' })).toBe(1);
    });

    it('mã lỗi qua HTTP: người nhận sai → 400 WORKORDER_INVALID_ASSIGNEE; work order DONE → 409 WORKORDER_INVALID_STATUS', async () => {
      const { manager, asset, wo } = await setup();
      const recep = await createReceptionist();
      const tech = await createTechnician();
      const bad = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(recep._id) });
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe('WORKORDER_INVALID_ASSIGNEE');

      const done = await makeWo(asset, { status: 'DONE', completedAt: new Date() });
      const res = await call('patch', `/${done._id}/assign`, manager, { assignedTo: String(tech._id) });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('WORKORDER_INVALID_STATUS');
    });

    it('Lễ tân / Cư dân → 403 mọi endpoint; KTV gọi assign / assignees → 403; không token → 401', async () => {
      const { wo } = await setup();
      const tech = await createTechnician();
      const recep = await createReceptionist();
      const resident = await createResident();
      const body = { assignedTo: String(tech._id) };

      for (const u of [recep, resident]) {
        expect((await call('get', '', u)).status).toBe(403);
        expect((await call('get', '/assignees', u)).status).toBe(403);
        expect((await call('get', `/${wo._id}`, u)).status).toBe(403);
        expect((await call('patch', `/${wo._id}/assign`, u, body)).status).toBe(403);
      }
      expect((await call('patch', `/${wo._id}/assign`, tech, body)).status).toBe(403);
      expect((await call('get', '/assignees', tech)).status).toBe(403);
      expect((await call('get', '')).status).toBe(401);
      expect((await call('get', '/assignees')).status).toBe(401);
      expect((await call('patch', `/${wo._id}/assign`, null, body)).status).toBe(401);
      expect((await WorkOrder.findById(wo._id).lean()).assignedTo).toBeNull();
    });

    it('KTV: danh sách chỉ việc của mình (200); xem chi tiết việc người khác → 403, việc của mình → 200', async () => {
      const { building } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      const mine = await makeWo(await makeAsset(building), { assignedTo: t1._id });
      const theirs = await makeWo(await makeAsset(building), { assignedTo: t2._id });

      const list = await call('get', '', t1);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i._id)).toEqual([String(mine._id)]);
      expect((await call('get', `/${mine._id}`, t1)).status).toBe(200);
      expect((await call('get', `/${theirs._id}`, t1)).status).toBe(403);
    });

    it('validate: assignedTo sai định dạng / thiếu, note quá dài, id sai, bộ lọc sai → 400', async () => {
      const { manager, wo } = await setup();
      const tech = await createTechnician();
      const assign = (body, id = wo._id) => call('patch', `/${id}/assign`, manager, body);

      expect((await assign({ assignedTo: 'abc' })).status).toBe(400);
      expect((await assign({})).status).toBe(400);
      expect((await assign({ assignedTo: String(tech._id), note: 'x'.repeat(501) })).status).toBe(400);
      expect((await assign({ assignedTo: String(tech._id) }, 'khong-phai-id')).status).toBe(400);
      expect((await call('get', '?status=SAI', manager)).status).toBe(400);
      expect((await call('get', '?assignedTo=abc', manager)).status).toBe(400);
      expect((await call('get', '?sort=password', manager)).status).toBe(400);
      expect((await call('get', '/khong-phai-id', manager)).status).toBe(400);
      expect((await call('get', '/0123456789abcdef01234567', manager)).status).toBe(404);
      expect((await call('patch', '/0123456789abcdef01234567/assign', manager, { assignedTo: String(tech._id) })).status).toBe(404);
    });
  });
});
