// UC-D11 — Mã cư dân (BR-O25), quyền phát sinh phí của thành viên (BR-O26), tra mã tại quầy.
// Mã sinh LƯỜI theo hộ gia đình hiện tại (household.service) nên không phụ thuộc Module A có hook hay không.
import { Apartment, Building, MemberCode, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { retryOnDuplicate } from '../../utils/codeGenerator.js';
import { escapeRegex } from '../../utils/pagination.js';
import { ageAt, ageGroupOf } from '../amenities/pricing.js';
import { getBookingConfig, toVnYmd, vnDayStart } from '../amenities/slot.utils.js';
import { assertHead, getHousehold, getMyHouseholds } from '../household/household.service.js';

// ===== Mã chữ =====
const pad = (n, width) => String(n).padStart(width, '0');

/** "A-0501" → số căn "0501"; bỏ tiền tố trùng mã tòa, đệm 4 chữ số; không phải số thì dùng nguyên văn */
export function apartmentNumber(apartmentCode, buildingCode) {
  const full = String(apartmentCode).trim().toUpperCase();
  const prefix = String(buildingCode).trim().toUpperCase();
  let rest = full;
  if (full.startsWith(prefix)) {
    const stripped = full.slice(prefix.length).replace(/^[-_\s]+/, '');
    if (stripped) rest = stripped;
  }
  return /^\d+$/.test(rest) ? pad(rest, 4) : rest;
}

/** Mã chữ: chủ hộ (seq 0) "A-0501", thành viên "A-0501-01", "A-0501-02"… */
export function formatCode(buildingCode, apartmentCode, seq) {
  const base = `${String(buildingCode).trim().toUpperCase()}-${apartmentNumber(apartmentCode, buildingCode)}`;
  return seq === 0 ? base : `${base}-${pad(seq, 2)}`;
}

/**
 * Đồng bộ member_codes của một căn với hộ gia đình hiện tại (idempotent):
 *  - thu hồi mã người đã rời / mất quyền (kể cả chủ sở hữu "không ở");
 *  - đổi chủ hộ: người mới nhận seq 0, người cũ nếu còn ở nhận số mới (không dùng lại số đã cấp);
 *  - cấp mã cho người mới (chủ hộ trước, thành viên theo thứ tự).
 * Chạy đồng thời hai lần vẫn đúng nhờ unique index + thử lại.
 */
export async function ensureCodes(apartmentId) {
  return retryOnDuplicate(() => syncCodes(apartmentId), 4);
}

async function syncCodes(apartmentId) {
  const household = await getHousehold(apartmentId);
  const { apartment, members } = household;
  const building = apartment.buildingId;
  const now = new Date();

  const active = await MemberCode.find({ apartmentId, isActive: true });
  const byUser = new Map(active.map((c) => [String(c.userId), c]));
  const wantSeq = (m) => (m.isHead ? 0 : null); // null = giữ số đang có hoặc cấp số mới

  // 1) Thu hồi: người không còn trong hộ, hoặc vai trò chủ hộ đã đổi
  for (const code of active) {
    const m = members.find((x) => x.userId === String(code.userId));
    const stale = !m || (m.isHead && code.seq !== 0) || (!m.isHead && code.seq === 0);
    if (stale) {
      await MemberCode.updateOne({ _id: code._id, isActive: true }, { isActive: false, revokedAt: now });
      byUser.delete(String(code.userId));
    }
  }

  // 2) Cấp mã còn thiếu. Số tiếp theo = max(seq) của căn kể cả đã thu hồi → không bao giờ dùng lại
  const top = await MemberCode.findOne({ apartmentId }).sort({ seq: -1 }).select('seq').lean();
  let nextSeq = (top?.seq ?? 0) + 1;
  for (const m of members) {
    if (byUser.has(m.userId)) continue;
    const seq = wantSeq(m) ?? nextSeq++;
    // Ngày sinh gắn với người: người từng có mã (ở căn này hoặc căn khác) thì giữ lại
    const previous = await MemberCode.findOne({ userId: m.userId, dateOfBirth: { $ne: null } })
      .sort({ updatedAt: -1 })
      .select('dateOfBirth')
      .lean();
    await MemberCode.create({
      userId: m.userId,
      apartmentId,
      code: formatCode(building.code, apartment.code, seq),
      seq,
      dateOfBirth: previous?.dateOfBirth ?? null,
    });
  }
  return household;
}

/** Đồng bộ + trả về mã đang hiệu lực của cả hộ, theo userId */
async function activeCodesOf(apartmentId) {
  const household = await ensureCodes(apartmentId);
  const codes = await MemberCode.find({ apartmentId, isActive: true }).lean();
  return { household, byUser: new Map(codes.map((c) => [String(c.userId), c])) };
}

// ===== Ngày sinh / tuổi =====
/** "YYYY-MM-DD" → 00:00 giờ VN. Không được ở tương lai (so theo ngày VN); null = xóa */
export function parseDateOfBirth(ymd, now = new Date()) {
  if (ymd === null || ymd === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || ymd < '1900-01-01' || toVnYmd(vnDayStart(ymd)) !== ymd) {
    throw ApiError.badRequest('Ngày sinh không hợp lệ', [{ field: 'dateOfBirth', message: 'Ngày sinh không hợp lệ' }]);
  }
  if (ymd > toVnYmd(now)) {
    throw ApiError.badRequest('Ngày sinh không được ở tương lai', [{ field: 'dateOfBirth', message: 'Ngày sinh không được ở tương lai' }]);
  }
  return vnDayStart(ymd);
}

const ageInfo = (dateOfBirth, at, cfg) => ({
  age: ageAt(dateOfBirth, at),
  ageGroup: ageGroupOf(dateOfBirth, at, cfg),
});

// ===== API: mã của tôi =====
const apartmentView = (a) => ({ _id: a._id, code: a.code, floor: a.floor ?? null, building: a.buildingId });

/** Mã của tôi trong từng căn có quyền (bỏ chủ sở hữu "không ở") */
export async function getMyCodes(userId) {
  const [user, mine, cfg] = await Promise.all([User.findById(userId).select('fullName avatarUrl').lean(), getMyHouseholds(userId), getBookingConfig()]);
  const now = new Date();
  const out = [];
  for (const { apartment, relationType, isHead } of mine) {
    const { household, byUser } = await activeCodesOf(apartment._id);
    const me = household.members.find((m) => m.userId === String(userId));
    const record = byUser.get(String(userId));
    if (!me || !record) continue;
    out.push({
      userId: String(userId),
      apartment: apartmentView(household.apartment),
      relationType,
      isHead,
      canIncurCharges: isHead || record.canIncurCharges,
      code: record.code,
      seq: record.seq,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl ?? null,
      dateOfBirth: me.dateOfBirth,
      ...ageInfo(me.dateOfBirth, now, cfg),
    });
  }
  return out;
}

/** Căn hộ thao tác: có apartmentId thì phải là căn có quyền; không có thì lấy căn duy nhất, ở nhiều căn → bắt chọn */
export async function resolveApartmentId(userId, apartmentId) {
  if (apartmentId) return String(apartmentId);
  const mine = await getMyHouseholds(userId);
  if (!mine.length) throw ApiError.forbidden('Tài khoản chưa có quyền sử dụng tiện ích trong căn hộ nào (liên hệ Lễ tân)');
  if (mine.length > 1) throw ApiError.badRequest('Bạn ở nhiều căn hộ, hãy chọn apartmentId');
  return String(mine[0].apartment._id);
}

async function activeRecord(apartmentId, userId) {
  const { household, byUser } = await activeCodesOf(apartmentId);
  const record = byUser.get(String(userId));
  const member = household.members.find((m) => m.userId === String(userId));
  if (!record || !member) throw new ApiError('MEMBER_CODE_NOT_FOUND', 'Người này không có mã cư dân trong căn hộ');
  return { household, record, member, byUser };
}

// ===== API: chủ hộ quản lý gia đình =====
export async function getHouseholdView(userId, apartmentId) {
  const id = await resolveApartmentId(userId, apartmentId);
  await assertHead(userId, id);
  const [{ household, byUser }, cfg] = await Promise.all([activeCodesOf(id), getBookingConfig()]);
  const now = new Date();
  return {
    apartment: apartmentView(household.apartment),
    ownerResiding: household.ownerResiding,
    owner: household.owner,
    members: household.members.map((m) => {
      const c = byUser.get(m.userId);
      return {
        ...m,
        code: c?.code ?? null,
        seq: c?.seq ?? null,
        canIncurCharges: m.isHead || Boolean(c?.canIncurCharges),
        ...ageInfo(m.dateOfBirth, now, cfg),
        // Bước 8 (UC-D09) điền: gói tháng đang dùng của thành viên và số chỗ còn trống
        passes: [],
      };
    }),
  };
}

/** Chủ hộ sửa quyền phát sinh phí và/hoặc ngày sinh của thành viên */
export async function updateMember(headId, apartmentId, memberUserId, body) {
  const id = await resolveApartmentId(headId, apartmentId);
  await assertHead(headId, id);
  const { record, member } = await activeRecord(id, memberUserId);

  const patch = {};
  if (body.canIncurCharges !== undefined) {
    // BR-O26: chủ hộ luôn được phát sinh phí, không cần bật
    if (member.isHead) throw ApiError.badRequest('Chủ hộ luôn được phát sinh phí tiện ích', [{ field: 'canIncurCharges', message: 'Chủ hộ luôn được phát sinh phí' }]);
    patch.canIncurCharges = body.canIncurCharges;
  }
  if (body.dateOfBirth !== undefined) patch.dateOfBirth = parseDateOfBirth(body.dateOfBirth);
  if (Object.keys(patch).length) await MemberCode.updateOne({ _id: record._id, isActive: true }, patch);
  return getMemberView(id, memberUserId);
}

async function getMemberView(apartmentId, userId) {
  const { household, byUser } = await activeCodesOf(apartmentId);
  const cfg = await getBookingConfig();
  const m = household.members.find((x) => x.userId === String(userId));
  const c = byUser.get(String(userId));
  return {
    ...m,
    code: c.code,
    seq: c.seq,
    canIncurCharges: m.isHead || c.canIncurCharges,
    ...ageInfo(m.dateOfBirth, new Date(), cfg),
  };
}

/** Lễ tân sửa ngày sinh khi đối chiếu giấy tờ: áp cho mọi mã đang hiệu lực của người đó */
export async function setDateOfBirthByStaff(userId, dateOfBirth) {
  const date = parseDateOfBirth(dateOfBirth);
  const user = await User.findById(userId).select('fullName').lean();
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const mine = await getMyHouseholds(userId);
  for (const { apartment } of mine) await ensureCodes(apartment._id);
  const res = await MemberCode.updateMany({ userId, isActive: true }, { dateOfBirth: date });
  if (!res.matchedCount) throw new ApiError('MEMBER_CODE_NOT_FOUND', 'Người này chưa có mã cư dân (không thuộc hộ nào có quyền tiện ích)');
  const cfg = await getBookingConfig();
  return { userId: String(userId), fullName: user.fullName, dateOfBirth: date, ...ageInfo(date, new Date(), cfg) };
}

// ===== API: tra mã tại quầy (Lễ tân / Bảo vệ / Trưởng BQL) =====
/** "B-0501-02" → thử đoán căn "B-0501" để cấp mã cho thành viên mới chưa ai mở app */
async function apartmentIdFromCode(text) {
  const [buildingCode, number] = text.split('-');
  if (!buildingCode || !number) return null;
  const building = await Building.findOne({ code: new RegExp(`^${escapeRegex(buildingCode)}$`, 'i') }).select('code').lean();
  if (!building) return null;
  const apartments = await Apartment.find({ buildingId: building._id }).select('code').lean();
  return apartments.find((a) => apartmentNumber(a.code, building.code) === number)?._id ?? null;
}

async function findActiveByText(text) {
  let record = await MemberCode.findOne({ code: text, isActive: true }).lean();
  if (record) {
    // Mã có thể đã cũ (người rời căn, đổi chủ hộ chưa ai đọc) → đồng bộ rồi đọc lại
    await ensureCodes(record.apartmentId);
    return MemberCode.findOne({ code: text, isActive: true }).lean();
  }
  const apartmentId = await apartmentIdFromCode(text);
  if (!apartmentId) return null;
  await ensureCodes(apartmentId);
  return MemberCode.findOne({ code: text, isActive: true }).lean();
}

/**
 * Tra mã chữ (không phân biệt hoa thường). Luôn trả ảnh đại diện để nhân viên đối chiếu với người đến.
 * Bước 8, 10, 11 bổ sung gói tháng, booking hôm nay, lượt vào.
 */
export async function lookup(q) {
  const record = await findActiveByText(String(q ?? '').trim().toUpperCase());
  if (!record) throw new ApiError('MEMBER_CODE_NOT_FOUND');

  const { household, byUser } = await activeCodesOf(record.apartmentId);
  const me = household.members.find((m) => m.userId === String(record.userId));
  const current = byUser.get(String(record.userId));
  if (!me || !current) throw new ApiError('MEMBER_CODE_NOT_FOUND');
  const cfg = await getBookingConfig();

  return {
    code: current.code,
    person: {
      userId: me.userId,
      fullName: me.fullName,
      avatarUrl: me.avatarUrl,
      relationType: me.relationType,
      ...ageInfo(me.dateOfBirth, new Date(), cfg),
    },
    apartment: apartmentView(household.apartment),
    isHead: me.isHead,
    canIncurCharges: me.isHead || current.canIncurCharges,
    household: household.members.map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
      code: byUser.get(m.userId)?.code ?? null,
      isHead: m.isHead,
    })),
  };
}
