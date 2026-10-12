// UC-D09 — Chủ hộ mua gói tháng tiện ích cho mình hoặc thành viên (BR-O22, BR-O24, BR-O26 / BR-F8).
// Gói theo NGƯỜI, theo THÁNG DƯƠNG LỊCH, hiệu lực ngay, không tự gia hạn; mua giữa tháng tính trọn tháng.
import {
  AGE_GROUPS,
  AMENITY_ACCESS_MODES,
  AMENITY_PASS_STATUS,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  ROLES,
} from '../../constants/enums.js';
import { Amenity, AmenityPass, MemberCode, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { periodEnd, periodStart, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { assertNoOverdue, hasOverdueInvoice } from '../amenities/overdue.js';
import { ageGroupOf, formatVnd, passFee } from '../amenities/pricing.js';
import { getBookingConfig } from '../amenities/slot.utils.js';
import { assertHead, assertMember } from '../household/household.service.js';
import { ensureCodes, resolveApartmentId } from '../memberCodes/memberCodes.service.js';

export { getActivePass } from './passes.queries.js';

const PASS_MODES = [AMENITY_ACCESS_MODES.WALK_IN, AMENITY_ACCESS_MODES.BOOKING];
const monthLabel = (month) => `${month.slice(5)}/${month.slice(0, 4)}`; // 2026-10 → 10/2026
const LINK = '/r/my-code/passes';

/** [tháng hiện tại, tháng kế tiếp] theo giờ VN — chỉ được mua / chọn hai tháng này */
export function purchasableMonths(now = new Date()) {
  const current = vnPeriod(now);
  return [current, vnPeriod(periodEnd(current))];
}

function assertPurchasableMonth(month, now) {
  if (!purchasableMonths(now).includes(month)) {
    throw ApiError.badRequest('Chỉ mua được gói của tháng này hoặc tháng sau', [
      { field: 'month', message: 'Chỉ chọn tháng này hoặc tháng sau' },
    ]);
  }
}

/** Tiện ích có bán gói không (đủ cả giá người lớn và trẻ em)? */
const sellsPass = (amenity) => PASS_MODES.includes(amenity.accessMode ?? AMENITY_ACCESS_MODES.BOOKING) && passFee(amenity, AGE_GROUPS.ADULT) !== null;

/**
 * Giá gói cho một người: nhóm tuổi tính tại NGÀY 1 của tháng gói (BR-O24), nên bé tròn 12 tuổi giữa tháng vẫn giá trẻ em.
 * error: PASS_NOT_SOLD (tiện ích không bán gói) | PASS_NOT_REQUIRED (trẻ nhỏ được miễn phí) | null
 */
function priceFor(amenity, dateOfBirth, month, cfg) {
  if (!sellsPass(amenity)) return { ageGroup: null, fee: null, error: 'PASS_NOT_SOLD' };
  const ageGroup = ageGroupOf(dateOfBirth, periodStart(month), cfg);
  if (ageGroup === AGE_GROUPS.CHILD_FREE) return { ageGroup, fee: null, error: 'PASS_NOT_REQUIRED' };
  return { ageGroup, fee: passFee(amenity, ageGroup), error: null };
}

/** Tiện ích riêng tòa chỉ dành cho căn thuộc tòa đó; chung toàn khu thì mọi căn */
const amenityVisibleTo = (amenity, apartment) =>
  !amenity.buildingId || String(amenity.buildingId) === String(apartment.buildingId?._id ?? apartment.buildingId);

const isUniqueViolation = (err) => [err?.code, err?.cause?.code, err?.errorResponse?.code].includes(11000);

// ===== Mua gói =====
export async function purchasePass(user, { apartmentId, userId, amenityId, month }) {
  const now = new Date();
  assertPurchasableMonth(month, now);
  // Người mua phải là chủ hộ của căn (thành viên thường → HOUSEHOLD_HEAD_REQUIRED, người ngoài hộ → 403)
  const { household } = await assertHead(user.id, apartmentId);
  const target = household.members.find((m) => m.userId === String(userId));
  if (!target) {
    throw ApiError.badRequest('Người được mua không phải thành viên của hộ gia đình này', [
      { field: 'userId', message: 'Không thuộc hộ này' },
    ]);
  }

  const amenity = await Amenity.findById(amenityId).lean();
  if (!amenity || !amenityVisibleTo(amenity, household.apartment)) throw ApiError.notFound('Không tìm thấy tiện ích');
  if (!amenity.isActive) throw new ApiError('AMENITY_INACTIVE');
  const price = priceFor(amenity, target.dateOfBirth, month, await getBookingConfig());
  if (price.error) throw new ApiError(price.error);

  await assertNoOverdue(apartmentId, now); // BR-F8
  const exists = await AmenityPass.exists({ userId, amenityId, month, status: AMENITY_PASS_STATUS.ACTIVE });
  if (exists) throw new ApiError('PASS_ALREADY_EXISTS');

  let pass;
  try {
    pass = await withTransaction(async (session) => {
      const [doc] = await AmenityPass.create(
        [{ userId, apartmentId, amenityId, month, ageGroup: price.ageGroup, fee: price.fee, purchasedBy: user.id }],
        { session },
      );
      return doc.toObject();
    });
  } catch (err) {
    // Hai yêu cầu mua đồng thời: unique partial index chỉ cho một yêu cầu thắng
    if (isUniqueViolation(err)) throw new ApiError('PASS_ALREADY_EXISTS');
    throw err;
  }

  // Thông báo SAU transaction: người được mua (nếu khác chủ hộ) và chủ hộ
  const what = `gói ${amenity.name} tháng ${monthLabel(month)} (${formatVnd(price.fee)})`;
  const self = String(target.userId) === String(user.id);
  if (self) {
    await notify(user.id, { type: NOTIFICATION_TYPES.BOOKING, title: 'Đã mua gói tháng', content: `Bạn đã mua ${what}.`, refId: pass._id, link: LINK });
  } else {
    await notify(target.userId, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Bạn được mua gói tháng tiện ích',
      content: `Chủ hộ đã mua ${what} cho bạn.`,
      refId: pass._id,
      link: LINK,
    });
    await notify(user.id, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Đã mua gói tháng cho thành viên',
      content: `Bạn đã mua ${what} cho ${target.fullName}.`,
      refId: pass._id,
      link: LINK,
    });
  }
  return { ...pass, amenity: { _id: amenity._id, name: amenity.name, accessMode: amenity.accessMode }, member: memberOf(target) };
}

const memberOf = (m) => ({ userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl ?? null });

// ===== Tùy chọn mua (giá theo nhóm tuổi của từng người, tính tại ngày 1 của tháng) =====
export async function getPurchaseOptions(user, { apartmentId, month }) {
  const now = new Date();
  const [current] = purchasableMonths(now);
  const chosen = month ?? current;
  assertPurchasableMonth(chosen, now);
  const id = await resolveApartmentId(user.id, apartmentId);
  const { household } = await assertHead(user.id, id);

  const buildingId = household.apartment.buildingId?._id ?? household.apartment.buildingId;
  const [amenities, cfg, owned, overdue] = await Promise.all([
    Amenity.find({
      isActive: true,
      accessMode: { $in: PASS_MODES },
      monthlyPassFeeAdult: { $ne: null },
      monthlyPassFeeChild: { $ne: null },
      $or: [{ buildingId: null }, { buildingId }],
    })
      .sort({ name: 1 })
      .lean(),
    getBookingConfig(),
    AmenityPass.find({ userId: { $in: household.members.map((m) => m.userId) }, month: chosen, status: AMENITY_PASS_STATUS.ACTIVE }).lean(),
    hasOverdueInvoice(id, now),
  ]);
  const ownedKey = new Map(owned.map((p) => [`${p.userId}|${p.amenityId}`, p]));

  const options = [];
  for (const member of household.members) {
    for (const amenity of amenities) {
      const price = priceFor(amenity, member.dateOfBirth, chosen, cfg);
      const existing = ownedKey.get(`${member.userId}|${amenity._id}`);
      options.push({
        userId: member.userId,
        amenityId: String(amenity._id),
        ageGroup: price.ageGroup,
        fee: price.fee,
        status: existing ? 'OWNED' : price.error === 'PASS_NOT_REQUIRED' ? 'NOT_REQUIRED' : 'AVAILABLE',
        passId: existing?._id ?? null,
      });
    }
  }
  return {
    month: chosen,
    months: purchasableMonths(now),
    overdue,
    members: household.members.map((m) => ({
      ...memberOf(m),
      isHead: m.isHead,
      ageGroup: ageGroupOf(m.dateOfBirth, periodStart(chosen), cfg),
    })),
    amenities: amenities.map((a) => ({ _id: a._id, name: a.name, accessMode: a.accessMode, location: a.location ?? null })),
    options,
  };
}

// ===== Hủy gói =====
export async function cancelPass(user, id, { reason } = {}) {
  const pass = await AmenityPass.findById(id).lean();
  if (!pass) throw ApiError.notFound('Không tìm thấy gói tháng');
  const isManager = user.role === ROLES.MANAGER;
  const text = reason?.trim() || null;
  if (isManager && !text) {
    throw ApiError.badRequest('Trưởng BQL phải nhập lý do hủy gói', [{ field: 'reason', message: 'Bắt buộc nhập lý do' }]);
  }
  // Chủ hộ chỉ hủy gói của hộ mình (người ngoài hộ / thành viên thường bị từ chối trước khi lộ trạng thái gói)
  if (!isManager) await assertHead(user.id, pass.apartmentId);

  if (pass.status !== AMENITY_PASS_STATUS.ACTIVE) throw new ApiError('PASS_ALREADY_CANCELLED');
  if (pass.invoiceId) throw new ApiError('PASS_ALREADY_BILLED');
  // Chủ hộ chỉ hủy gói của THÁNG SAU (chưa bắt đầu); gói tháng này phải nhờ Trưởng BQL
  if (!isManager && pass.month <= vnPeriod()) throw new ApiError('PASS_CANCEL_NOT_ALLOWED');

  const cancelled = await withTransaction(async (session) => {
    // Điều kiện trạng thái hiện tại + chưa gộp hóa đơn: billing có thể gán invoiceId đồng thời
    const doc = await AmenityPass.findOneAndUpdate(
      { _id: id, status: AMENITY_PASS_STATUS.ACTIVE, invoiceId: null },
      { $set: { status: AMENITY_PASS_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: user.id, cancelReason: text } },
      { returnDocument: 'after', session },
    ).lean();
    if (!doc) return null;
    await logAudit(
      {
        action: AUDIT_ACTIONS.AMENITY_PASS_CANCELLED,
        user,
        targetType: 'amenity_passes',
        targetId: doc._id,
        metadata: {
          userId: String(doc.userId),
          apartmentId: String(doc.apartmentId),
          amenityId: String(doc.amenityId),
          month: doc.month,
          fee: doc.fee,
          reason: text,
          byRole: user.role,
        },
      },
      { session },
    );
    return doc;
  });
  if (!cancelled) {
    const latest = await AmenityPass.findById(id).select('invoiceId').lean();
    throw new ApiError(latest?.invoiceId ? 'PASS_ALREADY_BILLED' : 'PASS_ALREADY_CANCELLED');
  }

  const [amenity, member, head] = await Promise.all([
    Amenity.findById(cancelled.amenityId).select('name').lean(),
    User.findById(cancelled.userId).select('fullName').lean(),
    User.findById(cancelled.purchasedBy).select('fullName').lean(),
  ]);
  const what = `gói ${amenity?.name ?? 'tiện ích'} tháng ${monthLabel(cancelled.month)}`;
  const byManager = isManager ? ` Lý do: ${text}.` : '';
  await notify([cancelled.userId, cancelled.purchasedBy].filter((uid) => String(uid) !== String(user.id)), {
    type: NOTIFICATION_TYPES.BOOKING,
    title: 'Gói tháng đã bị hủy',
    content: `${what.charAt(0).toUpperCase()}${what.slice(1)} của ${member?.fullName ?? 'thành viên'} đã được hủy${isManager ? ' bởi Ban quản lý' : ''}.${byManager}`,
    refId: cancelled._id,
    link: LINK,
  });
  return { ...cancelled, purchasedByName: head?.fullName ?? null };
}

// ===== Danh sách =====
/**
 * Mã cư dân (vd A-0101-01) của người dùng gói trong căn của gói — để phân biệt người trùng tên.
 * Đồng bộ mã của các căn trong trang rồi lấy mã đang hiệu lực; người đã rời hộ thì lấy mã gần nhất đã thu hồi.
 * @param {{ userId: any, apartmentId: any }[]} refs
 * @returns {Promise<Map<string, string>>} key `${userId}|${apartmentId}` → mã
 */
async function memberCodesOf(refs) {
  const apartmentIds = [...new Set(refs.map((r) => String(r.apartmentId)))];
  for (const id of apartmentIds) await ensureCodes(id);
  const rows = await MemberCode.find({ apartmentId: { $in: apartmentIds }, userId: { $in: [...new Set(refs.map((r) => String(r.userId)))] } })
    .sort({ isActive: 1, createdAt: 1 }) // bản ghi hiệu lực (isActive=true) ghi sau cùng → thắng khi gán vào Map
    .select('userId apartmentId code')
    .lean();
  return new Map(rows.map((r) => [`${r.userId}|${r.apartmentId}`, r.code]));
}

const canCancelBy = (pass, { isHead, isManager }) =>
  pass.status === AMENITY_PASS_STATUS.ACTIVE &&
  !pass.invoiceId &&
  (isManager || (isHead && pass.month > vnPeriod()));

/** Chủ hộ: gói của cả hộ; thành viên: gói của mình */
export async function listMyPasses(user, { apartmentId, month, status }) {
  const id = await resolveApartmentId(user.id, apartmentId);
  const { household, me } = await assertMember(user.id, id);
  const filter = { apartmentId: id, status: status ?? AMENITY_PASS_STATUS.ACTIVE };
  if (month) filter.month = month;
  if (!me.isHead) filter.userId = user.id;
  const rows = await AmenityPass.find(filter)
    .populate('amenityId', 'name accessMode')
    .sort({ month: -1, createdAt: -1 })
    .limit(200)
    .lean();

  const known = new Map(household.members.map((m) => [m.userId, m]));
  const missing = [...new Set(rows.map((r) => String(r.userId)))].filter((uid) => !known.has(uid));
  const others = missing.length ? await User.find({ _id: { $in: missing } }).select('fullName avatarUrl').lean() : [];
  const nameOf = new Map(others.map((u) => [String(u._id), { userId: String(u._id), fullName: u.fullName, avatarUrl: u.avatarUrl ?? null }]));
  const current = vnPeriod();
  const codeOf = await memberCodesOf(rows);

  return rows.map((r) => ({
    ...r,
    memberCode: codeOf.get(`${r.userId}|${r.apartmentId}`) ?? null,
    amenity: r.amenityId ? { _id: r.amenityId._id, name: r.amenityId.name, accessMode: r.amenityId.accessMode } : null,
    amenityId: r.amenityId?._id ?? r.amenityId,
    member: known.has(String(r.userId)) ? memberOf(known.get(String(r.userId))) : nameOf.get(String(r.userId)) ?? null,
    isCurrent: r.month === current,
    canCancel: canCancelBy(r, { isHead: me.isHead, isManager: false }),
  }));
}

/** Manager / Lễ tân: tất cả gói, lọc theo tháng, tiện ích, căn… */
export async function listPasses(user, query) {
  const filter = {};
  for (const key of ['month', 'amenityId', 'apartmentId', 'userId', 'status']) if (query[key]) filter[key] = query[key];
  if (query.invoiced !== undefined) filter.invoiceId = query.invoiced ? { $ne: null } : null;
  const { items, pagination } = await paginate(AmenityPass, filter, query, {
    populate: [
      { path: 'userId', select: 'fullName avatarUrl' },
      { path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'name' } },
      { path: 'amenityId', select: 'name accessMode' },
    ],
  });
  const isManager = user.role === ROLES.MANAGER;
  const codeOf = await memberCodesOf(items.map((r) => ({ userId: r.userId?._id ?? r.userId, apartmentId: r.apartmentId?._id ?? r.apartmentId })));
  return {
    items: items.map((r) => ({
      ...r,
      memberCode: codeOf.get(`${r.userId?._id ?? r.userId}|${r.apartmentId?._id ?? r.apartmentId}`) ?? null,
      canCancel: canCancelBy(r, { isHead: false, isManager }),
    })),
    pagination,
  };
}
