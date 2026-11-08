// Người 1 (Mô đun 10) — UC-D03: Danh sách work order, phân công / giao lại kỹ thuật viên
import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, AuditLog, Notification, User, WorkOrder } from '../../src/models/index.js';
import * as service from '../../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { assertMatch, startApi } from '../helpers/equipment.js';
import {
  asUser,
  createBuilding,
  createManager,
  createReceptionist,
  createResidentUser,
  createTechnician,
} from '../helpers/fixtures.js';

let server;
let api;

let seq = 0;
const makeAsset = (building, extra = {}) => {
  seq += 1;
  return Asset.create({
    buildingId: building._id,
    name: `Tài sản ${seq}`,
    category: 'PUMP',
    code: `TB-${seq}`,
    cycleValue: 30,
    cycleUnit: 'DAY',
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

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('workOrders UC-D03 — phân công / danh sách', () => {
  afterEach(async () => {
    mock.restoreAll();
    await clearTestDB();
  });

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
      assert.equal(changed, true);
      assertMatch(workOrder, { status: 'PENDING', isOverdue: false });
      assert.equal(workOrder.assignedTo.fullName, tech.fullName);
      assert.equal(workOrder.assignedBy.fullName, manager.fullName);

      const saved = await WorkOrder.findById(wo._id).lean();
      assert.equal(saved.status, 'PENDING');
      assert.equal(String(saved.assignedTo), String(tech._id));
      assert.equal(String(saved.assignedBy), String(manager._id));
      assert.ok(saved.assignedAt.getTime() >= before);
      assert.equal(saved.startedAt, null);

      const [note] = await Notification.find({ userId: tech._id }).lean();
      assertMatch(note, { type: 'MAINTENANCE', title: 'Bạn được giao một work order bảo trì' });
      assert.ok((note.content).includes(wo.title));
      assert.ok((note.content).includes('Mang theo dầu bôi trơn'));
      assert.equal(String(note.refId), String(wo._id));

      const audits = await AuditLog.find({ action: 'WORKORDER_ASSIGNED' }).lean();
      assert.equal(audits.length, 1);
      assertMatch(audits[0], { targetType: 'work_orders' });
      assert.equal(String(audits[0].performedBy), String(manager._id));
      assertMatch(audits[0].metadata, { from: null, to: String(tech._id), note: 'Mang theo dầu bôi trơn' });
    });

    it('giao lại: báo cả KTV mới lẫn KTV cũ, 2 audit (from/to), trạng thái IN_PROGRESS giữ nguyên (BR-O20)', async () => {
      const { mUser, wo } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t1._id) });
      await WorkOrder.updateOne({ _id: wo._id }, { status: 'IN_PROGRESS', startedAt: new Date() });

      const { changed } = await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t2._id), note: 'Đổi người' });
      assert.equal(changed, true);

      const saved = await WorkOrder.findById(wo._id).lean();
      assert.equal(saved.status, 'IN_PROGRESS');
      assert.equal(String(saved.assignedTo), String(t2._id));
      assert.ok(saved.startedAt);

      assert.equal(await noteCount(t2._id), 1);
      const oldNote = (await Notification.find({ userId: t1._id }).sort({ createdAt: 1 }).lean()).at(-1);
      assert.equal(oldNote.title, 'Work order đã được giao lại');
      assert.ok((oldNote.content).includes(t2.fullName));
      assert.equal(await noteCount(t1._id), 2); // lần giao đầu + báo bị giao lại

      const audits = await AuditLog.find({ action: 'WORKORDER_ASSIGNED' }).sort({ createdAt: 1 }).lean();
      assert.equal(audits.length, 2);
      assertMatch(audits[1].metadata, { from: String(t1._id), to: String(t2._id), note: 'Đổi người' });
    });

    it('chọn lại đúng người đang được giao → không đổi gì, không thông báo, không audit', async () => {
      const { mUser, wo } = await setup();
      const tech = await createTechnician();
      await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id) });
      const first = await WorkOrder.findById(wo._id).lean();

      const { changed, workOrder } = await service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id), note: 'Nhắc lại' });
      assert.equal(changed, false);
      assert.equal(String(workOrder.assignedTo._id), String(tech._id));

      const after = await WorkOrder.findById(wo._id).lean();
      assert.equal(after.assignedAt.getTime(), first.assignedAt.getTime());
      assert.equal(await noteCount(tech._id), 1);
      assert.equal(await AuditLog.countDocuments({ action: 'WORKORDER_ASSIGNED' }), 1);
    });

    it('người nhận là Lễ tân / Manager / Cư dân / KTV đã nghỉ / id không tồn tại → WORKORDER_INVALID_ASSIGNEE, work order không đổi', async () => {
      const { manager, mUser, wo } = await setup();
      const bad = [
        await createReceptionist(),
        manager,
        await createResidentUser(),
        await createTechnician({ isActive: false }),
        { _id: '0123456789abcdef01234567' },
      ];
      for (const u of bad) {
        await assert.rejects(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(u._id) }), {
          errorCode: 'WORKORDER_INVALID_ASSIGNEE',
          status: 400,
        });
      }
      const saved = await WorkOrder.findById(wo._id).lean();
      assert.equal(saved.assignedTo, null);
      assert.equal(await Notification.countDocuments(), 0);
      assert.equal(await AuditLog.countDocuments(), 0);
    });

    it('work order DONE → WORKORDER_INVALID_STATUS (409); không tồn tại → NOT_FOUND', async () => {
      const { mUser, asset } = await setup();
      const tech = await createTechnician();
      const done = await makeWo(asset, { status: 'DONE', completedAt: new Date() });
      await assert.rejects(service.assignWorkOrder(mUser, done._id, { assignedTo: String(tech._id) }), {
        errorCode: 'WORKORDER_INVALID_STATUS',
        status: 409,
      });
      await assert.rejects(service.assignWorkOrder(mUser, '0123456789abcdef01234567', { assignedTo: String(tech._id) }), {
        errorCode: 'NOT_FOUND',
      });
    });

    it('cập nhật có điều kiện: người được giao bị đổi giữa lúc đọc và ghi → CONCURRENT_UPDATE, không ghi đè, không thông báo', async () => {
      const { mUser, wo } = await setup();
      const [t1, t2, t3] = [await createTechnician(), await createTechnician(), await createTechnician()];
      // Manager khác vừa giao cho t3 sau khi request này đã đọc work order (còn chưa phân công)
      const realFindOne = User.findOne.bind(User);
      mock.method(User, 'findOne', (...args) => ({
        select: () => ({
          lean: async () => {
            await WorkOrder.updateOne({ _id: wo._id }, { assignedTo: t3._id });
            return realFindOne(...args).select('fullName').lean();
          },
        }),
      }), { times: 1 });

      await assert.rejects(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(t1._id) }), {
        errorCode: 'CONCURRENT_UPDATE',
      });
      assert.equal(String((await WorkOrder.findById(wo._id).lean()).assignedTo), String(t3._id));
      assert.equal(await Notification.countDocuments(), 0);
      assert.equal(await AuditLog.countDocuments(), 0);
      assert.ok(t2);
    });

    it('cập nhật có điều kiện: work order vừa DONE giữa lúc đọc và ghi → CONCURRENT_UPDATE', async () => {
      const { mUser, wo } = await setup();
      const tech = await createTechnician();
      const realFindOne = User.findOne.bind(User);
      mock.method(User, 'findOne', (...args) => ({
        select: () => ({
          lean: async () => {
            await WorkOrder.updateOne({ _id: wo._id }, { status: 'DONE', completedAt: new Date() });
            return realFindOne(...args).select('fullName').lean();
          },
        }),
      }), { times: 1 });
      await assert.rejects(service.assignWorkOrder(mUser, wo._id, { assignedTo: String(tech._id) }), {
        errorCode: 'CONCURRENT_UPDATE',
      });
      assert.equal((await WorkOrder.findById(wo._id).lean()).assignedTo, null);
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

      assert.equal((await q({})).pagination.total, 3);
      assert.deepEqual((await q({ unassigned: true })).items.map((i) => String(i._id)), [String(wo._id)]);
      assert.equal((await q({ assignedTo: String(tech._id) })).pagination.total, 2);
      assert.equal((await q({ status: ['IN_PROGRESS', 'DONE'] })).pagination.total, 2);
      assert.equal((await q({ status: ['PENDING'] })).items[0].assetId.name, asset.name);

      const byBuilding = await q({ buildingId: String(b2._id) });
      assert.deepEqual(byBuilding.items.map((i) => String(i._id)), [String(wo2._id)]);
      assert.equal(byBuilding.items[0].assetId.buildingId.name, b2.name);
      assert.equal(byBuilding.items[0].assignedTo.fullName, tech.fullName);

      assert.deepEqual((await q({ q: 'thang máy' })).items.map((i) => String(i._id)), [String(wo2._id)]);
      assert.equal((await q({ q: 'không có' })).pagination.total, 0);

      const page = await q({ limit: 2, page: 2 });
      assert.equal(page.items.length, 1);
      assertMatch(page.pagination, { page: 2, limit: 2, total: 3 });
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
      assert.deepEqual(flag, {
        [wo._id]: false,
        [old._id]: true,
        [oldRunning._id]: true,
        [edge._id]: false,
        [oldDone._id]: false,
      });

      const overdue = await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true });
      assert.deepEqual(overdue.items.map((i) => String(i._id)).sort(), [String(old._id), String(oldRunning._id)].sort());
      // Kết hợp bộ lọc: quá hạn + DONE → không có gì
      assert.equal((await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true, status: ['DONE'] })).pagination.total, 0);
      assert.equal(((await service.listWorkOrders(mUser, { page: 1, limit: 50, overdue: true, status: ['IN_PROGRESS'] })).items).length, 1);
    });

    it('KTV chỉ thấy work order của mình, kể cả khi cố lọc chưa phân công / KTV khác; xem việc người khác → 403', async () => {
      const { mUser, building, wo } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      const mine = await makeWo(await makeAsset(building), { assignedTo: t1._id });
      const theirs = await makeWo(await makeAsset(building), { assignedTo: t2._id });
      const tUser = asUser(t1);

      const list = await service.listWorkOrders(tUser, { page: 1, limit: 20 });
      assert.deepEqual(list.items.map((i) => String(i._id)), [String(mine._id)]);
      // Bộ lọc chưa phân công / KTV khác không mở rộng phạm vi: luôn chỉ việc của chính mình
      const sneaky = await service.listWorkOrders(tUser, { page: 1, limit: 20, unassigned: true });
      assert.deepEqual(sneaky.items.map((i) => String(i._id)), [String(mine._id)]);
      assert.deepEqual((await service.listWorkOrders(tUser, { page: 1, limit: 20, assignedTo: String(t2._id) })).items.map((i) => String(i._id)), [String(mine._id)]);

      assert.equal((await service.getWorkOrder(tUser, mine._id)).title, mine.title);
      await assert.rejects(service.getWorkOrder(tUser, theirs._id), { errorCode: 'FORBIDDEN_ROLE' });
      await assert.rejects(service.getWorkOrder(tUser, wo._id), { errorCode: 'FORBIDDEN_ROLE' });

      // Manager thấy tất cả
      assert.equal((await service.getWorkOrder(mUser, theirs._id)).assignedTo.fullName, t2.fullName);
      assert.equal((await service.listWorkOrders(mUser, { page: 1, limit: 20 })).pagination.total, 3);
      await assert.rejects(service.getWorkOrder(mUser, '0123456789abcdef01234567'), { errorCode: 'NOT_FOUND' });
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
      assert.deepEqual(list.map((t) => [t.fullName, t.openWorkOrders]), [
        ['An', 2],
        ['Bình', 0],
      ]);
      assert.equal(String(list[1]._id), String(free._id));
    });

    it('model: assignedAt / startedAt mặc định null; có index { assetId, completedAt }', async () => {
      const { wo } = await setup();
      assert.equal(wo.assignedAt, null);
      assert.equal(wo.startedAt, null);
      const indexes = await WorkOrder.collection.indexes();
      assert.equal(indexes.some((i) => i.key.assetId === 1 && i.key.completedAt === -1), true);
    });
  });

  describe('routes — phân quyền & validate', () => {
    const call = (method, path, user, body) => api(method.toUpperCase(), `/work-orders${path}`, user, body);

    it('Manager: danh sách 200 có phân trang + isOverdue; /assignees không bị nuốt bởi /:id; chi tiết 200', async () => {
      const { manager, wo } = await setup();
      await createTechnician();

      const list = await call('get', '?unassigned=true&overdue=false', manager);
      assert.equal(list.status, 200);
      assertMatch(list.body.pagination, { page: 1, total: 1 });
      assertMatch(list.body.data[0], { isOverdue: false });

      const assignees = await call('get', '/assignees', manager);
      assert.equal(assignees.status, 200);
      assert.equal(Array.isArray(assignees.body.data), true);
      assert.equal((assignees.body.data[0])['openWorkOrders'], 0);

      const detail = await call('get', `/${wo._id}`, manager);
      assert.equal(detail.status, 200);
      assert.ok(detail.body.data.assetId.name);
    });

    it('Manager PATCH assign → 200 và work order giữ PENDING; chọn lại cùng người → 200 không đổi', async () => {
      const { manager, wo } = await setup();
      const tech = await createTechnician();
      const res = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(tech._id), note: '' });
      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Đã phân công kỹ thuật viên');
      assertMatch(res.body.data, { status: 'PENDING' });
      const again = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(tech._id) });
      assert.equal(again.status, 200);
      assert.equal(again.body.message, 'Work order đã được giao cho người này');
      assert.equal(await AuditLog.countDocuments({ action: 'WORKORDER_ASSIGNED' }), 1);
    });

    it('mã lỗi qua HTTP: người nhận sai → 400 WORKORDER_INVALID_ASSIGNEE; work order DONE → 409 WORKORDER_INVALID_STATUS', async () => {
      const { manager, asset, wo } = await setup();
      const recep = await createReceptionist();
      const tech = await createTechnician();
      const bad = await call('patch', `/${wo._id}/assign`, manager, { assignedTo: String(recep._id) });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.errorCode, 'WORKORDER_INVALID_ASSIGNEE');

      const done = await makeWo(asset, { status: 'DONE', completedAt: new Date() });
      const res = await call('patch', `/${done._id}/assign`, manager, { assignedTo: String(tech._id) });
      assert.equal(res.status, 409);
      assert.equal(res.body.errorCode, 'WORKORDER_INVALID_STATUS');
    });

    it('Lễ tân / Cư dân → 403 mọi endpoint; KTV gọi assign / assignees → 403; không token → 401', async () => {
      const { wo } = await setup();
      const tech = await createTechnician();
      const recep = await createReceptionist();
      const resident = await createResidentUser();
      const body = { assignedTo: String(tech._id) };

      for (const u of [recep, resident]) {
        assert.equal((await call('get', '', u)).status, 403);
        assert.equal((await call('get', '/assignees', u)).status, 403);
        assert.equal((await call('get', `/${wo._id}`, u)).status, 403);
        assert.equal((await call('patch', `/${wo._id}/assign`, u, body)).status, 403);
      }
      assert.equal((await call('patch', `/${wo._id}/assign`, tech, body)).status, 403);
      assert.equal((await call('get', '/assignees', tech)).status, 403);
      assert.equal((await call('get', '')).status, 401);
      assert.equal((await call('get', '/assignees')).status, 401);
      assert.equal((await call('patch', `/${wo._id}/assign`, null, body)).status, 401);
      assert.equal((await WorkOrder.findById(wo._id).lean()).assignedTo, null);
    });

    it('KTV: danh sách chỉ việc của mình (200); xem chi tiết việc người khác → 403, việc của mình → 200', async () => {
      const { building } = await setup();
      const [t1, t2] = [await createTechnician(), await createTechnician()];
      const mine = await makeWo(await makeAsset(building), { assignedTo: t1._id });
      const theirs = await makeWo(await makeAsset(building), { assignedTo: t2._id });

      const list = await call('get', '', t1);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.data.map((i) => i._id), [String(mine._id)]);
      assert.equal((await call('get', `/${mine._id}`, t1)).status, 200);
      assert.equal((await call('get', `/${theirs._id}`, t1)).status, 403);
    });

    it('validate: assignedTo sai định dạng / thiếu, note quá dài, id sai, bộ lọc sai → 400', async () => {
      const { manager, wo } = await setup();
      const tech = await createTechnician();
      const assign = (body, id = wo._id) => call('patch', `/${id}/assign`, manager, body);

      assert.equal((await assign({ assignedTo: 'abc' })).status, 400);
      assert.equal((await assign({})).status, 400);
      assert.equal((await assign({ assignedTo: String(tech._id), note: 'x'.repeat(501) })).status, 400);
      assert.equal((await assign({ assignedTo: String(tech._id) }, 'khong-phai-id')).status, 400);
      assert.equal((await call('get', '?status=SAI', manager)).status, 400);
      assert.equal((await call('get', '?assignedTo=abc', manager)).status, 400);
      assert.equal((await call('get', '?sort=password', manager)).status, 400);
      assert.equal((await call('get', '/khong-phai-id', manager)).status, 400);
      assert.equal((await call('get', '/0123456789abcdef01234567', manager)).status, 404);
      assert.equal((await call('patch', '/0123456789abcdef01234567/assign', manager, { assignedTo: String(tech._id) })).status, 404);
    });
  });
});
