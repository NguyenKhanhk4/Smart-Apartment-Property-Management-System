// Module D — UC-D11: hộ gia đình, mã cư dân (BR-O25), quyền phát sinh phí (BR-O26), tra mã tại quầy
// Dữ liệu hộ được tạo thẳng vào DB (residents / apartments) — không phụ thuộc seed hay code Module A.
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
const household = await import('../src/modules/household/household.service.js');
const codes = await import('../src/modules/memberCodes/memberCodes.service.js');
const { Apartment, MemberCode, Resident, User } = await import('../src/models/index.js');

const DAY = 86400e3;
const app = createApp();
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

/** Tòa A + căn 0501. status: OWNED | RENTED */
async function makeApartment({ buildingCode = 'A', code = '0501', status = 'OWNED' } = {}) {
  const building = await createBuilding({ code: buildingCode, name: `Tòa ${buildingCode}` });
  const apartment = await createApartment(building, { code, status });
  return { building, apartment };
}

/** Tạo user cư dân + gán vào căn. moveIn: số ngày trước hôm nay (lớn hơn = ở lâu hơn) */
async function addPerson(apartment, relationType, name, { moveIn = 10, userExtra = {}, resident = {} } = {}) {
  const user = await createResident({ fullName: name, ...userExtra });
  const row = await linkResident(user, apartment, { relationType, moveInDate: new Date(Date.now() - moveIn * DAY), ...resident });
  return { user, row };
}

/** Hộ mẫu: chủ sở hữu đang ở + 2 thành viên */
async function makeFamily() {
  const { building, apartment } = await makeApartment();
  const owner = await addPerson(apartment, 'OWNER', 'Chủ hộ', { moveIn: 100 });
  const spouse = await addPerson(apartment, 'FAMILY_MEMBER', 'Vợ', { moveIn: 90 });
  const child = await addPerson(apartment, 'FAMILY_MEMBER', 'Con nhỏ', { moveIn: 80 });
  return { building, apartment, owner, spouse, child };
}

const ymdFromNow = (days) => new Date(Date.now() + 7 * 3600e3 - days * DAY).toISOString().slice(0, 10);
const yearsAgoYmd = (years) => ymdFromNow(years * 365.25);

describe('member codes (UC-D11)', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('household.service — quy tắc chủ hộ', () => {
    it('căn OWNED: chủ sở hữu là chủ hộ (đứng đầu danh sách), người còn lại là thành viên; có thông tin ảnh/tên/SĐT', async () => {
      const f = await makeFamily();
      await User.updateOne({ _id: f.owner.user._id }, { avatarUrl: 'https://cdn.test/a.png', phone: '0901' });
      const h = await household.getHousehold(f.apartment._id);
      expect(h.apartment).toMatchObject({ code: '0501', buildingId: { code: 'A', name: 'Tòa A' } });
      expect(h.ownerResiding).toBe(true);
      expect(h.members.map((m) => m.fullName)).toEqual(['Chủ hộ', 'Vợ', 'Con nhỏ']);
      expect(h.members.map((m) => m.isHead)).toEqual([true, false, false]);
      expect(h.head).toMatchObject({ fullName: 'Chủ hộ', relationType: 'OWNER', avatarUrl: 'https://cdn.test/a.png', phone: '0901' });
      expect(h.owner).toMatchObject({ fullName: 'Chủ hộ', userId: String(f.owner.user._id) });
      expect(h.members[2]).toMatchObject({ relationType: 'FAMILY_MEMBER', dateOfBirth: null, avatarUrl: null });
    });

    it('căn RENTED có TENANT: TENANT ở lâu nhất là chủ hộ; chủ sở hữu "không ở" không nằm trong members nhưng vẫn trả ở owner', async () => {
      const { apartment } = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(apartment, 'OWNER', 'Chủ sở hữu', { moveIn: 500 });
      const tenantNew = await addPerson(apartment, 'TENANT', 'Thuê sau', { moveIn: 20 });
      const tenantOld = await addPerson(apartment, 'TENANT', 'Thuê trước', { moveIn: 60 });
      const kid = await addPerson(apartment, 'FAMILY_MEMBER', 'Con người thuê', { moveIn: 30 });

      const h = await household.getHousehold(apartment._id);
      expect(h.ownerResiding).toBe(false);
      expect(h.head).toMatchObject({ fullName: 'Thuê trước', isHead: true });
      expect(h.members.map((m) => m.fullName)).toEqual(['Thuê trước', 'Con người thuê', 'Thuê sau']);
      expect(h.members.some((m) => m.userId === String(owner.user._id))).toBe(false);
      expect(h.owner).toMatchObject({ fullName: 'Chủ sở hữu' });

      // Chủ sở hữu không ở: không có quyền Module D trong căn
      expect(await household.getMyHouseholds(owner.user._id)).toEqual([]);
      await expect(household.assertMember(owner.user._id, apartment._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE', status: 403 });
      await expect(household.assertHead(owner.user._id, apartment._id)).rejects.toMatchObject({ status: 403 });
      const mine = await household.getMyHouseholds(tenantOld.user._id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ isHead: true, relationType: 'TENANT' });
      expect((await household.getMyHouseholds(kid.user._id))[0].isHead).toBe(false);
      expect(String(tenantNew.user._id)).not.toBe(String(h.head.userId));
    });

    it('căn RENTED nhưng chưa có TENANT đang ở → chủ sở hữu vẫn là chủ hộ; TENANT đã chuyển đi không tính', async () => {
      const { apartment } = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(apartment, 'OWNER', 'Chủ sở hữu');
      await addPerson(apartment, 'TENANT', 'Đã đi', { resident: { isActive: false } });
      const h = await household.getHousehold(apartment._id);
      expect(h.ownerResiding).toBe(true);
      expect(h.head.userId).toBe(String(owner.user._id));
      expect(h.members).toHaveLength(1);
    });

    it('bỏ qua cư dân đã chuyển đi, tài khoản bị khóa; căn không tồn tại → NOT_FOUND', async () => {
      const f = await makeFamily();
      await Resident.updateOne({ _id: f.spouse.row._id }, { isActive: false });
      await User.updateOne({ _id: f.child.user._id }, { isActive: false });
      const h = await household.getHousehold(f.apartment._id);
      expect(h.members.map((m) => m.fullName)).toEqual(['Chủ hộ']);
      await expect(household.getHousehold('0123456789abcdef01234567')).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
      expect(await household.getMyHouseholds(f.spouse.user._id)).toEqual([]);
    });

    it('ngày sinh: ưu tiên users.dateOfBirth (khi Module A có), không thì member_codes.dateOfBirth', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await MemberCode.updateOne({ userId: f.child.user._id, isActive: true }, { dateOfBirth: new Date('2020-05-12T00:00:00+07:00') });
      let h = await household.getHousehold(f.apartment._id);
      expect(h.members.find((m) => m.fullName === 'Con nhỏ').dateOfBirth.toISOString()).toBe('2020-05-11T17:00:00.000Z');

      // Giả lập Module A đã có users.dateOfBirth (schema hiện chưa khai báo nên ghi thẳng vào collection)
      await User.collection.updateOne({ _id: f.child.user._id }, { $set: { dateOfBirth: new Date('2019-01-01T00:00:00+07:00') } });
      h = await household.getHousehold(f.apartment._id);
      expect(h.members.find((m) => m.fullName === 'Con nhỏ').dateOfBirth.toISOString()).toBe('2018-12-31T17:00:00.000Z');
    });

    it('assertMember / assertHead: thành viên thường → HOUSEHOLD_HEAD_REQUIRED; người ngoài hộ → FORBIDDEN_ROLE; chủ hộ qua', async () => {
      const f = await makeFamily();
      const stranger = await createResident();
      const idApt = f.apartment._id;
      expect((await household.assertHead(f.owner.user._id, idApt)).me.isHead).toBe(true);
      expect((await household.assertMember(f.spouse.user._id, idApt)).me.fullName).toBe('Vợ');
      await expect(household.assertHead(f.spouse.user._id, idApt)).rejects.toMatchObject({ errorCode: 'HOUSEHOLD_HEAD_REQUIRED', status: 403 });
      await expect(household.assertMember(stranger._id, idApt)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE', status: 403 });
      await expect(household.assertHead(stranger._id, idApt)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
    });

    it('getMyHouseholds: người ở nhiều căn thấy đủ các căn; mỗi căn có isHead riêng', async () => {
      const a = await makeApartment({ buildingCode: 'A', code: '0501' });
      const b = await makeApartment({ buildingCode: 'B', code: '0102' });
      const user = await createResident();
      await linkResident(user, a.apartment, { relationType: 'OWNER' });
      await linkResident(user, b.apartment, { relationType: 'FAMILY_MEMBER' });
      await addPerson(b.apartment, 'OWNER', 'Chủ căn B');
      const mine = await household.getMyHouseholds(user._id);
      expect(mine.map((m) => [m.apartment.code, m.isHead])).toEqual([
        ['0501', true],
        ['0102', false],
      ]);
    });
  });

  describe('mã chữ (BR-O25)', () => {
    it('apartmentNumber / formatCode: bỏ tiền tố trùng mã tòa, đệm 4 chữ số, không phải số thì dùng nguyên văn', () => {
      expect(codes.apartmentNumber('A-0501', 'A')).toBe('0501');
      expect(codes.apartmentNumber('A0501', 'A')).toBe('0501');
      expect(codes.apartmentNumber('0501', 'A')).toBe('0501');
      expect(codes.apartmentNumber('501', 'A')).toBe('0501');
      expect(codes.apartmentNumber('a_12', 'A')).toBe('0012');
      expect(codes.apartmentNumber('12B', 'A')).toBe('12B');
      expect(codes.apartmentNumber('A-12B', 'A')).toBe('12B');
      expect(codes.apartmentNumber('A', 'A')).toBe('A'); // chỉ có mã tòa → giữ nguyên
      expect(codes.formatCode('A', 'A-0501', 0)).toBe('A-0501');
      expect(codes.formatCode('A', 'A-0501', 1)).toBe('A-0501-01');
      expect(codes.formatCode('a', '0501', 12)).toBe('A-0501-12');
      expect(codes.formatCode('A', '0501', 100)).toBe('A-0501-100');
    });

    it('chủ hộ A-0501, thành viên A-0501-01, A-0501-02 theo thứ tự ở; gọi lại không sinh thêm', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await codes.ensureCodes(f.apartment._id);
      const rows = await MemberCode.find({ apartmentId: f.apartment._id }).sort({ seq: 1 }).lean();
      expect(rows.map((r) => [r.code, r.seq, r.isActive])).toEqual([
        ['A-0501', 0, true],
        ['A-0501-01', 1, true],
        ['A-0501-02', 2, true],
      ]);
      expect(String(rows[0].userId)).toBe(String(f.owner.user._id));
      expect(String(rows[2].userId)).toBe(String(f.child.user._id));
      expect(rows[0]).toMatchObject({ canIncurCharges: false, revokedAt: null, dateOfBirth: null });
    });

    it('mã tòa lấy từ Building.code; số căn lấy từ Apartment.code kể cả có tiền tố / không phải số', async () => {
      const a = await makeApartment({ buildingCode: 'B', code: 'B-0102' });
      const c = await makeApartment({ buildingCode: 'C', code: '12B' });
      await addPerson(a.apartment, 'OWNER', 'Chủ B');
      await addPerson(c.apartment, 'OWNER', 'Chủ C');
      await codes.ensureCodes(a.apartment._id);
      await codes.ensureCodes(c.apartment._id);
      expect((await MemberCode.findOne({ apartmentId: a.apartment._id }).lean()).code).toBe('B-0102');
      expect((await MemberCode.findOne({ apartmentId: c.apartment._id }).lean()).code).toBe('C-12B');
    });

    it('thêm thành viên thứ 3 sau khi xóa thành viên thứ 2 → -03 (không dùng lại số); mã người rời bị thu hồi, giữ lịch sử', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await Resident.updateOne({ _id: f.child.row._id }, { isActive: false }); // seq 2 rời đi
      const grandma = await addPerson(f.apartment, 'FAMILY_MEMBER', 'Bà', { moveIn: 5 });
      await codes.ensureCodes(f.apartment._id);

      const active = await MemberCode.find({ apartmentId: f.apartment._id, isActive: true }).sort({ seq: 1 }).lean();
      expect(active.map((r) => r.code)).toEqual(['A-0501', 'A-0501-01', 'A-0501-03']);
      expect(String(active[2].userId)).toBe(String(grandma.user._id));
      const revoked = await MemberCode.findOne({ userId: f.child.user._id }).lean();
      expect(revoked).toMatchObject({ code: 'A-0501-02', isActive: false });
      expect(revoked.revokedAt).toBeInstanceOf(Date);
    });

    it('thành viên rời hết rồi người mới vào: số vẫn tiếp tục từ số lớn nhất đã cấp', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await Resident.updateMany({ _id: { $in: [f.spouse.row._id, f.child.row._id] } }, { isActive: false });
      await codes.ensureCodes(f.apartment._id);
      await addPerson(f.apartment, 'FAMILY_MEMBER', 'Người mới');
      await codes.ensureCodes(f.apartment._id);
      const codesNow = (await MemberCode.find({ apartmentId: f.apartment._id, isActive: true }).sort({ seq: 1 }).lean()).map((r) => r.code);
      expect(codesNow).toEqual(['A-0501', 'A-0501-03']);
    });

    it('người chuyển đi (kể cả chủ hộ): mã thu hồi; hộ mới nhận lại A-0501 và -01 bắt đầu tiếp theo số đã cấp', async () => {
      const { apartment } = await makeApartment();
      const oldOwner = await addPerson(apartment, 'OWNER', 'Chủ cũ');
      await codes.ensureCodes(apartment._id);
      await Resident.updateOne({ _id: oldOwner.row._id }, { isActive: false });
      await codes.ensureCodes(apartment._id);
      expect(await MemberCode.countDocuments({ apartmentId: apartment._id, isActive: true })).toBe(0);

      const newOwner = await addPerson(apartment, 'OWNER', 'Chủ mới');
      await codes.ensureCodes(apartment._id);
      const mine = await MemberCode.findOne({ userId: newOwner.user._id, isActive: true }).lean();
      expect(mine).toMatchObject({ code: 'A-0501', seq: 0 });
      expect(await MemberCode.countDocuments({ code: 'A-0501' })).toBe(2); // lịch sử: bản cũ đã thu hồi + bản mới
    });

    it('căn đang cho thuê: TENANT nhận A-0501, chủ sở hữu "không ở" bị thu hồi mã; người ở trước đó giữ số cũ', async () => {
      const { apartment } = await makeApartment();
      const owner = await addPerson(apartment, 'OWNER', 'Chủ sở hữu', { moveIn: 400 });
      const relative = await addPerson(apartment, 'FAMILY_MEMBER', 'Người nhà', { moveIn: 300 });
      await codes.ensureCodes(apartment._id);
      expect((await MemberCode.findOne({ userId: owner.user._id, isActive: true }).lean()).code).toBe('A-0501');

      await Apartment.updateOne({ _id: apartment._id }, { status: 'RENTED' });
      const tenant = await addPerson(apartment, 'TENANT', 'Người thuê', { moveIn: 3 });
      await codes.ensureCodes(apartment._id);

      expect(await MemberCode.findOne({ userId: owner.user._id, isActive: true })).toBeNull();
      expect((await MemberCode.findOne({ userId: tenant.user._id, isActive: true }).lean()).code).toBe('A-0501');
      expect((await MemberCode.findOne({ userId: relative.user._id, isActive: true }).lean()).code).toBe('A-0501-01');
    });

    it('đổi chủ hộ: người mới nhận seq 0, người cũ nếu còn ở nhận số mới và mã cũ bị thu hồi', async () => {
      const { apartment } = await makeApartment({ status: 'RENTED' });
      const t1 = await addPerson(apartment, 'TENANT', 'Người thuê 1', { moveIn: 50 });
      const kid = await addPerson(apartment, 'FAMILY_MEMBER', 'Con', { moveIn: 40 });
      await codes.ensureCodes(apartment._id);
      // Module A bổ sung hợp đồng thuê có ngày vào ở sớm hơn → người này trở thành chủ hộ
      const t0 = await addPerson(apartment, 'TENANT', 'Người thuê 0', { moveIn: 200 });
      await codes.ensureCodes(apartment._id);

      const byUser = async (u) => (await MemberCode.findOne({ userId: u._id, isActive: true }).lean()).code;
      expect(await byUser(t0.user)).toBe('A-0501');
      expect(await byUser(kid.user)).toBe('A-0501-01');
      expect(await byUser(t1.user)).toBe('A-0501-02'); // số mới, không dùng lại A-0501
      expect(await MemberCode.countDocuments({ userId: t1.user._id, code: 'A-0501', isActive: false })).toBe(1);
    });

    it('hộ chưa có chủ sở hữu / người thuê (dữ liệu Module A chưa đủ): vẫn cấp mã thành viên, không lỗi', async () => {
      const { apartment } = await makeApartment();
      await addPerson(apartment, 'FAMILY_MEMBER', 'Chỉ có người nhà');
      const h = await codes.ensureCodes(apartment._id);
      expect(h.head).toBeNull();
      expect((await MemberCode.findOne({ apartmentId: apartment._id }).lean()).code).toBe('A-0501-01');
    });

    it('ngày sinh và quyền phát sinh phí: ngày sinh theo người (giữ khi cấp lại mã), chủ hộ mới/cũ không thừa hưởng canIncurCharges', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await MemberCode.updateOne({ userId: f.child.user._id, isActive: true }, { dateOfBirth: new Date('2020-01-01T00:00:00+07:00'), canIncurCharges: true });
      // Con rời căn rồi quay lại → mã mới, giữ ngày sinh nhưng canIncurCharges về mặc định false
      await Resident.updateOne({ _id: f.child.row._id }, { isActive: false });
      await codes.ensureCodes(f.apartment._id);
      await Resident.updateOne({ _id: f.child.row._id }, { isActive: true });
      await codes.ensureCodes(f.apartment._id);
      const again = await MemberCode.findOne({ userId: f.child.user._id, isActive: true }).lean();
      expect(again.code).toBe('A-0501-03');
      expect(again.dateOfBirth.toISOString()).toBe('2019-12-31T17:00:00.000Z');
      expect(again.canIncurCharges).toBe(false);
    });

    it('gọi ensureCodes đồng thời → không trùng mã, đủ mã cho cả hộ', async () => {
      const f = await makeFamily();
      await Promise.all([codes.ensureCodes(f.apartment._id), codes.ensureCodes(f.apartment._id), codes.ensureCodes(f.apartment._id)]);
      const rows = await MemberCode.find({ apartmentId: f.apartment._id, isActive: true }).lean();
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.code)).size).toBe(3);
    });

    it('index: không thể có 2 bản ghi hiệu lực cùng mã hoặc cùng (người, căn)', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      const base = await MemberCode.findOne({ apartmentId: f.apartment._id, isActive: true }).lean();
      await expect(MemberCode.create({ userId: f.child.user._id, apartmentId: f.apartment._id, code: base.code, seq: 9 })).rejects.toMatchObject({ code: 11000 });
      await expect(MemberCode.create({ userId: base.userId, apartmentId: base.apartmentId, code: 'A-0501-77', seq: 77 })).rejects.toMatchObject({ code: 11000 });
      // Bản ghi đã thu hồi thì không chặn
      await MemberCode.create({ userId: base.userId, apartmentId: base.apartmentId, code: base.code, seq: 0, isActive: false });
    });
  });

  describe('API — resident', () => {
    it('GET /mine: chủ hộ thấy A-0501, thành viên thấy A-0501-01; có ảnh, tên, nhóm tuổi; 401 không token; 403 role khác', async () => {
      const f = await makeFamily();
      await User.updateOne({ _id: f.spouse.user._id }, { avatarUrl: 'https://cdn.test/vo.png' });
      const head = await request(app).get('/api/member-codes/mine').set(auth(f.owner.user));
      expect(head.status).toBe(200);
      expect(head.body.data).toHaveLength(1);
      expect(head.body.data[0]).toMatchObject({
        userId: String(f.owner.user._id),
        code: 'A-0501',
        isHead: true,
        canIncurCharges: true,
        fullName: 'Chủ hộ',
        ageGroup: 'ADULT',
        age: null,
        apartment: { code: '0501', building: { code: 'A' } },
      });
      const mem = await request(app).get('/api/member-codes/mine').set(auth(f.spouse.user));
      expect(mem.body.data[0]).toMatchObject({ code: 'A-0501-01', isHead: false, canIncurCharges: false, avatarUrl: 'https://cdn.test/vo.png' });

      expect((await request(app).get('/api/member-codes/mine')).status).toBe(401);
      expect((await request(app).get('/api/member-codes/mine').set(auth(await createManager()))).status).toBe(403);
      expect((await request(app).get('/api/member-codes/mine').set(auth(await createReceptionist()))).status).toBe(403);
    });

    it('GET /mine: chủ sở hữu căn đang cho thuê (không ở) không có mã; người thuê có A-0501; người chưa gán căn → mảng rỗng', async () => {
      const { apartment } = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(apartment, 'OWNER', 'Chủ sở hữu', { moveIn: 300 });
      const tenant = await addPerson(apartment, 'TENANT', 'Người thuê', { moveIn: 30 });
      const mineOwner = await request(app).get('/api/member-codes/mine').set(auth(owner.user));
      expect(mineOwner.status).toBe(200);
      expect(mineOwner.body.data).toEqual([]);
      const mineTenant = await request(app).get('/api/member-codes/mine').set(auth(tenant.user));
      expect(mineTenant.body.data[0]).toMatchObject({ code: 'A-0501', isHead: true, relationType: 'TENANT' });
      expect((await request(app).get('/api/member-codes/mine').set(auth(await createResident()))).body.data).toEqual([]);
      // Chủ sở hữu không ở cũng không vào được màn chủ hộ
      expect((await request(app).get(`/api/member-codes/household?apartmentId=${apartment._id}`).set(auth(owner.user))).status).toBe(403);
    });

    it('GET /household: chủ hộ xem thành viên + mã + canIncurCharges + tuổi; thành viên thường → 403 HOUSEHOLD_HEAD_REQUIRED', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      await MemberCode.updateOne({ userId: f.spouse.user._id }, { canIncurCharges: true });
      const res = await request(app).get('/api/member-codes/household').set(auth(f.owner.user));
      expect(res.status).toBe(200);
      expect(res.body.data.apartment).toMatchObject({ code: '0501', building: { code: 'A', name: 'Tòa A' } });
      expect(res.body.data.ownerResiding).toBe(true);
      const byName = Object.fromEntries(res.body.data.members.map((m) => [m.fullName, m]));
      expect(byName['Chủ hộ']).toMatchObject({ code: 'A-0501', isHead: true, canIncurCharges: true, passes: [] });
      expect(byName['Vợ']).toMatchObject({ code: 'A-0501-01', canIncurCharges: true });
      expect(byName['Con nhỏ']).toMatchObject({ code: 'A-0501-02', canIncurCharges: false, ageGroup: 'ADULT', age: null });

      const denied = await request(app).get('/api/member-codes/household').set(auth(f.spouse.user));
      expect(denied.status).toBe(403);
      expect(denied.body.errorCode).toBe('HOUSEHOLD_HEAD_REQUIRED');
      expect((await request(app).get('/api/member-codes/household').set(auth(await createTechnician()))).status).toBe(403);
      expect((await request(app).get('/api/member-codes/household')).status).toBe(401);
    });

    it('PATCH /household/:userId: bật/tắt canIncurCharges; chủ hộ đặt ngày sinh cho con → nhóm tuổi đổi đúng (CHILD_FREE → CHILD → ADULT)', async () => {
      const f = await makeFamily();
      const url = `/api/member-codes/household/${f.child.user._id}`;
      const on = await request(app).patch(url).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect(on.status).toBe(200);
      expect(on.body.data).toMatchObject({ fullName: 'Con nhỏ', canIncurCharges: true, code: 'A-0501-02' });
      const off = await request(app).patch(url).set(auth(f.owner.user)).send({ canIncurCharges: false });
      expect(off.body.data.canIncurCharges).toBe(false);

      const small = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: yearsAgoYmd(5.5) });
      expect(small.body.data).toMatchObject({ age: 5, ageGroup: 'CHILD_FREE' });
      const kid = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: yearsAgoYmd(8.5) });
      expect(kid.body.data).toMatchObject({ age: 8, ageGroup: 'CHILD' });
      const teen = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: yearsAgoYmd(13.5) });
      expect(teen.body.data).toMatchObject({ age: 13, ageGroup: 'ADULT' });
      // Lưu theo 00:00 giờ VN và hiển thị lại ở GET /household
      const list = await request(app).get('/api/member-codes/household').set(auth(f.owner.user));
      expect(list.body.data.members.find((m) => m.fullName === 'Con nhỏ')).toMatchObject({ age: 13, ageGroup: 'ADULT' });
      expect((await MemberCode.findOne({ userId: f.child.user._id, isActive: true }).lean()).dateOfBirth.toISOString()).toMatch(/T17:00:00\.000Z$/);

      // Xóa ngày sinh → coi là người lớn
      const cleared = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: null });
      expect(cleared.body.data).toMatchObject({ age: null, ageGroup: 'ADULT', dateOfBirth: null });
    });

    it('PATCH: ngày sinh tương lai → 400; hôm nay hợp lệ (CHILD_FREE); ngày không có thật / sai định dạng / body rỗng → 400', async () => {
      const f = await makeFamily();
      const url = `/api/member-codes/household/${f.child.user._id}`;
      const tomorrow = ymdFromNow(-1);
      const future = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: tomorrow });
      expect(future.status).toBe(400);
      expect(future.body.errorCode).toBe('VALIDATION_ERROR');
      expect(future.body.details).toEqual([{ field: 'dateOfBirth', message: 'Ngày sinh không được ở tương lai' }]);
      expect((await MemberCode.findOne({ userId: f.child.user._id, isActive: true }).lean()).dateOfBirth).toBeNull();

      const today = await request(app).patch(url).set(auth(f.owner.user)).send({ dateOfBirth: ymdFromNow(0) });
      expect(today.status).toBe(200);
      expect(today.body.data).toMatchObject({ age: 0, ageGroup: 'CHILD_FREE' });

      for (const bad of [{ dateOfBirth: '2026-02-31' }, { dateOfBirth: '12/05/2020' }, { dateOfBirth: '1800-01-01' }, {}, { canIncurCharges: 'x' }]) {
        expect((await request(app).patch(url).set(auth(f.owner.user)).send(bad)).status).toBe(400);
      }
    });

    it('PATCH: thành viên thường 403; chủ hộ tự bật phí cho mình → 400; người ngoài hộ → 404; người ngoài hộ gọi → 403; không token 401', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      const url = `/api/member-codes/household/${f.child.user._id}`;
      const asMember = await request(app).patch(url).set(auth(f.spouse.user)).send({ canIncurCharges: true });
      expect(asMember.status).toBe(403);
      expect(asMember.body.errorCode).toBe('HOUSEHOLD_HEAD_REQUIRED');
      expect((await MemberCode.findOne({ userId: f.child.user._id, isActive: true }).lean()).canIncurCharges).toBe(false);

      const self = await request(app).patch(`/api/member-codes/household/${f.owner.user._id}`).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect(self.status).toBe(400);
      // Chủ hộ vẫn sửa được ngày sinh của chính mình
      expect((await request(app).patch(`/api/member-codes/household/${f.owner.user._id}`).set(auth(f.owner.user)).send({ dateOfBirth: '1985-03-04' })).status).toBe(200);

      const outsider = await createResident();
      const notMember = await request(app).patch(`/api/member-codes/household/${outsider._id}`).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect(notMember.status).toBe(404);
      expect(notMember.body.errorCode).toBe('MEMBER_CODE_NOT_FOUND');
      expect((await request(app).patch(url).set(auth(outsider)).send({ canIncurCharges: true })).status).toBe(403);
      expect((await request(app).patch(url).send({ canIncurCharges: true })).status).toBe(401);
    });

    it('PATCH: chủ hộ ở 2 căn phải chọn apartmentId; sửa đúng căn được chọn', async () => {
      const f = await makeFamily();
      const second = await makeApartment({ buildingCode: 'B', code: '0201' });
      await linkResident(f.owner.user, second.apartment, { relationType: 'OWNER' });
      const url = `/api/member-codes/household/${f.child.user._id}`;
      expect((await request(app).patch(url).set(auth(f.owner.user)).send({ canIncurCharges: true })).status).toBe(400);
      const ok = await request(app).patch(`${url}?apartmentId=${f.apartment._id}`).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect(ok.status).toBe(200);
      // Chủ hộ căn B không phải thành viên căn A của "con" → 404
      const wrong = await request(app).patch(`${url}?apartmentId=${second.apartment._id}`).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect(wrong.status).toBe(404);
    });

  });

  describe('API — Lễ tân sửa ngày sinh', () => {
    it('Lễ tân đặt ngày sinh theo giấy tờ → 200, nhóm tuổi đúng và hiện ở GET /household của chủ hộ', async () => {
      const f = await makeFamily();
      const recep = await createReceptionist();
      const res = await request(app).patch(`/api/member-codes/${f.child.user._id}/date-of-birth`).set(auth(recep)).send({ dateOfBirth: yearsAgoYmd(7.5) });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ fullName: 'Con nhỏ', age: 7, ageGroup: 'CHILD' });
      const list = await request(app).get('/api/member-codes/household').set(auth(f.owner.user));
      expect(list.body.data.members.find((m) => m.fullName === 'Con nhỏ')).toMatchObject({ age: 7, ageGroup: 'CHILD' });
    });

    it('ngày sinh tương lai / sai định dạng / thiếu → 400; role khác Lễ tân (Trưởng BQL, Bảo vệ, KTV, cư dân) → 403; không token → 401; người chưa có hộ → 404', async () => {
      const f = await makeFamily();
      const url = `/api/member-codes/${f.child.user._id}/date-of-birth`;
      await codes.ensureCodes(f.apartment._id);
      const recep = await createReceptionist();
      expect((await request(app).patch(url).set(auth(recep)).send({ dateOfBirth: ymdFromNow(-2) })).status).toBe(400);
      expect((await request(app).patch(url).set(auth(recep)).send({ dateOfBirth: 'abc' })).status).toBe(400);
      expect((await request(app).patch(url).set(auth(recep)).send({})).status).toBe(400);
      for (const user of [await createManager(), await createSecurity(), await createTechnician(), f.owner.user]) {
        expect((await request(app).patch(url).set(auth(user)).send({ dateOfBirth: '2020-01-01' })).status).toBe(403);
      }
      expect((await request(app).patch(url).send({ dateOfBirth: '2020-01-01' })).status).toBe(401);
      expect((await MemberCode.findOne({ userId: f.child.user._id, isActive: true }).lean()).dateOfBirth).toBeNull();

      const homeless = await createResident();
      const none = await request(app).patch(`/api/member-codes/${homeless._id}/date-of-birth`).set(auth(recep)).send({ dateOfBirth: '2020-01-01' });
      expect(none.status).toBe(404);
      expect(none.body.errorCode).toBe('MEMBER_CODE_NOT_FOUND');
      expect((await request(app).patch('/api/member-codes/0123456789abcdef01234567/date-of-birth').set(auth(recep)).send({ dateOfBirth: '2020-01-01' })).status).toBe(404);
    });
  });

  describe('API — tra mã tại quầy (/lookup)', () => {
    const lookup = (q, user) => request(app).get('/api/member-codes/lookup').query({ q }).set(auth(user));

    it('Lễ tân, Bảo vệ, Trưởng BQL → 200; KTV, cư dân → 403; không token → 401; thiếu q → 400', async () => {
      const f = await makeFamily();
      for (const user of [await createReceptionist(), await createSecurity(), await createManager()]) {
        expect((await lookup('A-0501', user)).status).toBe(200);
      }
      expect((await lookup('A-0501', await createTechnician())).status).toBe(403);
      expect((await lookup('A-0501', f.owner.user)).status).toBe(403);
      expect((await request(app).get('/api/member-codes/lookup?q=A-0501')).status).toBe(401);
      expect((await request(app).get('/api/member-codes/lookup').set(auth(await createReceptionist()))).status).toBe(400);
    });

    it('tra mã chữ: trả ảnh đại diện + tuổi/nhóm tuổi + căn + cả hộ; không phân biệt hoa thường/khoảng trắng', async () => {
      const f = await makeFamily();
      await User.updateOne({ _id: f.child.user._id }, { avatarUrl: 'https://cdn.test/con.png' });
      await codes.ensureCodes(f.apartment._id);
      await MemberCode.updateOne({ userId: f.child.user._id }, { dateOfBirth: new Date(`${yearsAgoYmd(4.5)}T00:00:00+07:00`) });
      const recep = await createReceptionist();

      const res = await lookup('  a-0501-02 ', recep);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        code: 'A-0501-02',
        isHead: false,
        canIncurCharges: false,
        person: { fullName: 'Con nhỏ', avatarUrl: 'https://cdn.test/con.png', age: 4, ageGroup: 'CHILD_FREE', relationType: 'FAMILY_MEMBER' },
        apartment: { code: '0501', building: { code: 'A', name: 'Tòa A' } },
      });
      expect(res.body.data.household.map((m) => [m.fullName, m.code, m.isHead])).toEqual([
        ['Chủ hộ', 'A-0501', true],
        ['Vợ', 'A-0501-01', false],
        ['Con nhỏ', 'A-0501-02', false],
      ]);

      const head = await lookup('A-0501', recep);
      expect(head.body.data).toMatchObject({ isHead: true, canIncurCharges: true, person: { fullName: 'Chủ hộ', avatarUrl: null, ageGroup: 'ADULT', age: null } });
      await request(app).patch(`/api/member-codes/household/${f.spouse.user._id}`).set(auth(f.owner.user)).send({ canIncurCharges: true });
      expect((await lookup('A-0501-01', recep)).body.data.canIncurCharges).toBe(true);
    });

    it('người rời căn → mã thu hồi → lookup 404 MEMBER_CODE_NOT_FOUND; mã không tồn tại → 404', async () => {
      const f = await makeFamily();
      const recep = await createReceptionist();
      expect((await lookup('A-0501-02', recep)).status).toBe(200);

      await Resident.updateOne({ _id: f.child.row._id }, { isActive: false }); // lễ tân (Module A) cho con chuyển đi
      const gone = await lookup('A-0501-02', recep);
      expect(gone.status).toBe(404);
      expect(gone.body.errorCode).toBe('MEMBER_CODE_NOT_FOUND');
      expect((await MemberCode.findOne({ userId: f.child.user._id }).lean()).isActive).toBe(false);
      expect((await lookup('Z-9999', recep)).status).toBe(404);
      expect((await lookup('A-0501-09', recep)).status).toBe(404);
    });

    it('thành viên mới vừa được Lễ tân thêm (chưa ai mở app) vẫn tra được vì mã sinh lười khi tra', async () => {
      const f = await makeFamily();
      await codes.ensureCodes(f.apartment._id);
      const newcomer = await addPerson(f.apartment, 'FAMILY_MEMBER', 'Người mới', { moveIn: 1 });
      expect(await MemberCode.countDocuments({ userId: newcomer.user._id })).toBe(0);
      const res = await lookup('A-0501-03', await createReceptionist());
      expect(res.status).toBe(200);
      expect(res.body.data.person.fullName).toBe('Người mới');
    });

    it('căn đang cho thuê: tra mã A-0501 ra người thuê; chủ sở hữu không ở không còn tra được', async () => {
      const { apartment } = await makeApartment({ status: 'RENTED' });
      const owner = await addPerson(apartment, 'OWNER', 'Chủ sở hữu', { moveIn: 300 });
      const tenant = await addPerson(apartment, 'TENANT', 'Người thuê', { moveIn: 3 });
      await MemberCode.create({ userId: owner.user._id, apartmentId: apartment._id, code: 'A-0501', seq: 0 }); // mã cũ còn sót từ trước khi cho thuê
      const res = await lookup('A-0501', await createReceptionist());
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ code: 'A-0501', isHead: true, person: { fullName: 'Người thuê', userId: String(tenant.user._id) } });
      expect(res.body.data.household.map((m) => m.fullName)).toEqual(['Người thuê']);
      expect((await MemberCode.findOne({ userId: owner.user._id }).lean()).isActive).toBe(false);
    });
  });
});
