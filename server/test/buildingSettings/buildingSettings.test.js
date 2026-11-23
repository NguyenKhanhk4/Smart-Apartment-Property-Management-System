// buildingSettings.test.js — Bộ test toàn diện cho UC05 (Thông tin tòa nhà, Biểu phí điện nước, Thu hộ, Lịch & thời hạn)
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { AUDIT_ACTIONS, CONFIG_KEYS } from '../../src/constants/enums.js';
import { AuditLog, SystemConfig, UtilityTariff } from '../../src/models/index.js';
import { getBankInfo } from '../../src/modules/buildingSettings/buildingProfile.service.js';
import { cancelUpcomingSetting, getCollectionSettings, isCollecting, updateCollectionSetting } from '../../src/modules/buildingSettings/collectionSettings.service.js';
import { computeTieredAmount, createTariff, deleteTariff, getTariffAt } from '../../src/modules/buildingSettings/utilityTariffs.service.js';
import { createFeeType } from '../../src/modules/feeTypes/feeTypes.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { startApi, stubCloudinary } from '../helpers/equipment.js';
import { asUser, createUser } from '../helpers/fixtures.js';

let server;
let api;
let upload;

before(async () => {
  await connectTestDB();
  server = await startApi();
  ({ api, upload } = server);
});

afterEach(clearTestDB);

after(async () => {
  if (server) await server.close();
  await closeTestDB();
});

// 1. Test computeTieredAmount: hàm thuần tính giá bậc thang
test('computeTieredAmount: 1 bậc, nhiều bậc, ranh giới, lượng dùng 0, định mức theo người', () => {
  // Lượng dùng 0
  assert.equal(computeTieredAmount([{ upTo: 50, unitPrice: 1500 }, { upTo: null, unitPrice: 2000 }], 0), 0);
  assert.equal(computeTieredAmount([], 100), 0);

  // 1 bậc duy nhất (không giới hạn)
  const singleTier = [{ upTo: null, unitPrice: 3000 }];
  assert.equal(computeTieredAmount(singleTier, 10), 30_000);

  // Nhiều bậc: bậc 1: 0-50 kWh giá 1.678; bậc 2: 51-100 kWh giá 1.734; bậc 3: >100 kWh giá 2.014
  const multiTiers = [
    { upTo: 50, unitPrice: 1678 },
    { upTo: 100, unitPrice: 1734 },
    { upTo: null, unitPrice: 2014 },
  ];

  // Đúng ranh giới bậc 1 (50 kWh)
  assert.equal(computeTieredAmount(multiTiers, 50), 50 * 1678);

  // Ranh giới bậc 2 (100 kWh)
  assert.equal(computeTieredAmount(multiTiers, 100), 50 * 1678 + 50 * 1734);

  // Vượt sang bậc 3 (120 kWh: 50*1678 + 50*1734 + 20*2014)
  const expected120 = 50 * 1678 + 50 * 1734 + 20 * 2014;
  assert.equal(computeTieredAmount(multiTiers, 120), expected120);

  // Nước có định mức theo người (perOccupant: true): bậc 1: 10m3/người giá 6000, bậc 2: >10m3/người giá 8000
  const waterTiers = [
    { upTo: 10, unitPrice: 6000 },
    { upTo: null, unitPrice: 8000 },
  ];
  // 4 người -> định mức bậc 1 là 4 * 10 = 40m3
  // Dùng 35m3 -> nằm trọn trong bậc 1: 35 * 6000 = 210.000
  assert.equal(computeTieredAmount(waterTiers, 35, { occupants: 4, perOccupant: true }), 210_000);
  // Dùng 50m3 -> 40m3 * 6000 + 10m3 * 8000 = 240.000 + 80.000 = 320.000
  assert.equal(computeTieredAmount(waterTiers, 50, { occupants: 4, perOccupant: true }), 320_000);
});

// 2. Test Biểu giá điện nước (UtilityTariff)
test('Biểu giá điện nước: validate bậc thang, dời kỳ đang mở, trùng kỳ, đóng phiên bản cũ, không xóa bản đã hiệu lực', async () => {
  const manager = await createUser('MANAGER');
  const now = new Date('2026-11-15T00:00:00+07:00'); // Kỳ hiện tại là 2026-11

  // Validate bậc rỗng / sai cấu trúc
  await assert.rejects(
    createTariff(manager, { utility: 'ELECTRICITY', fromPeriod: '2026-12', tiers: [] }, { now }),
    /Cần ít nhất một bậc giá/,
  );

  // Bậc cuối không phải null
  await assert.rejects(
    createTariff(manager, { utility: 'ELECTRICITY', fromPeriod: '2026-12', tiers: [{ upTo: 50, unitPrice: 1000 }] }, { now }),
    /Bậc cuối cùng phải để trống mức tối đa/,
  );

  // Giá âm
  await assert.rejects(
    createTariff(manager, { utility: 'ELECTRICITY', fromPeriod: '2026-12', tiers: [{ upTo: null, unitPrice: -500 }] }, { now }),
    /Đơn giá không được âm/,
  );

  // upTo không tăng dần
  await assert.rejects(
    createTariff(manager, {
      utility: 'ELECTRICITY',
      fromPeriod: '2026-12',
      tiers: [{ upTo: 100, unitPrice: 1000 }, { upTo: 50, unitPrice: 1500 }, { upTo: null, unitPrice: 2000 }],
    }, { now }),
    /Mức tối đa của các bậc phải tăng dần/,
  );

  // Tạo biểu giá hợp lệ trong kỳ tương lai (2026-12)
  const res1 = await createTariff(manager, {
    utility: 'ELECTRICITY',
    fromPeriod: '2026-12',
    tiers: [{ upTo: 100, unitPrice: 2000 }, { upTo: null, unitPrice: 2500 }],
  }, { now });
  assert.equal(res1.movedTo, null);
  assert.equal(res1.tariff.fromPeriod, '2026-12');
  assert.equal(res1.tariff.toPeriod, null);

  // Thử tạo trùng kỳ 2026-12 -> Báo lỗi MSG-S16
  await assert.rejects(
    createTariff(manager, {
      utility: 'ELECTRICITY',
      fromPeriod: '2026-12',
      tiers: [{ upTo: null, unitPrice: 3000 }],
    }, { now }),
    /Ngày hiệu lực trùng với mức giá đã có/,
  );

  // Tạo trong kỳ đang mở (2026-11) hoặc quá khứ -> tự dời sang kỳ sau (2026-12 đã có nên nếu dời về 2026-12 sẽ trùng; thử với WATER)
  const waterRes = await createTariff(manager, {
    utility: 'WATER',
    fromPeriod: '2026-11', // kỳ hiện tại
    tiers: [{ upTo: 10, unitPrice: 6000 }, { upTo: null, unitPrice: 8000 }],
    perOccupant: true,
  }, { now });
  assert.equal(waterRes.movedTo, '2026-12');
  assert.equal(waterRes.tariff.fromPeriod, '2026-12');
  assert.match(waterRes.message, /tự động dời sang kỳ sau/);

  // Thêm phiên bản tiếp theo vào 2027-01 -> phiên bản 2026-12 tự động được đóng toPeriod = '2026-12'
  const res2 = await createTariff(manager, {
    utility: 'ELECTRICITY',
    fromPeriod: '2027-01',
    tiers: [{ upTo: null, unitPrice: 3000 }],
  }, { now });
  assert.equal(res2.tariff.fromPeriod, '2027-01');

  const oldTariff = await UtilityTariff.findById(res1.tariff._id);
  assert.equal(oldTariff.toPeriod, '2026-12');

  // getTariffAt
  const t202612 = await getTariffAt('ELECTRICITY', '2026-12');
  assert.equal(t202612.tiers[0].unitPrice, 2000);
  const t202701 = await getTariffAt('ELECTRICITY', '2027-01');
  assert.equal(t202701.tiers[0].unitPrice, 3000);

  // Không thể xóa phiên bản đã hiệu lực: giả sử có 1 bản từ 2026-10 (đã có hiệu lực)
  const activeTariff = await UtilityTariff.create({
    utility: 'ELECTRICITY',
    fromPeriod: '2026-10',
    toPeriod: '2026-11',
    tiers: [{ upTo: null, unitPrice: 1500 }],
  });
  await assert.rejects(
    deleteTariff(manager, activeTariff._id, { now }),
    (err) => err.errorCode === 'UTILITY_TARIFF_IN_USE',
  );

  // Xóa được phiên bản tương lai (2027-01) -> phiên bản cũ 2026-12 mở lại toPeriod = null
  await deleteTariff(manager, res2.tariff._id, { now });
  const restored = await UtilityTariff.findById(res1.tariff._id);
  assert.equal(restored.toPeriod, null);
});

// 3. Test Công tắc thu hộ (CollectionSetting)
test('Công tắc thu hộ: mặc định điện tắt nước bật, đổi công tắc hiệu lực từ kỳ sau, audit log', async () => {
  const manager = await createUser('MANAGER');
  const now = new Date('2026-11-15T00:00:00+07:00'); // Kỳ 2026-11

  // Chưa có bản ghi nào trong DB
  assert.equal(await isCollecting('ELECTRICITY', '2026-11'), false);
  assert.equal(await isCollecting('WATER', '2026-11'), true);

  // Đổi công tắc điện: bật thu hộ điện
  const updateRes = await updateCollectionSetting(manager, { utility: 'ELECTRICITY', enabled: true }, { now });
  assert.equal(updateRes.effectiveFrom, '2026-12'); // kỳ sau
  assert.match(updateRes.message, /kỳ sau/);

  // Kỳ hiện tại (2026-11) vẫn TẮT
  assert.equal(await isCollecting('ELECTRICITY', '2026-11'), false);
  // Kỳ sau (2026-12) ra BẬT
  assert.equal(await isCollecting('ELECTRICITY', '2026-12'), true);

  // getCollectionSettings trả đúng trạng thái hiện tại và hẹn kỳ sau
  const settings = await getCollectionSettings({ now });
  assert.equal(settings.currentPeriod, '2026-11');
  assert.equal(settings.nextPeriod, '2026-12');
  assert.equal(settings.settings.ELECTRICITY.current.enabled, false);
  assert.equal(settings.settings.ELECTRICITY.upcoming.enabled, true);

  // Kiểm tra audit log
  const audit = await AuditLog.findOne({ action: AUDIT_ACTIONS.COLLECTION_SETTING_CHANGED }).lean();
  assert.ok(audit);
  assert.equal(audit.after.enabled, true);
  assert.equal(audit.after.fromPeriod, '2026-12');
});

test('Công tắc thu hộ: hủy lịch hẹn, chọn lại đúng trạng thái hiện tại = hủy hẹn; định mức nước theo đầu người từ kỳ sau', async () => {
  const manager = await createUser('MANAGER');
  const now = new Date('2026-11-15T00:00:00+07:00'); // Kỳ 2026-11
  const upcoming = async (utility) => (await getCollectionSettings({ now })).settings[utility].upcoming;

  // Hẹn BẬT điện rồi hủy bằng API hủy hẹn → kỳ sau giữ TẮT, có audit kèm loại điện / nước
  await updateCollectionSetting(manager, { utility: 'ELECTRICITY', enabled: true }, { now });
  const cancelled = await cancelUpcomingSetting(manager, 'ELECTRICITY', { now });
  assert.match(cancelled.message, /Đã hủy lịch hẹn/);
  assert.equal(await upcoming('ELECTRICITY'), null);
  assert.equal(await isCollecting('ELECTRICITY', '2026-12'), false);
  const logs = await AuditLog.find({ action: AUDIT_ACTIONS.COLLECTION_SETTING_CHANGED }).lean();
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.metadata.utility === 'ELECTRICITY'));
  assert.match((await cancelUpcomingSetting(manager, 'ELECTRICITY', { now })).message, /Không có lịch hẹn/);

  // Hẹn BẬT rồi bấm lại TẮT (đúng trạng thái kỳ hiện tại) → không tạo dòng hẹn thừa
  await updateCollectionSetting(manager, { utility: 'ELECTRICITY', enabled: true }, { now });
  await updateCollectionSetting(manager, { utility: 'ELECTRICITY', enabled: false }, { now });
  assert.equal(await upcoming('ELECTRICITY'), null);

  // Định mức nước (nước mặc định BẬT): 4 m³/người từ kỳ sau, kỳ hiện tại chưa có định mức
  await updateCollectionSetting(manager, { utility: 'WATER', enabled: true, waterQuotaPerOccupant: 4 }, { now });
  const water = (await getCollectionSettings({ now })).settings.WATER;
  assert.equal(water.current.waterQuotaPerOccupant, null);
  assert.equal(water.upcoming.waterQuotaPerOccupant, 4);
  assert.equal(water.upcoming.fromPeriod, '2026-12');
  // Đặt lại đúng định mức hiện tại (không áp) → hủy hẹn
  await updateCollectionSetting(manager, { utility: 'WATER', enabled: true, waterQuotaPerOccupant: null }, { now });
  assert.equal(await upcoming('WATER'), null);
});

// 4. Test Thông tin tòa nhà (BuildingProfile) và API
test('Thông tin tòa nhà: mã số thuế, số tài khoản, upload logo, getBankInfo, audit log', async () => {
  stubCloudinary();
  const manager = await createUser('MANAGER');
  const resident = await createUser('RESIDENT');

  // Chưa đăng nhập -> 401
  const unauth = await api('GET', '/building-profile');
  assert.equal(unauth.status, 401);

  // Cư dân xem được profile
  const resGet = await api('GET', '/building-profile', resident);
  assert.equal(resGet.status, 200);

  // Cư dân sửa -> 403
  const resForbidden = await api('PUT', '/building-profile', resident, { name: 'Tháp Ruby' });
  assert.equal(resForbidden.status, 403);

  // Mã số thuế sai định dạng -> 400
  const badTax = await upload('PUT', '/building-profile', manager, {
    name: 'Chung cư Sunshine',
    taxCode: '12345', // sai (không đủ 10 số)
  }, []);
  assert.equal(badTax.status, 400);

  // Số tài khoản có chữ cái -> 400
  const badBank = await upload('PUT', '/building-profile', manager, {
    name: 'Chung cư Sunshine',
    bankAccountNo: 'ABC123456',
  }, []);
  assert.equal(badBank.status, 400);

  // Lưu hợp lệ kèm logo (PNG buffer thật với magic bytes)
  const realPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const successRes = await upload('PUT', '/building-profile', manager, {
    name: 'Tòa nhà Sunshine Riverside',
    address: '123 Võ Chí Công, Tây Hồ, Hà Nội',
    taxCode: '0123456789-001',
    bankName: 'Vietcombank',
    bankAccountNo: '9876543210',
    bankAccountName: 'BAN QUAN TRI SUNSHINE',
  }, [['logo.png', realPng, 'image/png', 'logo']]);

  assert.equal(successRes.status, 200);
  assert.equal(successRes.body.data.name, 'Tòa nhà Sunshine Riverside');
  assert.ok(successRes.body.data.logoUrl);

  // getBankInfo trả đúng thông tin
  const bankInfo = await getBankInfo();
  assert.equal(bankInfo.bankName, 'Vietcombank');
  assert.equal(bankInfo.accountNo, '9876543210');
  assert.equal(bankInfo.accountName, 'BAN QUAN TRI SUNSHINE');

  // Audit Log
  const audit = await AuditLog.findOne({ action: AUDIT_ACTIONS.BUILDING_PROFILE_UPDATED }).lean();
  assert.ok(audit);
  assert.equal(audit.after.taxCode, '0123456789-001');
});

// 5. Test Lịch & thời hạn: kiểm tra chéo và giới hạn UPLOAD_MAX_SIZE_MB
test('Lịch & thời hạn: tự hủy <= nhắc -> 400; upload max > 20 -> 400', async () => {
  const manager = await createUser('MANAGER');

  // Khởi tạo các giá trị mẫu
  await SystemConfig.create([
    { key: CONFIG_KEYS.OWNER_CONFIRM_REMIND_DAYS, value: 3, scope: 'BUSINESS' },
    { key: CONFIG_KEYS.OWNER_CONFIRM_AUTO_CANCEL_DAYS, value: 7, scope: 'BUSINESS' },
    { key: CONFIG_KEYS.UPLOAD_MAX_SIZE_MB, value: 10, scope: 'TECHNICAL' },
  ]);

  // Sửa thời hạn tự hủy nhỏ hơn hoặc bằng nhắc (7 thành 2) -> 400
  const resBadCancel = await api('PATCH', `/system-configs/${CONFIG_KEYS.OWNER_CONFIRM_AUTO_CANCEL_DAYS}`, manager, { value: 2 });
  assert.equal(resBadCancel.status, 400);
  assert.match(resBadCancel.body.message, /lớn hơn thời hạn nhắc/);

  // Sửa nhắc lớn hơn hoặc bằng tự hủy (3 thành 8) -> 400
  const resBadRemind = await api('PATCH', `/system-configs/${CONFIG_KEYS.OWNER_CONFIRM_REMIND_DAYS}`, manager, { value: 8 });
  assert.equal(resBadRemind.status, 400);
  assert.match(resBadRemind.body.message, /nhỏ hơn thời hạn tự hủy/);

  // Sửa UPLOAD_MAX_SIZE_MB > 20 -> 400
  const resBadUpload = await api('PATCH', `/system-configs/${CONFIG_KEYS.UPLOAD_MAX_SIZE_MB}`, manager, { value: 30 });
  assert.equal(resBadUpload.status, 400);
  assert.match(resBadUpload.body.message, /không được vượt quá 20MB/);

  // Sửa UPLOAD_MAX_SIZE_MB hợp lệ (15) -> 200
  const resGoodUpload = await api('PATCH', `/system-configs/${CONFIG_KEYS.UPLOAD_MAX_SIZE_MB}`, manager, { value: 15 });
  assert.equal(resGoodUpload.status, 200);
});

// 6. Test Phí cố định của Khánh: Rule 4b tự dời kỳ mở
test('FeeType createFeeType: ngày hiệu lực trong kỳ mở tự dời sang kỳ sau (Rule 4b)', async () => {
  const manager = await createUser('MANAGER');
  const now = new Date('2026-11-15T00:00:00+07:00'); // Kỳ 2026-11

  // Gửi effectiveFrom là kỳ đang mở 2026-11
  const fee = await createFeeType(asUser(manager), {
    code: 'CLEANING_TEST',
    name: 'Phí vệ sinh test',
    feeCategory: 'CLEANING',
    calcMethod: 'PER_M2',
    unitPrice: 5000,
    effectiveFrom: '2026-11',
  }, { now });

  assert.equal(fee.movedTo, '2026-12');
  assert.match(fee.message, /tự động dời sang kỳ sau/);
});
