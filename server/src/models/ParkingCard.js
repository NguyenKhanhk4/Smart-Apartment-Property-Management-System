import { PARKING_CARD_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// parking_cards — thẻ gửi xe vật lý (UC66)
const parkingCardSchema = new Schema(
  {
    cardNumber: { type: String, required: true, trim: true, uppercase: true },
    vehicleId: { type: ObjectId, ref: 'Vehicle', required: true },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    status: {
      type: String,
      enum: values(PARKING_CARD_STATUS),
      required: true,
      default: PARKING_CARD_STATUS.ACTIVE,
    },
    issuedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    closedBy: { type: ObjectId, ref: 'User', default: null },
    note: { type: String, default: null },
  },
  schemaOptions('parking_cards'),
);

// cardNumber duy nhất trong các thẻ chưa RETURNED
parkingCardSchema.index(
  { cardNumber: 1 },
  {
    name: 'uniq_unreturned_parking_card',
    unique: true,
    partialFilterExpression: {
      status: { $in: ['ACTIVE', 'DISABLED_TO_COLLECT', 'LOST'] },
    },
  },
);

parkingCardSchema.index({ vehicleId: 1, status: 1 });
parkingCardSchema.index({ apartmentId: 1, status: 1 });

export const ParkingCard = model('ParkingCard', parkingCardSchema);
