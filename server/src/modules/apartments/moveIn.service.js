import { APARTMENT_OCCUPANCY, AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, RELATION_TYPES } from '../../constants/enums.js';
import { Apartment, Contract, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { canUseResidentServices } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { toVnYmd, vnDayStart } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';

function moveInDate(value, apartment) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? vnDayStart(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || toVnYmd(date) !== value || value > toVnYmd(new Date())) {
    throw ApiError.field('moveInDate', 'Ngày bắt đầu ở phải hợp lệ và không được ở tương lai');
  }
  if (date < vnDayStart(toVnYmd(apartment.handoverDate))) {
    throw ApiError.field('moveInDate', 'Ngày bắt đầu ở không được trước ngày bàn giao');
  }
  return date;
}

async function targetResidence(apartmentId, session) {
  const apartment = await Apartment.findById(apartmentId).session(session);
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
  if (!apartment.handoverDate || apartment.handoverDate > new Date()) {
    throw new ApiError('STATUS_CONFLICT', 'Cần ghi nhận bàn giao căn hộ trước khi xác nhận vào ở');
  }
  const sale = await Contract.findOne({ apartmentId, type: 'SALE', status: 'ACTIVE', startDate: { $lte: new Date() } }).session(session).lean();
  if (!sale || sale.ownerAccountPending) {
    throw new ApiError('STATUS_CONFLICT', 'Cần hồ sơ sở hữu hiệu lực và đã cấp tài khoản chủ sở hữu');
  }
  const tenant = await Resident.findOne({ apartmentId, relationType: 'TENANT', isActive: true,
    $or: [{ moveInDate: null }, { moveInDate: { $lte: new Date() } }],
  }).session(session);
  const resident = tenant ?? await Resident.findOne({ apartmentId, relationType: 'OWNER', isActive: true, userId: sale.ownerId }).session(session);
  if (!resident?.userId) throw new ApiError('STATUS_CONFLICT', 'Cần cấp quyền tài khoản cho người vào ở trước khi ghi nhận');
  return { apartment, resident, sale };
}

export async function requestMoveIn(actor, { apartmentId, moveInDate: value }, ip) {
  if (actor.role !== 'RESIDENT') throw ApiError.forbidden('Chỉ cư dân được gửi thông báo vào ở');
  const result = await withTransaction(async (session) => {
    // Kiểm tra liên kết trước, không tiết lộ hồ sơ căn hộ của người khác.
    if (!await Resident.exists({ apartmentId, userId: actor.id, isActive: true }).session(session)) throw ApiError.forbidden('Bạn không thuộc căn hộ này');
    const { apartment, resident } = await targetResidence(apartmentId, session);
    if (String(resident.userId) !== String(actor.id)) throw ApiError.forbidden('Chỉ chủ hộ hoặc khách thuê hiện tại được thông báo vào ở');
    if (canUseResidentServices(apartment, resident)) throw new ApiError('STATUS_CONFLICT', 'Căn hộ đã được ghi nhận vào ở');
    const date = moveInDate(value, apartment);
    if (resident.moveInRequest?.date?.getTime() === date.getTime()) throw new ApiError('STATUS_CONFLICT', 'Thông báo này đang chờ Ban quản lý ghi nhận');
    resident.moveInStatus = 'PENDING';
    resident.moveInRequest = { date, requestedAt: new Date() };
    await resident.save({ session });
    // Đồng bộ với bàn giao / đổi chủ / kết thúc thuê đang xử lý cùng căn.
    apartment.moveInRevision = (apartment.moveInRevision ?? 0) + 1;
    await apartment.save({ session });
    await logAudit({ action: AUDIT_ACTIONS.RESIDENT_UPDATED, user: actor,
      targetType: AUDIT_TARGETS.RESIDENT, targetId: resident._id,
      metadata: { action: 'REQUEST_MOVE_IN', apartmentId, moveInDate: date }, ip }, { session });
    return { apartmentId, code: apartment.code, moveInRequest: resident.moveInRequest };
  });
  await notifyRoles(['MANAGER'], { type: NOTIFICATION_TYPES.SYSTEM, title: 'Cư dân thông báo bắt đầu ở',
    content: `Căn ${result.code} thông báo bắt đầu ở ngày ${toVnYmd(result.moveInRequest.date)}. Vui lòng kiểm tra và ghi nhận.`,
    refId: apartmentId, link: `/app/apartments/${apartmentId}`,
  }).catch((error) => console.error('[move-in] notify manager:', error.message));
  return result;
}

export async function confirmMoveIn(apartmentId, actor, ip, { moveInDate: value } = {}) {
  if (actor.role !== 'MANAGER') throw ApiError.forbidden('Chỉ Ban quản lý được ghi nhận vào ở');
  const result = await withTransaction(async (session) => {
    const { apartment, resident, sale } = await targetResidence(apartmentId, session);
    if (resident.moveInStatus === 'CONFIRMED' && canUseResidentServices(apartment, resident)) throw new ApiError('STATUS_CONFLICT', 'Cư dân đã được ghi nhận vào ở');
    const date = moveInDate(value ?? (resident.moveInRequest?.date && toVnYmd(resident.moveInRequest.date)), apartment);
    const previous = apartment.occupancyStatus;
    const source = resident.moveInRequest ? 'RESIDENT_REPORT' : 'MANAGER_RECORDED';
    resident.moveInDate = date;
    resident.moveInStatus = 'CONFIRMED';
    resident.moveInConfirmedAt = new Date();
    resident.moveInConfirmedBy = actor.id;
    resident.moveInRequest = undefined;
    apartment.occupancyStatus = resident.relationType === RELATION_TYPES.TENANT ? APARTMENT_OCCUPANCY.RENTED : APARTMENT_OCCUPANCY.OWNER_OCCUPIED;
    await resident.save({ session });
    await apartment.save({ session });
    await logAudit({ action: AUDIT_ACTIONS.APARTMENT_CHANGED, user: actor,
      targetType: AUDIT_TARGETS.APARTMENT, targetId: apartment._id,
      metadata: { action: 'CONFIRM_MOVE_IN', contractId: sale._id, residentId: resident._id, source,
        moveInDate: date, changes: { occupancyStatus: { from: previous, to: apartment.occupancyStatus } } }, ip,
    }, { session });
    return { apartment, userId: resident.userId };
  });
  await notify(result.userId, { type: NOTIFICATION_TYPES.SYSTEM, title: 'Đã ghi nhận vào ở',
    content: `Ban quản lý đã ghi nhận vào ở căn ${result.apartment.code}. Bạn có thể sử dụng các dịch vụ theo quyền được cấp.`,
    refId: apartmentId, link: '/r/my-apartment',
  }).catch((error) => console.error('[move-in] notify resident:', error.message));
  return result.apartment;
}

export async function listMoveInRequests() {
  return Resident.find({ isActive: true, moveInStatus: 'PENDING', 'moveInRequest.date': { $exists: true } })
    .select('apartmentId userId relationType moveInRequest')
    .populate({ path: 'apartmentId', select: 'code floor buildingId', populate: { path: 'buildingId', select: 'name' } })
    .populate('userId', 'fullName phone').sort({ 'moveInRequest.requestedAt': 1 }).lean();
}
