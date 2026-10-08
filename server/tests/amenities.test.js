// Module D — UC-D05: Quản lý tiện ích theo kiểu FREE / WALK_IN / BOOKING
// (BR-O15 giờ mở cửa, BR-O19 ngừng / đổi kiểu tiện ích, BR-O24 giá theo tuổi, phí snapshot)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createApartment,
  createBuilding,
  createHousehold,
  createManager,
  createReceptionist,
  createTechnician,
  tokenFor,
} from './helpers/fixtures.js';

// Không gọi Cloudinary thật, vẫn giữ middleware kiểm tra file thật
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    uploadToCloudinary: vi.fn(async (files = [], folder) => files.map((f) => `https://cdn.test/${folder}/${f.originalname}`)),
  };
});

const { createApp } = await import('../src/app.js');
const service = await import('../src/modules/amenities/amenities.service.js');
const slot = await import('../src/modules/amenities/slot.utils.js');
const pricing = await import('../src/modules/amenities/pricing.js');
const { Amenity, AuditLog, Booking, SystemConfig } = await import('../src/models/index.js');
const { DEFAULT_CONFIGS } = await import('../src/constants/enums.js');

const HOUR = 3600e3;
const base = (extra = {}) => ({
  name: 'Sân tennis',
  accessMode: 'BOOKING',
  openTime: '08:00',
  closeTime: '17:00',
  slotDurationMinutes: 60,
  capacityPerSlot: 1,
  feePerBooking: 0,
  ...extra,
});
const freeBody = (extra = {}) => ({ name: 'Công viên', accessMode: 'FREE', ...extra });
const walkInBody = (extra = {}) => ({
  name: 'Hồ bơi',
  accessMode: 'WALK_IN',
  openTime: '05:00',
  closeTime: '22:00',
  perVisitFeeAdult: 50000,
  perVisitFeeChild: 30000,
  ...extra,
});

/** Booking thẳng vào DB với mốc thật startAt/endAt */
const makeBooking = (amenity, apartment, startAt, extra = {}) =>
  Booking.create({
    amenityId: amenity._id,
    apartmentId: apartment._id,
    date: slot.vnDayStart(slot.toVnYmd(startAt)),
    slotStart: '08:00',
    slotEnd: '09:00',
    startAt,
    endAt: new Date(startAt.getTime() + HOUR),
    fee: amenity.feePerBooking,
    ...extra,
  });

const fieldsOf = (err) => err.details.map((d) => d.field);
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

describe('amenities (UC-D05)', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  describe('slot.utils', () => {
    it('vnDayStart / toVnYmd / atTime theo giờ VN', () => {
      expect(slot.vnDayStart('2026-10-08').toISOString()).toBe('2026-10-07T17:00:00.000Z');
      expect(slot.toVnYmd(new Date('2026-10-07T17:00:00.000Z'))).toBe('2026-10-08');
      expect(slot.toVnYmd(new Date('2026-10-07T16:59:59.000Z'))).toBe('2026-10-07');
      expect(slot.atTime(slot.vnDayStart('2026-10-08'), '08:30').toISOString()).toBe('2026-10-08T01:30:00.000Z');
      expect(slot.toMinutes('08:30')).toBe(510);
      expect(slot.toHHMM(510)).toBe('08:30');
      expect(() => slot.vnDayStart('08/10/2026')).toThrow();
    });

    it('buildSlotGrid: 08:00–17:00 slot 90 phút → 6 slot, slot cuối kết thúc 17:00', () => {
      const grid = slot.buildSlotGrid({ openTime: '08:00', closeTime: '17:00', slotDurationMinutes: 90 });
      expect(grid).toHaveLength(6);
      expect(grid[0]).toEqual({ slotStart: '08:00', slotEnd: '09:30' });
      expect(grid.at(-1)).toEqual({ slotStart: '15:30', slotEnd: '17:00' });
      // Phần dư không đủ 1 slot bị bỏ: 08:00–17:00 slot 120 → 4 slot (16:00–18:00 vượt giờ đóng)
      expect(slot.buildSlotGrid({ openTime: '08:00', closeTime: '17:00', slotDurationMinutes: 120 })).toHaveLength(4);
    });

    it('getBookingConfig: mặc định đúng (lễ tân 05:00–22:00, mốc tuổi 6/12, 120 phút, nhắc 3 ngày)', async () => {
      expect(await slot.getBookingConfig()).toEqual({
        maxActivePerApartment: 2,
        advanceDays: 14,
        checkinEarlyMinutes: 15,
        noShowGraceMinutes: 15,
        receptionOpen: '05:00',
        receptionClose: '22:00',
        childFreeAge: 6,
        childAdultAge: 12,
        walkInVisitMinutes: 120,
        passExpiryRemindDays: 3,
      });
    });

    it('getBookingConfig: giá trị cấu hình sai kiểu / sai logic → dùng mặc định; giá trị đúng → đọc được', async () => {
      await SystemConfig.create([
        { key: 'BOOKING_ADVANCE_DAYS', value: 'abc', scope: 'BUSINESS' },
        { key: 'RECEPTION_OPEN_TIME', value: '23:00', scope: 'BUSINESS' }, // mở ≥ đóng → bỏ cả cặp
        { key: 'CHILD_FREE_AGE', value: 15, scope: 'BUSINESS' }, // ≥ mốc người lớn → bỏ cả cặp
        { key: 'WALK_IN_VISIT_MINUTES', value: true, scope: 'BUSINESS' }, // không phải số
        { key: 'PASS_EXPIRY_REMIND_DAYS', value: 5, scope: 'BUSINESS' },
      ]);
      expect(await slot.getBookingConfig()).toMatchObject({
        advanceDays: 14,
        receptionOpen: '05:00',
        receptionClose: '22:00',
        childFreeAge: 6,
        childAdultAge: 12,
        walkInVisitMinutes: 120,
        passExpiryRemindDays: 5,
      });
      await SystemConfig.updateOne({ key: 'CHILD_FREE_AGE' }, { value: 4 });
      await SystemConfig.create({ key: 'CHILD_ADULT_AGE', value: 10, scope: 'BUSINESS' });
      expect(await slot.getBookingConfig()).toMatchObject({ childFreeAge: 4, childAdultAge: 10 });
    });

    it('DEFAULT_CONFIGS: có tham số booking + tiện ích mới (scope BUSINESS, mô tả kèm mã BR), đã bỏ BOOKING_CANCEL_HOURS', () => {
      const keys = DEFAULT_CONFIGS.map((c) => c.key);
      for (const k of [
        'BOOKING_ADVANCE_DAYS',
        'CHECKIN_EARLY_MINUTES',
        'NO_SHOW_GRACE_MINUTES',
        'RECEPTION_OPEN_TIME',
        'RECEPTION_CLOSE_TIME',
        'BOOKING_MAX_ACTIVE_PER_APARTMENT',
        'CHILD_FREE_AGE',
        'CHILD_ADULT_AGE',
        'WALK_IN_VISIT_MINUTES',
        'PASS_EXPIRY_REMIND_DAYS',
      ]) {
        expect(keys).toContain(k);
      }
      expect(keys).not.toContain('BOOKING_CANCEL_HOURS');
      const byKey = Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c]));
      expect(byKey.RECEPTION_OPEN_TIME.value).toBe('05:00');
      expect(byKey.RECEPTION_CLOSE_TIME.value).toBe('22:00');
      for (const k of ['CHILD_FREE_AGE', 'CHILD_ADULT_AGE', 'WALK_IN_VISIT_MINUTES', 'PASS_EXPIRY_REMIND_DAYS']) {
        expect(byKey[k].scope).toBe('BUSINESS');
        expect(byKey[k].description).toMatch(/BR-O\d+/);
      }
    });
  });

  describe('pricing.js (BR-O24)', () => {
    const at = new Date('2026-10-08T05:00:00.000Z'); // 12:00 ngày 08/10/2026 giờ VN
    const cfg = { childFreeAge: 6, childAdultAge: 12 };

    it('ageAt: tuổi tròn năm theo ngày lịch VN; chưa tới sinh nhật chưa tăng tuổi', () => {
      expect(pricing.ageAt('2020-10-08', at)).toBe(6);
      expect(pricing.ageAt('2020-10-09', at)).toBe(5);
      expect(pricing.ageAt('2014-10-08', at)).toBe(12);
      expect(pricing.ageAt('2014-10-09', at)).toBe(11);
      expect(pricing.ageAt('2026-10-08', at)).toBe(0);
      expect(pricing.ageAt('2000-02-29', new Date('2026-02-28T05:00:00Z'))).toBe(25); // sinh nhật 29/02 → 01/03 mới tăng
      expect(pricing.ageAt('2000-02-29', new Date('2026-03-01T05:00:00Z'))).toBe(26);
      // Ngày sinh lưu 00:00 giờ VN (= 17:00 UTC hôm trước) vẫn ra đúng ngày
      expect(pricing.ageAt(new Date('2020-10-07T17:00:00.000Z'), at)).toBe(6);
      // 23:30 VN cuối ngày 07/10 vẫn chưa qua sinh nhật 08/10
      expect(pricing.ageAt('2020-10-08', new Date('2026-10-07T16:30:00.000Z'))).toBe(5);
    });

    it('ageAt: không có / sai / ở tương lai → null', () => {
      expect(pricing.ageAt(null, at)).toBeNull();
      expect(pricing.ageAt(undefined, at)).toBeNull();
      expect(pricing.ageAt('không phải ngày', at)).toBeNull();
      expect(pricing.ageAt('2026-10-09', at)).toBeNull();
    });

    it('ageGroupOf: 5 tuổi → CHILD_FREE, 6 → CHILD, 11 → CHILD, 12 → ADULT', () => {
      expect(pricing.ageGroupOf('2021-10-09', at, cfg)).toBe('CHILD_FREE'); // 4 tuổi
      expect(pricing.ageGroupOf('2020-10-09', at, cfg)).toBe('CHILD_FREE'); // 5 tuổi (mai mới tròn 6)
      expect(pricing.ageGroupOf('2020-10-08', at, cfg)).toBe('CHILD'); // tròn 6 tuổi hôm nay
      expect(pricing.ageGroupOf('2014-10-09', at, cfg)).toBe('CHILD'); // 11 tuổi
      expect(pricing.ageGroupOf('2014-10-08', at, cfg)).toBe('ADULT'); // tròn 12 tuổi hôm nay
      expect(pricing.ageGroupOf('1990-01-01', at, cfg)).toBe('ADULT');
    });

    it('ageGroupOf: không ngày sinh → ADULT; ngày sinh đúng hôm nay → CHILD_FREE; mốc tuổi lấy từ cfg; cfg sai → 6/12', () => {
      expect(pricing.ageGroupOf(null, at, cfg)).toBe('ADULT');
      expect(pricing.ageGroupOf(undefined)).toBe('ADULT');
      expect(pricing.ageGroupOf('hỏng', at, cfg)).toBe('ADULT');
      expect(pricing.ageGroupOf('2026-10-09', at, cfg)).toBe('ADULT'); // ngày sinh tương lai = dữ liệu sai
      const now = new Date();
      expect(pricing.ageGroupOf(now, now, cfg)).toBe('CHILD_FREE');
      expect(pricing.ageGroupOf(now)).toBe('CHILD_FREE'); // cfg + at mặc định
      // Mốc tuổi đổi qua cfg: 5 tuổi với mốc miễn phí 3 → CHILD; 9 tuổi với mốc người lớn 8 → ADULT
      expect(pricing.ageGroupOf('2021-10-08', at, { childFreeAge: 3, childAdultAge: 8 })).toBe('CHILD');
      expect(pricing.ageGroupOf('2017-10-08', at, { childFreeAge: 3, childAdultAge: 8 })).toBe('ADULT');
      expect(pricing.ageGroupOf('2020-10-09', at, { childFreeAge: 'x', childAdultAge: 2 })).toBe('CHILD_FREE'); // cfg sai → 6/12
      expect(pricing.ageGroupOf('2020-10-08', at, { childFreeAge: 12, childAdultAge: 6 })).toBe('CHILD');
    });

    const gym = { accessMode: 'WALK_IN', perVisitFeeAdult: 50000, perVisitFeeChild: 30000, monthlyPassFeeAdult: 400000, monthlyPassFeeChild: 250000 };

    it('visitFee: theo nhóm tuổi, CHILD_FREE luôn 0; thiếu trường → 0', () => {
      expect(pricing.visitFee(gym, 'ADULT')).toBe(50000);
      expect(pricing.visitFee(gym, 'CHILD')).toBe(30000);
      expect(pricing.visitFee(gym, 'CHILD_FREE')).toBe(0);
      expect(pricing.visitFee({}, 'ADULT')).toBe(0);
      expect(pricing.visitFee({ accessMode: 'FREE' }, 'CHILD')).toBe(0);
    });

    it('passFee: theo nhóm tuổi; null nếu không bán gói (thiếu 1 trong 2 giá cũng coi là không bán)', () => {
      expect(pricing.passFee(gym, 'ADULT')).toBe(400000);
      expect(pricing.passFee(gym, 'CHILD')).toBe(250000);
      expect(pricing.passFee(gym, 'CHILD_FREE')).toBe(0);
      expect(pricing.passFee({ ...gym, monthlyPassFeeAdult: null, monthlyPassFeeChild: null }, 'ADULT')).toBeNull();
      expect(pricing.passFee({ ...gym, monthlyPassFeeChild: null }, 'ADULT')).toBeNull();
      expect(pricing.passFee({}, 'CHILD')).toBeNull();
    });

    it('priceSummaryOf: dòng giá cho từng kiểu', () => {
      expect(pricing.priceSummaryOf(gym)).toBe('Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt · Gói 400.000 đ/tháng (trẻ em 250.000 đ)');
      expect(pricing.priceSummaryOf({ ...gym, monthlyPassFeeChild: 400000 })).toBe('Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt · Gói 400.000 đ/tháng');
      expect(pricing.priceSummaryOf({ ...gym, monthlyPassFeeAdult: null, monthlyPassFeeChild: null })).toBe('Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt');
      expect(pricing.priceSummaryOf({ accessMode: 'WALK_IN', perVisitFeeAdult: 40000, perVisitFeeChild: 0 })).toBe('Người lớn 40.000 đ · Trẻ em miễn phí / lượt');
      expect(pricing.priceSummaryOf({ accessMode: 'WALK_IN', perVisitFeeAdult: 0, perVisitFeeChild: 0 })).toBe('Miễn phí vé lẻ');
      expect(pricing.priceSummaryOf({ accessMode: 'FREE' })).toBe('Miễn phí');
      expect(pricing.priceSummaryOf({ accessMode: 'BOOKING', feePerBooking: 1250000 })).toBe('1.250.000 đ / lượt đặt');
      expect(pricing.priceSummaryOf({ accessMode: 'BOOKING', feePerBooking: 150000, monthlyPassFeeAdult: 600000, monthlyPassFeeChild: 350000 })).toBe(
        '150.000 đ / lượt đặt · Gói 600.000 đ/tháng (trẻ em 350.000 đ)',
      );
      // Bản ghi cũ không có accessMode → BOOKING
      expect(pricing.priceSummaryOf({ feePerBooking: 0 })).toBe('Miễn phí đặt chỗ');
      expect(pricing.accessModeOf({})).toBe('BOOKING');
    });
  });

  describe('tạo tiện ích theo kiểu', () => {
    it('FREE: chỉ cần tên; mọi trường phí / slot lưu 0 / null dù client có gửi; priceSummary "Miễn phí"', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, freeBody());
      expect(a).toMatchObject({
        accessMode: 'FREE',
        openTime: null,
        closeTime: null,
        slotDurationMinutes: null,
        capacityPerSlot: null,
        feePerBooking: 0,
        perVisitFeeAdult: 0,
        perVisitFeeChild: 0,
        maxConcurrent: null,
        monthlyPassFeeAdult: null,
        monthlyPassFeeChild: null,
        priceSummary: 'Miễn phí',
        isActive: true,
      });

      const ignored = await service.createAmenity(
        m,
        freeBody({
          name: 'Sân chơi',
          slotDurationMinutes: 60,
          capacityPerSlot: 5,
          feePerBooking: 99000,
          perVisitFeeAdult: 1000,
          perVisitFeeChild: 500,
          maxConcurrent: 10,
          monthlyPassFeeAdult: 100000,
          monthlyPassFeeChild: 50000,
        }),
      );
      expect(ignored).toMatchObject({
        slotDurationMinutes: null,
        capacityPerSlot: null,
        feePerBooking: 0,
        perVisitFeeAdult: 0,
        perVisitFeeChild: 0,
        maxConcurrent: null,
        monthlyPassFeeAdult: null,
        monthlyPassFeeChild: null,
      });
    });

    it('FREE: giờ mở cửa tùy chọn, KHÔNG áp BR-O15 (03:00–23:30 hợp lệ); nhập thiếu 1 giờ hoặc đóng ≤ mở → lỗi', async () => {
      const m = asUser(await createManager());
      const wide = await service.createAmenity(m, freeBody({ openTime: '03:00', closeTime: '23:30' }));
      expect(wide).toMatchObject({ openTime: '03:00', closeTime: '23:30' });

      const onlyOpen = await service.createAmenity(m, freeBody({ name: 'A', openTime: '06:00' })).catch((e) => e);
      expect(onlyOpen).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      expect(fieldsOf(onlyOpen)).toEqual(['closeTime']);
      const onlyClose = await service.createAmenity(m, freeBody({ name: 'B', closeTime: '18:00' })).catch((e) => e);
      expect(fieldsOf(onlyClose)).toEqual(['openTime']);
      const reversed = await service.createAmenity(m, freeBody({ name: 'C', openTime: '18:00', closeTime: '06:00' })).catch((e) => e);
      expect(fieldsOf(reversed)).toEqual(['closeTime']);
      expect(await Amenity.countDocuments()).toBe(1);
    });

    it('WALK_IN: 05:00–22:00 hợp lệ; lưu giá vé, gói tháng, maxConcurrent; trường slot / phí đặt lưu null / 0', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(
        m,
        walkInBody({ maxConcurrent: 40, monthlyPassFeeAdult: 450000, monthlyPassFeeChild: 280000, slotDurationMinutes: 60, capacityPerSlot: 3, feePerBooking: 77000 }),
      );
      expect(a).toMatchObject({
        accessMode: 'WALK_IN',
        openTime: '05:00',
        closeTime: '22:00',
        perVisitFeeAdult: 50000,
        perVisitFeeChild: 30000,
        maxConcurrent: 40,
        monthlyPassFeeAdult: 450000,
        monthlyPassFeeChild: 280000,
        slotDurationMinutes: null,
        capacityPerSlot: null,
        feePerBooking: 0,
        priceSummary: 'Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt · Gói 450.000 đ/tháng (trẻ em 280.000 đ)',
      });
      // Gói tháng và maxConcurrent tùy chọn; giá vé = 0 vẫn hợp lệ (miễn phí)
      const minimal = await service.createAmenity(m, walkInBody({ name: 'Yoga', perVisitFeeAdult: 0, perVisitFeeChild: 0 }));
      expect(minimal).toMatchObject({ maxConcurrent: null, monthlyPassFeeAdult: null, monthlyPassFeeChild: null, perVisitFeeAdult: 0 });
    });

    it('WALK_IN: 04:30 bị chặn (openTime), 22:30 bị chặn (closeTime), đóng ≤ mở bị chặn, thiếu giờ / thiếu giá vé → lỗi theo field; không cần vừa 1 slot', async () => {
      const m = asUser(await createManager());
      const early = await service.createAmenity(m, walkInBody({ openTime: '04:30' })).catch((e) => e);
      expect(early).toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
      expect(early.details).toEqual([{ field: 'openTime', message: 'Giờ mở cửa không được sớm hơn giờ lễ tân bắt đầu làm việc (05:00)' }]);

      const late = await service.createAmenity(m, walkInBody({ closeTime: '22:30' })).catch((e) => e);
      expect(fieldsOf(late)).toEqual(['closeTime']);
      const reversed = await service.createAmenity(m, walkInBody({ openTime: '12:00', closeTime: '12:00' })).catch((e) => e);
      expect(fieldsOf(reversed)).toEqual(['closeTime']);

      const noHours = await service.createAmenity(m, { name: 'X', accessMode: 'WALK_IN', perVisitFeeAdult: 1, perVisitFeeChild: 1 }).catch((e) => e);
      expect(fieldsOf(noHours)).toEqual(['openTime', 'closeTime']);
      const noFee = await service.createAmenity(m, { name: 'X', accessMode: 'WALK_IN', openTime: '06:00', closeTime: '20:00' }).catch((e) => e);
      expect(fieldsOf(noFee)).toEqual(['perVisitFeeAdult', 'perVisitFeeChild']);

      // Khung giờ 30 phút vẫn hợp lệ vì WALK_IN không chia slot
      expect((await service.createAmenity(m, walkInBody({ name: 'Ngắn', openTime: '10:00', closeTime: '10:30' }))).closeTime).toBe('10:30');
      expect(await Amenity.countDocuments()).toBe(1);
    });

    it('BOOKING: giữ hành vi cũ (slot, sức chứa, phí/lượt, BR-O15, vừa ≥ 1 slot); gói tháng tùy chọn; thiếu slot / sức chứa → lỗi', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base({ feePerBooking: 100000, monthlyPassFeeAdult: 600000, monthlyPassFeeChild: 350000 }));
      expect(a).toMatchObject({
        accessMode: 'BOOKING',
        slotDurationMinutes: 60,
        capacityPerSlot: 1,
        feePerBooking: 100000,
        perVisitFeeAdult: 0,
        perVisitFeeChild: 0,
        maxConcurrent: null,
        monthlyPassFeeAdult: 600000,
        monthlyPassFeeChild: 350000,
        priceSummary: '100.000 đ / lượt đặt · Gói 600.000 đ/tháng (trẻ em 350.000 đ)',
      });
      // WALK_IN-only fields bị bỏ qua
      const ignored = await service.createAmenity(m, base({ name: 'Cầu lông', perVisitFeeAdult: 9000, maxConcurrent: 5 }));
      expect(ignored).toMatchObject({ perVisitFeeAdult: 0, maxConcurrent: null, monthlyPassFeeAdult: null });

      const missing = await service.createAmenity(m, { name: 'Y', accessMode: 'BOOKING', openTime: '08:00', closeTime: '17:00' }).catch((e) => e);
      expect(fieldsOf(missing)).toEqual(['slotDurationMinutes', 'capacityPerSlot']);
      const early = await service.createAmenity(m, base({ name: 'Z', openTime: '04:30' })).catch((e) => e);
      expect(fieldsOf(early)).toEqual(['openTime']);
    });

    it('accessMode không truyền → BOOKING (tương thích client cũ)', async () => {
      const m = asUser(await createManager());
      const body = base();
      delete body.accessMode;
      expect((await service.createAmenity(m, body)).accessMode).toBe('BOOKING');
    });

    it('gói tháng: phải nhập đủ cả hai giá hoặc để trống cả hai (WALK_IN và BOOKING)', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, walkInBody({ monthlyPassFeeAdult: 400000 })).catch((e) => e);
      expect(fieldsOf(a)).toEqual(['monthlyPassFeeChild']);
      const b = await service.createAmenity(m, base({ monthlyPassFeeChild: 250000 })).catch((e) => e);
      expect(fieldsOf(b)).toEqual(['monthlyPassFeeAdult']);
      // '' = để trống (multipart)
      const c = await service.createAmenity(m, walkInBody({ monthlyPassFeeAdult: '', monthlyPassFeeChild: '', maxConcurrent: '' }));
      expect(c).toMatchObject({ monthlyPassFeeAdult: null, monthlyPassFeeChild: null, maxConcurrent: null });
    });
  });

  describe('BR-O15 — giờ mở cửa (WALK_IN / BOOKING)', () => {
    it('04:30 (trước giờ lễ tân) → lỗi openTime; 10:00–22:30 → lỗi closeTime; đóng trước mở → lỗi; không đủ 1 slot → lỗi', async () => {
      const m = asUser(await createManager());
      const early = await service.createAmenity(m, base({ openTime: '04:30' })).catch((e) => e);
      expect(early).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      expect(fieldsOf(early)).toEqual(['openTime']);

      const late = await service.createAmenity(m, base({ openTime: '10:00', closeTime: '22:30' })).catch((e) => e);
      expect(fieldsOf(late)).toEqual(['closeTime']);

      const reversed = await service.createAmenity(m, base({ openTime: '15:00', closeTime: '09:00' })).catch((e) => e);
      expect(reversed.details).toContainEqual({ field: 'closeTime', message: 'Giờ đóng cửa phải sau giờ mở cửa' });

      const tooShort = await service.createAmenity(m, base({ openTime: '16:00', closeTime: '17:00', slotDurationMinutes: 90 })).catch((e) => e);
      expect(fieldsOf(tooShort)).toEqual(['slotDurationMinutes']);

      expect(await Amenity.countDocuments()).toBe(0);
    });

    it('05:00–22:00 → hợp lệ; đổi RECEPTION_OPEN_TIME = 04:00 trong system_configs thì 04:30 hợp lệ', async () => {
      const m = asUser(await createManager());
      const ok = await service.createAmenity(m, base({ openTime: '05:00', closeTime: '22:00' }));
      expect(ok).toMatchObject({ isActive: true, imageUrl: null, buildingId: null, lockVersion: 0 });
      expect(String(ok.createdBy)).toBe(m.id);

      await SystemConfig.create({ key: 'RECEPTION_OPEN_TIME', value: '04:00', scope: 'BUSINESS' });
      const early = await service.createAmenity(m, base({ name: 'Hồ bơi', openTime: '04:30' }));
      expect(early.openTime).toBe('04:30');
    });

    it('sửa: kiểm tra BR-O15 trên giá trị sau khi ghép (chỉ đổi slot vẫn phải vừa khung giờ cũ)', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base({ openTime: '15:00', closeTime: '17:00' }));
      await expect(service.updateAmenity(m, a._id, { slotDurationMinutes: 180 })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      await expect(service.updateAmenity(m, a._id, { closeTime: '23:00' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      const updated = await service.updateAmenity(m, a._id, { openTime: '09:00', slotDurationMinutes: 120 });
      expect(updated).toMatchObject({ openTime: '09:00', closeTime: '17:00', slotDurationMinutes: 120 });
    });

    it('sửa WALK_IN: giờ mở 04:30 bị chặn, sửa giá vé giữ nguyên giờ cũ', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, walkInBody());
      await expect(service.updateAmenity(m, a._id, { openTime: '04:30' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      const updated = await service.updateAmenity(m, a._id, { perVisitFeeAdult: 60000 });
      expect(updated).toMatchObject({ openTime: '05:00', closeTime: '22:00', perVisitFeeAdult: 60000 });
    });
  });

  describe('audit AMENITY_FEE_CHANGED', () => {
    it('đổi phí đặt → metadata { name, changes: { feePerBooking: [cũ, mới] } }; booking cũ giữ phí snapshot; sửa khác phí không ghi audit', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base({ name: 'Sân tennis', feePerBooking: 100000 }));
      const apt = await createApartment();
      const old = await makeBooking(a, apt, new Date(Date.now() + 24 * HOUR));

      await service.updateAmenity(m, a._id, { location: 'Sân sau' });
      expect(await AuditLog.countDocuments()).toBe(0);

      await service.updateAmenity(m, a._id, { feePerBooking: 150000 });
      const [log] = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).lean();
      expect(log.metadata).toEqual({ name: 'Sân tennis', changes: { feePerBooking: [100000, 150000] } });
      expect(String(log.performedBy)).toBe(m.id);
      expect((await Booking.findById(old._id).lean()).fee).toBe(100000);

      // Cùng giá → không ghi thêm
      await service.updateAmenity(m, a._id, { feePerBooking: 150000 });
      expect(await AuditLog.countDocuments()).toBe(1);
    });

    it('liệt kê đúng các trường phí đổi (giá vé, gói tháng), không kèm trường không đổi; xóa gói → [giá cũ, null]', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, walkInBody({ monthlyPassFeeAdult: 400000, monthlyPassFeeChild: 250000 }));

      await service.updateAmenity(m, a._id, { perVisitFeeChild: 35000, monthlyPassFeeAdult: 420000, maxConcurrent: 30 });
      let logs = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).sort({ createdAt: 1 }).lean();
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual({
        name: 'Hồ bơi',
        changes: { perVisitFeeChild: [30000, 35000], monthlyPassFeeAdult: [400000, 420000] }, // maxConcurrent không phải trường phí
      });

      await service.updateAmenity(m, a._id, { monthlyPassFeeAdult: '', monthlyPassFeeChild: '' });
      logs = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).sort({ createdAt: 1 }).lean();
      expect(logs).toHaveLength(2);
      expect(logs[1].metadata.changes).toEqual({ monthlyPassFeeAdult: [420000, null], monthlyPassFeeChild: [250000, null] });
      expect((await Amenity.findById(a._id).lean()).monthlyPassFeeAdult).toBeNull();

      // Chỉ đổi maxConcurrent / giờ → không ghi audit mới
      await service.updateAmenity(m, a._id, { maxConcurrent: 10, closeTime: '21:00' });
      expect(await AuditLog.countDocuments({ action: 'AMENITY_FEE_CHANGED' })).toBe(2);
    });
  });

  describe('đổi kiểu tiện ích (accessMode)', () => {
    it('BOOKING → WALK_IN: phải nhập giá vé; trường slot / phí đặt bị bỏ, giờ mở cửa và gói tháng được giữ; audit liệt kê các trường phí đổi', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base({ feePerBooking: 100000, monthlyPassFeeAdult: 600000, monthlyPassFeeChild: 350000 }));

      const noFee = await service.updateAmenity(m, a._id, { accessMode: 'WALK_IN' }).catch((e) => e);
      expect(noFee).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      expect(fieldsOf(noFee)).toEqual(['perVisitFeeAdult', 'perVisitFeeChild']);
      expect((await Amenity.findById(a._id).lean()).accessMode).toBe('BOOKING'); // chưa đổi gì

      const updated = await service.updateAmenity(m, a._id, { accessMode: 'WALK_IN', perVisitFeeAdult: 50000, perVisitFeeChild: 30000 });
      expect(updated).toMatchObject({
        accessMode: 'WALK_IN',
        slotDurationMinutes: null,
        capacityPerSlot: null,
        feePerBooking: 0,
        perVisitFeeAdult: 50000,
        perVisitFeeChild: 30000,
        openTime: '08:00',
        closeTime: '17:00',
        monthlyPassFeeAdult: 600000,
      });
      const [log] = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).lean();
      expect(log.metadata).toEqual({
        name: 'Sân tennis',
        changes: { feePerBooking: [100000, 0], perVisitFeeAdult: [0, 50000], perVisitFeeChild: [0, 30000] },
      });
    });

    it('WALK_IN → BOOKING phải nhập lại slot + sức chứa; → FREE xóa sạch phí / gói / giới hạn (audit ghi các trường phí về 0 / null)', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, walkInBody({ maxConcurrent: 40, monthlyPassFeeAdult: 450000, monthlyPassFeeChild: 280000 }));

      const noSlot = await service.updateAmenity(m, a._id, { accessMode: 'BOOKING' }).catch((e) => e);
      expect(fieldsOf(noSlot)).toEqual(['slotDurationMinutes', 'capacityPerSlot']);
      const booking = await service.updateAmenity(m, a._id, { accessMode: 'BOOKING', slotDurationMinutes: 60, capacityPerSlot: 1, feePerBooking: 80000 });
      expect(booking).toMatchObject({ accessMode: 'BOOKING', perVisitFeeAdult: 0, perVisitFeeChild: 0, maxConcurrent: null, feePerBooking: 80000 });

      const free = await service.updateAmenity(m, a._id, { accessMode: 'FREE' });
      expect(free).toMatchObject({
        accessMode: 'FREE',
        slotDurationMinutes: null,
        capacityPerSlot: null,
        feePerBooking: 0,
        monthlyPassFeeAdult: null,
        monthlyPassFeeChild: null,
        priceSummary: 'Miễn phí',
      });
      const logs = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).sort({ createdAt: 1 }).lean();
      expect(logs.at(-1).metadata.changes).toEqual({
        feePerBooking: [80000, 0],
        monthlyPassFeeAdult: [450000, null],
        monthlyPassFeeChild: [280000, null],
      });
    });

    it('đổi kiểu khi còn booking sắp tới → 409 AMENITY_HAS_ACTIVE_BOOKINGS, không đổi gì; gửi lại cùng kiểu thì không bị chặn; hết booking thì đổi được', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base());
      const apt = await createApartment();
      const upcoming = await makeBooking(a, apt, new Date(Date.now() + 2 * HOUR));

      await expect(service.updateAmenity(m, a._id, { accessMode: 'FREE' })).rejects.toMatchObject({ errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS', status: 409 });
      await expect(service.updateAmenity(m, a._id, { accessMode: 'WALK_IN', perVisitFeeAdult: 1, perVisitFeeChild: 1 })).rejects.toMatchObject({
        errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS',
      });
      expect(await Amenity.findById(a._id).lean()).toMatchObject({ accessMode: 'BOOKING', slotDurationMinutes: 60 });

      // Cùng kiểu + sửa trường khác: không phải đổi kiểu
      const same = await service.updateAmenity(m, a._id, { accessMode: 'BOOKING', location: 'Sân sau' });
      expect(same).toMatchObject({ accessMode: 'BOOKING', location: 'Sân sau' });

      await Booking.updateOne({ _id: upcoming._id }, { status: 'CANCELLED', cancelledAt: new Date() });
      expect((await service.updateAmenity(m, a._id, { accessMode: 'FREE' })).accessMode).toBe('FREE');
    });

    it('booking chen vào giữa lúc kiểm tra và lúc ghi → hoàn tác về kiểu cũ, vẫn báo AMENITY_HAS_ACTIVE_BOOKINGS', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base({ feePerBooking: 70000 }));
      const apt = await createApartment();
      const realExists = Booking.exists.bind(Booking);
      let calls = 0;
      vi.spyOn(Booking, 'exists').mockImplementation(async (...args) => {
        const res = await realExists(...args);
        calls += 1;
        if (calls === 1) await makeBooking(a, apt, new Date(Date.now() + HOUR));
        return res;
      });
      await expect(service.updateAmenity(m, a._id, { accessMode: 'FREE' })).rejects.toMatchObject({ errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS' });
      expect(await Amenity.findById(a._id).lean()).toMatchObject({ accessMode: 'BOOKING', slotDurationMinutes: 60, capacityPerSlot: 1, feePerBooking: 70000 });
      expect(await AuditLog.countDocuments()).toBe(0);
    });
  });

  describe('BR-O19 — ngừng / kích hoạt', () => {
    it('ngừng bị chặn khi còn booking sắp tới (APPROVED / CHECKED_IN); hủy booking đó rồi thì ngừng được, kích hoạt lại được', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base());
      const apt = await createApartment();
      const upcoming = await makeBooking(a, apt, new Date(Date.now() + 2 * HOUR));

      await expect(service.setAmenityStatus(a._id, false)).rejects.toMatchObject({ errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS', status: 409 });
      expect((await Amenity.findById(a._id)).isActive).toBe(true);

      await Booking.updateOne({ _id: upcoming._id }, { status: 'CHECKED_IN' });
      await expect(service.setAmenityStatus(a._id, false)).rejects.toMatchObject({ errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS' });

      await Booking.updateOne({ _id: upcoming._id }, { status: 'CANCELLED', cancelledAt: new Date() });
      expect((await service.setAmenityStatus(a._id, false)).isActive).toBe(false);
      expect((await service.setAmenityStatus(a._id, true)).isActive).toBe(true);
    });

    it('booking đã qua giờ kết thúc / đã hoàn tất / không đến / luồng cũ PENDING không chặn ngừng', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base());
      const apt = await createApartment();
      await makeBooking(a, apt, new Date(Date.now() - 3 * HOUR)); // APPROVED nhưng đã kết thúc
      await makeBooking(a, apt, new Date(Date.now() + HOUR), { status: 'COMPLETED' });
      await makeBooking(a, apt, new Date(Date.now() + HOUR), { status: 'NO_SHOW' });
      await makeBooking(a, apt, new Date(Date.now() + HOUR), { status: 'PENDING' });
      expect((await service.setAmenityStatus(a._id, false)).isActive).toBe(false);
    });

    it('booking chen vào giữa lúc kiểm tra và lúc ghi → hoàn tác, vẫn báo AMENITY_HAS_ACTIVE_BOOKINGS', async () => {
      const m = asUser(await createManager());
      const a = await service.createAmenity(m, base());
      const apt = await createApartment();
      const realExists = Booking.exists.bind(Booking);
      let calls = 0;
      vi.spyOn(Booking, 'exists').mockImplementation(async (...args) => {
        const res = await realExists(...args);
        calls += 1;
        if (calls === 1) await makeBooking(a, apt, new Date(Date.now() + HOUR));
        return res;
      });
      await expect(service.setAmenityStatus(a._id, false)).rejects.toMatchObject({ errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS' });
      expect((await Amenity.findById(a._id)).isActive).toBe(true);
    });

    it('id không tồn tại → NOT_FOUND', async () => {
      await expect(service.setAmenityStatus('0123456789abcdef01234567', false)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    });

    it('tiện ích FREE / WALK_IN không có booking → ngừng được ngay', async () => {
      const m = asUser(await createManager());
      const free = await service.createAmenity(m, freeBody());
      const walkIn = await service.createAmenity(m, walkInBody());
      expect((await service.setAmenityStatus(free._id, false)).isActive).toBe(false);
      expect((await service.setAmenityStatus(walkIn._id, false)).isActive).toBe(false);
    });
  });

  describe('danh sách / chi tiết', () => {
    it('cư dân thấy cả 3 kiểu (FREE để biết giờ và vị trí), kèm accessMode + priceSummary; chỉ tiện ích đang hoạt động, dùng chung hoặc của tòa mình; Lễ tân & Manager thấy tất cả', async () => {
      const m = asUser(await createManager());
      const h = await createHousehold(); // cư dân ở tòa h.building
      const other = await createBuilding();
      const shared = await service.createAmenity(m, base({ name: 'Gym chung' }));
      const park = await service.createAmenity(m, freeBody({ name: 'Công viên', location: 'Trung tâm khu', openTime: '05:00', closeTime: '22:00' }));
      const pool = await service.createAmenity(m, walkInBody({ name: 'Hồ bơi' }));
      const mine = await service.createAmenity(m, base({ name: 'BBQ tòa mình', buildingId: String(h.building._id) }));
      const notMine = await service.createAmenity(m, base({ name: 'BBQ tòa khác', buildingId: String(other._id) }));
      const stopped = await service.createAmenity(m, freeBody({ name: 'Sân chơi ngừng' }));
      await service.setAmenityStatus(stopped._id, false);

      const resident = asUser(h.user);
      const list = await service.listAmenities(resident, { page: 1, limit: 50, sort: 'name' });
      expect(list.items.map((a) => a.name)).toEqual(['BBQ tòa mình', 'Công viên', 'Gym chung', 'Hồ bơi']);
      expect(list.items.map((a) => a.accessMode)).toEqual(['BOOKING', 'FREE', 'BOOKING', 'WALK_IN']);
      const parkItem = list.items.find((a) => a.name === 'Công viên');
      expect(parkItem).toMatchObject({ location: 'Trung tâm khu', openTime: '05:00', closeTime: '22:00', priceSummary: 'Miễn phí' });
      expect(list.items.find((a) => a.name === 'Hồ bơi').priceSummary).toBe('Người lớn 50.000 đ · Trẻ em 30.000 đ / lượt');
      // Cố lọc isActive=false hay tòa khác cũng không lộ thêm
      expect((await service.listAmenities(resident, { page: 1, limit: 50, sort: 'name', isActive: false })).items).toHaveLength(4);
      expect((await service.listAmenities(resident, { page: 1, limit: 50, sort: 'name', buildingId: String(other._id) })).items).toHaveLength(0);
      // Lọc theo kiểu
      expect((await service.listAmenities(resident, { page: 1, limit: 50, sort: 'name', accessMode: 'FREE' })).items.map((a) => a.name)).toEqual(['Công viên']);

      expect((await service.getAmenity(resident, mine._id)).name).toBe('BBQ tòa mình');
      expect((await service.getAmenity(resident, shared._id)).buildingId).toBeNull();
      expect(await service.getAmenity(resident, park._id)).toMatchObject({ accessMode: 'FREE', priceSummary: 'Miễn phí' });
      expect((await service.getAmenity(resident, pool._id)).accessMode).toBe('WALK_IN');
      await expect(service.getAmenity(resident, notMine._id)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
      await expect(service.getAmenity(resident, stopped._id)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });

      const recep = asUser(await createReceptionist());
      expect((await service.listAmenities(recep, { page: 1, limit: 50, sort: 'name' })).pagination.total).toBe(6);
      expect((await service.listAmenities(m, { page: 1, limit: 50, sort: 'name', isActive: false })).items.map((a) => a.name)).toEqual(['Sân chơi ngừng']);
      const withBuilding = await service.getAmenity(m, mine._id);
      expect(withBuilding.buildingId.name).toBe(h.building.name);
    });

    it('bản ghi cũ chưa có accessMode đọc ra là BOOKING (lọc BOOKING lấy cả bản ghi cũ), sửa phí vẫn được', async () => {
      const m = asUser(await createManager());
      await Amenity.collection.insertOne({
        name: 'Hồ bơi cũ',
        openTime: '08:00',
        closeTime: '17:00',
        slotDurationMinutes: 60,
        capacityPerSlot: 20,
        feePerBooking: 50000,
        isActive: true,
        buildingId: null,
      });
      await service.createAmenity(m, walkInBody({ name: 'Gym' }));

      const all = await service.listAmenities(m, { page: 1, limit: 50, sort: 'name' });
      const legacy = all.items.find((a) => a.name === 'Hồ bơi cũ');
      expect(legacy).toMatchObject({ accessMode: 'BOOKING', perVisitFeeAdult: 0, monthlyPassFeeAdult: null, priceSummary: '50.000 đ / lượt đặt' });
      expect((await service.listAmenities(m, { page: 1, limit: 50, sort: 'name', accessMode: 'BOOKING' })).items.map((a) => a.name)).toEqual(['Hồ bơi cũ']);
      expect((await service.listAmenities(m, { page: 1, limit: 50, sort: 'name', accessMode: 'WALK_IN' })).items.map((a) => a.name)).toEqual(['Gym']);

      const updated = await service.updateAmenity(m, legacy._id, { feePerBooking: 60000 });
      expect(updated).toMatchObject({ accessMode: 'BOOKING', feePerBooking: 60000 });
      const [log] = await AuditLog.find({ action: 'AMENITY_FEE_CHANGED' }).lean();
      expect(log.metadata.changes).toEqual({ feePerBooking: [50000, 60000] });
    });

    it('tòa không tồn tại → VALIDATION_ERROR; buildingId rỗng → dùng chung toàn khu', async () => {
      const m = asUser(await createManager());
      await expect(service.createAmenity(m, base({ buildingId: '0123456789abcdef01234567' }))).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      const b = await createBuilding();
      const a = await service.createAmenity(m, base({ buildingId: String(b._id) }));
      const shared = await service.updateAmenity(m, a._id, { buildingId: '' });
      expect(shared.buildingId).toBeNull();
    });
  });

  describe('routes — phân quyền & validate', () => {
    const app = createApp();
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const post = (user, fields, image) => {
      let req = request(app).post('/api/amenities').set('Authorization', `Bearer ${tokenFor(user)}`);
      Object.entries(fields).forEach(([k, v]) => (req = req.field(k, String(v))));
      if (image) req = req.attach('image', image, { filename: 'gym.png', contentType: 'image/png' });
      return req;
    };

    it('Manager POST multipart kèm ảnh → 201 (số chuỗi được convert); Lễ tân POST → 403; không token → 401; thiếu capacityPerSlot → 400', async () => {
      const manager = await createManager();
      const res = await post(manager, base(), PNG);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        accessMode: 'BOOKING',
        capacityPerSlot: 1,
        slotDurationMinutes: 60,
        feePerBooking: 0,
        imageUrl: 'https://cdn.test/amenities/gym.png',
        priceSummary: 'Miễn phí đặt chỗ',
      });

      expect((await post(await createReceptionist(), base({ name: 'Khác' }))).status).toBe(403);
      expect((await request(app).post('/api/amenities').field('name', 'A')).status).toBe(401);

      const missing = base({ name: 'Thiếu' });
      delete missing.capacityPerSlot;
      const bad = await post(manager, missing);
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d) => d.field)).toContain('capacityPerSlot');
    });

    it('POST FREE chỉ tên + kiểu → 201; gửi kèm phí / slot bị bỏ qua; giờ 03:00–23:30 hợp lệ; chỉ 1 giờ → 400', async () => {
      const manager = await createManager();
      const res = await post(manager, freeBody());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ accessMode: 'FREE', openTime: null, feePerBooking: 0, slotDurationMinutes: null, priceSummary: 'Miễn phí' });

      const ignored = await post(manager, freeBody({ name: 'Sân chơi', feePerBooking: 50000, slotDurationMinutes: 60, perVisitFeeAdult: 9000, openTime: '03:00', closeTime: '23:30' }));
      expect(ignored.status).toBe(201);
      expect(ignored.body.data).toMatchObject({ feePerBooking: 0, slotDurationMinutes: null, perVisitFeeAdult: 0, openTime: '03:00', closeTime: '23:30' });

      const half = await post(manager, freeBody({ name: 'Nửa giờ', openTime: '06:00' }));
      expect(half.status).toBe(400);
      expect(half.body.details.map((d) => d.field)).toEqual(['closeTime']);
    });

    it('POST WALK_IN: hợp lệ → 201; thiếu giá vé / giờ → 400 theo field; 04:30 → 400 (BR-O15); kiểu sai → 400', async () => {
      const manager = await createManager();
      const ok = await post(manager, walkInBody({ maxConcurrent: 40, monthlyPassFeeAdult: 450000, monthlyPassFeeChild: 280000 }));
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ accessMode: 'WALK_IN', maxConcurrent: 40, perVisitFeeChild: 30000, slotDurationMinutes: null });

      const noFee = walkInBody({ name: 'Thiếu giá' });
      delete noFee.perVisitFeeChild;
      const r1 = await post(manager, noFee);
      expect(r1.status).toBe(400);
      expect(r1.body.details.map((d) => d.field)).toEqual(['perVisitFeeChild']);

      const noHours = walkInBody({ name: 'Thiếu giờ' });
      delete noHours.openTime;
      delete noHours.closeTime;
      const r2 = await post(manager, noHours);
      expect(r2.status).toBe(400);
      expect(r2.body.details.map((d) => d.field)).toEqual(['openTime', 'closeTime']);

      const early = await post(manager, walkInBody({ name: 'Quá sớm', openTime: '04:30' }));
      expect(early.status).toBe(400);
      expect(early.body.details).toEqual([{ field: 'openTime', message: 'Giờ mở cửa không được sớm hơn giờ lễ tân bắt đầu làm việc (05:00)' }]);

      expect((await post(manager, walkInBody({ name: 'Kiểu sai', accessMode: 'VIP' }))).status).toBe(400);
      expect((await post(manager, walkInBody({ name: 'Giá âm', perVisitFeeAdult: -1 }))).status).toBe(400);
      expect((await post(manager, walkInBody({ name: 'Giới hạn 0', maxConcurrent: 0 }))).status).toBe(400);
      const halfPass = await post(manager, walkInBody({ name: 'Gói lẻ', monthlyPassFeeAdult: 400000 }));
      expect(halfPass.status).toBe(400);
      expect(halfPass.body.details.map((d) => d.field)).toEqual(['monthlyPassFeeChild']);
      expect(await Amenity.countDocuments()).toBe(1);
    });

    it('validate BOOKING: giờ sai định dạng, slot < 15, phí âm/lẻ, giá gói âm, 2 ảnh → 400; BR-O15 qua HTTP trả details theo field', async () => {
      const manager = await createManager();
      expect((await post(manager, base({ openTime: '8h' }))).status).toBe(400);
      expect((await post(manager, base({ slotDurationMinutes: 10 }))).status).toBe(400);
      expect((await post(manager, base({ feePerBooking: -1 }))).status).toBe(400);
      expect((await post(manager, base({ feePerBooking: 1.5 }))).status).toBe(400);
      expect((await post(manager, base({ monthlyPassFeeAdult: -5, monthlyPassFeeChild: 1 }))).status).toBe(400);
      let twoImages = post(manager, base()).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      twoImages = twoImages.attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
      expect((await twoImages).status).toBe(400);

      const early = await post(manager, base({ openTime: '04:30' }));
      expect(early.status).toBe(400);
      expect(early.body.details).toEqual([{ field: 'openTime', message: 'Giờ mở cửa không được sớm hơn giờ lễ tân bắt đầu làm việc (05:00)' }]);
      expect(await Amenity.countDocuments()).toBe(0);
    });

    it('GET: Manager / Lễ tân / Cư dân 200 (mặc định 50/trang, sắp theo tên, có priceSummary); lọc accessMode; KTV 403; không token 401', async () => {
      const m = await createManager();
      const h = await createHousehold();
      await service.createAmenity(asUser(m), base({ name: 'Yoga', accessMode: 'BOOKING' }));
      await service.createAmenity(asUser(m), freeBody({ name: 'Bida' }));

      const list = await request(app).get('/api/amenities').set(auth(m));
      expect(list.status).toBe(200);
      expect(list.body.pagination.limit).toBe(50);
      expect(list.body.data.map((a) => a.name)).toEqual(['Bida', 'Yoga']);
      expect(list.body.data[0]).toMatchObject({ accessMode: 'FREE', priceSummary: 'Miễn phí' });
      const free = await request(app).get('/api/amenities?accessMode=FREE').set(auth(m));
      expect(free.body.data.map((a) => a.name)).toEqual(['Bida']);
      expect((await request(app).get('/api/amenities?accessMode=VIP').set(auth(m))).status).toBe(400);
      expect((await request(app).get('/api/amenities').set(auth(await createReceptionist()))).status).toBe(200);
      const asResident = await request(app).get('/api/amenities').set(auth(h.user));
      expect(asResident.status).toBe(200);
      expect(asResident.body.data.map((a) => a.accessMode)).toEqual(['FREE', 'BOOKING']); // cư dân thấy cả FREE
      expect((await request(app).get('/api/amenities').set(auth(await createTechnician()))).status).toBe(403);
      expect((await request(app).get('/api/amenities')).status).toBe(401);
      expect((await request(app).get('/api/amenities?sort=password').set(auth(m))).status).toBe(400);
    });

    it('GET chi tiết: cư dân xem tiện ích FREE → 200; id sai định dạng → 400; không có → 404; KTV 403', async () => {
      const m = await createManager();
      const h = await createHousehold();
      const park = await service.createAmenity(asUser(m), freeBody());
      const res = await request(app).get(`/api/amenities/${park._id}`).set(auth(h.user));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ accessMode: 'FREE', priceSummary: 'Miễn phí' });
      expect((await request(app).get('/api/amenities/abc').set(auth(m))).status).toBe(400);
      expect((await request(app).get('/api/amenities/0123456789abcdef01234567').set(auth(m))).status).toBe(404);
      expect((await request(app).get(`/api/amenities/${park._id}`).set(auth(await createTechnician()))).status).toBe(403);
      expect((await request(app).get(`/api/amenities/${park._id}`)).status).toBe(401);
    });

    it('PUT / PATCH status: chỉ Manager; Lễ tân 403; isActive thiếu → 400; ngừng khi có booking sắp tới → 409', async () => {
      const manager = await createManager();
      const recep = await createReceptionist();
      const a = await Amenity.create(base());

      const put = await request(app).put(`/api/amenities/${a._id}`).set(auth(manager)).field('feePerBooking', '20000');
      expect(put.status).toBe(200);
      expect(put.body.data.feePerBooking).toBe(20000);
      expect((await request(app).put(`/api/amenities/${a._id}`).set(auth(recep)).field('name', 'Đổi tên')).status).toBe(403);
      expect((await request(app).put(`/api/amenities/${a._id}`).field('name', 'Đổi tên')).status).toBe(401);

      expect((await request(app).patch(`/api/amenities/${a._id}/status`).set(auth(recep)).send({ isActive: false })).status).toBe(403);
      expect((await request(app).patch(`/api/amenities/${a._id}/status`).set(auth(manager)).send({})).status).toBe(400);

      await makeBooking(a, await createApartment(), new Date(Date.now() + HOUR));
      const blocked = await request(app).patch(`/api/amenities/${a._id}/status`).set(auth(manager)).send({ isActive: false });
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe('AMENITY_HAS_ACTIVE_BOOKINGS');
    });

    it('PUT đổi kiểu: còn booking sắp tới → 409; thiếu trường kiểu mới → 400; hợp lệ → 200 và xóa gói tháng bằng chuỗi rỗng', async () => {
      const manager = await createManager();
      const a = await service.createAmenity(asUser(manager), base({ monthlyPassFeeAdult: 600000, monthlyPassFeeChild: 350000 }));
      const booking = await makeBooking(a, await createApartment(), new Date(Date.now() + HOUR));

      const blocked = await request(app).put(`/api/amenities/${a._id}`).set(auth(manager)).field('accessMode', 'FREE');
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe('AMENITY_HAS_ACTIVE_BOOKINGS');

      await Booking.updateOne({ _id: booking._id }, { status: 'CANCELLED' });
      const missing = await request(app).put(`/api/amenities/${a._id}`).set(auth(manager)).field('accessMode', 'WALK_IN');
      expect(missing.status).toBe(400);
      expect(missing.body.details.map((d) => d.field)).toEqual(['perVisitFeeAdult', 'perVisitFeeChild']);

      const ok = await request(app)
        .put(`/api/amenities/${a._id}`)
        .set(auth(manager))
        .field('accessMode', 'WALK_IN')
        .field('perVisitFeeAdult', '50000')
        .field('perVisitFeeChild', '30000')
        .field('monthlyPassFeeAdult', '')
        .field('monthlyPassFeeChild', '');
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ accessMode: 'WALK_IN', monthlyPassFeeAdult: null, monthlyPassFeeChild: null, slotDurationMinutes: null });
    });
  });
});
