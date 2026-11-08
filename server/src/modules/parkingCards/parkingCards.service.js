import { AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, PARKING_CARD_STATUS, VEHICLE_STATUS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { ParkingCard, Resident, Vehicle } from '../../models/index.js';

/**
 * Chuyển các thẻ ACTIVE khớp `filter` sang DISABLED_TO_COLLECT và ghi audit PARKING_CARD_DISABLED từng thẻ.
 * `actor` = người thao tác (null = hệ thống, vd cron hết hạn hợp đồng). Trả về số thẻ đã chuyển.
 */
async function disableActiveCards(filter, session, actor, reason) {
  const cards = await ParkingCard.find({ ...filter, status: PARKING_CARD_STATUS.ACTIVE })
    .select('cardNumber vehicleId apartmentId')
    .session(session)
    .lean();
  if (!cards.length) return 0;

  const res = await ParkingCard.updateMany(
    { _id: { $in: cards.map((c) => c._id) }, status: PARKING_CARD_STATUS.ACTIVE },
    { $set: { status: PARKING_CARD_STATUS.DISABLED_TO_COLLECT } },
    { session },
  );
  for (const card of cards) {
    await logAudit(
      {
        action: AUDIT_ACTIONS.PARKING_CARD_DISABLED,
        user: actor,
        targetType: AUDIT_TARGETS.PARKING_CARD,
        targetId: card._id,
        metadata: { cardNumber: card.cardNumber, vehicleId: card.vehicleId, apartmentId: card.apartmentId, reason },
      },
      { session },
    );
  }
  return res.modifiedCount || 0;
}

/** Thẻ ACTIVE của 1 phương tiện → cần thu hồi (hủy xe) */
export const disableActiveCardsByVehicle = (vehicleId, session = null, actor = null) =>
  disableActiveCards({ vehicleId }, session, actor, 'VEHICLE_CANCELLED');

/** Thẻ ACTIVE của căn hộ (hoặc danh sách phương tiện) → cần thu hồi (chấm dứt / hết hạn hợp đồng) */
export function disableActiveCardsByApartment(apartmentId, vehicleIds = null, session = null, actor = null) {
  const filter = { apartmentId };
  if (Array.isArray(vehicleIds)) filter.vehicleId = { $in: vehicleIds };
  return disableActiveCards(filter, session, actor, 'CONTRACT_ENDED');
}

/**
 * Danh sách thẻ gửi xe (Lễ tân / Trưởng BQL) — UC66
 */
export async function issueResidentCard({ residentId, cardNumber, replacesId }, manager, ip) {
  let result;
  try {
    result = await withTransaction(async (session) => {
      const resident = await Resident.findOne({
        _id: residentId, isActive: true, userId: { $type: 'objectId' },
      }).session(session).lean();
      if (!resident) throw ApiError.notFound('Không tìm thấy tài khoản cư dân đang có quyền tại căn hộ');

      const currentId = resident.parkingCardId ?? null;
      if (String(currentId) !== String(replacesId ?? null)) {
        throw new ApiError('STATUS_CONFLICT', 'Thẻ hiện tại đã thay đổi. Vui lòng tải lại danh sách');
      }

      const [card] = await ParkingCard.create([{
        cardNumber, residentId, apartmentId: resident.apartmentId, status: PARKING_CARD_STATUS.ACTIVE,
      }], { session });

      const update = await Resident.updateOne(
        { _id: residentId, isActive: true, parkingCardId: currentId },
        { $set: { parkingCardId: card._id } },
        { session },
      );
      if (!update.modifiedCount) {
        if (!session) await ParkingCard.deleteOne({ _id: card._id });
        throw new ApiError('STATUS_CONFLICT', 'Quyền cư trú hoặc thẻ hiện tại đã thay đổi');
      }

      if (currentId) await disableActiveCards({ _id: currentId }, session, manager, 'CARD_REPLACED');
      await logAudit({
        action: AUDIT_ACTIONS.PARKING_CARD_ISSUED,
        targetType: AUDIT_TARGETS.PARKING_CARD,
        targetId: card._id,
        user: manager,
        ip,
        metadata: { cardNumber: card.cardNumber, residentId, apartmentId: card.apartmentId, replacesId },
      }, { session });
      return { card, userId: resident.userId };
    });
  } catch (error) {
    if (error.code === 11000) throw ApiError.field('cardNumber', 'Mã thẻ đã được sử dụng hoặc chưa được thu hồi');
    throw error;
  }

  await notify(result.userId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: replacesId ? 'Thẻ cư dân đã được cấp lại' : 'Thẻ cư dân đã được cấp',
    content: 'Bạn có thể đến quầy lễ tân để nhận thẻ cư dân.',
    refId: result.card._id,
  }).catch((error) => console.error('[parking-cards] notify:', error.message));
  return result.card;
}

export async function handOverResidentCard(id, receptionist, ip) {
  return withTransaction(async (session) => {
    const card = await ParkingCard.findOne({
      _id: id, residentId: { $type: 'objectId' }, status: PARKING_CARD_STATUS.ACTIVE,
    }).session(session);
    if (!card) throw ApiError.notFound('Không tìm thấy thẻ cư dân chờ bàn giao');

    const resident = await Resident.findOne({
      _id: card.residentId, parkingCardId: id, isActive: true,
    }).session(session).lean();
    if (!resident) throw new ApiError('STATUS_CONFLICT', 'Thẻ không còn hiệu lực cấp cho cư dân');
    const updated = card.handedOverAt ? card : await ParkingCard.findOneAndUpdate(
      { _id: id, handedOverAt: null, status: PARKING_CARD_STATUS.ACTIVE },
      { $set: { handedOverAt: new Date(), handedOverBy: receptionist.id } },
      { session, returnDocument: 'after' },
    );
    if (!updated) throw new ApiError('STATUS_CONFLICT', 'Thẻ đã thay đổi. Vui lòng tải lại');

    const vehicleIds = await Vehicle.find({
      apartmentId: card.apartmentId, registeredBy: resident.userId,
    }).select('_id').session(session).lean();
    await disableActiveCards(
      { vehicleId: { $in: vehicleIds.map((vehicle) => vehicle._id) } },
      session, receptionist, 'RESIDENT_CARD_HANDED_OVER',
    );
    if (!card.handedOverAt) {
      await logAudit({
        action: AUDIT_ACTIONS.PARKING_CARD_HANDED_OVER,
        targetType: AUDIT_TARGETS.PARKING_CARD,
        targetId: updated._id,
        user: receptionist,
        ip,
        metadata: { cardNumber: card.cardNumber, residentId: card.residentId, apartmentId: card.apartmentId },
      }, { session });
    }
    return updated;
  });
}

export async function listParkingCards(query = {}) {
  const filter = {};

  if (query.status === 'PENDING_HANDOVER') {
    filter.status = PARKING_CARD_STATUS.ACTIVE;
    filter.residentId = { $type: 'objectId' };
    filter.handedOverAt = null;
  } else if (query.status) {
    filter.status = query.status;
    if (query.status === PARKING_CARD_STATUS.ACTIVE) {
      filter.$or = [{ residentId: null }, { handedOverAt: { $ne: null } }];
    }
  }
  if (query.apartmentId) {
    filter.apartmentId = query.apartmentId;
  }
  if (query.vehicleId) {
    filter.vehicleId = query.vehicleId;
  }
  if (query.q && query.q.trim()) {
    const reg = new RegExp(escapeRegex(query.q.trim()), 'i');
    filter.cardNumber = reg;
  }

  const result = await paginate(ParkingCard, filter, { page: query.page, limit: query.limit, sort: '-updatedAt' }, {
    populate: [
      {
        path: 'vehicleId',
        select: 'type plateNumber brand color status registeredBy',
        populate: { path: 'registeredBy', select: 'fullName phone email' },
      },
      {
        path: 'apartmentId',
        select: 'code floor buildingId',
        populate: { path: 'buildingId', select: 'code name' },
      },
      {
        path: 'residentId',
        select: 'userId isActive parkingCardId',
        populate: { path: 'userId', select: 'fullName phone' },
      },
      { path: 'closedBy', select: 'fullName email' },
    ],
  });

  const cardScopes = result.items.flatMap((card) =>
    card.residentId?.userId && card.apartmentId
      ? [{ apartmentId: card.apartmentId._id, registeredBy: card.residentId.userId._id }]
      : [],
  );
  if (!cardScopes.length) return result;

  const approved = await Vehicle.find({ status: VEHICLE_STATUS.APPROVED, $or: cardScopes })
    .select('apartmentId registeredBy').lean();
  const counts = new Map();
  const scopeKey = (apartment, user) => String(apartment) + '/' + String(user);
  for (const vehicle of approved) {
    const key = scopeKey(vehicle.apartmentId, vehicle.registeredBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const card of result.items) {
    const resident = card.residentId;
    if (!resident) continue;
    card.elevatorAllowed = Boolean(resident.isActive && card.handedOverAt
      && String(resident.parkingCardId) === String(card._id)
      && card.status === PARKING_CARD_STATUS.ACTIVE);
    const key = scopeKey(card.apartmentId?._id, resident.userId?._id);
    card.parkingVehicleCount = card.elevatorAllowed ? (counts.get(key) ?? 0) : 0;
  }
  return result;
}

/**
 * Lễ tân đánh dấu Đã thu hồi (RETURNED) hoặc Mất thẻ (LOST) — UC66
 */
export async function closeParkingCard(cardId, { status, note }, receptionistUser, ip) {
  if (![PARKING_CARD_STATUS.RETURNED, PARKING_CARD_STATUS.LOST].includes(status)) {
    throw ApiError.badRequest('Trạng thái đóng thẻ chỉ nhận RETURNED hoặc LOST');
  }

  const staffId = receptionistUser?.id ?? null;
  let updated = null;

  await withTransaction(async (session) => {
    const card = await ParkingCard.findById(cardId).session(session);
    if (!card) {
      throw ApiError.notFound('Không tìm thấy thẻ gửi xe');
    }

    if (card.status !== PARKING_CARD_STATUS.DISABLED_TO_COLLECT) {
      throw new ApiError(
        'STATUS_CONFLICT',
        'Chỉ thẻ ở trạng thái Cần thu hồi mới có thể xác nhận Đã thu hồi hoặc Mất thẻ',
      );
    }

    card.status = status;
    card.closedAt = new Date();
    card.closedBy = staffId;
    if (note !== undefined) {
      card.note = note?.trim() || null;
    }

    await card.save({ session });
    updated = card.toObject();

    await logAudit(
      {
        action:
          status === PARKING_CARD_STATUS.RETURNED
            ? AUDIT_ACTIONS.PARKING_CARD_RETURNED
            : AUDIT_ACTIONS.PARKING_CARD_LOST,
        user: receptionistUser,
        targetType: AUDIT_TARGETS.PARKING_CARD,
        targetId: card._id,
        metadata: {
          cardNumber: card.cardNumber,
          vehicleId: card.vehicleId,
          apartmentId: card.apartmentId,
          status,
          note: card.note,
        },
        ip,
      },
      { session },
    );
  });

  return updated;
}
