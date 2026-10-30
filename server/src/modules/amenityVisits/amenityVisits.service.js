// UC-D10 — Quầy tiện ích: lễ tân tra mã cư dân rồi ghi lượt vào tiện ích WALK_IN (gói tháng / vé lẻ / miễn phí), hủy lượt.
// KHÔNG thu tiền tại chỗ: phí vé lẻ được Module B cộng vào hóa đơn đầu tháng sau (billing ở bước 12).
import { AGE_GROUPS, AMENITY_ACCESS_MODES, AUDIT_ACTIONS, NOTIFICATION_TYPES, VISIT_CHARGE_TYPES, VISIT_STATUS } from '../../constants/enums.js';
import { Amenity, AmenityVisit } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { MINUTE_MS, fmtTimeVn, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { assertNoOverdue } from '../amenities/overdue.js';
import { accessModeOf, ageAt, ageGroupOf, formatVnd, visitFee } from '../amenities/pricing.js';
import { getBookingConfig, toMinutes, toVnYmd, vnDayStart } from '../amenities/slot.utils.js';
import { getActivePass } from '../amenityPasses/passes.queries.js';
import { assertMember } from '../household/household.service.js';
import { resolveMemberCode } from '../memberCodes/memberCodes.service.js';
import { VISIT_POPULATE, countInside, dayRange, findVisits, presentVisits } from './visits.queries.js';
import { canIncurCharges } from '../amenities/access.queries.js';

const ADULT_ESCORT_AGE = 18; // người đi kèm trẻ em phải từ 18 tuổi
const MIN_REASON = 5;
const LINK = '/r/amenities';
const timeOf = fmtTimeVn;

/** Phút kể từ 00:00 giờ VN của `now` */
const vnMinutesOfDay = (now) => Math.floor((now.getTime() - vnDayStart(toVnYmd(now)).getTime()) / MINUTE_MS);

/** Người trong hộ + quyền phát sinh phí (BR-O26) + ngày sinh */
async function personContext(record) {
  const { household, me } = await assertMember(record.userId, record.apartmentId);
  return { household, me, canCharge: await canIncurCharges(record.userId, record.apartmentId, me.isHead) };
}

/** Người lớn đi kèm của trẻ em (6–11 tuổi): phải là cư dân từ 18 tuổi (không có ngày sinh → coi là người lớn), khác chính trẻ */
async function resolveEscort(escortCode, child, now) {
  if (!escortCode) throw new ApiError('ESCORT_REQUIRED', 'Trẻ em phải có người lớn đi kèm: nhập mã cư dân của người lớn');
  const record = await resolveMemberCode(escortCode);
  if (String(record.userId) === String(child.userId)) throw new ApiError('ESCORT_REQUIRED', 'Người đi kèm phải là người lớn khác, không phải chính trẻ');
  const ctx = await personContext(record);
  const age = ageAt(ctx.me.dateOfBirth, now);
  if (age !== null && age < ADULT_ESCORT_AGE) throw new ApiError('ESCORT_REQUIRED', `Người đi kèm phải từ ${ADULT_ESCORT_AGE} tuổi`);
  return { record, ...ctx };
}

/**
 * Ghi 1 lượt vào tiện ích WALK_IN.
 * body: { amenityId, code (mã cư dân), escortCode?, accompaniedChildren? }
 * Kiểm tra theo thứ tự: tiện ích → mã người vào → trùng lượt → nhóm tuổi / người đi kèm → loại lượt & người chịu phí → nợ quá hạn → sức chứa.
 */
export async function createVisit(staff, { amenityId, code, escortCode, accompaniedChildren = 0 }, { now = new Date() } = {}) {
  const amenity = await Amenity.findById(amenityId).lean();
  if (!amenity) throw ApiError.notFound('Không tìm thấy tiện ích');
  if (!amenity.isActive) throw new ApiError('AMENITY_INACTIVE');
  if (accessModeOf(amenity) !== AMENITY_ACCESS_MODES.WALK_IN) throw new ApiError('AMENITY_NOT_WALK_IN');
  const minutes = vnMinutesOfDay(now);
  if (minutes < toMinutes(amenity.openTime) || minutes >= toMinutes(amenity.closeTime)) {
    throw new ApiError('AMENITY_CLOSED', `Tiện ích mở cửa từ ${amenity.openTime} đến ${amenity.closeTime}`);
  }

  const record = await resolveMemberCode(code);
  const ctx = await personContext(record);
  const { household } = ctx;
  // Tiện ích riêng của một tòa chỉ phục vụ cư dân tòa đó
  const buildingId = household.apartment.buildingId?._id ?? household.apartment.buildingId;
  if (amenity.buildingId && String(amenity.buildingId) !== String(buildingId)) throw ApiError.notFound('Không tìm thấy tiện ích');

  const cfg = await getBookingConfig();
  const group = ageGroupOf(ctx.me.dateOfBirth, now, cfg);

  if (group === AGE_GROUPS.CHILD_FREE) {
    throw new ApiError(
      'ESCORT_REQUIRED',
      `Trẻ dưới ${cfg.childFreeAge} tuổi được miễn phí và không có lượt riêng: hãy ghi vào lượt của người lớn đi kèm (mục "số trẻ nhỏ đi kèm")`,
    );
  }
  const escort = group === AGE_GROUPS.CHILD ? await resolveEscort(escortCode, record, now) : null;

  // Loại lượt: gói tháng còn hiệu lực → PASS (0đ); không → vé lẻ theo nhóm tuổi (giá 0 thì FREE)
  const pass = await getActivePass(record.userId, amenityId, now);
  let chargeType = VISIT_CHARGE_TYPES.PASS;
  let fee = 0;
  let chargedTo = null;
  if (!pass) {
    fee = visitFee(amenity, group);
    chargeType = fee > 0 ? VISIT_CHARGE_TYPES.SINGLE : VISIT_CHARGE_TYPES.FREE;
    if (fee > 0) {
      // Người chịu phí: chính người vào nếu là chủ hộ / được bật quyền phí, hoặc người lớn đi kèm CÙNG CĂN có quyền phí
      if (ctx.canCharge) chargedTo = record.userId;
      else if (escort && String(escort.record.apartmentId) === String(record.apartmentId) && escort.canCharge) chargedTo = escort.record.userId;
      else throw new ApiError('CHARGE_NOT_ALLOWED');
      await assertNoOverdue(record.apartmentId, now); // BR-F8: chỉ chặn khi có phí
    }
  }

  const visit = await withTransaction(async (session) => {
    // Khóa theo tiện ích: các lượt cùng tiện ích ghi lên cùng 1 document nên giao dịch đến sau chạy lại và luôn thấy lượt trước
    await Amenity.updateOne({ _id: amenityId }, { $inc: { lockVersion: 1 } }, { session });

    // Một người không bị ghi 2 lần trong WALK_IN_VISIT_MINUTES (bấm đúp)
    const since = new Date(now.getTime() - cfg.walkInVisitMinutes * MINUTE_MS);
    if (await AmenityVisit.exists({ amenityId, userId: record.userId, status: VISIT_STATUS.VALID, visitedAt: { $gt: since } }).session(session)) {
      throw new ApiError('VISIT_DUPLICATE');
    }

    // Sức chứa: số người đang trong tiện ích (mỗi lượt = 1 + trẻ nhỏ đi kèm) + lượt mới
    if (amenity.maxConcurrent) {
      const inside = await countInside(amenityId, now, cfg.walkInVisitMinutes, { session });
      const adding = 1 + accompaniedChildren;
      if (inside + adding > amenity.maxConcurrent) {
        throw new ApiError('AMENITY_FULL', `${amenity.name} đang có ${inside}/${amenity.maxConcurrent} người, không đủ chỗ cho ${adding} người`);
      }
    }

    const [doc] = await AmenityVisit.create(
      [
        {
          amenityId,
          userId: record.userId,
          apartmentId: record.apartmentId,
          visitedAt: now,
          ageGroup: group,
          chargeType,
          passId: pass?._id ?? null,
          fee,
          accompaniedBy: escort?.record.userId ?? null,
          accompaniedChildren,
          chargedTo,
          recordedBy: staff.id,
          billingMonth: vnPeriod(now), // theo visitedAt giờ VN
        },
      ],
      { session },
    );
    return doc.toObject();
  });

  // Báo người chịu phí khi có phí vé lẻ (nếu không phải chính người đang đứng ở quầy cũng sẽ thấy trong ứng dụng)
  if (visit.fee > 0 && visit.chargedTo) {
    await notify(visit.chargedTo, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Đã ghi lượt vào tiện ích',
      content: `${amenity.name} · ${timeOf(visit.visitedAt)} ${toVnYmd(visit.visitedAt).split('-').reverse().join('/')}. Vé lẻ ${formatVnd(visit.fee)}, tính vào hóa đơn tháng sau.`,
      refId: visit._id,
      link: LINK,
    });
  }

  const [presented] = await presentVisits(await findVisits({ _id: visit._id }).lean());
  return presented;
}

/** Hủy lượt (lễ tân, Trưởng BQL): bắt buộc lý do, chỉ khi chưa gộp hóa đơn, ghi audit */
export async function cancelVisit(user, id, { reason } = {}, { now = new Date() } = {}) {
  const text = reason?.trim();
  if (!text || text.length < MIN_REASON) throw ApiError.field('reason', `Lý do hủy là bắt buộc (tối thiểu ${MIN_REASON} ký tự)`);
  const existing = await AmenityVisit.findById(id).lean();
  if (!existing) throw ApiError.notFound('Không tìm thấy lượt vào');
  if (existing.invoiceId) throw new ApiError('VISIT_ALREADY_BILLED');
  if (existing.status !== VISIT_STATUS.VALID) throw new ApiError('VISIT_ALREADY_CANCELLED');

  const cancelled = await withTransaction(async (session) => {
    // Điều kiện trạng thái + chưa gộp hóa đơn: cron billing gộp đồng thời thì chỉ một bên thắng
    const doc = await AmenityVisit.findOneAndUpdate(
      { _id: id, status: VISIT_STATUS.VALID, invoiceId: null },
      { $set: { status: VISIT_STATUS.CANCELLED, cancelledAt: now, cancelledBy: user.id, cancelReason: text } },
      { returnDocument: 'after', session },
    ).lean();
    if (!doc) {
      const fresh = await AmenityVisit.findById(id).select('invoiceId').session(session).lean();
      throw new ApiError(fresh?.invoiceId ? 'VISIT_ALREADY_BILLED' : 'VISIT_ALREADY_CANCELLED');
    }
    await logAudit(
      {
        action: AUDIT_ACTIONS.AMENITY_VISIT_CANCELLED,
        user,
        targetType: 'amenity_visits',
        targetId: doc._id,
        metadata: {
          amenityId: doc.amenityId,
          userId: doc.userId,
          apartmentId: doc.apartmentId,
          chargeType: doc.chargeType,
          fee: doc.fee,
          billingMonth: doc.billingMonth,
          reason: text,
        },
      },
      { session },
    );
    return doc;
  });

  if (cancelled.chargedTo && cancelled.fee > 0) {
    await notify(cancelled.chargedTo, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Lượt vào tiện ích đã được hủy',
      content: `Lượt vào lúc ${timeOf(cancelled.visitedAt)} ${toVnYmd(cancelled.visitedAt).split('-').reverse().join('/')} đã được hủy, không tính phí. Lý do: ${text}.`,
      refId: cancelled._id,
      link: LINK,
    });
  }
  const [presented] = await presentVisits(await findVisits({ _id: cancelled._id }).lean());
  return presented;
}

/** Danh sách lượt vào (lễ tân, Trưởng BQL): lọc ngày (mặc định hôm nay, giờ VN), tiện ích, căn, loại, trạng thái */
export async function listVisits(user, query, { now = new Date() } = {}) {
  const ymd = query.date ?? toVnYmd(now);
  if (toVnYmd(vnDayStart(ymd)) !== ymd) throw ApiError.field('date', 'Ngày không hợp lệ (dạng YYYY-MM-DD)');
  const filter = { visitedAt: dayRange(ymd) };
  if (query.amenityId) filter.amenityId = query.amenityId;
  if (query.apartmentId) filter.apartmentId = query.apartmentId;
  if (query.chargeType) filter.chargeType = query.chargeType;
  if (query.status) filter.status = query.status;
  const { items: rows, pagination } = await paginate(
    AmenityVisit,
    filter,
    { ...query, sort: query.sort ?? '-visitedAt' },
    { populate: VISIT_POPULATE },
  );
  return { items: await presentVisits(rows), pagination };
}

/** Số người "đang trong tiện ích" của từng tiện ích WALK_IN đang hoạt động: { amenityId, name, current, max } */
export async function getOccupancy(user, { now = new Date() } = {}) {
  const cfg = await getBookingConfig();
  const amenities = await Amenity.find({ isActive: true, accessMode: AMENITY_ACCESS_MODES.WALK_IN }).select('name maxConcurrent openTime closeTime').sort({ name: 1 }).lean();
  const items = await Promise.all(
    amenities.map(async (a) => ({
      amenityId: a._id,
      name: a.name,
      current: await countInside(a._id, now, cfg.walkInVisitMinutes),
      max: a.maxConcurrent ?? null,
      openTime: a.openTime,
      closeTime: a.closeTime,
    })),
  );
  return { serverTime: now, windowMinutes: cfg.walkInVisitMinutes, items };
}
