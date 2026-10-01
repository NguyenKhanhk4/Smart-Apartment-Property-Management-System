import { APARTMENT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// apartments — căn hộ
const apartmentSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    floor: Number,
    area: { type: Number, required: true, min: 1 }, // m² — căn cứ phí vệ sinh (BR-F4)
    status: {
      type: String,
      enum: values(APARTMENT_STATUS),
      required: true,
      default: APARTMENT_STATUS.VACANT,
    },
  },
  schemaOptions('apartments'),
);

apartmentSchema.index({ buildingId: 1, code: 1 }, { unique: true });
apartmentSchema.index({ status: 1 });

export const Apartment = model('Apartment', apartmentSchema);
