import { Apartment } from '../../models/Apartment.js';

// Các luồng cư trú gọi sau khi xác nhận thay đổi, trong cùng transaction.
export function recordOccupancy(apartmentId, occupancyStatus, session) {
  return Apartment.updateOne(
    { _id: apartmentId, handoverDate: { $type: 'date' } },
    { $set: { occupancyStatus } },
    { session },
  );
}
