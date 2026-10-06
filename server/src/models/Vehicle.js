import { VEHICLE_STATUS, VEHICLE_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// vehicles — phương tiện đăng ký gửi xe
const vehicleSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    ownerUserId: { type: ObjectId, ref: 'User' }, // người đăng ký
    type: { type: String, enum: values(VEHICLE_TYPES), required: true },
    plateNumber: { type: String, trim: true, uppercase: true }, // xe đạp có thể trống
    brand: String,
    color: String,
    status: {
      type: String,
      enum: values(VEHICLE_STATUS),
      required: true,
      default: VEHICLE_STATUS.PENDING,
    },
    cancelRequested: { type: Boolean, default: false },
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewNote: String,
    approvedAt: { type: Date, default: null }, // BR-F5
    cancelledAt: { type: Date, default: null },
  },
  schemaOptions('vehicles'),
);

vehicleSchema.index({ plateNumber: 1 }, { unique: true, sparse: true });
vehicleSchema.index({ apartmentId: 1, status: 1 });

export const Vehicle = model('Vehicle', vehicleSchema);
