import { APARTMENT_OCCUPANCY, APARTMENT_STATUS, APARTMENT_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// apartments — căn hộ
const apartmentSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    floor: Number,
    area: { type: Number, required: true, min: 1 }, // m² — căn cứ phí vệ sinh (BR-F4)
    blockId: ObjectId,
    type: { type: String, enum: values(APARTMENT_TYPES) },
    grossArea: { type: Number, min: 0 },
    netArea: { type: Number, min: 0 },
    managementAreaHistory: { type: [{
      area: { type: Number, required: true, min: 1 },
      effectiveFrom: { type: Date, required: true },
      reason: String, sourceReference: String,
      changedBy: { type: ObjectId, ref: 'User' }, changedAt: Date, _id: false,
    }], default: [] },
    technicalShaft: String,
    handoverDate: Date,
    // Hồ sơ cũ chưa có ngày bàn giao giữ giá trị undefined để BQL đối chiếu.
    occupancyStatus: { type: String, enum: values(APARTMENT_OCCUPANCY) },
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
