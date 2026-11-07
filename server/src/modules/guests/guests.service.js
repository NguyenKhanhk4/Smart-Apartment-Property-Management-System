// Module 7: xử lý khách, bưu kiện, tuần tra và cảnh báo khẩn với kiểm tra quyền/phạm vi ở backend.
import { randomUUID } from 'node:crypto';
import { GUEST_STATUS, NOTIFICATION_TYPES, ROLES } from '../../constants/enums.js';
import { Apartment, GuestLog, Resident, User, DutyShift, Ticket } from '../../models/index.js';
import { Parcel, PatrolCheckpoint, PatrolTour, SecurityIncident } from '../../models/GuestLog.js';
import { notify, notifyRoles, notifyApartment } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { getOnDuty } from '../dutyShifts/dutyShifts.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { DAY_MS, HOUR_MS, endOfVnDay, fmtTimeVn, startOfVnDay } from '../../utils/time.js';
import { decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';

const POPULATE = [
  { path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'name' } },
  { path: 'registeredBy', select: 'fullName phone' },
  { path: 'recordedBy', select: 'fullName' },
];

/**
 * Khách mới chỉ lưu 4 số cuối CCCD; tiếp tục che bản ghi cũ từng lưu toàn bộ số/mã hóa.
 * Không trả dữ liệu mã hóa/hash cho frontend và không yêu cầu khóa mã hóa cho khách mới.
 */
const withIdFields = ({ idNumber, ...data }) => ({
  ...data, ...(idNumber ? { idLast4: String(idNumber).replace(/\D/g, '').slice(-4) } : {}),
});

export function presentGuest(log) {
  const plain = typeof log.toObject === 'function' ? log.toObject() : log;
  const { idNumberEnc, ...rest } = plain;
  delete rest.idNumberHash;
  const idNumber = idNumberEnc ? decryptIdNumber(idNumberEnc) : plain.idNumber;
  return { ...rest, idNumber: plain.idLast4 ? `********${plain.idLast4}` : maskIdNumber(idNumber) };
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
    residentConfirmation: 'CONFIRMED', confirmedBy: user.id,
  });
  return presentGuest(log);
}

export async function cancelRegistration(user, id) {
  const log = await findOr404(id);
  const mine = await getActiveApartmentIds(user.id);
  if (!mine.includes(String(log.apartmentId))) throw ApiError.forbidden('Không phải khách của căn hộ bạn');
  if (log.isWalkIn) throw ApiError.badRequest('Khách do Bảo vệ tạo cần được xác nhận hoặc từ chối, không xóa nhật ký');
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
    const mine = await getActiveApartmentIds(user.id);
    if (query.apartmentId && !mine.includes(String(query.apartmentId))) throw ApiError.forbidden();
    filter.apartmentId = query.apartmentId || { $in: mine };
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

export async function confirmGuest(user, id, confirmed) {
  const log = await findOr404(id);
  if (!(await getActiveApartmentIds(user.id)).includes(String(log.apartmentId))) throw ApiError.forbidden();
  if (log.status === GUEST_STATUS.CHECKED_OUT) throw ApiError.badRequest('Khách đã rời tòa nhà');
  const updated = await GuestLog.findOneAndUpdate(
    { _id: id, residentConfirmation: 'PENDING', status: { $ne: GUEST_STATUS.CHECKED_OUT } },
    { $set: { residentConfirmation: confirmed ? 'CONFIRMED' : 'DECLINED', confirmedBy: user.id }, $inc: { __v: 1 } },
    { new: true },
  );
  if (!updated) throw ApiError.badRequest('Yêu cầu đã được phản hồi');
  await notifyRoles(['STAFF:SECURITY'], { type: NOTIFICATION_TYPES.GUEST, title: 'Cư dân phản hồi khách đến thăm',
    content: `${log.guestName}: ${confirmed ? 'đồng ý' : 'không xác nhận'}.`, link: '/app/guests', refId: log._id });
  return presentGuest(updated);
}

const isManager = (user) => user.role === ROLES.MANAGER;
function requireStaff(user, title) {
  if (!(user.role === ROLES.STAFF && user.roleTitle === title)) throw ApiError.forbidden();
}
function requireManager(user) { if (!isManager(user)) throw ApiError.forbidden(); }

// Một API dữ liệu phân trang cho các tab vận hành; chữ ký và token không select mặc định.
export async function listOperations(user, kind, query = {}) {
  const models = { parcels: Parcel, checkpoints: PatrolCheckpoint, tours: PatrolTour, incidents: SecurityIncident };
  const Model = models[kind];
  if (!Model) throw ApiError.notFound();
  const filter = {};
  if (user.role === ROLES.RESIDENT) {
    if (kind !== 'parcels') throw ApiError.forbidden();
    const mine = await getActiveApartmentIds(user.id);
    if (query.apartmentId && !mine.includes(String(query.apartmentId))) throw ApiError.forbidden();
    filter.apartmentId = query.apartmentId || { $in: mine };
  } else if (kind === 'tours' && !isManager(user)) filter.guardId = user.id;
  if (kind === 'parcels' && query.status) filter.status = query.status;
  if (kind === 'incidents' && query.status === 'OPEN') filter.acknowledgedAt = null;
  if (query.from || query.to) filter.createdAt = {
    ...(query.from && { $gte: startOfVnDay(query.from) }), ...(query.to && { $lte: endOfVnDay(query.to) }),
  };
  const populate = kind === 'parcels' ? [{ path: 'apartmentId', select: 'code' }]
    : kind === 'tours' ? [{ path: 'guardId', select: 'fullName' }]
      : kind === 'incidents' ? [{ path: 'reportedBy', select: 'fullName' }, { path: 'acknowledgedBy', select: 'fullName' }] : undefined;
  const result = await paginate(Model, filter, { ...query, sort: '-createdAt' }, {
    populate, ...(kind === 'checkpoints' && isManager(user) && { select: '+token' }),
  });
  if (kind === 'tours') result.items = result.items.map((tour) => ({ ...tour,
    missed: tour.endAt <= new Date() ? tour.checkpoints.filter((p) => !tour.scans.some((s) => String(s.checkpointId) === String(p.checkpointId))) : [],
  }));
  return result;
}

export async function receiveParcel(user, data, imageUrls) {
  requireStaff(user, 'RECEPTIONIST');
  if (!(await Apartment.exists({ _id: data.apartmentId }))) throw ApiError.badRequest('Căn hộ không tồn tại');
  if (!imageUrls?.length) throw ApiError.badRequest('Cần ảnh bưu kiện');
  const parcel = await Parcel.create({ apartmentId: data.apartmentId, trackingCode: data.trackingCode,
    carrier: data.carrier, imageUrls, receivedBy: user.id });
  await notifyApartment(parcel.apartmentId, { type: NOTIFICATION_TYPES.GUEST, title: 'Bưu kiện đang lưu quầy',
    content: `Mã ${parcel.trackingCode} (${parcel.carrier}). Vui lòng xuống quầy nhận và ký tên.`, refId: parcel._id, link: '/r/guests' });
  return parcel;
}

export async function handOverParcel(user, id, data) {
  requireStaff(user, 'RECEPTIONIST');
  const parcel = await Parcel.findById(id).lean();
  if (!parcel) throw ApiError.notFound('Không tìm thấy bưu kiện');
  const fields = { handedOverBy: user.id, handedOverAt: new Date() };
  if (data.returned) {
    if (parcel.status !== 'AWAITING_RETURN') throw ApiError.badRequest('Bưu kiện chưa ở trạng thái chờ trả');
    fields.status = 'RETURNED';
  } else {
    const member = await Resident.findOne({ apartmentId: parcel.apartmentId, userId: data.recipientId, isActive: true }).lean();
    const recipient = member && await User.findOne({ _id: data.recipientId, isActive: true }).select('fullName').lean();
    if (!recipient) throw ApiError.badRequest('Người nhận phải là thành viên đang hoạt động của đúng căn');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.signature || '') || data.signature.length > 150000) {
      throw ApiError.badRequest('Cần chữ ký PNG hợp lệ');
    }
    const png = Buffer.from(data.signature.split(',')[1], 'base64');
    if (png.length < 100 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw ApiError.badRequest('Chữ ký không phải ảnh PNG');
    Object.assign(fields, { status: 'COLLECTED', collectedBy: data.recipientId, recipientName: recipient.fullName, signature: data.signature });
  }
  const result = await Parcel.findOneAndUpdate({ _id: id, status: { $in: data.returned ? ['AWAITING_RETURN'] : ['STORED', 'AWAITING_RETURN'] } },
    { $set: fields }, { new: true });
  if (!result) throw ApiError.badRequest('Bưu kiện đã bàn giao hoặc đã trả');
  return result;
}

export async function parcelRecipients(user, id) {
  requireStaff(user, 'RECEPTIONIST');
  const parcel = await Parcel.findById(id).lean();
  if (!parcel) throw ApiError.notFound();
  const residents = await Resident.find({ apartmentId: parcel.apartmentId, isActive: true }).select('userId').lean();
  return User.find({ _id: { $in: residents.map((r) => r.userId) }, isActive: true }).select('fullName').lean();
}

export async function createCheckpoint(user, data) {
  requireManager(user);
  return PatrolCheckpoint.create({ name: data.name, location: data.location, token: randomUUID() });
}
export async function updateCheckpoint(user, id, active) {
  requireManager(user);
  const point = await PatrolCheckpoint.findByIdAndUpdate(id, { $set: { active } }, { new: true });
  if (!point) throw ApiError.notFound();
  return point;
}
export async function createTour(user, data) {
  requireManager(user);
  const shift = await DutyShift.findOne({ _id: data.shiftId, roleTitle: 'SECURITY', isBackup: false }).lean();
  const now = new Date();
  if (!shift || shift.endAt <= now) throw ApiError.badRequest('Chọn ca Bảo vệ chính chưa kết thúc');
  const guard = await User.exists({ _id: shift.userId, isActive: true, role: 'STAFF', roleTitle: 'SECURITY' });
  if (!guard || data.startAt < shift.startAt || data.endAt > shift.endAt || data.endAt <= data.startAt || data.endAt <= now) {
    throw ApiError.badRequest('Thời gian tuần tra phải nằm trong ca đang hoạt động của Bảo vệ');
  }
  const points = await PatrolCheckpoint.find({ _id: { $in: data.checkpointIds }, active: true }).lean();
  if (points.length !== data.checkpointIds.length) throw ApiError.badRequest('Điểm tuần tra không hợp lệ hoặc trùng');
  return PatrolTour.create({ name: data.name, shiftId: shift._id, guardId: shift.userId, startAt: data.startAt, endAt: data.endAt,
    checkpoints: data.checkpointIds.map((id) => { const p = points.find((v) => String(v._id) === String(id)); return { checkpointId: p._id, name: p.name, location: p.location }; }) });
}

export async function scanCheckpoint(user, id, data, now = new Date()) {
  requireStaff(user, 'SECURITY');
  const checkpoint = await PatrolCheckpoint.findOne({ token: data.code.replace(/^CP1\./, '') }).lean();
  if (!checkpoint) throw ApiError.badRequest('Mã checkpoint không hợp lệ');
  const tour = await PatrolTour.findOne({ _id: id, guardId: user.id, startAt: { $lte: now }, endAt: { $gt: now } }).lean();
  if (!tour || !(await DutyShift.exists({ _id: tour.shiftId, userId: user.id, startAt: { $lte: now }, endAt: { $gt: now } }))) {
    throw ApiError.forbidden('Không phải lượt tuần tra của bạn trong ca hiện tại');
  }
  if (!tour.checkpoints.some((p) => String(p.checkpointId) === String(checkpoint._id))) throw ApiError.badRequest('Điểm này không thuộc lộ trình');
  const updated = await PatrolTour.findOneAndUpdate({ _id: id, 'scans.checkpointId': { $ne: checkpoint._id }, endAt: { $gt: now } },
    { $push: { scans: { checkpointId: checkpoint._id, scannedAt: now, latitude: data.latitude, longitude: data.longitude } } }, { new: true });
  if (!updated) throw ApiError.badRequest('Điểm đã quét hoặc lượt tuần tra đã kết thúc');
  return updated;
}

// requestId duy nhất giúp gửi lại từ điện thoại không tạo hai sự cố; không tự đóng ticket khi tiếp nhận.
export async function reportIncident(user, data, imageUrls = []) {
  requireStaff(user, 'SECURITY');
  const filter = { requestId: data.requestId };
  const existing = await SecurityIncident.findOne(filter).lean();
  if (existing) {
    if (String(existing.reportedBy) !== user.id || existing.type !== data.type || existing.description !== data.description || existing.location !== data.location) {
      throw ApiError.badRequest('Mã yêu cầu đã được dùng cho báo cáo khác');
    }
    return existing;
  }
  // Upsert theo khóa duy nhất để hai request gửi cùng lúc dùng chung một sự cố.
  let incident;
  try {
    incident = await SecurityIncident.findOneAndUpdate(filter,
      { $setOnInsert: { ...data, reportedBy: user.id, imageUrls } },
      { upsert: true, returnDocument: 'after', runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    incident = await SecurityIncident.findOne(filter);
    if (!incident) throw error;
  }
  if (String(incident.reportedBy) !== String(user.id) || incident.type !== data.type ||
      incident.description !== data.description || incident.location !== data.location) {
    throw ApiError.badRequest('Mã yêu cầu đã được dùng cho báo cáo khác');
  }
  // Job sẽ retry khi kênh gửi lỗi; báo cáo đã lưu vẫn trả thành công.
  await dispatchIncident(incident._id).catch((error) => console.error('[module7] Chờ gửi lại cảnh báo:', error.message));
  return incident;
}

export async function acknowledgeIncident(user, id) {
  const incident = await SecurityIncident.findById(id).lean();
  if (!incident) throw ApiError.notFound();
  if (!isManager(user)) {
    const shifts = await Promise.all(['TECHNICIAN', 'SECURITY'].map((r) => getOnDuty(r)));
    if (!shifts.some((s) => s.backup.some((p) => String(p._id) === user.id))) throw ApiError.forbidden('Chỉ Trưởng BQL hoặc người trực dự phòng tiếp nhận');
  }
  const updated = await SecurityIncident.findOneAndUpdate({ _id: id, acknowledgedAt: null },
    { $set: { acknowledgedBy: user.id, acknowledgedAt: new Date() } }, { new: true });
  if (!updated) throw ApiError.badRequest('Cảnh báo đã được tiếp nhận');
  return updated;
}

export async function broadcastIncident(user, id) {
  requireManager(user);
  const incident = await SecurityIncident.findOneAndUpdate({ _id: id, broadcastAt: null }, { $set: { broadcastAt: new Date() } }, { new: true });
  if (!incident) throw ApiError.badRequest('Không tìm thấy sự cố hoặc đã phát cảnh báo cư dân');
  try {
    await notifyRoles(['RESIDENT'], { type: NOTIFICATION_TYPES.SYSTEM, title: 'KHẨN CẤP: Thông báo từ Ban quản lý',
      content: `${incident.location}: ${incident.description}`, refId: incident._id, link: '/r/guests', email: true });
  } catch (error) {
    await SecurityIncident.updateOne({ _id: id }, { $unset: { broadcastAt: 1 } });
    throw error;
  }
  return { sent: true };
}

async function dispatchIncident(id, now = new Date()) {
  // Lease 1 phút để hai worker không phát cùng lúc; khi lỗi sẽ mở lại để job retry.
  const incident = await SecurityIncident.findOneAndUpdate({ _id: id, acknowledgedAt: null, nextNotifyAt: { $lte: now } },
    { $set: { nextNotifyAt: new Date(now.getTime() + 60000) } }, { new: true }).lean();
  if (!incident) return 0;
  try {
    const shifts = await Promise.all(['SECURITY', 'TECHNICIAN'].map((r) => getOnDuty(r, now)));
    const managers = await User.find({ role: 'MANAGER', isActive: true }).select('_id').lean();
    const targets = [...managers.map((p) => p._id), ...shifts.flatMap((s) => s.backup.map((p) => p._id))];
    await notify(targets, { type: NOTIFICATION_TYPES.SYSTEM, title: 'KHẨN CẤP: Cần tiếp nhận sự cố',
      content: `${incident.location}: ${incident.description}`, refId: incident._id, link: '/app/guests', email: true });
    // Nhân viên trực thấy banner qua API; không gửi Email toàn bộ nhân viên ngoài ca.
    await SecurityIncident.updateOne({ _id: id, acknowledgedAt: null }, { $set: { notifiedAt: now, nextNotifyAt: new Date(now.getTime() + 15 * 60000) } });
    return 1;
  } catch (error) {
    await SecurityIncident.updateOne({ _id: id }, { $set: { nextNotifyAt: now } });
    throw error;
  }
}

export async function activeAlerts(user) {
  if (user.role === 'RESIDENT') return SecurityIncident.find({ broadcastAt: { $ne: null }, broadcastEndedAt: null })
    .select('location description createdAt').sort({ createdAt: -1 }).limit(20).lean();
  if (!isManager(user)) {
    let onDuty;
    if (user.roleTitle === 'RECEPTIONIST') {
      const [open, close] = await Promise.all([getConfig('RECEPTION_OPEN_TIME'), getConfig('RECEPTION_CLOSE_TIME')]);
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      onDuty = open <= close ? time >= open && time < close : time >= open || time < close;
    } else onDuty = await DutyShift.exists({ userId: user.id, startAt: { $lte: new Date() }, endAt: { $gt: new Date() } });
    if (!onDuty) return [];
  }
  const shifts = await Promise.all(['SECURITY', 'TECHNICIAN'].map((r) => getOnDuty(r)));
  const canAcknowledge = isManager(user) || shifts.some((s) => s.backup.some((p) => String(p._id) === user.id));
  const alerts = await SecurityIncident.find({ acknowledgedAt: null }).select('location description createdAt').sort({ createdAt: -1 }).limit(20).lean();
  return alerts.map((alert) => ({ ...alert, canAcknowledge }));
}

export async function endBroadcast(user, id) {
  requireManager(user);
  const incident = await SecurityIncident.findOneAndUpdate({ _id: id, broadcastAt: { $ne: null }, broadcastEndedAt: null },
    { $set: { broadcastEndedAt: new Date() } }, { new: true });
  if (!incident) throw ApiError.badRequest('Cảnh báo cư dân chưa phát hoặc đã kết thúc');
  return incident;
}

export async function parcelReceipt(user, id) {
  if (!isManager(user)) requireStaff(user, 'RECEPTIONIST');
  const parcel = await Parcel.findById(id).select('recipientName handedOverAt +signature').lean();
  if (!parcel) throw ApiError.notFound();
  return parcel;
}

export async function operationsSummary(user, query = {}) {
  if (!['MANAGER', 'BOARD'].includes(user.role)) throw ApiError.forbidden();
  const filter = { createdAt: { $gte: startOfVnDay(query.from || new Date()), $lte: endOfVnDay(query.to || new Date()) } };
  const [guests, parcels, tours] = await Promise.all([
    GuestLog.countDocuments({ checkInTime: filter.createdAt }),
    Parcel.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PatrolTour.find({ endAt: { ...filter.createdAt, $lte: new Date(Math.min(+filter.createdAt.$lte, Date.now())) } }).select('checkpoints scans endAt').lean(),
  ]);
  return { guests, parcels, tours: tours.length, completeTours: tours.filter((t) => t.scans.length === t.checkpoints.length).length,
    missingCheckpoints: tours.reduce((sum, t) => sum + t.checkpoints.length - t.scans.length, 0) };
}

// Dùng job hiện có: retention khách, nhắc bưu kiện, điểm bỏ sót và nhắc khẩn; không phụ thuộc DB thật khi test.
export async function runOperationsJobs(now = new Date()) {
  let affected = 0;
  const retention = Number(await getConfig('GUEST_RETENTION_MONTHS', 12));
  const cutoff = new Date(now); cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.max(1, retention));
  affected += (await GuestLog.deleteMany({ createdAt: { $lt: cutoff } })).deletedCount;
  affected += (await Parcel.updateMany({ status: 'STORED', createdAt: { $lte: new Date(now.getTime() - 14 * DAY_MS) } }, { $set: { status: 'AWAITING_RETURN' } })).modifiedCount;
  const waiting = await Parcel.find({ status: 'STORED', remindedAt: null, createdAt: { $lte: new Date(now.getTime() - 3 * DAY_MS) } }).select('_id apartmentId trackingCode').lean();
  for (const parcel of waiting) {
    if (!(await Parcel.updateOne({ _id: parcel._id, status: 'STORED', remindedAt: null }, { $set: { remindedAt: now } })).modifiedCount) continue;
    try {
      await notifyApartment(parcel.apartmentId, { type: NOTIFICATION_TYPES.GUEST, title: 'Nhắc nhận bưu kiện', content: `Bưu kiện ${parcel.trackingCode} đã lưu quầy quá 3 ngày.`, link: '/r/guests', refId: parcel._id });
      affected++;
    } catch (error) { await Parcel.updateOne({ _id: parcel._id }, { $unset: { remindedAt: 1 } }); throw error; }
  }
  const tours = await PatrolTour.find({ endAt: { $lte: now }, missedNotifiedAt: null }).lean();
  for (const tour of tours) {
    const missed = tour.checkpoints.filter((p) => !tour.scans.some((s) => String(s.checkpointId) === String(p.checkpointId)));
    if (!(await PatrolTour.updateOne({ _id: tour._id, missedNotifiedAt: null }, { $set: { missedNotifiedAt: now } })).modifiedCount) continue;
    try {
      if (missed.length) await notifyRoles(['MANAGER'], { type: NOTIFICATION_TYPES.SYSTEM, title: 'Tuần tra thiếu checkpoint',
        content: `${tour.name}: ${missed.map((p) => p.name).join(', ')}.`, link: '/app/guests', refId: tour._id });
      affected++;
    } catch (error) { await PatrolTour.updateOne({ _id: tour._id }, { $unset: { missedNotifiedAt: 1 } }); throw error; }
  }
  // Tái dùng ticket gốc, không tạo một ticket kỹ thuật thứ hai.
  const urgent = await Ticket.find({ priority: 'URGENT', status: 'NEW', assignedTo: null, ackDueAt: { $lt: now } }).select('_id code title').lean();
  for (const ticket of urgent) {
    await SecurityIncident.updateOne({ requestId: `ticket:${ticket._id}` }, { $setOnInsert: {
      type: 'TECHNICAL', location: ticket.code, description: ticket.title, sourceTicketId: ticket._id, nextNotifyAt: now,
    } }, { upsert: true });
  }
  // Khi KTV nhận phiếu thì dừng nhắc khẩn, không thay đổi trạng thái ticket.
  const ticketAlerts = await SecurityIncident.find({ sourceTicketId: { $ne: null }, acknowledgedAt: null }).lean();
  for (const alert of ticketAlerts) {
    const ticket = await Ticket.findById(alert.sourceTicketId).select('assignedTo status').lean();
    if (ticket && (ticket.assignedTo || ticket.status !== 'NEW')) await SecurityIncident.updateOne({ _id: alert._id, acknowledgedAt: null },
      { $set: { acknowledgedAt: now, acknowledgedBy: ticket.assignedTo || null, nextNotifyAt: new Date('9999-01-01') } });
  }
  const incidents = await SecurityIncident.find({ acknowledgedAt: null, nextNotifyAt: { $lte: now } }).select('_id').lean();
  for (const incident of incidents) affected += await dispatchIncident(incident._id, now);
  return affected;
}

// ===== UC-E08: Bảo vệ ghi nhận khách đến/rời =====
export async function checkIn(user, id, { note }) {
  const log = await findOr404(id);
  if (log.status !== GUEST_STATUS.EXPECTED) throw ApiError.badRequest('Khách đã được ghi nhận đến trước đó');
  if (log.isWalkIn && log.residentConfirmation !== 'CONFIRMED') throw ApiError.badRequest('Cần cư dân đồng ý trước khi cho khách vào');
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
    status: GUEST_STATUS.EXPECTED,
    isWalkIn: true,
    expectedTime: now,
    recordedBy: user.id,
  });
  await notifyApartment(apartment._id, {
    type: NOTIFICATION_TYPES.GUEST,
    title: 'Có khách đến thăm',
    content: `${log.guestName} đang chờ ở sảnh để thăm căn ${apartment.code}. Vui lòng đồng ý hoặc từ chối trước khi Bảo vệ cho vào.`,
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
