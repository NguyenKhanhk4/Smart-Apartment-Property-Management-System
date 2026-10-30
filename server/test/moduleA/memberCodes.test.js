// Ngày sinh có 1 nguồn: users.dateOfBirth. member_codes.dateOfBirth chỉ còn là dữ liệu cũ (đọc dự phòng).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { MemberCode, User } from '../../src/models/index.js';
import { getHousehold } from '../../src/modules/household/household.service.js';
import * as memberCodes from '../../src/modules/memberCodes/memberCodes.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, createResidentUser, linkResident } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const dobYmd = (d) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

async function householdWithMember() {
  const { user: head, apartment } = await createHousehold();
  const member = await createResidentUser({ dateOfBirth: new Date('2000-01-01T00:00:00+07:00') });
  await linkResident(member, apartment);
  await memberCodes.ensureCodes(apartment._id);
  return { head, member, apartment };
}

test('chủ hộ sửa ngày sinh thành viên → ghi vào users.dateOfBirth, hộ gia đình đọc đúng giá trị mới', async () => {
  const { head, member, apartment } = await householdWithMember();
  // dữ liệu cũ còn lưu ngày sinh khác ở member_codes
  await MemberCode.updateMany({ userId: member._id }, { dateOfBirth: new Date('1990-05-05T00:00:00+07:00') });

  await memberCodes.updateMember(String(head._id), String(apartment._id), String(member._id), { dateOfBirth: '2015-03-02' });

  assert.equal(dobYmd((await User.findById(member._id)).dateOfBirth), '2015-03-02');
  const household = await getHousehold(apartment._id);
  const m = household.members.find((x) => x.userId === String(member._id));
  assert.equal(dobYmd(new Date(m.dateOfBirth)), '2015-03-02');
});

test('lễ tân sửa ngày sinh → ghi vào users.dateOfBirth', async () => {
  const { member } = await householdWithMember();
  await memberCodes.setDateOfBirthByStaff(String(member._id), '2012-12-12');
  assert.equal(dobYmd((await User.findById(member._id)).dateOfBirth), '2012-12-12');
});

test('lễ tân sửa ngày sinh người không có mã cư dân → MEMBER_CODE_NOT_FOUND', async () => {
  const stranger = await createResidentUser();
  await assert.rejects(memberCodes.setDateOfBirthByStaff(String(stranger._id), '2012-12-12'), { errorCode: 'MEMBER_CODE_NOT_FOUND' });
});
