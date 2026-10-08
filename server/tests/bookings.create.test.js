// Module D — UC-D06: lưới slot, đặt tiện ích BOOKING (tự xác nhận), lịch sử, hủy (đặt chạy trong MongoDB transaction → replica set)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createApartment,
  createBuilding,
  createManager,
  createReceptionist,
  createResident,
  createSecurity,
  createTechnician,
  linkResident,
  tokenFor,
} from './helpers/fixtures.js';

const { createApp } = await import('../src/app.js');
const bookings = await import('../src/modules/bookings/bookings.service.js');
const codes = await import('../src/modules/memberCodes/memberCodes.service.js');
const { Amenity, AmenityPass, Booking, Invoice, MemberCode, Notification } = await import('../src/models/index.js');
const { toVnYmd, vnDayStart, atTime } = await import('../src/modules/amenities/slot.utils.js');
const { vnPeriod } = await import('../src/utils/time.js');

const DAY = 86400e3;
const HOUR = 3600e3;
const app = createApp();
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });
const tomorrow = () => toVnYmd(new Date(Date.now() + DAY));
const inDays = (n) => toVnYmd(new Date(Date.now() + n * DAY));

const TENNIS = {
  name: 'Sân tennis',
  accessMode: 'BOOKING',
  openTime: '05:00',
  closeTime: '22:00',
  slotDurationMinutes: 60,
  capacityPerSlot: 1,
  feePerBooking: 100000,
  monthlyPassFeeAdult: 600000,
  monthlyPassFeeChild: 350000,
};
const makeAmenity = (extra = {}) => Amenity.create({ ...TENNIS, ...extra });

async function makeApartment({ buildingCode = 'A', code = '0501', status = 'OWNED' } = {}) {
  const building = await createBuilding({ code: buildingCode, name: `Tòa ${buildingCode}` });
  const apartment = await createApartment(building, { code, status });
  return { building, apartment };
}

async function addPerson(apartment, relationType, name, moveIn = 10) {
  const user = await createResident({ fullName: name });
  const row = await linkResident(user, apartment, { relationType, moveInDate: new Date(Date.now() - moveIn * DAY) });
  return { user, row };
}

/** Hộ mẫu: chủ hộ + vợ (thành viên, chưa được phát sinh phí) */
async function makeFamily(opts) {
  const ctx = await makeApartment(opts);
  const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ hộ', 100);
  const spouse = await addPerson(ctx.apartment, 'FAMILY_MEMBER', 'Vợ', 90);
  await codes.ensureCodes(ctx.apartment._id);
  return { ...ctx, owner, spouse };
}

/** Thêm căn có đúng 1 chủ hộ trong tòa đã có */
async function makeSoloApartment(building, code) {
  const apartment = await createApartment(building, { code, status: 'OWNED' });
  const owner = await addPerson(apartment, 'OWNER', `Chủ ${code}`);
  return { apartment, owner, building };
}

const book = (user, family, amenity, slotStart = '10:00', date = tomorrow()) =>
  request(app)
    .post('/api/bookings')
    .set(auth(user))
    .send({ apartmentId: String(family.apartment._id), amenityId: String(amenity._id), date, slotStart });

const rawBooking = (family, amenity, startAt, extra = {}) =>
  Booking.create({
    amenityId: amenity._id,
    apartmentId: family.apartment._id,
    date: vnDayStart(toVnYmd(startAt)),
    slotStart: '10:00',
    slotEnd: '11:00',
    startAt,
    endAt: new Date(startAt.getTime() + HOUR),
    fee: 100000,
    bookedBy: family.owner.user._id,
    ...extra,
  });

const giveInvoice = (family, status = 'OVERDUE', extra = {}) =>
  Invoice.create({
    code: `HD-T-${Math.random().toString(36).slice(2, 8)}`,
    apartmentId: family.apartment._id,
    buildingId: family.building._id,
    period: '2020-01',
    items: [{ feeCategory: 'CLEANING', description: 'Phí vệ sinh', unitPrice: 1, amount: 1 }],
    totalAmount: 1,
    status,
    issuedAt: new Date(Date.now() - 40 * DAY),
    dueDate: new Date(Date.now() - 10 * DAY),
    ...extra,
  });

const giveActivePass = (user, family, amenity, date) =>
  AmenityPass.create({
    userId: user._id,
    apartmentId: family.apartment._id,
    amenityId: amenity._id,
    month: vnPeriod(vnDayStart(date)),
    ageGroup: 'ADULT',
    fee: 600000,
    purchasedBy: user._id,
  });

describe('bookings — đặt tiện ích (UC-D06)', () => {
  beforeAll(() => connectTestDB({ replSet: true }), 120000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  describe('đặt thành công', () => {
    it('chủ hộ đặt → 201 APPROVED, phí snapshot, startAt/endAt đúng giờ VN, bookedBy, thông báo cho người đặt; khóa tiện ích tăng lockVersion', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const date = tomorrow();
      const res = await book(f.owner.user, f, tennis, '10:00', date);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'APPROVED',
        fee: 100000,
        slotStart: '10:00',
        slotEnd: '11:00',
        passId: null,
        createdByStaff: null,
        amenity: { name: 'Sân tennis' },
      });
      const saved = await Booking.findById(res.body.data._id).lean();
      expect(saved.startAt.toISOString()).toBe(new Date(`${date}T10:00:00+07:00`).toISOString());
      expect(saved.endAt.toISOString()).toBe(new Date(`${date}T11:00:00+07:00`).toISOString());
      expect(saved.date.toISOString()).toBe(new Date(`${date}T00:00:00+07:00`).toISOString());
      expect(String(saved.bookedBy)).toBe(String(f.owner.user._id));
      expect(String(saved.apartmentId)).toBe(String(f.apartment._id));
      expect((await Amenity.findById(tennis._id).lean()).lockVersion).toBe(1);

      const notis = await Notification.find({ userId: f.owner.user._id }).lean();
      expect(notis).toHaveLength(1);
      expect(notis[0].content).toContain('Sân tennis');
      expect(notis[0].content).toContain('10:00–11:00');
      expect(notis[0].content).toContain('Phí 100.000 đ');

      // Đổi bảng giá sau đó không ảnh hưởng booking đã đặt (BR-O13)
      await Amenity.updateOne({ _id: tennis._id }, { feePerBooking: 250000 });
      expect((await Booking.findById(saved._id).lean()).fee).toBe(100000);
    });

    it('có gói tháng còn hiệu lực ngày đó → phí 0, ghi passId, thông báo "theo gói tháng"; gói của tháng khác không dùng được', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const date = tomorrow();
      const pass = await giveActivePass(f.owner.user, f, tennis, date);
      const res = await book(f.owner.user, f, tennis, '10:00', date);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ fee: 0, passId: String(pass._id) });
      expect((await Notification.findOne({ userId: f.owner.user._id }).lean()).content).toContain('Miễn phí theo gói tháng');

      // Gói tháng sau không áp cho ngày ở tháng này: đặt 10 ngày tới nằm tháng khác hoặc cùng tháng tùy ngày chạy → dùng gói CANCELLED để chắc chắn
      await AmenityPass.updateOne({ _id: pass._id }, { status: 'CANCELLED' });
      const noPass = await book(f.owner.user, f, tennis, '11:00', date);
      expect(noPass.body.data).toMatchObject({ fee: 100000, passId: null });
    });

    it('tiện ích phí/lượt 0 → đặt miễn phí; thành viên chưa được phát sinh phí vẫn đặt được', async () => {
      const f = await makeFamily();
      const free = await makeAmenity({ name: 'Sân cầu lông', feePerBooking: 0 });
      const res = await book(f.spouse.user, f, free);
      expect(res.status).toBe(201);
      expect(res.body.data.fee).toBe(0);
    });
  });

  describe('quyền phát sinh phí (BR-O26) và quyền đặt', () => {
    it('thành viên chưa được bật quyền + slot có phí → 403 CHARGE_NOT_ALLOWED; chỉ gói CỦA MÌNH mới đưa phí về 0; bật quyền thì đặt được slot có phí; chủ hộ luôn được', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const date = tomorrow();
      const denied = await book(f.spouse.user, f, tennis, '10:00', date);
      expect(denied.status).toBe(403);
      expect(denied.body.errorCode).toBe('CHARGE_NOT_ALLOWED');
      expect(await Booking.countDocuments()).toBe(0);

      // Gói tháng của chủ hộ không giúp thành viên được đặt slot có phí
      await giveActivePass(f.owner.user, f, tennis, date);
      expect((await book(f.spouse.user, f, tennis, '10:00', date)).body.errorCode).toBe('CHARGE_NOT_ALLOWED');

      // Gói của chính thành viên → phí 0 → đặt được dù chưa có quyền phát sinh phí
      const spousePass = await giveActivePass(f.spouse.user, f, tennis, date);
      const withPass = await book(f.spouse.user, f, tennis, '10:00', date);
      expect(withPass.status).toBe(201);
      expect(withPass.body.data).toMatchObject({ fee: 0, passId: String(spousePass._id) });

      // Hết gói + chủ hộ bật quyền → đặt slot có phí được
      await AmenityPass.updateOne({ _id: spousePass._id }, { status: 'CANCELLED' });
      await MemberCode.updateOne({ userId: f.spouse.user._id, isActive: true }, { canIncurCharges: true });
      const allowed = await book(f.spouse.user, f, tennis, '12:00', date);
      expect(allowed.status).toBe(201);
      expect(allowed.body.data).toMatchObject({ fee: 100000, passId: null });
    });

    it('chủ hộ luôn đặt được slot có phí (không cần canIncurCharges)', async () => {
      const f = await makeFamily();
      const res = await book(f.owner.user, f, await makeAmenity());
      expect(res.status).toBe(201);
      expect(res.body.data.fee).toBe(100000);
    });

    it('chủ sở hữu "không ở" (căn đang cho thuê) → 403, người thuê đặt được; người ngoài hộ → 403; Lễ tân / Bảo vệ / KTV / Trưởng BQL → 403; không token → 401', async () => {
      const ctx = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ sở hữu', 300);
      const tenant = await addPerson(ctx.apartment, 'TENANT', 'Người thuê', 30);
      const family = { ...ctx };
      const tennis = await makeAmenity();
      const asOwner = await book(owner.user, family, tennis);
      expect(asOwner.status).toBe(403);
      expect(asOwner.body.errorCode).toBe('FORBIDDEN_ROLE');
      expect((await book(await createResident(), family, tennis)).status).toBe(403);
      for (const user of [await createReceptionist(), await createSecurity(), await createTechnician(), await createManager()]) {
        expect((await book(user, family, tennis)).status).toBe(403);
      }
      expect((await request(app).post('/api/bookings').send({})).status).toBe(401);
      expect((await book(tenant.user, family, tennis)).status).toBe(201);
      expect(await Booking.countDocuments()).toBe(1);
    });
  });

  describe('kiểm tra tiện ích', () => {
    it('WALK_IN / FREE → 409 AMENITY_NOT_BOOKABLE (cả đặt lẫn lưới slot); đã ngừng → 409 AMENITY_INACTIVE; không tồn tại / tòa khác → 404', async () => {
      const f = await makeFamily();
      const walkIn = await Amenity.create({ name: 'Gym', accessMode: 'WALK_IN', openTime: '05:00', closeTime: '22:00', perVisitFeeAdult: 5, perVisitFeeChild: 3 });
      const free = await Amenity.create({ name: 'Công viên', accessMode: 'FREE' });
      for (const a of [walkIn, free]) {
        const res = await book(f.owner.user, f, a);
        expect(res.status).toBe(409);
        expect(res.body.errorCode).toBe('AMENITY_NOT_BOOKABLE');
        const slots = await request(app).get(`/api/amenities/${a._id}/slots?date=${tomorrow()}`).set(auth(f.owner.user));
        expect(slots.status).toBe(409);
        expect(slots.body.errorCode).toBe('AMENITY_NOT_BOOKABLE');
      }
      const stopped = await makeAmenity({ name: 'Sân ngừng', isActive: false });
      const inactive = await book(f.owner.user, f, stopped);
      expect(inactive.status).toBe(409);
      expect(inactive.body.errorCode).toBe('AMENITY_INACTIVE');
      expect((await book(f.owner.user, f, { _id: '0123456789abcdef01234567' })).status).toBe(404);
      const other = await createBuilding({ code: 'Z', name: 'Tòa Z' });
      const elsewhere = await makeAmenity({ name: 'BBQ tòa Z', buildingId: other._id });
      expect((await book(f.owner.user, f, elsewhere)).status).toBe(404);
      const sameBuilding = await makeAmenity({ name: 'BBQ tòa A', buildingId: f.building._id });
      expect((await book(f.owner.user, f, sameBuilding)).status).toBe(201);
    });
  });

  describe('slot / ngày', () => {
    it('slot không khớp lưới, ngày đã qua, ngày > 14, ngày không có thật, sai định dạng → 400 theo field', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const off = await book(f.owner.user, f, tennis, '10:30');
      expect(off.status).toBe(400);
      expect(off.body.details).toEqual([{ field: 'slotStart', message: 'Khung giờ không khớp lưới của tiện ích' }]);
      expect((await book(f.owner.user, f, tennis, '10:00', inDays(-1))).body.details[0].field).toBe('date');
      const far = await book(f.owner.user, f, tennis, '10:00', inDays(15));
      expect(far.status).toBe(400);
      expect(far.body.details).toEqual([{ field: 'date', message: 'Chỉ đặt trước tối đa 14 ngày' }]);
      expect((await book(f.owner.user, f, tennis, '10:00', '2026-02-31')).status).toBe(400);
      expect((await book(f.owner.user, f, tennis, '10:00', '08/10/2026')).status).toBe(400);
      expect((await book(f.owner.user, f, tennis, '23:00')).status).toBe(400); // ngoài giờ mở cửa
      expect((await book(f.owner.user, f, tennis, '10:00', inDays(14))).status).toBe(201); // đúng ngày thứ 14 vẫn được
      expect(await Booking.countDocuments()).toBe(1);
    });

    it('slot đã qua (quá startAt + thời gian cho phép check-in) → 400; còn trong thời gian cho phép thì được (service, giờ cố định)', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const user = asUser(f.owner.user);
      const body = { apartmentId: String(f.apartment._id), amenityId: String(tennis._id), date: '2026-10-08', slotStart: '10:00' };
      const at = (hhmm) => new Date(`2026-10-08T${hhmm}:00+07:00`);
      await expect(bookings.createBooking(user, body, { now: at('10:15') })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', details: [{ field: 'slotStart', message: 'Khung giờ đã qua' }] });
      const late = await bookings.createBooking(user, body, { now: at('10:14') }); // NO_SHOW_GRACE_MINUTES = 15 → còn đặt được
      expect(late.slotStart).toBe('10:00');
    });
  });

  describe('chặn nợ quá hạn và giới hạn booking', () => {
    it('căn có hóa đơn OVERDUE hoặc UNPAID quá hạn → 409 BOOKING_APARTMENT_OVERDUE', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const invoice = await giveInvoice(f, 'OVERDUE');
      const blocked = await book(f.owner.user, f, tennis);
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe('BOOKING_APARTMENT_OVERDUE');
      await Invoice.updateOne({ _id: invoice._id }, { status: 'UNPAID' });
      expect((await book(f.owner.user, f, tennis)).body.errorCode).toBe('BOOKING_APARTMENT_OVERDUE');
      await Invoice.updateOne({ _id: invoice._id }, { status: 'PAID' });
      expect((await book(f.owner.user, f, tennis)).status).toBe(201);
    });

    it('đủ 2 booking chưa dùng → 409 BOOKING_LIMIT_EXCEEDED; CANCELLED / NO_SHOW / COMPLETED / đã kết thúc không tính; hủy 1 booking thì đặt lại được', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const future = (n) => new Date(Date.now() + n * DAY);
      // Các booking không tính vào giới hạn
      for (const status of ['CANCELLED', 'NO_SHOW', 'COMPLETED']) await rawBooking(f, tennis, future(1 + Math.random()), { status });
      await rawBooking(f, tennis, new Date(Date.now() - 5 * HOUR)); // APPROVED nhưng đã kết thúc (chờ cron NO_SHOW/COMPLETED)

      const first = await book(f.owner.user, f, tennis, '08:00');
      const second = await book(f.owner.user, f, tennis, '09:00');
      expect([first.status, second.status]).toEqual([201, 201]);
      const third = await book(f.owner.user, f, tennis, '10:00');
      expect(third.status).toBe(409);
      expect(third.body.errorCode).toBe('BOOKING_LIMIT_EXCEEDED');
      // Thành viên cùng căn dùng chung giới hạn của căn
      expect((await book(f.spouse.user, f, tennis, '11:00')).body.errorCode).toBe('BOOKING_LIMIT_EXCEEDED');

      await request(app).patch(`/api/bookings/${first.body.data._id}/cancel`).set(auth(f.owner.user)).send({});
      expect((await book(f.owner.user, f, tennis, '10:00')).status).toBe(201);
    });

    it('CHECKED_IN vẫn tính vào giới hạn', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      await rawBooking(f, tennis, new Date(Date.now() - 10 * 60e3), { status: 'CHECKED_IN', endAt: new Date(Date.now() + 50 * 60e3) });
      await rawBooking(f, tennis, new Date(Date.now() + 3 * HOUR));
      expect((await book(f.owner.user, f, tennis, '10:00')).body.errorCode).toBe('BOOKING_LIMIT_EXCEEDED');
    });
  });

  describe('sức chứa và đồng thời', () => {
    it('căn đã đặt slot này → BOOKING_SLOT_CONFLICT; slot đầy (sức chứa 1) → 409; hủy rồi đặt lại được', async () => {
      const f = await makeFamily();
      const other = await makeSoloApartment(f.building, '0502');
      const tennis = await makeAmenity();
      const mine = await book(f.owner.user, f, tennis, '10:00');
      expect(mine.status).toBe(201);
      const again = await book(f.owner.user, f, tennis, '10:00');
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe('BOOKING_SLOT_CONFLICT');
      const full = await book(other.owner.user, other, tennis, '10:00');
      expect(full.status).toBe(409);
      expect(full.body.errorCode).toBe('BOOKING_SLOT_CONFLICT');
      await request(app).patch(`/api/bookings/${mine.body.data._id}/cancel`).set(auth(f.owner.user)).send({});
      expect((await book(other.owner.user, other, tennis, '10:00')).status).toBe(201);
    });

    it('slot sức chứa 2: 2 căn đặt được, căn thứ 3 hết chỗ; CANCELLED không chiếm chỗ', async () => {
      const f = await makeFamily();
      const b = await makeSoloApartment(f.building, '0502');
      const c = await makeSoloApartment(f.building, '0503');
      const bbq = await makeAmenity({ name: 'Khu BBQ', capacityPerSlot: 2 });
      expect((await book(f.owner.user, f, bbq)).status).toBe(201);
      const second = await book(b.owner.user, b, bbq);
      expect(second.status).toBe(201);
      expect((await book(c.owner.user, c, bbq)).status).toBe(409);
      await Booking.updateOne({ _id: second.body.data._id }, { status: 'CANCELLED' });
      expect((await book(c.owner.user, c, bbq)).status).toBe(201);
    });

    it('6 căn đặt đồng thời slot sức chứa 2 → đúng 2 thành công, 4 còn lại BOOKING_SLOT_CONFLICT, DB chỉ có 2 booking', async () => {
      const building = await createBuilding({ code: 'A', name: 'Tòa A' });
      const solos = [];
      for (const code of ['0101', '0102', '0103', '0104', '0105', '0106']) solos.push(await makeSoloApartment(building, code));
      const bbq = await makeAmenity({ name: 'Khu BBQ', capacityPerSlot: 2, feePerBooking: 0 });
      const results = await Promise.all(solos.map((s) => book(s.owner.user, s, bbq, '18:00')));
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.errorCode).toBe('BOOKING_SLOT_CONFLICT');
      expect(await Booking.countDocuments({ status: 'APPROVED' })).toBe(2);
      expect((await Amenity.findById(bbq._id).lean()).lockVersion).toBe(2); // chỉ giao dịch thành công mới tăng khóa
    });
  });

  describe('chống tranh chấp với "ngừng tiện ích"', () => {
    it('tiện ích bị ngừng ngay sau khi tạo booking (đọc lại isActive sau commit) → hoàn tác booking, 409 AMENITY_INACTIVE', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const realFindById = Amenity.findById.bind(Amenity);
      let calls = 0;
      vi.spyOn(Amenity, 'findById').mockImplementation((...args) => {
        calls += 1;
        // Lần 1: đọc trong giao dịch (còn hoạt động). Lần 2: đọc sau commit → đã bị ngừng
        return calls === 2 ? { select: () => ({ lean: async () => ({ isActive: false }) }) } : realFindById(...args);
      });
      const res = await book(f.owner.user, f, tennis);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('AMENITY_INACTIVE');
      expect(await Booking.countDocuments()).toBe(0);
    });

    it('tiện ích bị ngừng trong lúc giao dịch → rollback toàn bộ (không còn booking, lockVersion không tăng)', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const realFindById = Amenity.findById.bind(Amenity);
      let calls = 0;
      vi.spyOn(Amenity, 'findById').mockImplementation((...args) => {
        calls += 1;
        return calls === 1 ? { select: () => ({ session: () => ({ lean: async () => ({ isActive: false }) }) }) } : realFindById(...args);
      });
      const res = await book(f.owner.user, f, tennis);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('AMENITY_INACTIVE');
      expect(await Booking.countDocuments()).toBe(0);
      expect((await Amenity.findById(tennis._id).lean()).lockVersion).toBe(0);
    });
  });

  describe('hủy booking', () => {
    it('cư dân hủy booking APPROVED trước giờ bắt đầu → CANCELLED, ghi người hủy, thông báo', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const made = (await book(f.owner.user, f, tennis)).body.data;
      await Notification.deleteMany({});
      const res = await request(app).patch(`/api/bookings/${made._id}/cancel`).set(auth(f.owner.user)).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      const saved = await Booking.findById(made._id).lean();
      expect(saved.cancelledAt).toBeInstanceOf(Date);
      expect(String(saved.cancelledBy)).toBe(String(f.owner.user._id));
      expect(await Notification.countDocuments({ userId: f.owner.user._id })).toBe(1);
    });

    it('thành viên hủy booking do chủ hộ đặt (cùng căn) được; chủ hộ nhận thông báo', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const made = (await book(f.owner.user, f, tennis)).body.data;
      await Notification.deleteMany({});
      const res = await request(app).patch(`/api/bookings/${made._id}/cancel`).set(auth(f.spouse.user)).send({ reason: 'Đổi lịch' });
      expect(res.status).toBe(200);
      expect((await Booking.findById(made._id).lean()).cancelReason).toBe('Đổi lịch');
      expect(await Notification.countDocuments({ userId: f.owner.user._id })).toBe(1);
      expect(await Notification.countDocuments({ userId: f.spouse.user._id })).toBe(1);
    });

    it('từ giờ bắt đầu trở đi → 409 BOOKING_CANCEL_TOO_LATE, booking giữ nguyên', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const started = await rawBooking(f, tennis, new Date(Date.now() - 30 * 60e3), { endAt: new Date(Date.now() + 30 * 60e3) });
      const res = await request(app).patch(`/api/bookings/${started._id}/cancel`).set(auth(f.owner.user)).send({});
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('BOOKING_CANCEL_TOO_LATE');
      expect(res.body.message).toBe('Đã đến giờ bắt đầu, không thể hủy booking');
      expect((await Booking.findById(started._id).lean()).status).toBe('APPROVED');

      // Đúng ranh giới (service, giờ cố định): trước 1 phút được, đúng giờ thì không
      const future = await rawBooking(f, tennis, new Date('2030-01-01T03:00:00Z'));
      const user = asUser(f.owner.user);
      await expect(bookings.cancelBooking(user, future._id, {}, { now: new Date('2030-01-01T03:00:00Z') })).rejects.toMatchObject({ errorCode: 'BOOKING_CANCEL_TOO_LATE' });
      expect((await bookings.cancelBooking(user, future._id, {}, { now: new Date('2030-01-01T02:59:00Z') })).status).toBe('CANCELLED');
    });

    it('căn khác → 404; hủy lần 2 / CHECKED_IN / COMPLETED / NO_SHOW → 409 BOOKING_INVALID_STATUS; role khác → 403; không token → 401; id sai → 400', async () => {
      const f = await makeFamily();
      const other = await makeSoloApartment(f.building, '0502');
      const tennis = await makeAmenity();
      const made = (await book(f.owner.user, f, tennis)).body.data;
      const url = `/api/bookings/${made._id}/cancel`;

      const crossApartment = await request(app).patch(url).set(auth(other.owner.user)).send({});
      expect(crossApartment.status).toBe(404);
      expect((await Booking.findById(made._id).lean()).status).toBe('APPROVED');

      expect((await request(app).patch(url).set(auth(f.owner.user)).send({})).status).toBe(200);
      const twice = await request(app).patch(url).set(auth(f.owner.user)).send({});
      expect(twice.status).toBe(409);
      expect(twice.body.errorCode).toBe('BOOKING_INVALID_STATUS');
      for (const status of ['CHECKED_IN', 'COMPLETED', 'NO_SHOW']) {
        const b = await rawBooking(f, tennis, new Date(Date.now() + 5 * HOUR), { status });
        const res = await request(app).patch(`/api/bookings/${b._id}/cancel`).set(auth(f.owner.user)).send({});
        expect(res.status).toBe(409);
        expect(res.body.errorCode).toBe('BOOKING_INVALID_STATUS');
      }
      for (const user of [await createReceptionist(), await createSecurity(), await createManager()]) {
        expect((await request(app).patch(url).set(auth(user)).send({})).status).toBe(403);
      }
      expect((await request(app).patch(url).send({})).status).toBe(401);
      expect((await request(app).patch('/api/bookings/abc/cancel').set(auth(f.owner.user)).send({})).status).toBe(400);
      expect((await request(app).patch('/api/bookings/0123456789abcdef01234567/cancel').set(auth(f.owner.user)).send({})).status).toBe(404);
    });

    it('chủ sở hữu "không ở" không hủy được booking của căn cho thuê (404)', async () => {
      const ctx = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ sở hữu', 300);
      const tenant = await addPerson(ctx.apartment, 'TENANT', 'Người thuê', 30);
      const family = { ...ctx, owner: tenant };
      const tennis = await makeAmenity();
      const b = await rawBooking(family, tennis, new Date(Date.now() + 5 * HOUR));
      expect((await request(app).patch(`/api/bookings/${b._id}/cancel`).set(auth(owner.user)).send({})).status).toBe(404);
      expect((await request(app).patch(`/api/bookings/${b._id}/cancel`).set(auth(tenant.user)).send({})).status).toBe(200);
    });
  });

  describe('lưới slot', () => {
    const NOW = new Date('2026-10-08T03:00:00.000Z'); // 10:00 ngày 08/10/2026 giờ VN
    const slotsOf = (data) => Object.fromEntries(data.slots.map((s) => [s.slotStart, s]));

    it('khóa đúng lý do: PAST (đã qua startAt + 15 phút), ALREADY_BOOKED (căn mình), FULL; slot trống có đủ sức chứa / đã đặt / còn lại / phí', async () => {
      const f = await makeFamily();
      const other = await makeSoloApartment(f.building, '0502');
      const tennis = await makeAmenity({ capacityPerSlot: 2 });
      const startOf = (hhmm) => new Date(`2026-10-08T${hhmm}:00+07:00`);
      await rawBooking(f, tennis, startOf('15:00'), { slotStart: '15:00', slotEnd: '16:00' }); // căn mình
      await rawBooking(other, tennis, startOf('15:00'), { slotStart: '15:00', slotEnd: '16:00' }); // + căn khác → đầy (2/2)
      await rawBooking(other, tennis, startOf('16:00'), { slotStart: '16:00', slotEnd: '17:00' }); // 1/2, của căn khác
      await rawBooking(other, tennis, startOf('17:00'), { slotStart: '17:00', slotEnd: '18:00', status: 'CANCELLED' }); // không chiếm chỗ

      const data = await bookings.getSlots(asUser(f.owner.user), tennis._id, { date: '2026-10-08' }, { now: NOW });
      expect(data.slots).toHaveLength(17); // 05:00 → 22:00, slot 60 phút
      expect(data.today).toBe('2026-10-08');
      expect(data.maxDate).toBe('2026-10-22');
      expect(data.rules).toMatchObject({ advanceDays: 14, maxActivePerApartment: 2, checkinEarlyMinutes: 15, noShowGraceMinutes: 15 });
      const s = slotsOf(data);
      for (const hhmm of ['05:00', '08:00', '09:00']) expect(s[hhmm]).toMatchObject({ available: false, lockReason: 'PAST', lockMessage: 'Đã qua giờ bắt đầu' });
      expect(s['10:00']).toMatchObject({ available: true, lockReason: null, capacity: 2, booked: 0, remaining: 2, fee: 100000, usesPass: false }); // 10:00 chưa quá 10:15
      expect(s['15:00']).toMatchObject({ available: false, lockReason: 'ALREADY_BOOKED', booked: 2, remaining: 0 }); // vừa là căn mình đặt vừa đầy → ưu tiên lý do "căn mình"
      expect(s['16:00']).toMatchObject({ available: true, booked: 1, remaining: 1 });
      expect(s['17:00']).toMatchObject({ available: true, booked: 0, remaining: 2 });
      expect(data.viewer).toMatchObject({ isHead: true, canIncurCharges: true, overdue: false, activeCount: 1, maxActive: 2, limitReached: false });

      // Căn thứ ba (chưa đặt gì) thấy 15:00 là FULL, 16:00 còn chỗ; căn "other" thấy 16:00 là của mình
      const third = await makeSoloApartment(f.building, '0503');
      const asThird = await bookings.getSlots(asUser(third.owner.user), tennis._id, { date: '2026-10-08' }, { now: NOW });
      expect(slotsOf(asThird)['15:00']).toMatchObject({ lockReason: 'FULL', lockMessage: 'Đã hết chỗ' });
      expect(slotsOf(asThird)['16:00']).toMatchObject({ available: true, remaining: 1 });
      const asOther = await bookings.getSlots(asUser(other.owner.user), tennis._id, { date: '2026-10-08' }, { now: NOW });
      expect(slotsOf(asOther)['16:00']).toMatchObject({ lockReason: 'ALREADY_BOOKED' });
    });

    it('ranh giới giờ: đúng startAt + 15 phút thì khóa PAST, trước đó 1 phút còn mở', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const at = (hhmm) => new Date(`2026-10-08T${hhmm}:00+07:00`);
      const before = await bookings.getSlots(asUser(f.owner.user), tennis._id, { date: '2026-10-08' }, { now: at('10:14') });
      expect(slotsOf(before)['10:00'].available).toBe(true);
      const exact = await bookings.getSlots(asUser(f.owner.user), tennis._id, { date: '2026-10-08' }, { now: at('10:15') });
      expect(slotsOf(exact)['10:00']).toMatchObject({ available: false, lockReason: 'PAST' });
    });

    it('ngày > 14 ngày khóa hết (BEYOND_ADVANCE), ngày thứ 14 còn mở; ngày đã qua khóa hết PAST', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const asOwner = (date) => bookings.getSlots(asUser(f.owner.user), tennis._id, { date }, { now: NOW });
      const day14 = await asOwner('2026-10-22');
      expect(day14.slots.every((x) => x.available)).toBe(true);
      const day15 = await asOwner('2026-10-23');
      expect(day15.slots.every((x) => !x.available && x.lockReason === 'BEYOND_ADVANCE')).toBe(true);
      expect(day15.slots[0].lockMessage).toBe('Chỉ đặt trước tối đa 14 ngày');
      const yesterday = await asOwner('2026-10-07');
      expect(yesterday.slots.every((x) => x.lockReason === 'PAST')).toBe(true);
    });

    it('phí áp cho người xem: có gói tháng → 0 (usesPass); thành viên thấy canIncurCharges=false; nợ quá hạn và giới hạn booking được báo ở viewer', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const date = tomorrow();
      await giveActivePass(f.spouse.user, f, tennis, date);
      const spouse = await bookings.getSlots(asUser(f.spouse.user), tennis._id, { date });
      expect(spouse.slots.every((x) => x.fee === 0 && x.usesPass)).toBe(true);
      expect(spouse.viewer).toMatchObject({ isHead: false, canIncurCharges: false });
      const owner = await bookings.getSlots(asUser(f.owner.user), tennis._id, { date });
      expect(owner.slots[0]).toMatchObject({ fee: 100000, usesPass: false });

      await giveInvoice(f);
      await rawBooking(f, tennis, new Date(Date.now() + 2 * DAY));
      await rawBooking(f, tennis, new Date(Date.now() + 3 * DAY));
      const blocked = await bookings.getSlots(asUser(f.owner.user), tennis._id, { date });
      expect(blocked.viewer).toMatchObject({ overdue: true, activeCount: 2, limitReached: true });
    });

    it('qua HTTP: Lễ tân / Bảo vệ / Trưởng BQL / cư dân 200 (nhân viên không có viewer, phí = phí/lượt); KTV 403; không token 401; thiếu/sai ngày 400; ở nhiều căn phải truyền apartmentId', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const url = `/api/amenities/${tennis._id}/slots`;
      const date = tomorrow();
      for (const user of [await createReceptionist(), await createSecurity(), await createManager()]) {
        const res = await request(app).get(`${url}?date=${date}`).set(auth(user));
        expect(res.status).toBe(200);
        expect(res.body.data.viewer).toBeNull();
        expect(res.body.data.slots[0]).toMatchObject({ fee: 100000, usesPass: false });
      }
      const resident = await request(app).get(`${url}?date=${date}`).set(auth(f.owner.user));
      expect(resident.status).toBe(200);
      expect(resident.body.data.viewer.apartmentId).toBe(String(f.apartment._id));
      expect((await request(app).get(`${url}?date=${date}`).set(auth(await createTechnician()))).status).toBe(403);
      expect((await request(app).get(`${url}?date=${date}`)).status).toBe(401);
      expect((await request(app).get(url).set(auth(f.owner.user))).status).toBe(400);
      expect((await request(app).get(`${url}?date=2026-02-31`).set(auth(f.owner.user))).status).toBe(400);
      expect((await request(app).get(`${url}?date=${date}`).set(auth(await createResident()))).status).toBe(403);

      const second = await makeApartment({ buildingCode: 'B', code: '0201' });
      await linkResident(f.owner.user, second.apartment, { relationType: 'OWNER' });
      expect((await request(app).get(`${url}?date=${date}`).set(auth(f.owner.user))).status).toBe(400);
      const chosen = await request(app).get(`${url}?date=${date}&apartmentId=${second.apartment._id}`).set(auth(f.owner.user));
      expect(chosen.status).toBe(200);
      expect(chosen.body.data.viewer.apartmentId).toBe(String(second.apartment._id));
    });

    it('cư dân không thấy lưới của tiện ích đã ngừng hoặc của tòa khác (404)', async () => {
      const f = await makeFamily();
      const other = await createBuilding({ code: 'Z', name: 'Tòa Z' });
      const stopped = await makeAmenity({ name: 'Sân ngừng', isActive: false });
      const elsewhere = await makeAmenity({ name: 'Sân tòa Z', buildingId: other._id });
      for (const a of [stopped, elsewhere]) {
        expect((await request(app).get(`/api/amenities/${a._id}/slots?date=${tomorrow()}`).set(auth(f.owner.user))).status).toBe(404);
      }
      // Trưởng BQL vẫn xem được lưới của tiện ích đã ngừng
      expect((await request(app).get(`/api/amenities/${stopped._id}/slots?date=${tomorrow()}`).set(auth(await createManager()))).status).toBe(200);
    });
  });

  describe('lịch sử đặt', () => {
    it('chủ hộ thấy cả hộ, thành viên chỉ thấy booking do mình đặt; tách sắp tới / đã qua; canCancel đúng; phân trang', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity();
      const bbq = await makeAmenity({ name: 'Khu BBQ', feePerBooking: 0 });
      const byOwner = (await book(f.owner.user, f, tennis, '10:00', tomorrow())).body.data;
      const bySpouse = (await book(f.spouse.user, f, bbq, '11:00', tomorrow())).body.data;
      await rawBooking(f, tennis, new Date(Date.now() - 3 * DAY), { status: 'COMPLETED' });
      await rawBooking(f, tennis, new Date(Date.now() + 5 * DAY), { status: 'CANCELLED' });
      await rawBooking(f, tennis, new Date(Date.now() - 2 * DAY), { status: 'NO_SHOW', bookedBy: f.spouse.user._id });
      await rawBooking(f, tennis, new Date(Date.now() - 6 * HOUR)); // APPROVED nhưng đã kết thúc → coi là đã qua

      const head = await request(app).get('/api/bookings/mine').set(auth(f.owner.user));
      expect(head.status).toBe(200);
      expect(head.body.data.map((b) => b._id)).toEqual([byOwner._id, bySpouse._id]); // sắp tới, giờ gần nhất trước (10:00 < 11:00)
      expect(head.body.data[0]).toMatchObject({ canCancel: true, isMine: true, amenity: { name: 'Sân tennis' } });
      expect(head.body.data[1]).toMatchObject({ isMine: false, amenity: { name: 'Khu BBQ' } });
      expect(head.body.pagination).toMatchObject({ total: 2, page: 1 });

      const past = await request(app).get('/api/bookings/mine?scope=past').set(auth(f.owner.user));
      expect(past.body.data.map((b) => b.status).sort()).toEqual(['APPROVED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);
      expect(past.body.data.every((b) => b.canCancel === false)).toBe(true);
      expect(new Date(past.body.data[0].startAt).getTime()).toBeGreaterThan(new Date(past.body.data.at(-1).startAt).getTime()); // mới nhất trước

      const member = await request(app).get('/api/bookings/mine').set(auth(f.spouse.user));
      expect(member.body.data.map((b) => b._id)).toEqual([bySpouse._id]);
      const memberPast = await request(app).get('/api/bookings/mine?scope=past').set(auth(f.spouse.user));
      expect(memberPast.body.data.map((b) => b.status)).toEqual(['NO_SHOW']);

      const paged = await request(app).get('/api/bookings/mine?scope=past&limit=2&page=2').set(auth(f.owner.user));
      expect(paged.body.data).toHaveLength(2);
      expect(paged.body.pagination).toMatchObject({ page: 2, limit: 2, total: 4 });
    });

    it('chủ sở hữu "không ở" / người ngoài hộ / role khác → 403; không token → 401; scope sai → 400; ở nhiều căn phải truyền apartmentId', async () => {
      const ctx = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ sở hữu', 300);
      const tenant = await addPerson(ctx.apartment, 'TENANT', 'Người thuê', 30);
      expect((await request(app).get('/api/bookings/mine').set(auth(owner.user))).status).toBe(403);
      expect((await request(app).get('/api/bookings/mine').set(auth(await createResident()))).status).toBe(403);
      expect((await request(app).get('/api/bookings/mine').set(auth(await createReceptionist()))).status).toBe(403);
      expect((await request(app).get('/api/bookings/mine')).status).toBe(401);
      expect((await request(app).get('/api/bookings/mine?scope=all').set(auth(tenant.user))).status).toBe(400);
      expect((await request(app).get('/api/bookings/mine').set(auth(tenant.user))).status).toBe(200);

      const second = await makeApartment({ buildingCode: 'B', code: '0201' });
      await linkResident(tenant.user, second.apartment, { relationType: 'OWNER' });
      expect((await request(app).get('/api/bookings/mine').set(auth(tenant.user))).status).toBe(400);
      expect((await request(app).get(`/api/bookings/mine?apartmentId=${second.apartment._id}`).set(auth(tenant.user))).status).toBe(200);
      expect((await request(app).get(`/api/bookings/mine?apartmentId=${ctx.apartment._id}`).set(auth(owner.user))).status).toBe(403);
    });
  });

  it('atTime / giờ VN: slot 18:00 ngày D có startAt = D 11:00 UTC', async () => {
    const f = await makeFamily();
    const tennis = await makeAmenity({ feePerBooking: 0 });
    const date = inDays(2);
    const res = await book(f.owner.user, f, tennis, '18:00', date);
    expect(res.status).toBe(201);
    expect(new Date(res.body.data.startAt).toISOString()).toBe(`${date}T11:00:00.000Z`);
    expect(atTime(vnDayStart(date), '18:00').toISOString()).toBe(`${date}T11:00:00.000Z`);
  });
});
