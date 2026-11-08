import { APARTMENT_OCCUPANCY, APARTMENT_STATUS, AUDIT_ACTIONS, AUDIT_TARGETS, RELATION_TYPES } from '../../constants/enums.js';
import { AuditLog } from '../../models/AuditLog.js';

const { FAMILY_MEMBER } = RELATION_TYPES;
export const occupancyResidentSort = { moveInDate: 1, createdAt: 1, _id: 1 };

export function effectiveOccupancy(apartment) {
  if (apartment.status === APARTMENT_STATUS.RENTED) return APARTMENT_OCCUPANCY.RENTED;
  return apartment.occupancyStatus ?? (
    apartment.status === APARTMENT_STATUS.OWNED ? APARTMENT_OCCUPANCY.OWNER_OCCUPIED : APARTMENT_OCCUPANCY.VACANT
  );
}

export function occupyingHeadRelation(occupancy) {
  if (occupancy === APARTMENT_OCCUPANCY.RENTED) return RELATION_TYPES.TENANT;
  if ([APARTMENT_OCCUPANCY.OWNER_OCCUPIED, APARTMENT_OCCUPANCY.UNDER_REPAIR].includes(occupancy)) {
    return RELATION_TYPES.OWNER;
  }
  return null;
}

export async function findLegacyDeclarations(residents, session = null) {
  const ids = residents
    .filter((resident) => resident.relationType === FAMILY_MEMBER && !resident.declaredByResidenceId)
    .map((resident) => resident._id);
  if (!ids.length) return new Map();

  const logs = await AuditLog.find({
    action: AUDIT_ACTIONS.RESIDENT_ASSIGNED,
    targetType: AUDIT_TARGETS.RESIDENT,
    targetId: { $in: ids },
  }).select('targetId performedBy createdAt').sort({ createdAt: 1, _id: 1 }).session(session).lean();
  return new Map(logs.map((entry) => [String(entry.targetId), entry]));
}

export function isDeclaredBy(member, head, legacyDeclarations) {
  if (member.declaredByResidenceId) return String(member.declaredByResidenceId) === String(head._id);

  // Các khai báo tự phục vụ trước khi có liên kết lượt ở được nhận diện qua người ghi nhật ký.
  const declaration = legacyDeclarations.get(String(member._id));
  const residenceStart = head.createdAt ?? head.moveInDate;
  return Boolean(declaration?.performedBy && residenceStart
    && String(declaration.performedBy) === String(head.userId?._id ?? head.userId)
    && declaration.createdAt >= residenceStart);
}

/** Trả chủ hộ đang ở trước, sau đó là người do chủ hộ đó khai báo. */
export function currentOccupants(occupancy, residents, legacyDeclarations) {
  const headRelation = occupyingHeadRelation(occupancy);
  const head = residents.find((resident) => resident.relationType === headRelation && resident.userId);
  if (!head) return [];

  return [head, ...residents.filter((resident) =>
    resident.relationType === FAMILY_MEMBER && isDeclaredBy(resident, head, legacyDeclarations))];
}
