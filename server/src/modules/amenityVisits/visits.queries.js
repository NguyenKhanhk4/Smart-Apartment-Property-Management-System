// Truy vấn / trình bày lượt vào tiện ích dùng chung (UC-D10): danh sách quầy, đếm số người đang ở trong tiện ích,
// và khối "lượt vào hôm nay" của màn hình tra mã. Chỉ phụ thuộc model + util để memberCodes.service gọi được mà không import vòng.
import { VISIT_STATUS } from '../../constants/enums.js';
import { AmenityVisit, MemberCode } from '../../models/index.js';
import { DAY_MS } from '../../utils/time.js';
import { toVnYmd, vnDayStart } from '../amenities/slot.utils.js';

const MINUTE_MS = 60 * 1000;

const POPULATE = [
  { path: 'amenityId', select: 'name' },
  { path: 'userId', select: 'fullName avatarUrl' },
  { path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'code name' } },
  { path: 'recordedBy', select: 'fullName' },
  { path: 'chargedTo', select: 'fullName' },
  { path: 'accompaniedBy', select: 'fullName' },
];

/** Mỗi lượt VALID chiếm 1 chỗ + số trẻ nhỏ đi kèm; chỉ tính các lượt trong `windowMinutes` phút gần nhất (WALK_IN_VISIT_MINUTES) */
export async function countInside(amenityId, now, windowMinutes, { session } = {}) {
  const rows = await AmenityVisit.find({
    amenityId,
    status: VISIT_STATUS.VALID,
    visitedAt: { $gt: new Date(now.getTime() - windowMinutes * MINUTE_MS), $lte: now },
  })
    .select('accompaniedChildren')
    .session(session ?? null)
    .lean();
  return rows.reduce((sum, r) => sum + 1 + (r.accompaniedChildren ?? 0), 0);
}

/** Khoảng [00:00, 24:00) giờ VN của ngày "YYYY-MM-DD" */
export const dayRange = (ymd) => {
  const start = vnDayStart(ymd);
  return { $gte: start, $lt: new Date(start.getTime() + DAY_MS) };
};

/** Lượt vào ở dạng trả về cho client (kèm mã cư dân đang hiệu lực của người vào) */
export async function presentVisits(rows) {
  if (!rows.length) return [];
  const codes = await MemberCode.find({
    userId: { $in: rows.map((r) => r.userId?._id ?? r.userId) },
    isActive: true,
  })
    .select('userId apartmentId code')
    .lean();
  const codeOf = new Map(codes.map((c) => [`${c.apartmentId}:${c.userId}`, c.code]));
  const name = (u) => (u && typeof u === 'object' ? { userId: u._id, fullName: u.fullName } : null);
  return rows.map((r) => {
    const person = r.userId && typeof r.userId === 'object' ? r.userId : null;
    const apt = r.apartmentId && typeof r.apartmentId === 'object' ? r.apartmentId : null;
    return {
      _id: r._id,
      visitedAt: r.visitedAt,
      status: r.status,
      ageGroup: r.ageGroup,
      chargeType: r.chargeType,
      fee: r.fee,
      accompaniedChildren: r.accompaniedChildren ?? 0,
      billingMonth: r.billingMonth,
      invoiceId: r.invoiceId ?? null,
      amenity: r.amenityId && typeof r.amenityId === 'object' ? { _id: r.amenityId._id, name: r.amenityId.name } : null,
      person: person && {
        userId: person._id,
        fullName: person.fullName,
        avatarUrl: person.avatarUrl ?? null,
        memberCode: codeOf.get(`${apt?._id}:${person._id}`) ?? null,
      },
      apartment: apt && {
        _id: apt._id,
        code: apt.code,
        building: apt.buildingId ? { _id: apt.buildingId._id, code: apt.buildingId.code, name: apt.buildingId.name } : null,
      },
      recordedBy: name(r.recordedBy),
      chargedTo: name(r.chargedTo),
      accompaniedBy: name(r.accompaniedBy),
      cancelledAt: r.cancelledAt ?? null,
      cancelReason: r.cancelReason ?? null,
    };
  });
}

export const findVisits = (filter, sort = { visitedAt: -1 }) => AmenityVisit.find(filter).populate(POPULATE).sort(sort);

/** Lượt vào hôm nay (giờ VN) của một người, mọi trạng thái — khối "Lượt vào hôm nay" khi tra mã */
export async function listVisitsToday(userId, now = new Date()) {
  const rows = await findVisits({ userId, visitedAt: dayRange(toVnYmd(now)) }).lean();
  return presentVisits(rows);
}
