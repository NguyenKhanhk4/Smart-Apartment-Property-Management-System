import { APARTMENT_OCCUPANCY, APARTMENT_STATUS, RELATION_TYPES } from '../../constants/enums.js';

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
