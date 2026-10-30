import { GUEST_STATUS, NOTIFICATION_TYPES, ROLES } from '../../constants/enums.js';
import { Apartment, GuestLog } from '../../models/index.js';
import { notifyApartment } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { HOUR_MS, endOfVnDay, fmtTimeVn, startOfVnDay } from '../../utils/time.js';
import { buildIdNumberFields, decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';

const POPULATE = [
  { path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'name' } },
  { path: 'registeredBy', select: 'fullName phone' },
  { path: 'recordedBy', select: 'fullName' },
];

/**
 * CCCD khách lưu mã hóa (idNumberEnc + idNumberHash, không select mặc định) như CCCD cư dân.
 * API chỉ trả số đã che; bản ghi cũ còn idNumber dạng rõ cũng được che khi trả về.
 */
const withIdFields = ({ idNumber, ...data }) => (idNumber === undefined ? data : { ...data, ...buildIdNumberFields(idNumber) });

export function presentGuest(log) {
  const plain = typeof log.toObject === 'function' ? log.toObject() : log;
  const { idNumberEnc, ...rest } = plain;
  delete rest.idNumberHash;
  const idNumber = idNumberEnc ? decryptIdNumber(idNumberEnc) : plain.idNumber;
  return { ...rest, idNumber: maskIdNumber(idNumber) };
}

async function findOr404(id) {
  const log = await GuestLog.findById(id).select('+idNumberEnc');
  if (!log) throw ApiError.notFound('Không tìm thấy bản ghi khách');
  return log;
}

// ===== UC-E07: Cư dân đăng ký khách trước =====
export async function registerGuest(user, data) {
  const apartment = await resolveResidentApartment(user.id, data.apartmentId);
  if (data.expectedTime.getTime() < Date.now() - HOUR_MS) {
    throw ApiError.badRequest('Thời gian dự kiến không được ở quá khứ');
  }
  const log = await GuestLog.create({
    ...withIdFields(data),
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    status: GUEST_STATUS.EXPECTED,
    registeredBy: user.id,
  });
  return presentGuest(log);
}

export async function cancelRegistration(user, id) {
  const log = await findOr404(id);
  const mine = await getActiveApartmentIds(user.id);
  if (!mine.includes(String(log.apartmentId))) throw ApiError.forbidden('Không phải khách của căn hộ bạn');
  if (log.status !== GUEST_STATUS.EXPECTED) {
    throw ApiError.badRequest('Khách đã đến, không thể hủy đăng ký');
  }
  await log.deleteOne();
  return { deleted: true };
}

/**
 * Danh sách sổ khách. Cư dân chỉ thấy căn của mình; bảo vệ/lễ tân/manager thấy tất cả.
 * `date` = 1 ngày (giờ VN) — lọc theo expectedTime hoặc checkInTime trong ngày đó.
 */
export async function listGuests(user, query) {
  const filter = {};
  if (user.role === ROLES.RESIDENT) {
    filter.apartmentId = { $in: await getActiveApartmentIds(user.id) };
  } else if (query.apartmentId) {
    filter.apartmentId = query.apartmentId;
  }
  if (query.status) filter.status = { $in: query.status };
  if (query.date) {
    const range = { $gte: startOfVnDay(query.date), $lte: endOfVnDay(query.date) };
    filter.$or = [{ expectedTime: range }, { checkInTime: range }];
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q), 'i');
    const apartments = await Apartment.find({ code: re }).select('_id').lean();
    const or = [{ guestName: re }, { guestPhone: re }, { apartmentId: { $in: apartments.map((a) => a._id) } }];
    filter.$and = [...(filter.$or ? [{ $or: filter.$or }] : []), { $or: or }];
    delete filter.$or;
  }
  const { items, pagination } = await paginate(GuestLog, filter, { ...query, sort: query.sort ?? '-createdAt' }, {
    populate: POPULATE,
    select: '+idNumberEnc',
  });
  return { items: items.map(presentGuest), pagination };
}

// ===== UC-E08: Bảo vệ ghi nhận khách đến/rời =====
export async function checkIn(user, id, { note }) {
  const log = await findOr404(id);
  if (log.status !== GUEST_STATUS.EXPECTED) throw ApiError.badRequest('Khách đã được ghi nhận đến trước đó');
  log.status = GUEST_STATUS.CHECKED_IN;
  log.checkInTime = new Date();
  log.recordedBy = user.id;
  if (note) log.note = note;
  await log.save();

  await notifyApartment(log.apartmentId, {
    type: NOTIFICATION_TYPES.GUEST,
    title: 'Khách của bạn đã đến',
    content: `${log.guestName} đã vào tòa nhà lúc ${fmtTimeVn(log.checkInTime)}.`,
    refId: log._id,
    link: '/r/guests',
  });
  return presentGuest(log);
}

/** BR-O10: khách vãng lai — bắt buộc tên khách + căn hộ đến thăm */
export async function walkIn(user, data) {
  const apartment = await Apartment.findById(data.apartmentId).lean();
  if (!apartment) throw ApiError.badRequest('Căn hộ đến thăm không tồn tại');
  const now = new Date();
  const log = await GuestLog.create({
    ...withIdFields(data),
    buildingId: apartment.buildingId,
    status: GUEST_STATUS.CHECKED_IN,
    isWalkIn: true,
    expectedTime: now,
    checkInTime: now,
    recordedBy: user.id,
  });
  await notifyApartment(apartment._id, {
    type: NOTIFICATION_TYPES.GUEST,
    title: 'Có khách đến thăm',
    content: `${log.guestName} (khách chưa đăng ký) vừa vào thăm căn ${apartment.code}.`,
    refId: log._id,
    link: '/r/guests',
  });
  return presentGuest(log);
}

export async function checkOut(user, id) {
  const log = await findOr404(id);
  if (log.status !== GUEST_STATUS.CHECKED_IN) throw ApiError.badRequest('Khách chưa vào hoặc đã rời');
  log.status = GUEST_STATUS.CHECKED_OUT;
  log.checkOutTime = new Date();
  log.recordedBy ??= user.id;
  await log.save();
  return presentGuest(log);
}
