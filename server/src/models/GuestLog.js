import { GUEST_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// guest_logs — sổ khách ra vào (UC-E07, E08)
const guestLogSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building' },
    guestName: { type: String, required: true, trim: true },
    guestPhone: String,
    idNumber: String,
    numberOfGuests: { type: Number, default: 1, min: 1 },
    purpose: String,
    expectedTime: Date,
    status: {
      type: String,
      enum: values(GUEST_STATUS),
      required: true,
      default: GUEST_STATUS.EXPECTED,
    },
    isWalkIn: { type: Boolean, default: false }, // khách vãng lai (BR-O10)
    registeredBy: { type: ObjectId, ref: 'User', default: null }, // cư dân đăng ký trước
    checkInTime: { type: Date, default: null },
    checkOutTime: { type: Date, default: null },
    recordedBy: { type: ObjectId, ref: 'User', default: null }, // Bảo vệ
    note: String,
  },
  // 2 bảo vệ check-in/check-out cùng bản ghi đồng thời → request sau 409 CONCURRENT_UPDATE
  schemaOptions('guest_logs', { optimisticConcurrency: true }),
);

guestLogSchema.index({ expectedTime: 1, status: 1 });
guestLogSchema.index({ apartmentId: 1, createdAt: -1 });
guestLogSchema.index({ checkInTime: -1 });

export const GuestLog = model('GuestLog', guestLogSchema);
