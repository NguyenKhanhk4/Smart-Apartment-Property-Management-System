// Module D — UC-D09: chủ hộ mua gói tháng tiện ích cho mình hoặc thành viên (mua chạy trong MongoDB transaction → replica set)
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
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
const passes = await import('../src/modules/amenityPasses/amenityPasses.service.js');
const codes = await import('../src/modules/memberCodes/memberCodes.service.js');
const { assertNoOverdue, hasOverdueInvoice } = await import('../src/modules/amenities/overdue.js');
const { Amenity, AmenityPass, AuditLog, Invoice, MemberCode, Notification } = await import('../src/models/index.js');
const { periodEnd, periodStart, vnPeriod } = await import('../src/utils/time.js');
const { toVnYmd, vnDayStart } = await import('../src/modules/amenities/slot.utils.js');

const DAY = 86400e3;
const app = createApp();
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });
const [CUR, NEXT] = passes.purchasableMonths();
const AFTER_NEXT = vnPeriod(periodEnd(NEXT));
const PREVIOUS = vnPeriod(new Date(periodStart(CUR).getTime() - DAY));

const GYM = {
  name: 'Phòng gym',
  accessMode: 'WALK_IN',
  openTime: '05:00',
  closeTime: '22:00',
  perVisitFeeAdult: 50000,
  perVisitFeeChild: 30000,
  monthlyPassFeeAdult: 400000,
  monthlyPassFeeChild: 250000,
};
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
const makeAmenity = (extra = {}) => Amenity.create({ ...GYM, ...extra });

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

/** Hộ mẫu: chủ hộ + vợ + con. dob của con đặt qua member_codes (như chủ hộ làm ở trang Gia đình) */
async function makeFamily() {
  const ctx = await makeApartment();
  const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ hộ', 100);
  const spouse = await addPerson(ctx.apartment, 'FAMILY_MEMBER', 'Vợ', 90);
  const child = await addPerson(ctx.apartment, 'FAMILY_MEMBER', 'Con', 80);
  await codes.ensureCodes(ctx.apartment._id);
  return { ...ctx, owner, spouse, child };
}

const setDob = (family, person, ymd) =>
  MemberCode.updateOne({ userId: person.user._id, apartmentId: family.apartment._id, isActive: true }, { dateOfBirth: vnDayStart(ymd) });

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const yearsAgoYmd = (years) => toVnYmd(new Date(Date.now() - years * 365.25 * DAY));
/** Ngày sinh để sinh nhật lần thứ `age` rơi vào ngày `day` của tháng `month` ('YYYY-MM') */
const bornForBirthday = (month, day, age) => ymd(Number(month.slice(0, 4)) - age, Number(month.slice(5)), day);

const buy = (user, family, who, amenity, month = CUR) =>
  request(app)
    .post('/api/amenity-passes')
    .set(auth(user))
    .send({ apartmentId: String(family.apartment._id), userId: String(who.user._id), amenityId: String(amenity._id), month });

const makeInvoice = (family, extra = {}) =>
  Invoice.create({
    code: `HD-TEST-${Math.random().toString(36).slice(2, 8)}`,
    apartmentId: family.apartment._id,
    buildingId: family.building._id,
    period: PREVIOUS,
    items: [{ feeCategory: 'CLEANING', description: 'Phí vệ sinh', unitPrice: 1, amount: 1 }],
    totalAmount: 1,
    status: 'OVERDUE',
    issuedAt: new Date(Date.now() - 40 * DAY),
    dueDate: new Date(Date.now() - 10 * DAY),
    ...extra,
  });

describe('amenity passes (UC-D09)', () => {
  beforeAll(() => connectTestDB({ replSet: true }), 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('mua gói', () => {
    it('chủ hộ mua cho mình: giá người lớn, hiệu lực ngay, lưu snapshot; thông báo cho chủ hộ', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const res = await buy(f.owner.user, f, f.owner, gym);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        month: CUR,
        ageGroup: 'ADULT',
        fee: 400000,
        status: 'ACTIVE',
        invoiceId: null,
        amenity: { name: 'Phòng gym', accessMode: 'WALK_IN' },
        member: { fullName: 'Chủ hộ' },
      });
      const saved = await AmenityPass.findOne().lean();
      expect(saved).toMatchObject({ month: CUR, ageGroup: 'ADULT', fee: 400000, status: 'ACTIVE' });
      expect(String(saved.userId)).toBe(String(f.owner.user._id));
      expect(String(saved.purchasedBy)).toBe(String(f.owner.user._id));
      expect(String(saved.apartmentId)).toBe(String(f.apartment._id));
      expect(await Notification.countDocuments({ userId: f.owner.user._id })).toBe(1);
      expect(await Notification.countDocuments()).toBe(1);
    });

    it('mua gói tháng sau; hiệu lực theo tháng, tiện ích BOOKING cũng bán gói', async () => {
      const f = await makeFamily();
      const tennis = await makeAmenity(TENNIS);
      const res = await buy(f.owner.user, f, f.spouse, tennis, NEXT);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ month: NEXT, fee: 600000, ageGroup: 'ADULT' });
    });

    it('chủ hộ mua cho con 8 tuổi → giá trẻ em; thông báo cho con và chủ hộ', async () => {
      const f = await makeFamily();
      await setDob(f, f.child, yearsAgoYmd(8.5));
      const gym = await makeAmenity();
      const res = await buy(f.owner.user, f, f.child, gym);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ ageGroup: 'CHILD', fee: 250000, member: { fullName: 'Con' } });
      expect(String((await AmenityPass.findOne().lean()).purchasedBy)).toBe(String(f.owner.user._id));
      const toChild = await Notification.findOne({ userId: f.child.user._id }).lean();
      expect(toChild.content).toContain('Chủ hộ đã mua gói Phòng gym');
      const toHead = await Notification.findOne({ userId: f.owner.user._id }).lean();
      expect(toHead.content).toContain('cho Con');
      expect(await Notification.countDocuments()).toBe(2);
    });

    it('con chưa có ngày sinh được tính như người lớn', async () => {
      const f = await makeFamily();
      const res = await buy(f.owner.user, f, f.child, await makeAmenity());
      expect(res.body.data).toMatchObject({ ageGroup: 'ADULT', fee: 400000 });
    });

    it('con 4 tuổi → PASS_NOT_REQUIRED (400), không tạo gói', async () => {
      const f = await makeFamily();
      await setDob(f, f.child, yearsAgoYmd(4.5));
      const res = await buy(f.owner.user, f, f.child, await makeAmenity());
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PASS_NOT_REQUIRED');
      expect(await AmenityPass.countDocuments()).toBe(0);
    });

    it('nhóm tuổi tính tại NGÀY 1 của tháng gói: bé tròn 12 tuổi giữa tháng vẫn giá trẻ em; tròn 6 tuổi giữa tháng vẫn không cần gói', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      // Tròn 12 tuổi vào ngày 15 của tháng này → ngày 1 mới 11 tuổi → giá trẻ em
      await setDob(f, f.child, bornForBirthday(CUR, 15, 12));
      const turning12 = await buy(f.owner.user, f, f.child, gym, CUR);
      expect(turning12.body.data).toMatchObject({ ageGroup: 'CHILD', fee: 250000 });
      // Sang tháng sau bé đã 12 tuổi từ ngày 15 tháng này → ngày 1 tháng sau đã 12 → giá người lớn
      const nextMonth = await buy(f.owner.user, f, f.child, gym, NEXT);
      expect(nextMonth.body.data).toMatchObject({ ageGroup: 'ADULT', fee: 400000 });

      // Tròn 6 tuổi vào ngày 10 của tháng sau: ngày 1 mới 5 tuổi → miễn phí
      await setDob(f, f.spouse, bornForBirthday(NEXT, 10, 6));
      const turning6 = await buy(f.owner.user, f, f.spouse, gym, NEXT);
      expect(turning6.body.errorCode).toBe('PASS_NOT_REQUIRED');
      // Tròn 6 tuổi đúng ngày 1 của tháng sau → đã 6 tuổi → giá trẻ em
      await setDob(f, f.spouse, bornForBirthday(NEXT, 1, 6));
      const exactly6 = await buy(f.owner.user, f, f.spouse, gym, NEXT);
      expect(exactly6.body.data).toMatchObject({ ageGroup: 'CHILD', fee: 250000 });
    });

    it('thành viên thường mua → 403 HOUSEHOLD_HEAD_REQUIRED; người ngoài hộ → 403; Lễ tân/Bảo vệ/KTV/Trưởng BQL → 403; không token → 401', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const asMember = await buy(f.spouse.user, f, f.spouse, gym);
      expect(asMember.status).toBe(403);
      expect(asMember.body.errorCode).toBe('HOUSEHOLD_HEAD_REQUIRED');
      const outsider = await createResident();
      const asOutsider = await buy(outsider, f, f.owner, gym);
      expect(asOutsider.status).toBe(403);
      expect(asOutsider.body.errorCode).toBe('FORBIDDEN_ROLE');
      for (const user of [await createReceptionist(), await createSecurity(), await createTechnician(), await createManager()]) {
        expect((await buy(user, f, f.owner, gym)).status).toBe(403);
      }
      expect((await request(app).post('/api/amenity-passes').send({})).status).toBe(401);
      expect(await AmenityPass.countDocuments()).toBe(0);
    });

    it('chủ sở hữu "không ở" (căn đang cho thuê) không mua được; người thuê (chủ hộ) mua được', async () => {
      const ctx = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(ctx.apartment, 'OWNER', 'Chủ sở hữu', 300);
      const tenant = await addPerson(ctx.apartment, 'TENANT', 'Người thuê', 30);
      const family = { ...ctx };
      const gym = await makeAmenity();
      expect((await buy(owner.user, family, owner, gym)).status).toBe(403);
      expect((await buy(owner.user, family, tenant, gym)).status).toBe(403);
      expect((await buy(tenant.user, family, tenant, gym)).status).toBe(201);
      // Chủ hộ không mua được cho chủ sở hữu không ở (không thuộc hộ) → 400
      const forOwner = await buy(tenant.user, family, owner, await makeAmenity({ name: 'Yoga' }));
      expect(forOwner.status).toBe(400);
      expect(forOwner.body.details).toEqual([{ field: 'userId', message: 'Không thuộc hộ này' }]);
    });

    it('mua cho người ngoài hộ → 400 (field userId)', async () => {
      const f = await makeFamily();
      const stranger = await createResident();
      const res = await buy(f.owner.user, f, { user: stranger }, await makeAmenity());
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('userId');
    });

    it('tiện ích FREE / không bán gói / đã ngừng / không tồn tại → lỗi tương ứng', async () => {
      const f = await makeFamily();
      const park = await makeAmenity({ name: 'Công viên', accessMode: 'FREE', openTime: null, closeTime: null, perVisitFeeAdult: 0, perVisitFeeChild: 0, monthlyPassFeeAdult: null, monthlyPassFeeChild: null });
      const noPass = await makeAmenity({ name: 'Hồ bơi', monthlyPassFeeAdult: null, monthlyPassFeeChild: null });
      const stopped = await makeAmenity({ name: 'Yoga', isActive: false });
      for (const amenity of [park, noPass]) {
        const res = await buy(f.owner.user, f, f.owner, amenity);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('PASS_NOT_SOLD');
      }
      const inactive = await buy(f.owner.user, f, f.owner, stopped);
      expect(inactive.status).toBe(409);
      expect(inactive.body.errorCode).toBe('AMENITY_INACTIVE');
      const missing = await buy(f.owner.user, f, f.owner, { _id: '0123456789abcdef01234567' });
      expect(missing.status).toBe(404);
      expect(await AmenityPass.countDocuments()).toBe(0);
    });

    it('tiện ích riêng tòa: căn thuộc tòa khác không mua được (404), căn cùng tòa mua được', async () => {
      const f = await makeFamily();
      const other = await createBuilding({ code: 'Z', name: 'Tòa Z' });
      const sameBuilding = await makeAmenity({ name: 'BBQ tòa A', buildingId: f.building._id });
      const otherBuilding = await makeAmenity({ name: 'BBQ tòa Z', buildingId: other._id });
      expect((await buy(f.owner.user, f, f.owner, otherBuilding)).status).toBe(404);
      expect((await buy(f.owner.user, f, f.owner, sameBuilding)).status).toBe(201);
    });

    it('tháng quá khứ hoặc +2 tháng hoặc sai định dạng → 400 (field month)', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      for (const month of [PREVIOUS, AFTER_NEXT, '2026-13', '10/2026']) {
        const res = await buy(f.owner.user, f, f.owner, gym, month);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      }
      expect((await buy(f.owner.user, f, f.owner, gym, AFTER_NEXT)).body.details).toEqual([{ field: 'month', message: 'Chỉ chọn tháng này hoặc tháng sau' }]);
      expect(await AmenityPass.countDocuments()).toBe(0);
    });

    it('thiếu trường bắt buộc / id sai định dạng → 400', async () => {
      const f = await makeFamily();
      const res = await request(app).post('/api/amenity-passes').set(auth(f.owner.user)).send({ apartmentId: 'abc', month: CUR });
      expect(res.status).toBe(400);
      expect(res.body.details.map((d) => d.field).sort()).toEqual(['amenityId', 'apartmentId', 'userId']);
    });

    it('mua trùng (cùng người, tiện ích, tháng) → 409 PASS_ALREADY_EXISTS; khác tháng / khác tiện ích / khác người vẫn mua được', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const tennis = await makeAmenity(TENNIS);
      expect((await buy(f.owner.user, f, f.owner, gym)).status).toBe(201);
      const dup = await buy(f.owner.user, f, f.owner, gym);
      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe('PASS_ALREADY_EXISTS');
      expect((await buy(f.owner.user, f, f.owner, gym, NEXT)).status).toBe(201);
      expect((await buy(f.owner.user, f, f.owner, tennis)).status).toBe(201);
      expect((await buy(f.owner.user, f, f.spouse, gym)).status).toBe(201);
      expect(await AmenityPass.countDocuments()).toBe(4);
    });

    it('gửi đồng thời nhiều yêu cầu mua giống nhau → đúng 1 thành công, còn lại PASS_ALREADY_EXISTS, DB chỉ có 1 gói', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const results = await Promise.all([1, 2, 3, 4].map(() => buy(f.owner.user, f, f.spouse, gym)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.errorCode).toBe('PASS_ALREADY_EXISTS');
      expect(await AmenityPass.countDocuments({ status: 'ACTIVE' })).toBe(1);
    });

    it('căn có hóa đơn quá hạn → 409 BOOKING_APARTMENT_OVERDUE (cả OVERDUE lẫn UNPAID đã qua hạn); trả hết nợ thì mua được', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const invoice = await makeInvoice(f, { status: 'OVERDUE' });
      const blocked = await buy(f.owner.user, f, f.owner, gym);
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe('BOOKING_APARTMENT_OVERDUE');
      await Invoice.updateOne({ _id: invoice._id }, { status: 'UNPAID' }); // quá hạn nhưng cron chưa chuyển trạng thái
      expect((await buy(f.owner.user, f, f.owner, gym)).status).toBe(409);
      await Invoice.updateOne({ _id: invoice._id }, { status: 'UNPAID', dueDate: new Date(Date.now() + 5 * DAY) }); // chưa tới hạn
      expect((await buy(f.owner.user, f, f.owner, gym)).status).toBe(201);
      expect(await AmenityPass.countDocuments()).toBe(1);
    });

    it('overdue.js dùng chung: hóa đơn đã thanh toán / hủy / của căn khác không chặn; assertNoOverdue ném đúng mã', async () => {
      const f = await makeFamily();
      const other = await makeApartment({ buildingCode: 'B', code: '0201' });
      await makeInvoice(f, { status: 'PAID' });
      await makeInvoice(f, { status: 'CANCELLED', period: CUR });
      await makeInvoice({ apartment: other.apartment, building: other.building }, { status: 'OVERDUE' });
      expect(await hasOverdueInvoice(f.apartment._id)).toBe(false);
      await expect(assertNoOverdue(f.apartment._id)).resolves.toBeUndefined();
      await expect(assertNoOverdue(other.apartment._id)).rejects.toMatchObject({ errorCode: 'BOOKING_APARTMENT_OVERDUE', status: 409 });
    });

    it('giá là snapshot: đổi bảng giá tiện ích sau khi mua không ảnh hưởng gói đã mua', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      await buy(f.owner.user, f, f.owner, gym);
      await Amenity.updateOne({ _id: gym._id }, { monthlyPassFeeAdult: 999000 });
      expect((await AmenityPass.findOne().lean()).fee).toBe(400000);
      const second = await buy(f.owner.user, f, f.spouse, gym);
      expect(second.body.data.fee).toBe(999000);
    });
  });

  describe('hủy gói', () => {
    it('chủ hộ hủy gói THÁNG SAU → 200, ghi audit, thông báo cho người dùng gói; sau đó mua lại được', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const bought = await buy(f.owner.user, f, f.spouse, gym, NEXT);
      await Notification.deleteMany({});
      const res = await request(app).patch(`/api/amenity-passes/${bought.body.data._id}/cancel`).set(auth(f.owner.user)).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CANCELLED' });
      const saved = await AmenityPass.findById(bought.body.data._id).lean();
      expect(saved).toMatchObject({ status: 'CANCELLED', cancelReason: null });
      expect(String(saved.cancelledBy)).toBe(String(f.owner.user._id));
      expect(saved.cancelledAt).toBeInstanceOf(Date);
      expect(await Notification.countDocuments({ userId: f.spouse.user._id })).toBe(1);
      expect((await AuditLog.findOne({ action: 'AMENITY_PASS_CANCELLED' }).lean()).metadata).toMatchObject({ month: NEXT, byRole: 'RESIDENT', reason: null });
      expect((await buy(f.owner.user, f, f.spouse, gym, NEXT)).status).toBe(201);
    });

    it('chủ hộ hủy gói THÁNG NÀY → 409 PASS_CANCEL_NOT_ALLOWED, gói giữ nguyên', async () => {
      const f = await makeFamily();
      const bought = await buy(f.owner.user, f, f.owner, await makeAmenity());
      const res = await request(app).patch(`/api/amenity-passes/${bought.body.data._id}/cancel`).set(auth(f.owner.user)).send({});
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PASS_CANCEL_NOT_ALLOWED');
      expect((await AmenityPass.findById(bought.body.data._id).lean()).status).toBe('ACTIVE');
      expect(await AuditLog.countDocuments()).toBe(0);
    });

    it('thành viên thường / người ngoài hộ / Lễ tân không hủy được (403); không token 401; id sai 400; không tồn tại 404', async () => {
      const f = await makeFamily();
      const bought = await buy(f.owner.user, f, f.spouse, await makeAmenity(), NEXT);
      const url = `/api/amenity-passes/${bought.body.data._id}/cancel`;
      const asMember = await request(app).patch(url).set(auth(f.spouse.user)).send({});
      expect(asMember.status).toBe(403);
      expect(asMember.body.errorCode).toBe('HOUSEHOLD_HEAD_REQUIRED');
      expect((await request(app).patch(url).set(auth(await createResident())).send({})).status).toBe(403);
      expect((await request(app).patch(url).set(auth(await createReceptionist())).send({})).status).toBe(403);
      expect((await request(app).patch(url).send({})).status).toBe(401);
      expect((await request(app).patch('/api/amenity-passes/abc/cancel').set(auth(f.owner.user)).send({})).status).toBe(400);
      expect((await request(app).patch('/api/amenity-passes/0123456789abcdef01234567/cancel').set(auth(f.owner.user)).send({})).status).toBe(404);
      expect((await AmenityPass.findById(bought.body.data._id).lean()).status).toBe('ACTIVE');
    });

    it('Trưởng BQL hủy gói tháng này kèm lý do → 200 + audit AMENITY_PASS_CANCELLED + thông báo cho người dùng và chủ hộ; thiếu lý do → 400', async () => {
      const f = await makeFamily();
      const manager = await createManager();
      const bought = await buy(f.owner.user, f, f.spouse, await makeAmenity());
      await Notification.deleteMany({});
      const url = `/api/amenity-passes/${bought.body.data._id}/cancel`;

      const noReason = await request(app).patch(url).set(auth(manager)).send({});
      expect(noReason.status).toBe(400);
      expect(noReason.body.details[0].field).toBe('reason');
      expect((await request(app).patch(url).set(auth(manager)).send({ reason: 'ab' })).status).toBe(400);
      expect((await AmenityPass.findById(bought.body.data._id).lean()).status).toBe('ACTIVE');

      const res = await request(app).patch(url).set(auth(manager)).send({ reason: 'Cư dân chuyển đi giữa tháng' });
      expect(res.status).toBe(200);
      const saved = await AmenityPass.findById(bought.body.data._id).lean();
      expect(saved).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cư dân chuyển đi giữa tháng' });
      expect(String(saved.cancelledBy)).toBe(String(manager._id));
      const [log] = await AuditLog.find({ action: 'AMENITY_PASS_CANCELLED' }).lean();
      expect(String(log.performedBy)).toBe(String(manager._id));
      expect(log.metadata).toMatchObject({ month: CUR, fee: 400000, reason: 'Cư dân chuyển đi giữa tháng', byRole: 'MANAGER' });
      expect(await Notification.countDocuments({ userId: { $in: [f.spouse.user._id, f.owner.user._id] } })).toBe(2);
    });

    it('gói đã gộp hóa đơn → 409 PASS_ALREADY_BILLED (cả chủ hộ lẫn Trưởng BQL); gói đã hủy → 409 PASS_ALREADY_CANCELLED', async () => {
      const f = await makeFamily();
      const manager = await createManager();
      const gym = await makeAmenity();
      const billed = (await buy(f.owner.user, f, f.owner, gym, NEXT)).body.data;
      const invoice = await makeInvoice(f, { status: 'PAID', period: PREVIOUS });
      await AmenityPass.updateOne({ _id: billed._id }, { invoiceId: invoice._id });
      const byHead = await request(app).patch(`/api/amenity-passes/${billed._id}/cancel`).set(auth(f.owner.user)).send({});
      expect(byHead.status).toBe(409);
      expect(byHead.body.errorCode).toBe('PASS_ALREADY_BILLED');
      const byManager = await request(app).patch(`/api/amenity-passes/${billed._id}/cancel`).set(auth(manager)).send({ reason: 'Hủy theo yêu cầu' });
      expect(byManager.status).toBe(409);
      expect(byManager.body.errorCode).toBe('PASS_ALREADY_BILLED');
      expect((await AmenityPass.findById(billed._id).lean()).status).toBe('ACTIVE');
      expect(await AuditLog.countDocuments()).toBe(0);

      const other = (await buy(f.owner.user, f, f.spouse, gym, NEXT)).body.data;
      const url = `/api/amenity-passes/${other._id}/cancel`;
      expect((await request(app).patch(url).set(auth(f.owner.user)).send({})).status).toBe(200);
      const again = await request(app).patch(url).set(auth(f.owner.user)).send({});
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe('PASS_ALREADY_CANCELLED');
    });

    it('billing gán invoiceId giữa lúc kiểm tra và lúc ghi → không hủy được (điều kiện trạng thái trong lệnh cập nhật)', async () => {
      const f = await makeFamily();
      const bought = (await buy(f.owner.user, f, f.owner, await makeAmenity(), NEXT)).body.data;
      const invoice = await makeInvoice(f, { status: 'PAID', period: PREVIOUS });
      const realFind = AmenityPass.findById.bind(AmenityPass);
      let first = true;
      AmenityPass.findById = (...args) => {
        const q = realFind(...args);
        if (first) {
          first = false;
          // Đọc xong (chưa có invoiceId) rồi billing mới gộp hóa đơn
          const originalLean = q.lean.bind(q);
          q.lean = async () => {
            const doc = await originalLean();
            await AmenityPass.updateOne({ _id: bought._id }, { invoiceId: invoice._id });
            return doc;
          };
        }
        return q;
      };
      try {
        await expect(passes.cancelPass({ id: String(f.owner.user._id), role: 'RESIDENT' }, bought._id)).rejects.toMatchObject({ errorCode: 'PASS_ALREADY_BILLED' });
      } finally {
        AmenityPass.findById = realFind;
      }
      expect((await AmenityPass.findById(bought._id).lean()).status).toBe('ACTIVE');
    });
  });

  describe('danh sách và tiện ích dùng chung', () => {
    it('GET /mine: chủ hộ thấy gói cả hộ (có tên người dùng, canCancel đúng); thành viên chỉ thấy gói của mình', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      await buy(f.owner.user, f, f.owner, gym);
      await buy(f.owner.user, f, f.spouse, gym, NEXT);
      await buy(f.owner.user, f, f.child, gym, NEXT);

      const head = await request(app).get('/api/amenity-passes/mine').set(auth(f.owner.user));
      expect(head.status).toBe(200);
      expect(head.body.data).toHaveLength(3);
      const byName = Object.fromEntries(head.body.data.map((p) => [`${p.member.fullName}|${p.month}`, p]));
      expect(byName[`Chủ hộ|${CUR}`]).toMatchObject({ isCurrent: true, canCancel: false, amenity: { name: 'Phòng gym' }, memberCode: 'A-0501' });
      expect(byName[`Con|${NEXT}`].memberCode).toBe('A-0501-02');
      expect(byName[`Vợ|${NEXT}`]).toMatchObject({ isCurrent: false, canCancel: true, fee: 400000 });
      expect(head.body.data[0].month).toBe(NEXT); // mới nhất trước

      const member = await request(app).get('/api/amenity-passes/mine').set(auth(f.spouse.user));
      expect(member.body.data).toHaveLength(1);
      expect(member.body.data[0]).toMatchObject({ member: { fullName: 'Vợ' }, canCancel: false });

      const filtered = await request(app).get(`/api/amenity-passes/mine?month=${CUR}`).set(auth(f.owner.user));
      expect(filtered.body.data).toHaveLength(1);
    });

    it('GET /mine: mặc định chỉ gói ACTIVE, status=CANCELLED xem được gói đã hủy; người ngoài hộ / role khác bị từ chối', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const bought = (await buy(f.owner.user, f, f.spouse, gym, NEXT)).body.data;
      await request(app).patch(`/api/amenity-passes/${bought._id}/cancel`).set(auth(f.owner.user)).send({});
      expect((await request(app).get('/api/amenity-passes/mine').set(auth(f.owner.user))).body.data).toHaveLength(0);
      const cancelled = await request(app).get('/api/amenity-passes/mine?status=CANCELLED').set(auth(f.owner.user));
      expect(cancelled.body.data).toHaveLength(1);
      expect(cancelled.body.data[0].status).toBe('CANCELLED');

      expect((await request(app).get('/api/amenity-passes/mine').set(auth(await createResident()))).status).toBe(403);
      expect((await request(app).get(`/api/amenity-passes/mine?apartmentId=${f.apartment._id}`).set(auth(await createResident()))).status).toBe(403);
      expect((await request(app).get('/api/amenity-passes/mine').set(auth(await createReceptionist()))).status).toBe(403);
      expect((await request(app).get('/api/amenity-passes/mine')).status).toBe(401);
      expect((await request(app).get('/api/amenity-passes/mine?status=X').set(auth(f.owner.user))).status).toBe(400);
    });

    it('GET /options: giá theo nhóm tuổi tại ngày 1 của tháng, trạng thái AVAILABLE / OWNED / NOT_REQUIRED; chỉ chủ hộ; tháng ngoài phạm vi 400', async () => {
      const f = await makeFamily();
      await setDob(f, f.child, yearsAgoYmd(4.5));
      const gym = await makeAmenity();
      const tennis = await makeAmenity(TENNIS);
      await makeAmenity({ name: 'Hồ bơi không gói', monthlyPassFeeAdult: null, monthlyPassFeeChild: null });
      await makeAmenity({ name: 'Công viên', accessMode: 'FREE', openTime: null, closeTime: null, perVisitFeeAdult: 0, perVisitFeeChild: 0, monthlyPassFeeAdult: null, monthlyPassFeeChild: null });
      await makeAmenity({ name: 'Yoga ngừng', isActive: false });
      await buy(f.owner.user, f, f.owner, gym);

      const res = await request(app).get('/api/amenity-passes/options').set(auth(f.owner.user));
      expect(res.status).toBe(200);
      expect(res.body.data.month).toBe(CUR);
      expect(res.body.data.months).toEqual([CUR, NEXT]);
      expect(res.body.data.overdue).toBe(false);
      expect(res.body.data.amenities.map((a) => a.name)).toEqual(['Phòng gym', 'Sân tennis']);
      expect(res.body.data.members.map((m) => [m.fullName, m.ageGroup])).toEqual([['Chủ hộ', 'ADULT'], ['Vợ', 'ADULT'], ['Con', 'CHILD_FREE']]);
      const opt = (user, amenity) => res.body.data.options.find((o) => o.userId === String(user.user._id) && o.amenityId === String(amenity._id));
      expect(opt(f.owner, gym)).toMatchObject({ status: 'OWNED', fee: 400000 });
      expect(opt(f.spouse, gym)).toMatchObject({ status: 'AVAILABLE', fee: 400000, ageGroup: 'ADULT' });
      expect(opt(f.spouse, tennis)).toMatchObject({ status: 'AVAILABLE', fee: 600000 });
      expect(opt(f.child, gym)).toMatchObject({ status: 'NOT_REQUIRED', fee: null, ageGroup: 'CHILD_FREE' });

      await makeInvoice(f);
      expect((await request(app).get('/api/amenity-passes/options').set(auth(f.owner.user))).body.data.overdue).toBe(true);
      expect((await request(app).get('/api/amenity-passes/options').set(auth(f.spouse.user))).status).toBe(403);
      expect((await request(app).get(`/api/amenity-passes/options?month=${AFTER_NEXT}`).set(auth(f.owner.user))).status).toBe(400);
      expect((await request(app).get(`/api/amenity-passes/options?month=${NEXT}`).set(auth(f.owner.user))).body.data.month).toBe(NEXT);
    });

    it('GET /: Trưởng BQL và Lễ tân 200 (lọc tháng / tiện ích / căn / trạng thái / đã gộp hóa đơn); cư dân, KTV, Bảo vệ 403; không token 401', async () => {
      const f = await makeFamily();
      const other = await makeApartment({ buildingCode: 'B', code: '0201' });
      const otherOwner = await addPerson(other.apartment, 'OWNER', 'Chủ B');
      const gym = await makeAmenity();
      const tennis = await makeAmenity(TENNIS);
      const mine = (await buy(f.owner.user, f, f.owner, gym)).body.data;
      await buy(f.owner.user, f, f.spouse, tennis, NEXT);
      await request(app).post('/api/amenity-passes').set(auth(otherOwner.user)).send({ apartmentId: String(other.apartment._id), userId: String(otherOwner.user._id), amenityId: String(gym._id), month: CUR });
      await AmenityPass.updateOne({ _id: mine._id }, { invoiceId: (await makeInvoice(f, { status: 'PAID' }))._id });

      const manager = await createManager();
      const all = await request(app).get('/api/amenity-passes').set(auth(manager));
      expect(all.status).toBe(200);
      expect(all.body.pagination).toMatchObject({ total: 3, limit: 20 });
      const first = all.body.data.find((p) => p.userId.fullName === 'Chủ hộ');
      expect(first).toMatchObject({ amenityId: { name: 'Phòng gym' }, apartmentId: { code: '0501', buildingId: { name: 'Tòa A' } }, month: CUR, canCancel: false });
      // Mã cư dân phân biệt người trùng tên (vợ A-0501-01, chủ căn B có mã riêng ở căn B)
      expect(all.body.data.find((p) => p.userId.fullName === 'Vợ').memberCode).toBe('A-0501-01');
      expect(all.body.data.find((p) => p.userId.fullName === 'Chủ B').memberCode).toBe('B-0201');
      expect(first.memberCode).toBe('A-0501');
      const q = (qs) => request(app).get(`/api/amenity-passes?${qs}`).set(auth(manager)).then((r) => r.body.data.length);
      expect(await q(`month=${NEXT}`)).toBe(1);
      expect(await q(`amenityId=${gym._id}`)).toBe(2);
      expect(await q(`apartmentId=${other.apartment._id}`)).toBe(1);
      expect(await q('invoiced=true')).toBe(1);
      expect(await q('invoiced=false')).toBe(2);
      expect(await q('status=CANCELLED')).toBe(0);
      expect(await q(`userId=${f.spouse.user._id}`)).toBe(1);

      const asReceptionist = await request(app).get('/api/amenity-passes').set(auth(await createReceptionist()));
      expect(asReceptionist.status).toBe(200);
      expect(asReceptionist.body.data.every((p) => p.canCancel === false)).toBe(true); // Lễ tân chỉ xem
      for (const user of [f.owner.user, await createTechnician(), await createSecurity()]) {
        expect((await request(app).get('/api/amenity-passes').set(auth(user))).status).toBe(403);
      }
      expect((await request(app).get('/api/amenity-passes')).status).toBe(401);
      expect((await request(app).get('/api/amenity-passes?month=abc').set(auth(manager))).status).toBe(400);
      expect((await request(app).get('/api/amenity-passes?sort=password').set(auth(manager))).status).toBe(400);
    });
  });

  describe('mã cư dân trong danh sách', () => {
    it('hai người trùng tên ở hai căn vẫn phân biệt được bằng mã; người đã rời hộ hiện mã cũ', async () => {
      const f = await makeFamily();
      const other = await makeApartment({ buildingCode: 'B', code: '0201' });
      const twin = await addPerson(other.apartment, 'OWNER', 'Chủ hộ'); // trùng tên với chủ hộ căn A
      const gym = await makeAmenity();
      await buy(f.owner.user, f, f.owner, gym);
      await request(app).post('/api/amenity-passes').set(auth(twin.user)).send({ apartmentId: String(other.apartment._id), userId: String(twin.user._id), amenityId: String(gym._id), month: CUR });
      const left = (await buy(f.owner.user, f, f.spouse, gym)).body.data;
      expect(left).toBeTruthy();

      const manager = await createManager();
      const list = await request(app).get('/api/amenity-passes').set(auth(manager));
      const sameName = list.body.data.filter((p) => p.userId.fullName === 'Chủ hộ');
      expect(sameName.map((p) => p.memberCode).sort()).toEqual(['A-0501', 'B-0201']);

      // Vợ rời hộ: mã bị thu hồi nhưng gói còn ACTIVE → danh sách vẫn hiện mã gần nhất để nhận ra người
      const { Resident } = await import('../src/models/index.js');
      await Resident.updateOne({ userId: f.spouse.user._id }, { isActive: false });
      const after = await request(app).get('/api/amenity-passes').set(auth(manager));
      expect(after.body.data.find((p) => p.userId.fullName === 'Vợ').memberCode).toBe('A-0501-01');
    });
  });

  describe('getActivePass và tích hợp với thẻ cư dân', () => {
    it('getActivePass(userId, amenityId, at): chỉ gói ACTIVE của đúng tháng; gói tháng sau chưa có hiệu lực; gói đã hủy không tính', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const now = new Date();
      expect(await passes.getActivePass(f.owner.user._id, gym._id, now)).toBeNull();

      const current = (await buy(f.owner.user, f, f.owner, gym, CUR)).body.data;
      await buy(f.owner.user, f, f.spouse, gym, NEXT);
      expect(String((await passes.getActivePass(f.owner.user._id, gym._id, now))._id)).toBe(String(current._id));
      expect(await passes.getActivePass(f.spouse.user._id, gym._id, now)).toBeNull(); // mới mua cho tháng sau
      const inNextMonth = periodEnd(CUR);
      expect(await passes.getActivePass(f.spouse.user._id, gym._id, inNextMonth)).toMatchObject({ month: NEXT });
      expect(await passes.getActivePass(f.owner.user._id, gym._id, inNextMonth)).toBeNull();
      // Mốc giờ VN: 23:59:59 ngày cuối tháng vẫn thuộc tháng này
      expect((await passes.getActivePass(f.owner.user._id, gym._id, new Date(periodEnd(CUR).getTime() - 1)))._id.toString()).toBe(current._id);

      await request(app).patch(`/api/amenity-passes/${current._id}/cancel`).set(auth(await createManager())).send({ reason: 'Hủy để kiểm tra' });
      expect(await passes.getActivePass(f.owner.user._id, gym._id, now)).toBeNull();
      // Gói khác tiện ích không lẫn
      expect(await passes.getActivePass(f.owner.user._id, (await makeAmenity({ name: 'Yoga' }))._id, now)).toBeNull();
    });

    it('trang Gia đình (GET /member-codes/household): mỗi người có gói tháng này + tháng sau đang ACTIVE; lookup chỉ gói đang hiệu lực (tháng này)', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const tennis = await makeAmenity(TENNIS);
      await buy(f.owner.user, f, f.spouse, gym, CUR);
      const nextOnly = (await buy(f.owner.user, f, f.spouse, tennis, NEXT)).body.data;
      await buy(f.owner.user, f, f.child, gym, NEXT);

      const view = await request(app).get('/api/member-codes/household').set(auth(f.owner.user));
      const spouse = view.body.data.members.find((m) => m.fullName === 'Vợ');
      expect(spouse.passes.map((p) => [p.amenityName, p.month, p.isCurrent, p.fee])).toEqual([
        ['Phòng gym', CUR, true, 400000],
        ['Sân tennis', NEXT, false, 600000],
      ]);
      expect(view.body.data.members.find((m) => m.fullName === 'Chủ hộ').passes).toEqual([]);
      expect(view.body.data.members.find((m) => m.fullName === 'Con').passes).toHaveLength(1);

      const lookup = await request(app).get('/api/member-codes/lookup').query({ q: 'A-0501-01' }).set(auth(await createReceptionist()));
      expect(lookup.status).toBe(200);
      expect(lookup.body.data.passes).toHaveLength(1);
      expect(lookup.body.data.passes[0]).toMatchObject({ amenityName: 'Phòng gym', month: CUR, ageGroup: 'ADULT' });

      // Hủy gói tháng sau → biến mất khỏi Gia đình
      await request(app).patch(`/api/amenity-passes/${nextOnly._id}/cancel`).set(auth(f.owner.user)).send({});
      const after = await request(app).get('/api/member-codes/household').set(auth(f.owner.user));
      expect(after.body.data.members.find((m) => m.fullName === 'Vợ').passes).toHaveLength(1);
      const empty = await request(app).get('/api/member-codes/lookup').query({ q: 'A-0501' }).set(auth(await createSecurity()));
      expect(empty.body.data.passes).toEqual([]);
    });

    it('model: không thể tạo 2 gói ACTIVE cùng (người, tiện ích, tháng); gói đã hủy không chặn', async () => {
      const f = await makeFamily();
      const gym = await makeAmenity();
      const base = { userId: f.owner.user._id, apartmentId: f.apartment._id, amenityId: gym._id, month: CUR, ageGroup: 'ADULT', fee: 1, purchasedBy: f.owner.user._id };
      await AmenityPass.create(base);
      await expect(AmenityPass.create(base)).rejects.toMatchObject({ code: 11000 });
      await AmenityPass.create({ ...base, status: 'CANCELLED' });
      await AmenityPass.create({ ...base, month: NEXT });
      expect(await AmenityPass.countDocuments()).toBe(3);
    });
  });
});
