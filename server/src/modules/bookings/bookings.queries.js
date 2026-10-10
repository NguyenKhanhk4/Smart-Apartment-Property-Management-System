// Truy vấn / trình bày booking dùng chung (UC-D07): lịch trong ngày của lễ tân – bảo vệ và khối "booking hôm nay"
// của màn hình tra mã (/member-codes/lookup). Chỉ phụ thuộc model + slot.utils để memberCodes.service gọi được mà không import vòng.
import { Booking, MemberCode } from '../../models/index.js';
import { DAY_MS } from '../../utils/time.js';
import { addMinutes, atTime, toVnYmd, vnDayStart } from '../amenities/slot.utils.js';

const DAY_POPULATE = [
  { path: 'amenityId', select: 'name imageUrl location accessMode' },
  { path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'code name' } },
  { path: 'bookedBy', select: 'fullName avatarUrl phone' },
  { path: 'createdByStaff', select: 'fullName' },
];

/** startAt thật của booking; dữ liệu cũ chưa có startAt thì suy từ date + slotStart */
export const startAtOf = (booking) => booking.startAt ?? atTime(booking.date, booking.slotStart);

/**
 * Khung check-in (BR-O14): từ max(startAt − CHECKIN_EARLY_MINUTES, giờ lễ tân mở cửa của ngày đó) đến startAt + NO_SHOW_GRACE_MINUTES.
 * Giờ mở cửa lấy theo ngày của slot (giờ VN) nên slot 05:00 không check-in được trước giờ lễ tân vào ca.
 */
export function checkInWindow(booking, cfg) {
  const startAt = startAtOf(booking);
  const receptionOpensAt = atTime(vnDayStart(toVnYmd(startAt)), cfg.receptionOpen);
  const early = addMinutes(startAt, -cfg.checkinEarlyMinutes);
  return {
    opensAt: early.getTime() > receptionOpensAt.getTime() ? early : receptionOpensAt,
    closesAt: addMinutes(startAt, cfg.noShowGraceMinutes),
  };
}

export function isInCheckInWindow(booking, cfg, now) {
  const { opensAt, closesAt } = checkInWindow(booking, cfg);
  return now.getTime() >= opensAt.getTime() && now.getTime() <= closesAt.getTime();
}

/** Mọi booking có ngày đặt (giờ VN) là `ymd`, kèm tiện ích / căn + tòa / người đặt. `extra` là điều kiện lọc thêm */
export function findDayBookings(ymd, extra = {}) {
  const dayStart = vnDayStart(ymd);
  return Booking.find({ ...extra, date: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) } })
    .populate(DAY_POPULATE)
    .sort({ slotStart: 1, createdAt: 1 })
    .lean();
}

/** Mã cư dân đang hiệu lực của các (căn, người) trong danh sách booking → Map "apartmentId:userId" → mã chữ */
async function memberCodesOf(bookings) {
  const apartmentIds = [...new Set(bookings.map((b) => String(b.apartmentId?._id ?? b.apartmentId)))];
  const userIds = [...new Set(bookings.map((b) => String(b.bookedBy?._id ?? b.bookedBy)).filter((id) => id !== 'undefined'))];
  if (!apartmentIds.length || !userIds.length) return new Map();
  const rows = await MemberCode.find({ apartmentId: { $in: apartmentIds }, userId: { $in: userIds }, isActive: true })
    .select('apartmentId userId code')
    .lean();
  return new Map(rows.map((r) => [`${r.apartmentId}:${r.userId}`, r.code]));
}

/**
 * Dạng trả về cho lịch trong ngày. Mỗi booking có mốc mở / đóng check-in (`checkIn.opensAt/closesAt`) để client tự gắn nhãn
 * theo `serverTime` (không dựa vào đồng hồ máy người dùng).
 */
export async function presentDayBookings(bookings, cfg) {
  const codes = await memberCodesOf(bookings);
  return bookings.map((b) => {
    const booker = b.bookedBy && typeof b.bookedBy === 'object' ? b.bookedBy : null;
    const apartment = b.apartmentId && typeof b.apartmentId === 'object' ? b.apartmentId : null;
    const amenity = b.amenityId && typeof b.amenityId === 'object' ? b.amenityId : null;
    const startAt = startAtOf(b);
    return {
      _id: b._id,
      status: b.status,
      date: b.date,
      slotStart: b.slotStart,
      slotEnd: b.slotEnd,
      startAt,
      endAt: b.endAt ?? atTime(b.date, b.slotEnd),
      fee: b.fee,
      usesPass: Boolean(b.passId),
      invoiceId: b.invoiceId ?? null,
      amenity: amenity && { _id: amenity._id, name: amenity.name, imageUrl: amenity.imageUrl ?? null, location: amenity.location ?? null },
      apartment: apartment && {
        _id: apartment._id,
        code: apartment.code,
        building: apartment.buildingId ? { _id: apartment.buildingId._id, code: apartment.buildingId.code, name: apartment.buildingId.name } : null,
      },
      bookedBy: booker && {
        userId: booker._id,
        fullName: booker.fullName,
        avatarUrl: booker.avatarUrl ?? null,
        phone: booker.phone ?? null,
        memberCode: codes.get(`${apartment?._id}:${booker._id}`) ?? null,
      },
      createdByStaff: b.createdByStaff && typeof b.createdByStaff === 'object' ? { userId: b.createdByStaff._id, fullName: b.createdByStaff.fullName } : null,
      checkIn: checkInWindow({ ...b, startAt }, cfg),
      checkedInAt: b.checkedInAt ?? null,
      cancelledAt: b.cancelledAt ?? null,
      cancelReason: b.cancelReason ?? null,
    };
  });
}

/** "HH:mm" giờ VN của một mốc thời gian */
export const vnHHmm = (date) => new Date(new Date(date).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);

/** Một booking ở dạng trả về của lịch trong ngày (dùng sau check-in / hủy để client cập nhật dòng) */
export async function loadBookingView(id, cfg) {
  const rows = await Booking.find({ _id: id }).populate(DAY_POPULATE).lean();
  return (await presentDayBookings(rows, cfg))[0] ?? null;
}

/** Booking hôm nay (giờ VN) của một căn — khối "Booking hôm nay" khi tra mã. `personId` để đánh dấu booking do chính người đó đặt */
export async function listApartmentBookingsToday(apartmentId, personId, cfg, now = new Date()) {
  const rows = await findDayBookings(toVnYmd(now), { apartmentId });
  const items = await presentDayBookings(rows, cfg);
  return items.map((item) => ({ ...item, isMine: String(item.bookedBy?.userId) === String(personId) }));
}
