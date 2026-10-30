import { AUDIT_ACTIONS, AUDIT_TARGETS, PARKING_CARD_STATUS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { ParkingCard } from '../../models/index.js';

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

  return paginate(ParkingCard, filter, { page: query.page, limit: query.limit, sort: '-updatedAt' }, {
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
