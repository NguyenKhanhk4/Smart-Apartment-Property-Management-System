import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// amenities — tiện ích (UC-D05)
const amenitySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    buildingId: { type: ObjectId, ref: 'Building', default: null },
    openTime: { type: String, required: true, match: HHMM },
    closeTime: { type: String, required: true, match: HHMM },
    slotDurationMinutes: { type: Number, required: true, min: 15 },
    capacityPerSlot: { type: Number, required: true, min: 1 },
    feePerBooking: { type: Number, required: true, default: 0, min: 0 }, // 0 = miễn phí
    isActive: { type: Boolean, default: true },
  },
  schemaOptions('amenities'),
);

export const Amenity = model('Amenity', amenitySchema);
