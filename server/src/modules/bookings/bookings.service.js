// UC-D06 — Xem lịch trống, đặt tiện ích (tự xác nhận APPROVED, BR-O12), xem lịch sử và hủy. CHỈ tiện ích accessMode = BOOKING.
// Quyền đặt lấy từ household.service (thành viên CÓ QUYỀN của căn): chủ sở hữu "không ở" không đặt được.
// Lễ tân đặt hộ / hủy hộ làm ở bước 10 (UC-D07).
import { AMENITY_ACCESS_MODES, BOOKING_STATUS, NOTIFICATION_TYPES, ROLES } from '../../constants/enums.js';
import { Amenity, Apartment, Booking, MemberCode } from '../../models/index.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { getAmenity, ACTIVE_BOOKING_STATUSES as ACTIVE } from '../amenities/amenities.service.js';
import { assertNoOverdue, hasOverdueInvoice } from '../amenities/overdue.js';
import { accessModeOf, formatVnd } from '../amenities/pricing.js';
import { atTime, buildSlotGrid, getBookingConfig, toVnYmd, vnDayStart } from '../amenities/slot.utils.js';
import { getActivePass } from '../amenityPasses/passes.queries.js';
import { assertMember, getMyHouseholds } from '../household/household.service.js';
import { resolveApartmentId } from '../memberCodes/memberCodes.service.js';

const MINUTE_MS = 60 * 1000;
const LINK = '/r/amenities/bookings';
const dateVn = (d) => toVnYmd(d).split('-').reverse().join('/'); // 2026-10-08 → 08/10/2026

/** Khóa lý do hiển thị trên lưới slot */
export const LOCK_MESSAGES = {
  PAST: 'Đã qua giờ bắt đầu',
  BEYOND_ADVANCE: 'Chỉ đặt trước tối đa {days} ngày',
  ALREADY_BOOKED: 'Căn hộ bạn đã đặt khung giờ này',
  FULL: 'Đã hết chỗ',
};

function badRequest(field, message) {
  return ApiError.badRequest(message, [{ field, message }]);
}

/** "YYYY-MM-DD" hợp lệ (có thật) → 00:00 giờ VN của ngày đó */
function parseDay(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toVnYmd(vnDayStart(date)) !== date) {
    throw badRequest('date', 'Ngày không hợp lệ (dạng YYYY-MM-DD)');
  }
  return vnDayStart(date);
}

/** Số ngày từ hôm nay (giờ VN) tới `dayStart`; âm = ngày đã qua */
const daysFromToday = (dayStart, now) => Math.round((dayStart.getTime() - vnDayStart(toVnYmd(now)).getTime()) / DAY_MS);

/** Slot coi là đã qua khi hết thời gian cho phép check-in: startAt + NO_SHOW_GRACE_MINUTES (BR-O14) */
const isSlotPast = (startAt, now, cfg) => now.getTime() >= startAt.getTime() + cfg.noShowGraceMinutes * MINUTE_MS;

/** Tiện ích riêng tòa chỉ dành cho căn thuộc tòa đó; chung toàn khu thì mọi căn */
const amenityVisibleTo = (amenity, apartment) =>
  !amenity.buildingId || String(amenity.buildingId) === String(apartment.buildingId?._id ?? apartment.buildingId);

async function canIncurCharges(userId, apartmentId, isHead) {
  if (isHead) return true; // BR-O26: chủ hộ luôn được
  const code = await MemberCode.findOne({ userId, apartmentId, isActive: true }).select('canIncurCharges').lean();
  return Boolean(code?.canIncurCharges);
}

/** Booking chưa dùng của căn: đã xác nhận / đang dùng và chưa kết thúc (BR-O3). CANCELLED, NO_SHOW, COMPLETED không tính */
const unusedFilter = (apartmentId, now) => ({
  apartmentId,
  status: { $in: ACTIVE },
  $or: [{ endAt: { $gt: now } }, { endAt: null }],
});

// ===================================================================================================
// Lưới slot
// ===================================================================================================
/**
 * Lưới slot của một ngày: sức chứa / đã đặt / còn lại, phí áp cho người xem, và lý do khóa.
 * Người xem là cư dân: phí = 0 nếu có gói tháng còn hiệu lực ngày đó; chọn căn bằng apartmentId (bắt buộc nếu ở nhiều căn).
 * Lễ tân / Bảo vệ / Trưởng BQL: xem lưới chung, phí = phí/lượt của tiện ích.
 */
export async function getSlots(user, amenityId, { date, apartmentId }, { now = new Date() } = {}) {
  const amenity = await getAmenity(user, amenityId); // cư dân chỉ thấy tiện ích đang mở, dùng chung hoặc của tòa mình
  if (accessModeOf(amenity) !== AMENITY_ACCESS_MODES.BOOKING) throw new ApiError('AMENITY_NOT_BOOKABLE');
  const dayStart = parseDay(date);
  const cfg = await getBookingConfig();

  const rows = await Booking.find({
    amenityId,
    startAt: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) },
    status: { $in: ACTIVE },
  })
    .select('apartmentId startAt')
    .lean();

  let viewer = null;
  let baseFee = amenity.feePerBooking;
  let usesPass = false;
  let myApartmentId = null;
  if (user.role === ROLES.RESIDENT) {
    myApartmentId = await resolveApartmentId(user.id, apartmentId);
    const { me } = await assertMember(user.id, myApartmentId);
    const [pass, canCharge, overdue, activeCount] = await Promise.all([
      getActivePass(user.id, amenityId, dayStart),
      canIncurCharges(user.id, myApartmentId, me.isHead),
      hasOverdueInvoice(myApartmentId, now),
      Booking.countDocuments(unusedFilter(myApartmentId, now)),
    ]);
    usesPass = Boolean(pass);
    if (pass) baseFee = 0;
    viewer = {
      apartmentId: myApartmentId,
      isHead: me.isHead,
      canIncurCharges: canCharge,
      overdue,
      activeCount,
      maxActive: cfg.maxActivePerApartment,
      limitReached: activeCount >= cfg.maxActivePerApartment,
      passId: pass?._id ?? null,
    };
  }

  const beyond = daysFromToday(dayStart, now) > cfg.advanceDays;
  const slots = buildSlotGrid(amenity).map((slot) => {
    const startAt = atTime(dayStart, slot.slotStart);
    const mine = rows.some((r) => String(r.apartmentId) === String(myApartmentId) && r.startAt.getTime() === startAt.getTime());
    const booked = rows.filter((r) => r.startAt.getTime() === startAt.getTime()).length;
    const remaining = Math.max(amenity.capacityPerSlot - booked, 0);
    const lockReason = isSlotPast(startAt, now, cfg)
      ? 'PAST'
      : beyond
        ? 'BEYOND_ADVANCE'
        : mine
          ? 'ALREADY_BOOKED'
          : remaining === 0
            ? 'FULL'
            : null;
    return {
      ...slot,
      startAt,
      endAt: atTime(dayStart, slot.slotEnd),
      capacity: amenity.capacityPerSlot,
      booked,
      remaining,
      fee: baseFee,
      usesPass,
      available: lockReason === null,
      lockReason,
      lockMessage: lockReason ? LOCK_MESSAGES[lockReason].replace('{days}', cfg.advanceDays) : null,
    };
  });

  return {
    amenity: {
      _id: amenity._id,
      name: amenity.name,
      imageUrl: amenity.imageUrl,
      location: amenity.location ?? null,
      openTime: amenity.openTime,
      closeTime: amenity.closeTime,
      slotDurationMinutes: amenity.slotDurationMinutes,
      capacityPerSlot: amenity.capacityPerSlot,
      feePerBooking: amenity.feePerBooking,
      isActive: amenity.isActive,
    },
    date,
    today: toVnYmd(now),
    maxDate: toVnYmd(new Date(vnDayStart(toVnYmd(now)).getTime() + cfg.advanceDays * DAY_MS)),
    rules: {
      advanceDays: cfg.advanceDays,
      maxActivePerApartment: cfg.maxActivePerApartment,
      checkinEarlyMinutes: cfg.checkinEarlyMinutes,
      noShowGraceMinutes: cfg.noShowGraceMinutes,
      receptionOpen: cfg.receptionOpen,
    },
    viewer,
    slots,
  };
}

// ===================================================================================================
// Đặt chỗ
// ===================================================================================================
export async function createBooking(user, { apartmentId, amenityId, date, slotStart }, { now = new Date() } = {}) {
  // Thành viên CÓ QUYỀN của căn (chủ sở hữu "không ở" bị từ chối ở đây → 403)
  const { me } = await assertMember(user.id, apartmentId);
  const cfg = await getBookingConfig();
  let usedPass = null;

  const created = await withTransaction(async (session) => {
    // Khóa theo tiện ích: mọi booking cùng tiện ích ghi lên cùng 1 document → giao dịch đến sau xung đột và chạy lại,
    // nên kiểm tra sức chứa bên dưới luôn thấy booking của giao dịch trước (không đặt vượt chỗ).
    const amenity = await Amenity.findOneAndUpdate({ _id: amenityId }, { $inc: { lockVersion: 1 } }, { returnDocument: 'after', session }).lean();
    if (!amenity) throw ApiError.notFound('Không tìm thấy tiện ích');

    // 1. Tiện ích: đúng tòa, đang hoạt động, kiểu BOOKING
    const apartment = await Apartment.findById(apartmentId).select('buildingId').session(session).lean();
    if (!amenityVisibleTo(amenity, apartment)) throw ApiError.notFound('Không tìm thấy tiện ích');
    if (!amenity.isActive) throw new ApiError('AMENITY_INACTIVE');
    if (accessModeOf(amenity) !== AMENITY_ACCESS_MODES.BOOKING) throw new ApiError('AMENITY_NOT_BOOKABLE');

    // 2. Slot khớp lưới, trong BOOKING_ADVANCE_DAYS, chưa qua
    const dayStart = parseDay(date);
    const slot = buildSlotGrid(amenity).find((s) => s.slotStart === slotStart);
    if (!slot) throw badRequest('slotStart', 'Khung giờ không khớp lưới của tiện ích');
    const offset = daysFromToday(dayStart, now);
    if (offset < 0) throw badRequest('date', 'Ngày đã qua');
    if (offset > cfg.advanceDays) throw badRequest('date', `Chỉ đặt trước tối đa ${cfg.advanceDays} ngày`);
    const startAt = atTime(dayStart, slot.slotStart);
    const endAt = atTime(dayStart, slot.slotEnd);
    if (isSlotPast(startAt, now, cfg)) throw badRequest('slotStart', 'Khung giờ đã qua');

    // 3. Căn không nợ quá hạn (BR-F8)
    await assertNoOverdue(apartmentId, now);

    // 4. Giới hạn booking chưa dùng của căn (BR-O3)
    const unused = await Booking.countDocuments(unusedFilter(apartmentId, now)).session(session);
    if (unused >= cfg.maxActivePerApartment) throw new ApiError('BOOKING_LIMIT_EXCEEDED');

    // 5. Căn chưa đặt slot này
    const sameSlot = { amenityId, startAt, status: { $in: ACTIVE } };
    if (await Booking.exists({ ...sameSlot, apartmentId }).session(session)) {
      throw new ApiError('BOOKING_SLOT_CONFLICT', 'Căn hộ đã đặt khung giờ này');
    }

    // 6. Còn chỗ (APPROVED + CHECKED_IN)
    if ((await Booking.countDocuments(sameSlot).session(session)) >= amenity.capacityPerSlot) throw new ApiError('BOOKING_SLOT_CONFLICT');

    // 7. Phí snapshot: có gói tháng còn hiệu lực → 0, ngược lại phí/lượt (BR-O13). Phí > 0 phải là chủ hộ hoặc được bật quyền (BR-O26)
    usedPass = await getActivePass(user.id, amenityId, startAt);
    const fee = usedPass ? 0 : amenity.feePerBooking;
    if (fee > 0 && !(await canIncurCharges(user.id, apartmentId, me.isHead))) throw new ApiError('CHARGE_NOT_ALLOWED');

    const [doc] = await Booking.create(
      [{ amenityId, apartmentId, bookedBy: user.id, date: dayStart, slotStart: slot.slotStart, slotEnd: slot.slotEnd, startAt, endAt, fee, passId: usedPass?._id ?? null }],
      { session },
    );

    // Chống tranh chấp với "ngừng tiện ích" (UC-D05): đọc lại isActive sau khi tạo; đã ngừng thì hoàn tác cả giao dịch
    const fresh = await Amenity.findById(amenityId).select('isActive').session(session).lean();
    if (!fresh?.isActive) throw new ApiError('AMENITY_INACTIVE');
    return { booking: doc.toObject(), amenity };
  });

  // MongoDB standalone (dev) không có transaction nên không hoàn tác được ở trên → kiểm tra lại sau khi ghi
  const after = await Amenity.findById(amenityId).select('isActive').lean();
  if (!after?.isActive) {
    await Booking.deleteOne({ _id: created.booking._id });
    throw new ApiError('AMENITY_INACTIVE');
  }
  // Khóa ở trên chỉ theo TIỆN ÍCH: cùng một căn đặt đồng thời 2 tiện ích khác nhau có thể cùng vượt giới hạn (BR-O3).
  // Kiểm tra lại sau khi ghi; vượt thì hoàn tác booking vừa tạo (có thể cả 2 cùng hoàn tác — an toàn hơn là vượt giới hạn).
  if ((await Booking.countDocuments(unusedFilter(apartmentId, now))) > cfg.maxActivePerApartment) {
    await Booking.deleteOne({ _id: created.booking._id });
    throw new ApiError('BOOKING_LIMIT_EXCEEDED');
  }

  const { booking, amenity } = created;
  const feeText = booking.fee > 0 ? `Phí ${formatVnd(booking.fee)}` : usedPass ? 'Miễn phí theo gói tháng' : 'Miễn phí';
  await notify(user.id, {
    type: NOTIFICATION_TYPES.BOOKING,
    title: 'Đặt tiện ích thành công',
    content: `${amenity.name} · ${dateVn(booking.date)} ${booking.slotStart}–${booking.slotEnd}. ${feeText}.`,
    refId: booking._id,
    link: LINK,
  });
  return presentBooking(booking, amenity);
}

const presentBooking = (booking, amenity) => ({
  ...booking,
  amenity: amenity && { _id: amenity._id, name: amenity.name, imageUrl: amenity.imageUrl ?? null, location: amenity.location ?? null },
});

// ===================================================================================================
// Hủy (cư dân): miễn phí trước giờ bắt đầu (BR-O4)
// ===================================================================================================
export async function cancelBooking(user, id, { reason } = {}, { now = new Date() } = {}) {
  const booking = await Booking.findById(id).lean();
  const mine = booking ? await getMyHouseholds(user.id) : [];
  // Căn khác (hoặc không có quyền trong căn đó) → coi như không tồn tại
  if (!booking || !mine.some((h) => String(h.apartment._id) === String(booking.apartmentId))) throw ApiError.notFound('Không tìm thấy booking');
  if (booking.status !== BOOKING_STATUS.APPROVED) throw new ApiError('BOOKING_INVALID_STATUS');
  const startAt = booking.startAt ?? atTime(booking.date, booking.slotStart);
  if (now.getTime() >= startAt.getTime()) throw new ApiError('BOOKING_CANCEL_TOO_LATE');

  // Điều kiện trạng thái hiện tại: hai người cùng hủy / lễ tân check-in đồng thời chỉ một bên thắng
  const cancelled = await Booking.findOneAndUpdate(
    { _id: id, status: BOOKING_STATUS.APPROVED },
    { $set: { status: BOOKING_STATUS.CANCELLED, cancelledAt: now, cancelledBy: user.id, cancelReason: reason?.trim() || null } },
    { returnDocument: 'after' },
  ).lean();
  if (!cancelled) throw new ApiError('BOOKING_INVALID_STATUS');

  const amenity = await Amenity.findById(cancelled.amenityId).select('name imageUrl location').lean();
  const recipients = [cancelled.bookedBy].filter((uid) => uid && String(uid) !== String(user.id));
  await notify(user.id, {
    type: NOTIFICATION_TYPES.BOOKING,
    title: 'Đã hủy đặt tiện ích',
    content: `${amenity?.name ?? 'Tiện ích'} · ${dateVn(cancelled.date)} ${cancelled.slotStart}–${cancelled.slotEnd} đã được hủy, không mất phí.`,
    refId: cancelled._id,
    link: LINK,
  });
  if (recipients.length) {
    await notify(recipients, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Booking của bạn đã bị hủy',
      content: `${amenity?.name ?? 'Tiện ích'} · ${dateVn(cancelled.date)} ${cancelled.slotStart}–${cancelled.slotEnd} đã được thành viên khác trong hộ hủy.`,
      refId: cancelled._id,
      link: LINK,
    });
  }
  return presentBooking(cancelled, amenity);
}

// ===================================================================================================
// Lịch sử
// ===================================================================================================
/** Chủ hộ: booking cả hộ; thành viên: booking do mình đặt. scope = upcoming (chưa kết thúc) | past */
export async function listMyBookings(user, { apartmentId, scope = 'upcoming', page, limit }, { now = new Date() } = {}) {
  const id = await resolveApartmentId(user.id, apartmentId);
  const { me } = await assertMember(user.id, id);
  const upcoming = { status: { $in: ACTIVE }, endAt: { $gt: now } };
  const filter = {
    apartmentId: id,
    ...(me.isHead ? {} : { bookedBy: user.id }),
    ...(scope === 'upcoming' ? upcoming : { $or: [{ status: { $nin: ACTIVE } }, { endAt: { $lte: now } }, { endAt: null }] }),
  };
  const { items, pagination } = await paginate(Booking, filter, { page, limit, sort: scope === 'upcoming' ? 'startAt' : '-startAt' }, {
    populate: [
      { path: 'amenityId', select: 'name imageUrl location accessMode' },
      { path: 'bookedBy', select: 'fullName avatarUrl' },
    ],
  });
  return {
    items: items.map((b) => ({
      ...b,
      amenity: b.amenityId && { _id: b.amenityId._id, name: b.amenityId.name, imageUrl: b.amenityId.imageUrl ?? null, location: b.amenityId.location ?? null },
      amenityId: b.amenityId?._id ?? b.amenityId,
      canCancel: b.status === BOOKING_STATUS.APPROVED && Boolean(b.startAt) && b.startAt.getTime() > now.getTime(),
      isMine: String(b.bookedBy?._id ?? b.bookedBy) === String(user.id),
    })),
    pagination,
  };
}
