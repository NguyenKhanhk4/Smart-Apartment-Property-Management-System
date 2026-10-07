// utils/transaction.js trên MongoDB standalone (connectTestDB() không replSet) — như máy dev cục bộ
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { asUser, createBuilding, createManager, createTechnician } from './helpers/fixtures.js';

// Không gọi Cloudinary thật: trả URL giả theo tên file, vẫn giữ middleware kiểm tra file thật
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    uploadToCloudinary: vi.fn(async (files = [], folder) => files.map((f, i) => `https://cdn.test/${folder}/${i}-${f.originalname}`)),
  };
});

const { withTransaction } = await import('../src/utils/transaction.js');
const service = await import('../src/modules/workOrders/workOrders.service.js');
const { Asset, Building, WorkOrder } = await import('../src/models/index.js');

describe('withTransaction trên MongoDB standalone', () => {
  beforeAll(() => connectTestDB(), 120000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  it('không hỗ trợ transaction → chạy fn(null) không transaction, trả kết quả, console.warn đúng 1 lần', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [];
    const run = (code) =>
      withTransaction(async (session) => {
        calls.push(session);
        await Building.create([{ code, name: code }], { session: session ?? undefined });
        return code;
      });

    expect(await run('T1')).toBe('T1');
    expect(await run('T2')).toBe('T2');
    expect(await Building.countDocuments()).toBe(2); // mỗi lần ghi đúng 1 bản ghi (không bị chạy trùng)
    expect(calls.at(-1)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('replica set');
  });

  it('lỗi nghiệp vụ trong fn được ném lại nguyên vẹn, không chạy lại', async () => {
    let runs = 0;
    await expect(
      withTransaction(async () => {
        runs += 1;
        throw new Error('lỗi nghiệp vụ');
      }),
    ).rejects.toThrow('lỗi nghiệp vụ');
    expect(runs).toBe(1);
  });

  it('hoàn thành work order vẫn chạy được khi dev dùng MongoDB standalone (chỉ mất tính nguyên tử)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tech = await createTechnician();
    const asset = await Asset.create({
      buildingId: (await createBuilding())._id,
      name: 'Thang máy dev',
      category: 'ELEVATOR',
      maintenanceCycleDays: 30,
      nextMaintenanceDate: new Date(),
    });
    await createManager();
    const wo = await WorkOrder.create({ assetId: asset._id, type: 'SCHEDULED', status: 'IN_PROGRESS', title: 'Bảo trì', assignedTo: tech._id });

    const res = await service.updateWorkOrderStatus(asUser(tech), wo._id, { status: 'DONE', note: 'Xong việc rồi' }, [
      { originalname: 'a.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff]) },
    ]);
    expect(res.status).toBe('DONE');
    const a = await Asset.findById(asset._id).lean();
    expect(a.lastMaintenanceDate).toBeTruthy();
    expect(a.nextMaintenanceDate.getTime()).toBeGreaterThan(a.lastMaintenanceDate.getTime());
  });
});
