import { VEHICLE_STATUS, VEHICLE_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// vehicles — phương tiện đăng ký gửi xe
const vehicleSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    registeredBy: { type: ObjectId, ref: 'User' }, // người đăng ký
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
    cancelRequestedAt: { type: Date, default: null }, // BR-A7: thời điểm cư dân yêu cầu hủy
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewNote: String,
    rejectReason: String, // BR-A7: lý do từ chối (bắt buộc khi REJECTED)
    approvedAt: { type: Date, default: null }, // BR-F5
    cancelledAt: { type: Date, default: null },
  },
  schemaOptions('vehicles'),
);

// BR-A6: biển số duy nhất trong các xe PENDING/APPROVED
vehicleSchema.index(
  { plateNumber: 1 },
  {
    name: 'uniq_active_plate',
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] }, plateNumber: { $type: 'string' } },
  },
);
vehicleSchema.index({ apartmentId: 1, status: 1 });
vehicleSchema.index({ status: 1, type: 1 });

export const Vehicle = model('Vehicle', vehicleSchema);
