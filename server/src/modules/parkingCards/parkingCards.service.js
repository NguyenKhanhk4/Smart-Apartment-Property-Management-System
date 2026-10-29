import {
  AUDIT_ACTIONS,
  PARKING_CARD_STATUS,
} from '../../constants/enums.js';
import { ParkingCard } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';

/**
 * Chuyển các thẻ ACTIVE của phương tiện sang DISABLED_TO_COLLECT
 */
export async function disableActiveCardsByVehicle(vehicleId, session = null) {
  const options = session ? { session } : {};
  const res = await ParkingCard.updateMany(
    { vehicleId, status: PARKING_CARD_STATUS.ACTIVE },
    { $set: { status: PARKING_CARD_STATUS.DISABLED_TO_COLLECT } },
    options,
  );
  return res.modifiedCount || 0;
}

/**
 * Chuyển các thẻ ACTIVE của căn hộ (hoặc danh sách phương tiện) sang DISABLED_TO_COLLECT
 */
export async function disableActiveCardsByApartment(apartmentId, vehicleIds = null, session = null) {
  const filter = {
    apartmentId,
    status: PARKING_CARD_STATUS.ACTIVE,
  };
  if (Array.isArray(vehicleIds)) {
    filter.vehicleId = { $in: vehicleIds };
  }
  const options = session ? { session } : {};
  const res = await ParkingCard.updateMany(
    filter,
    { $set: { status: PARKING_CARD_STATUS.DISABLED_TO_COLLECT } },
    options,
  );
  return res.modifiedCount || 0;
}

/**
 * Danh sách thẻ gửi xe (Lễ tân / Trưởng BQL) — UC66
 */
export async function listParkingCards(query = {}) {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
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

  return paginate(ParkingCard, filter, {
    page: query.page,
    limit: query.limit,
    sort: { updatedAt: -1, createdAt: -1 },
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
      { path: 'closedBy', select: 'fullName email' },
    ],
  });
}

/**
 * Lễ tân đánh dấu Đã thu hồi (RETURNED) hoặc Mất thẻ (LOST) — UC66
 */
export async function closeParkingCard(cardId, { status, note }, receptionistUser, ip) {
  if (![PARKING_CARD_STATUS.RETURNED, PARKING_CARD_STATUS.LOST].includes(status)) {
    throw ApiError.badRequest('Trạng thái đóng thẻ chỉ nhận RETURNED hoặc LOST');
  }

  const staffId = receptionistUser?.id || receptionistUser?._id || null;
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
        targetType: 'ParkingCard',
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
