// Người 1 (Mô đun 10) — UC-D01: Quản lý tài sản chung & chu kỳ bảo trì
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, WorkOrder } from '../../src/models/index.js';
import * as assets from '../../src/modules/assets/assets.service.js';
import { startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { assertMatch, startApi } from '../helpers/equipment.js';
import { asUser, createBuilding, createManager, createReceptionist, createTechnician } from '../helpers/fixtures.js';

let server;
let api;

const DAY = 24 * 60 * 60 * 1000;
const body = (b, name, extra = {}) => ({
  buildingId: String(b._id),
  name,
  category: 'ELEVATOR',
  maintenanceCycleDays: 30,
  ...extra,
});

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api } = server);
});
after(async () => {
  await server.close();
  await closeTestDB();
});

describe('assets (UC-D01)', () => {
  afterEach(clearTestDB);

  it('tạo tài sản: next = last + chu kỳ; chưa có last → hôm nay + chu kỳ (BR-O18)', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    const last = new Date(Date.now() - 10 * DAY);
    const a1 = await assets.createAsset(manager, body(b, 'Thang máy 1', { lastMaintenanceDate: last }));
    assert.equal(a1.nextMaintenanceDate.getTime(), startOfVnDay(last).getTime() + 30 * DAY);
    assert.equal(a1.isActive, true);
    assert.equal(String(a1.createdBy), manager.id);

    const a2 = await assets.createAsset(manager, body(b, 'Máy bơm', { category: 'PUMP', maintenanceCycleDays: 90 }));
    assert.equal(a2.lastMaintenanceDate, null);
    assert.equal(a2.nextMaintenanceDate.getTime(), startOfVnDay().getTime() + 90 * DAY);
  });

  it('trùng tên trong cùng tòa (không phân biệt hoa thường) → ASSET_NAME_EXISTS; khác tòa thì được (BR-O17)', async () => {
    const manager = asUser(await createManager());
    const [b1, b2] = [await createBuilding(), await createBuilding()];
    await assets.createAsset(manager, body(b1, 'Thang máy A'));
    await assert.rejects(assets.createAsset(manager, body(b1, 'thang MÁY a')), { errorCode: 'ASSET_NAME_EXISTS' });
    assert.ok(await assets.createAsset(manager, body(b2, 'Thang máy A')));
  });

  it('ngày bảo trì gần nhất ở tương lai / tòa không tồn tại → VALIDATION_ERROR', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await assert.rejects(assets.createAsset(manager, body(b, 'X', { lastMaintenanceDate: new Date(Date.now() + 3 * DAY) })), { errorCode: 'VALIDATION_ERROR' });
    await assert.rejects(assets.createAsset(manager, { ...body(b, 'Y'), buildingId: '0123456789abcdef01234567' }), { errorCode: 'VALIDATION_ERROR' });
  });

  it('sửa chu kỳ → tính lại next; ngừng theo dõi bị chặn khi còn work order mở (BR-O19)', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    const last = new Date(Date.now() - 5 * DAY);
    const asset = await assets.createAsset(manager, body(b, 'Thang máy B', { lastMaintenanceDate: last }));
    const updated = await assets.updateAsset(asset._id, { maintenanceCycleDays: 10 });
    assert.equal(updated.nextMaintenanceDate.getTime(), startOfVnDay(last).getTime() + 10 * DAY);

    await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'IN_PROGRESS', scheduledDate: new Date() });
    await assert.rejects(assets.setAssetStatus(asset._id, false), { errorCode: 'ASSET_HAS_OPEN_WORKORDER' });
    await WorkOrder.updateMany({}, { status: 'DONE', completedAt: new Date() });
    assert.equal((await assets.setAssetStatus(asset._id, false)).isActive, false);
    assert.equal((await assets.setAssetStatus(asset._id, true)).isActive, true);
  });

  it('danh sách: lọc theo loại, đang theo dõi, đến hạn trong N ngày', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await assets.createAsset(manager, body(b, 'Sắp đến hạn', { lastMaintenanceDate: new Date(Date.now() - 28 * DAY) }));
    await assets.createAsset(manager, body(b, 'Còn lâu', { category: 'PUMP' }));
    const due = await assets.listAssets({ page: 1, limit: 20, dueWithinDays: 7 });
    assert.deepEqual(due.items.map((a) => a.name), ['Sắp đến hạn']);
    const pumps = await assets.listAssets({ page: 1, limit: 20, category: ['PUMP'] });
    assert.equal(pumps.pagination.total, 1);
    assert.equal(pumps.items[0].openWorkOrder, null);
  });

  it('sửa: chỉ tính lại next khi chu kỳ/ngày gần nhất thực sự đổi; sửa tên không dời lịch', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    const last = new Date(Date.now() - 40 * DAY);
    const asset = await assets.createAsset(manager, body(b, 'Đang quá hạn', { lastMaintenanceDate: last }));
    const due = asset.nextMaintenanceDate.getTime();

    // UI luôn gửi lại cả chu kỳ + ngày gần nhất cũ khi sửa tên
    const renamed = await assets.updateAsset(asset._id, {
      name: 'Đang quá hạn (đổi tên)',
      maintenanceCycleDays: 30,
      lastMaintenanceDate: last,
    });
    assert.equal(renamed.nextMaintenanceDate.getTime(), due);

    // Xóa ngày gần nhất → mốc là ngày tạo + chu kỳ
    const cleared = await assets.updateAsset(asset._id, { lastMaintenanceDate: null });
    assert.equal(cleared.lastMaintenanceDate, null);
    assert.equal(cleared.nextMaintenanceDate.getTime(), startOfVnDay(asset.createdAt).getTime() + 30 * DAY);

    await assert.rejects(assets.updateAsset(asset._id, { lastMaintenanceDate: new Date(Date.now() + 2 * DAY) }), { errorCode: 'VALIDATION_ERROR' });
  });

  it('sửa trùng tên tài sản khác cùng tòa → ASSET_NAME_EXISTS; id không tồn tại → NOT_FOUND', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await assets.createAsset(manager, body(b, 'Máy bơm 1', { category: 'PUMP' }));
    const other = await assets.createAsset(manager, body(b, 'Máy bơm 2', { category: 'PUMP' }));
    await assert.rejects(assets.updateAsset(other._id, { name: 'MÁY BƠM 1' }), { errorCode: 'ASSET_NAME_EXISTS' });
    await assert.rejects(assets.updateAsset('0123456789abcdef01234567', { name: 'X' }), { errorCode: 'NOT_FOUND' });
    await assert.rejects(assets.setAssetStatus('0123456789abcdef01234567', false), { errorCode: 'NOT_FOUND' });
  });

  it('danh sách: lọc tòa / trạng thái / tên, trả work order đang mở và cờ isDue', async () => {
    const manager = asUser(await createManager());
    const [b1, b2] = [await createBuilding(), await createBuilding()];
    const overdue = await assets.createAsset(manager, body(b1, 'Thang máy cũ', { lastMaintenanceDate: new Date(Date.now() - 31 * DAY) }));
    await assets.createAsset(manager, body(b2, 'Máy phát điện', { category: 'OTHER' }));
    const stopped = await assets.createAsset(manager, body(b2, 'Bơm ngừng', { category: 'PUMP' }));
    await assets.setAssetStatus(stopped._id, false);
    await WorkOrder.create({ assetId: overdue._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date() });

    const q = (extra) => assets.listAssets({ page: 1, limit: 20, ...extra });
    assert.equal((await q({ buildingId: String(b2._id) })).pagination.total, 2);
    assert.deepEqual((await q({ isActive: false })).items.map((a) => a.name), ['Bơm ngừng']);
    assert.deepEqual((await q({ q: 'phát' })).items.map((a) => a.name), ['Máy phát điện']);
    // dueWithinDays + isActive=false không bị ghi đè thành true
    assert.deepEqual((await q({ isActive: false, dueWithinDays: 365 })).items.map((a) => a.name), ['Bơm ngừng']);

    const [row] = (await q({ buildingId: String(b1._id) })).items;
    assert.equal(row.isDue, true);
    assertMatch(row.openWorkOrder, { status: 'PENDING' });
  });

  it('chi tiết: kèm work order đang mở, số lần đã bảo trì, cờ isDue; id lạ → NOT_FOUND', async () => {
    const manager = asUser(await createManager());
    const tech = await createTechnician();
    const b = await createBuilding();
    const asset = await assets.createAsset(manager, body(b, 'Thang máy D', { lastMaintenanceDate: new Date(Date.now() - 31 * DAY) }));
    await WorkOrder.create([
      { assetId: asset._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: new Date(Date.now() - 61 * DAY), completedAt: new Date(Date.now() - 60 * DAY) },
      { assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date(), assignedTo: tech._id },
    ]);
    const detail = await assets.getAsset(asset._id);
    assertMatch(detail, { name: 'Thang máy D', doneCount: 1, isDue: true });
    assert.equal(detail.buildingId.name, b.name);
    assertMatch(detail.openWorkOrder, { status: 'PENDING' });
    assert.equal(detail.openWorkOrder.assignedTo.fullName, tech.fullName);
    await assert.rejects(assets.getAsset('0123456789abcdef01234567'), { errorCode: 'NOT_FOUND' });
  });

  it('lịch sử bảo trì: chỉ work order DONE, mới nhất trước, cờ đúng hạn/trễ hạn', async () => {
    const manager = asUser(await createManager());
    const asset = await assets.createAsset(manager, body(await createBuilding(), 'Máy bơm E', { category: 'PUMP' }));
    const sched = new Date(Date.now() - 40 * DAY);
    await WorkOrder.create([
      { assetId: asset._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: sched, completedAt: new Date(sched.getTime() + 3600e3), note: 'Đúng hạn' },
      { assetId: asset._id, type: 'SCHEDULED', status: 'DONE', scheduledDate: sched, completedAt: new Date(sched.getTime() + 3 * DAY), note: 'Trễ hạn' },
      { assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', scheduledDate: new Date() },
    ]);
    const { items, pagination } = await assets.getAssetHistory(asset._id, { page: 1, limit: 20 });
    assert.equal(pagination.total, 2);
    assert.deepEqual(items.map((i) => [i.note, i.onTime]), [['Trễ hạn', false], ['Đúng hạn', true]]);
    await assert.rejects(assets.getAssetHistory('0123456789abcdef01234567', { page: 1, limit: 20 }), { errorCode: 'NOT_FOUND' });
  });

  describe('routes — phân quyền & validate', () => {

    it('Manager thêm qua API → 201; KTV chỉ xem (GET 200, POST 403); thiếu chu kỳ → 400', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const b = await createBuilding();
      const created = await api('POST', '/assets', manager, body(b, 'Hệ thống PCCC', { category: 'FIRE_SYSTEM', maintenanceCycleDays: 180 }));
      assert.equal(created.status, 201);
      assert.equal(await Asset.countDocuments(), 1);

      const list = await api('GET', '/assets', tech);
      assert.equal(list.status, 200);
      assert.equal(list.body.pagination.total, 1);

      const forbidden = await api('POST', '/assets', tech, body(b, 'Khác'));
      assert.equal(forbidden.status, 403);

      const invalid = await api('POST', '/assets', manager, { buildingId: String(b._id), name: 'Thiếu chu kỳ', category: 'OTHER' });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.errorCode, 'VALIDATION_ERROR');
    });

    it('PUT/PATCH: KTV 403, không token 401, body rỗng / chu kỳ ≤ 0 / loại sai / sort lạ → 400, id lạ → 404', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const b = await createBuilding();
      const asset = await assets.createAsset(asUser(manager), body(b, 'Thang máy C'));
      assert.equal((await api('GET', '/assets')).status, 401);
      assert.equal((await api('PUT', `/assets/${asset._id}`, tech, { name: 'X' })).status, 403);
      assert.equal((await api('PATCH', `/assets/${asset._id}/status`, tech, { isActive: false })).status, 403);

      const put = (payload) => api('PUT', `/assets/${asset._id}`, manager, payload);
      assert.equal((await put({})).status, 400);
      assert.equal((await put({ maintenanceCycleDays: 0 })).status, 400);
      assert.equal((await put({ category: 'ROBOT' })).status, 400);
      assert.equal((await api('GET', '/assets?sort=-passwordHash', manager)).status, 400);

      const okRes = await put({ maintenanceCycleDays: 45, note: 'Kiểm định 2026' });
      assert.equal(okRes.status, 200);
      assert.equal(okRes.body.data.maintenanceCycleDays, 45);

      const stop = await api('PATCH', `/assets/${asset._id}/status`, manager, { isActive: false });
      assert.equal(stop.status, 200);
      assert.equal(stop.body.data.isActive, false);

      const missing = await api('PUT', '/assets/0123456789abcdef01234567', manager, { name: 'Không tồn tại' });
      assert.equal(missing.status, 404);
    });

    it('GET chi tiết / lịch sử: Manager và KTV xem được; Lễ tân 403; id sai định dạng 400', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const rec = await createReceptionist();
      const asset = await assets.createAsset(asUser(manager), body(await createBuilding(), 'Thang máy F'));
      const d = await api('GET', `/assets/${asset._id}`, tech);
      assert.equal(d.status, 200);
      assertMatch(d.body.data, { name: 'Thang máy F', doneCount: 0, openWorkOrder: null });
      const h = await api('GET', `/assets/${asset._id}/history`, manager);
      assert.equal(h.status, 200);
      assert.equal(h.body.pagination.total, 0);
      assert.equal((await api('GET', `/assets/${asset._id}`, rec)).status, 403);
      assert.equal((await api('GET', '/assets/abc', manager)).status, 400);
    });
  });
});
