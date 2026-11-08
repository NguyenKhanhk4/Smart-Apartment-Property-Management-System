import { VEHICLE_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

export const PARKING_KINDS = Object.freeze({ RESIDENT: 'RESIDENT', GUEST: 'GUEST' });
export const PARKING_VEHICLE_TYPES = Object.freeze({ ...VEHICLE_TYPES, ELECTRIC_BICYCLE: 'ELECTRIC_BICYCLE' });

const parkingSessionSchema = new Schema({
  kind: { type: String, enum: values(PARKING_KINDS), required: true },
  vehicleType: { type: String, enum: values(PARKING_VEHICLE_TYPES), required: true },
  vehicleId: { type: ObjectId, ref: 'Vehicle', default: null },
  parkingCardId: { type: ObjectId, ref: 'ParkingCard', default: null },
  apartmentId: { type: ObjectId, ref: 'Apartment', default: null },
  cardNumber: { type: String, required: true },
  plateNumber: { type: String, default: null },
  enteredAt: { type: Date, required: true },
  enteredBy: { type: ObjectId, ref: 'User', required: true },
  exitedAt: { type: Date, default: null },
  exitedBy: { type: ObjectId, ref: 'User', default: null },
  feeAmount: { type: Number, min: 0, default: null },
}, schemaOptions('parking_sessions'));

parkingSessionSchema.index({ cardNumber: 1 }, {
  unique: true,
  partialFilterExpression: { kind: PARKING_KINDS.GUEST, exitedAt: null },
  name: 'uniq_open_guest_card',
});
parkingSessionSchema.index({ vehicleId: 1 }, {
  unique: true,
  partialFilterExpression: { kind: PARKING_KINDS.RESIDENT, exitedAt: null },
  name: 'uniq_open_resident_vehicle',
});
parkingSessionSchema.index({ plateNumber: 1 }, {
  unique: true,
  partialFilterExpression: { plateNumber: { $type: 'string' }, exitedAt: null },
  name: 'uniq_open_parking_plate',
});
parkingSessionSchema.index({ updatedAt: -1 });
parkingSessionSchema.index({ enteredAt: -1 });
parkingSessionSchema.index({ exitedAt: -1 });

export const ParkingSession = model('ParkingSession', parkingSessionSchema);
