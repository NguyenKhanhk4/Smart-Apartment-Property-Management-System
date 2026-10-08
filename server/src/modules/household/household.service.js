// Lớp ĐỌC dữ liệu hộ gia đình cho Module D (UC-D11, nền cho UC-D09/D10). Chỉ đọc bảng của Module A
// (residents, apartments, users, buildings) — KHÔNG ghi, KHÔNG sửa residency.service.
// Mọi suy luận "ai là chủ hộ" nằm ở đây; khi Module A bổ sung isHouseholdHead… chỉ cần sửa file này.
//
// Quy tắc (thiết kế 08/10/2026):
//  - Mỗi căn có đúng 1 chủ hộ. Căn RENTED có TENANT đang ở → chủ hộ là TENANT (ở lâu nhất nếu có nhiều); ngược lại là OWNER.
//  - Chủ sở hữu của căn RENTED đang có TENANT là "không ở": KHÔNG có quyền Module D trong căn đó (không là thành viên).
//  - Thành viên còn lại (FAMILY_MEMBER, hoặc TENANT/OWNER không phải chủ hộ) là tài khoản con.
import { APARTMENT_STATUS, RELATION_TYPES } from '../../constants/enums.js';
import { Apartment, MemberCode, Resident } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';

const USER_FIELDS = 'fullName avatarUrl phone isActive dateOfBirth'; // dateOfBirth: chờ Module A (hiện chưa có trong schema)

const sameId = (a, b) => String(a) === String(b);
const stayedSince = (r) => new Date(r.moveInDate ?? r.createdAt ?? 0).getTime();

function personOf(resident) {
  const u = resident.userId;
  return {
    userId: String(u._id),
    fullName: u.fullName,
    avatarUrl: u.avatarUrl ?? null,
    phone: u.phone ?? null,
  };
}

/**
 * Hộ gia đình của một căn.
 * @returns {Promise<{
 *   apartment: object,      // căn hộ (lean) kèm buildingId = { _id, code, name }
 *   head: object|null,      // chủ hộ (phần tử của members) — null nếu dữ liệu Module A chưa có OWNER/TENANT nào đang ở
 *   members: object[],      // người có quyền: { userId, fullName, avatarUrl, phone, relationType, dateOfBirth, isHead }
 *   owner: object|null,     // chủ sở hữu đang hoạt động, kể cả khi "không ở"
 *   ownerResiding: boolean  // false khi căn RENTED đang có TENANT
 * }>}
 */
export async function getHousehold(apartmentId) {
  const apartment = await Apartment.findById(apartmentId).populate('buildingId', 'code name').lean();
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');

  const rows = await Resident.find({ apartmentId, isActive: true }).populate('userId', USER_FIELDS).lean();
  // Tài khoản đã bị khóa / bị xóa không còn quyền
  const residents = rows.filter((r) => r.userId && r.userId.isActive !== false);

  const tenants = residents.filter((r) => r.relationType === RELATION_TYPES.TENANT).sort((a, b) => stayedSince(a) - stayedSince(b));
  const ownerRow = residents.find((r) => r.relationType === RELATION_TYPES.OWNER) ?? null;
  const ownerResiding = !(apartment.status === APARTMENT_STATUS.RENTED && tenants.length > 0);
  const headRow = ownerResiding ? ownerRow : tenants[0];

  const having = ownerResiding ? residents : residents.filter((r) => r !== ownerRow);
  const dobs = new Map(
    (
      await MemberCode.find({ apartmentId, isActive: true, userId: { $in: having.map((r) => r.userId._id) } })
        .select('userId dateOfBirth')
        .lean()
    ).map((c) => [String(c.userId), c.dateOfBirth]),
  );

  const members = having
    .map((r) => ({
      ...personOf(r),
      relationType: r.relationType,
      // Ưu tiên ngày sinh của Module A khi đã có; chưa có thì dùng bản lưu ở member_codes
      dateOfBirth: r.userId.dateOfBirth ?? dobs.get(String(r.userId._id)) ?? null,
      isHead: Boolean(headRow) && sameId(r._id, headRow._id),
      moveInAt: stayedSince(r),
    }))
    // Chủ hộ đứng đầu, còn lại theo thời gian ở
    .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.moveInAt - b.moveInAt)
    .map(({ moveInAt: _moveInAt, ...m }) => m);

  return {
    apartment,
    head: members.find((m) => m.isHead) ?? null,
    members,
    owner: ownerRow ? { ...personOf(ownerRow), relationType: ownerRow.relationType } : null,
    ownerResiding,
  };
}

/**
 * Các căn mà user là thành viên CÓ QUYỀN (bỏ chủ sở hữu "không ở").
 * @returns {Promise<{ apartment: object, relationType: string, isHead: boolean }[]>}
 */
export async function getMyHouseholds(userId) {
  const rows = await Resident.find({ userId, isActive: true }).select('apartmentId').sort({ createdAt: 1 }).lean();
  const out = [];
  for (const { apartmentId } of rows) {
    const household = await getHousehold(apartmentId);
    const me = household.members.find((m) => m.userId === String(userId));
    if (me) out.push({ apartment: household.apartment, relationType: me.relationType, isHead: me.isHead });
  }
  return out;
}

/** Thành viên có quyền của căn → trả về household; không phải thành viên → 403 */
export async function assertMember(userId, apartmentId) {
  const household = await getHousehold(apartmentId);
  const me = household.members.find((m) => m.userId === String(userId));
  if (!me) throw ApiError.forbidden('Bạn không có quyền sử dụng tiện ích trong căn hộ này');
  return { household, me };
}

/** Chủ hộ của căn → trả về household; thành viên thường → HOUSEHOLD_HEAD_REQUIRED (403) */
export async function assertHead(userId, apartmentId) {
  const { household, me } = await assertMember(userId, apartmentId);
  if (!me.isHead) throw new ApiError('HOUSEHOLD_HEAD_REQUIRED');
  return { household, me };
}
