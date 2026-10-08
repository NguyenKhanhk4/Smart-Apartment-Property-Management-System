import { BOOKING_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// bookings — lượt đặt tiện ích (UC-D06, D07)
const bookingSchema = new Schema(
  {
    amenityId: { type: ObjectId, ref: 'Amenity', required: true },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    requestedBy: { type: ObjectId, ref: 'User' },
    date: { type: Date, required: true }, // 00:00 ngày đặt (giờ VN)
    slotStart: { type: String, required: true }, // HH:mm
    slotEnd: { type: String, required: true },
    // Mốc thật của slot (= date + slotStart/slotEnd giờ VN) — dùng cho sức chứa, check-in, no-show, hoàn tất
    startAt: Date,
    endAt: Date,
    fee: { type: Number, required: true, min: 0 }, // snapshot từ amenity lúc đặt
    status: {
      type: String,
      enum: values(BOOKING_STATUS),
      required: true,
      default: BOOKING_STATUS.APPROVED, // BR-O12: tự xác nhận khi đặt
    },
    reviewedBy: { type: ObjectId, ref: 'User' }, // luồng duyệt cũ
    reviewNote: String,
    checkedInAt: Date,
    checkedInBy: { type: ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelledBy: { type: ObjectId, ref: 'User' },
    cancelReason: String,
    noShowAt: Date,
    completedAt: Date,
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // chống tính phí 2 lần
  },
  schemaOptions('bookings'),
);

bookingSchema.index({ amenityId: 1, date: 1, slotStart: 1, status: 1 }); // sức chứa slot (BR-O3)
bookingSchema.index({ apartmentId: 1, status: 1 });
bookingSchema.index({ status: 1, date: 1 }); // thống kê UC-E14
bookingSchema.index({ amenityId: 1, startAt: 1, status: 1 }); // sức chứa slot + booking sắp tới của tiện ích
bookingSchema.index({ status: 1, startAt: 1 }); // cron NO_SHOW
bookingSchema.index({ status: 1, endAt: 1 }); // cron COMPLETED

export const Booking = model('Booking', bookingSchema);
