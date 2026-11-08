import {
  AUDIT_ACTIONS, AUDIT_TARGETS, PARKING_CARD_STATUS, VEHICLE_STATUS,
} from '../../constants/enums.js';
import { ParkingCard, Resident, Vehicle } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';

/** Gọi sau khi kết thúc vai trò, trong cùng transaction; chỉ thu hồi dịch vụ của người thực sự rời căn. */
export async function revokeDepartedResidentServices({ apartmentId, userIds, endedAt, session = null, actor = null, ip }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return { vehicles: 0, cards: 0 };
  const stillActive = await Resident.find({ apartmentId, userId: { $in: ids }, isActive: true })
    .select('userId').session(session).lean();
  const retained = new Set(stillActive.map((r) => String(r.userId)));
  const departing = ids.filter((id) => !retained.has(id));
  if (!departing.length) return { vehicles: 0, cards: 0 };

  const vehicles = await Vehicle.find({ apartmentId, registeredBy: { $in: departing } })
    .select('_id status').session(session).lean();
  const vehicleIds = vehicles.map((v) => v._id);
  const liveVehicles = vehicles.filter((v) => [VEHICLE_STATUS.PENDING, VEHICLE_STATUS.APPROVED,
    VEHICLE_STATUS.CANCEL_REQUESTED].includes(v.status));
  await Vehicle.updateMany({ _id: { $in: liveVehicles.map((v) => v._id) } },
    { $set: { status: VEHICLE_STATUS.CANCELLED, cancelledAt: endedAt } }, { session });
  const previousMemberships = await Resident.find({ apartmentId, userId: { $in: departing }, isActive: false })
    .select('_id').session(session).lean();
  const cards = await ParkingCard.find({
    apartmentId,
    status: PARKING_CARD_STATUS.ACTIVE,
    $or: [
      { vehicleId: { $in: vehicleIds } },
      { residentId: { $in: previousMemberships.map((resident) => resident._id) } },
    ],
  }).select('_id cardNumber vehicleId residentId').session(session).lean();
  await ParkingCard.updateMany({ _id: { $in: cards.map((c) => c._id) }, status: PARKING_CARD_STATUS.ACTIVE },
    { $set: { status: PARKING_CARD_STATUS.DISABLED_TO_COLLECT } }, { session });
  const audit = (action, targetType, row, metadata) => logAudit({ action, user: actor, targetType,
    targetId: row._id, metadata: { apartmentId, reason: 'RESIDENCY_ENDED', endedAt, ...metadata }, ip }, { session });
  for (const v of liveVehicles) await audit(AUDIT_ACTIONS.VEHICLE_CANCELLED, AUDIT_TARGETS.VEHICLE, v, {});
  for (const c of cards) await audit(AUDIT_ACTIONS.PARKING_CARD_DISABLED, AUDIT_TARGETS.PARKING_CARD, c,
    { cardNumber: c.cardNumber, vehicleId: c.vehicleId, residentId: c.residentId });
  return { vehicles: liveVehicles.length, cards: cards.length };
}
