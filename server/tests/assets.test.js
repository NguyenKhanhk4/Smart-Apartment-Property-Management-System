// Module D — UC-D01: Quản lý tài sản chung & chu kỳ bảo trì
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { asUser, createBuilding, createManager, createReceptionist, createTechnician, tokenFor } from './helpers/fixtures.js';

const { createApp } = await import('../src/app.js');
const assets = await import('../src/modules/assets/assets.service.js');
const { Asset, WorkOrder } = await import('../src/models/index.js');
const { startOfVnDay } = await import('../src/utils/time.js');

const DAY = 24 * 60 * 60 * 1000;
const body = (b, name, extra = {}) => ({
  buildingId: String(b._id),
  name,
  category: 'ELEVATOR',
  maintenanceCycleDays: 30,
  ...extra,
});

describe('assets (UC-D01)', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  it('tạo tài sản: next = last + chu kỳ; chưa có last → hôm nay + chu kỳ (BR-O18)', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    const last = new Date(Date.now() - 10 * DAY);
    const a1 = await assets.createAsset(manager, body(b, 'Thang máy 1', { lastMaintenanceDate: last }));
    expect(a1.nextMaintenanceDate.getTime()).toBe(startOfVnDay(last).getTime() + 30 * DAY);
    expect(a1.isActive).toBe(true);
    expect(String(a1.createdBy)).toBe(manager.id);

    const a2 = await assets.createAsset(manager, body(b, 'Máy bơm', { category: 'PUMP', maintenanceCycleDays: 90 }));
    expect(a2.lastMaintenanceDate).toBeNull();
    expect(a2.nextMaintenanceDate.getTime()).toBe(startOfVnDay().getTime() + 90 * DAY);
  });

  it('trùng tên trong cùng tòa (không phân biệt hoa thường) → ASSET_NAME_EXISTS; khác tòa thì được (BR-O17)', async () => {
    const manager = asUser(await createManager());
    const [b1, b2] = [await createBuilding(), await createBuilding()];
    await assets.createAsset(manager, body(b1, 'Thang máy A'));
    await expect(assets.createAsset(manager, body(b1, 'thang MÁY a'))).rejects.toMatchObject({ errorCode: 'ASSET_NAME_EXISTS' });
    await expect(assets.createAsset(manager, body(b2, 'Thang máy A'))).resolves.toBeTruthy();
  });

  it('ngày bảo trì gần nhất ở tương lai / tòa không tồn tại → VALIDATION_ERROR', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await expect(
      assets.createAsset(manager, body(b, 'X', { lastMaintenanceDate: new Date(Date.now() + 3 * DAY) })),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    await expect(
      assets.createAsset(manager, { ...body(b, 'Y'), buildingId: '0123456789abcdef01234567' }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
  });

  it('sửa chu kỳ → tính lại next; ngừng theo dõi bị chặn khi còn work order mở (BR-O19)', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    const last = new Date(Date.now() - 5 * DAY);
    const asset = await assets.createAsset(manager, body(b, 'Thang máy B', { lastMaintenanceDate: last }));
    const updated = await assets.updateAsset(asset._id, { maintenanceCycleDays: 10 });
    expect(updated.nextMaintenanceDate.getTime()).toBe(startOfVnDay(last).getTime() + 10 * DAY);

    await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'IN_PROGRESS', scheduledDate: new Date() });
    await expect(assets.setAssetStatus(asset._id, false)).rejects.toMatchObject({ errorCode: 'ASSET_HAS_OPEN_WORKORDER' });
    await WorkOrder.updateMany({}, { status: 'DONE', completedAt: new Date() });
    expect((await assets.setAssetStatus(asset._id, false)).isActive).toBe(false);
    expect((await assets.setAssetStatus(asset._id, true)).isActive).toBe(true);
  });

  it('danh sách: lọc theo loại, đang theo dõi, đến hạn trong N ngày', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await assets.createAsset(manager, body(b, 'Sắp đến hạn', { lastMaintenanceDate: new Date(Date.now() - 28 * DAY) }));
    await assets.createAsset(manager, body(b, 'Còn lâu', { category: 'PUMP' }));
    const due = await assets.listAssets({ page: 1, limit: 20, dueWithinDays: 7 });
    expect(due.items.map((a) => a.name)).toEqual(['Sắp đến hạn']);
    const pumps = await assets.listAssets({ page: 1, limit: 20, category: ['PUMP'] });
    expect(pumps.pagination.total).toBe(1);
    expect(pumps.items[0].openWorkOrder).toBeNull();
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
    expect(renamed.nextMaintenanceDate.getTime()).toBe(due);

    // Xóa ngày gần nhất → mốc là ngày tạo + chu kỳ
    const cleared = await assets.updateAsset(asset._id, { lastMaintenanceDate: null });
    expect(cleared.lastMaintenanceDate).toBeNull();
    expect(cleared.nextMaintenanceDate.getTime()).toBe(startOfVnDay(asset.createdAt).getTime() + 30 * DAY);

    await expect(
      assets.updateAsset(asset._id, { lastMaintenanceDate: new Date(Date.now() + 2 * DAY) }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
  });

  it('sửa trùng tên tài sản khác cùng tòa → ASSET_NAME_EXISTS; id không tồn tại → NOT_FOUND', async () => {
    const manager = asUser(await createManager());
    const b = await createBuilding();
    await assets.createAsset(manager, body(b, 'Máy bơm 1', { category: 'PUMP' }));
    const other = await assets.createAsset(manager, body(b, 'Máy bơm 2', { category: 'PUMP' }));
    await expect(assets.updateAsset(other._id, { name: 'MÁY BƠM 1' })).rejects.toMatchObject({ errorCode: 'ASSET_NAME_EXISTS' });
    await expect(assets.updateAsset('0123456789abcdef01234567', { name: 'X' })).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    await expect(assets.setAssetStatus('0123456789abcdef01234567', false)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
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
    expect((await q({ buildingId: String(b2._id) })).pagination.total).toBe(2);
    expect((await q({ isActive: false })).items.map((a) => a.name)).toEqual(['Bơm ngừng']);
    expect((await q({ q: 'phát' })).items.map((a) => a.name)).toEqual(['Máy phát điện']);
    // dueWithinDays + isActive=false không bị ghi đè thành true
    expect((await q({ isActive: false, dueWithinDays: 365 })).items.map((a) => a.name)).toEqual(['Bơm ngừng']);

    const [row] = (await q({ buildingId: String(b1._id) })).items;
    expect(row.isDue).toBe(true);
    expect(row.openWorkOrder).toMatchObject({ status: 'PENDING' });
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
    expect(detail).toMatchObject({ name: 'Thang máy D', doneCount: 1, isDue: true });
    expect(detail.buildingId.name).toBe(b.name);
    expect(detail.openWorkOrder).toMatchObject({ status: 'PENDING' });
    expect(detail.openWorkOrder.assignedTo.fullName).toBe(tech.fullName);
    await expect(assets.getAsset('0123456789abcdef01234567')).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
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
    expect(pagination.total).toBe(2);
    expect(items.map((i) => [i.note, i.onTime])).toEqual([['Trễ hạn', false], ['Đúng hạn', true]]);
    await expect(assets.getAssetHistory('0123456789abcdef01234567', { page: 1, limit: 20 })).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
  });

  describe('routes — phân quyền & validate', () => {
    const app = createApp();

    it('Manager thêm qua API → 201; KTV chỉ xem (GET 200, POST 403); thiếu chu kỳ → 400', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const b = await createBuilding();
      const created = await request(app)
        .post('/api/assets')
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send(body(b, 'Hệ thống PCCC', { category: 'FIRE_SYSTEM', maintenanceCycleDays: 180 }));
      expect(created.status).toBe(201);
      expect(await Asset.countDocuments()).toBe(1);

      const list = await request(app).get('/api/assets').set('Authorization', `Bearer ${tokenFor(tech)}`);
      expect(list.status).toBe(200);
      expect(list.body.pagination.total).toBe(1);

      const forbidden = await request(app)
        .post('/api/assets')
        .set('Authorization', `Bearer ${tokenFor(tech)}`)
        .send(body(b, 'Khác'));
      expect(forbidden.status).toBe(403);

      const invalid = await request(app)
        .post('/api/assets')
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send({ buildingId: String(b._id), name: 'Thiếu chu kỳ', category: 'OTHER' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('PUT/PATCH: KTV 403, không token 401, body rỗng / chu kỳ ≤ 0 / loại sai / sort lạ → 400, id lạ → 404', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const b = await createBuilding();
      const asset = await assets.createAsset(asUser(manager), body(b, 'Thang máy C'));
      const as = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

      expect((await request(app).get('/api/assets')).status).toBe(401);
      expect((await request(app).put(`/api/assets/${asset._id}`).set(as(tech)).send({ name: 'X' })).status).toBe(403);
      expect((await request(app).patch(`/api/assets/${asset._id}/status`).set(as(tech)).send({ isActive: false })).status).toBe(403);

      const put = (payload) => request(app).put(`/api/assets/${asset._id}`).set(as(manager)).send(payload);
      expect((await put({})).status).toBe(400);
      expect((await put({ maintenanceCycleDays: 0 })).status).toBe(400);
      expect((await put({ category: 'ROBOT' })).status).toBe(400);
      expect((await request(app).get('/api/assets?sort=-passwordHash').set(as(manager))).status).toBe(400);

      const okRes = await put({ maintenanceCycleDays: 45, note: 'Kiểm định 2026' });
      expect(okRes.status).toBe(200);
      expect(okRes.body.data.maintenanceCycleDays).toBe(45);

      const stop = await request(app).patch(`/api/assets/${asset._id}/status`).set(as(manager)).send({ isActive: false });
      expect(stop.status).toBe(200);
      expect(stop.body.data.isActive).toBe(false);

      const missing = await request(app).put('/api/assets/0123456789abcdef01234567').set(as(manager)).send({ name: 'Không tồn tại' });
      expect(missing.status).toBe(404);
    });

    it('GET chi tiết / lịch sử: Manager và KTV xem được; Lễ tân 403; id sai định dạng 400', async () => {
      const manager = await createManager();
      const tech = await createTechnician();
      const rec = await createReceptionist();
      const asset = await assets.createAsset(asUser(manager), body(await createBuilding(), 'Thang máy F'));
      const as = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

      const d = await request(app).get(`/api/assets/${asset._id}`).set(as(tech));
      expect(d.status).toBe(200);
      expect(d.body.data).toMatchObject({ name: 'Thang máy F', doneCount: 0, openWorkOrder: null });
      const h = await request(app).get(`/api/assets/${asset._id}/history`).set(as(manager));
      expect(h.status).toBe(200);
      expect(h.body.pagination.total).toBe(0);
      expect((await request(app).get(`/api/assets/${asset._id}`).set(as(rec))).status).toBe(403);
      expect((await request(app).get('/api/assets/abc').set(as(manager))).status).toBe(400);
    });
  });
});
