import { AMENITY_ACCESS_MODES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mongoose gọi `required` với this = document → dùng function thường
function notFree() {
  return this.accessMode !== AMENITY_ACCESS_MODES.FREE;
}
function isBooking() {
  return (this.accessMode ?? AMENITY_ACCESS_MODES.BOOKING) === AMENITY_ACCESS_MODES.BOOKING;
}
function isWalkIn() {
  return this.accessMode === AMENITY_ACCESS_MODES.WALK_IN;
}

// amenities — tiện ích (UC-D05). Trường theo kiểu (accessMode):
//   FREE    : chỉ hiển thị (giờ mở cửa tùy chọn), mọi trường phí/slot lưu 0/null
//   WALK_IN : openTime/closeTime, perVisitFeeAdult/Child, [monthlyPassFee*], [maxConcurrent]
//   BOOKING : openTime/closeTime, slotDurationMinutes, capacityPerSlot, feePerBooking, [monthlyPassFee*]
// Tiền là số nguyên VND. Bản ghi cũ không có accessMode đọc ra là BOOKING (default) — Module E vẫn đọc được.
const amenitySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    buildingId: { type: ObjectId, ref: 'Building', default: null }, // null = dùng chung toàn khu
    location: { type: String, trim: true },
    imageUrl: { type: String, default: null },
    accessMode: { type: String, enum: values(AMENITY_ACCESS_MODES), required: true, default: AMENITY_ACCESS_MODES.BOOKING },
    openTime: { type: String, required: notFree, default: null, match: HHMM },
    closeTime: { type: String, required: notFree, default: null, match: HHMM },
    // BOOKING
    slotDurationMinutes: { type: Number, required: isBooking, default: null, min: 15 },
    capacityPerSlot: { type: Number, required: isBooking, default: null, min: 1 },
    feePerBooking: { type: Number, required: true, default: 0, min: 0 }, // 0 = miễn phí
    // WALK_IN: phí 1 lượt vào theo nhóm tuổi (BR-O24); số người tối đa cùng lúc (null = không giới hạn)
    perVisitFeeAdult: { type: Number, required: isWalkIn, default: 0, min: 0 },
    perVisitFeeChild: { type: Number, required: isWalkIn, default: 0, min: 0 },
    maxConcurrent: { type: Number, default: null, min: 1 },
    // Gói tháng (WALK_IN / BOOKING, BR-O22): null = không bán gói
    monthlyPassFeeAdult: { type: Number, default: null, min: 0 },
    monthlyPassFeeChild: { type: Number, default: null, min: 0 },
    isActive: { type: Boolean, default: true },
    // Tăng mỗi khi có booking mới để serialize việc giữ chỗ cùng slot (Bước 7 — UC-D06)
    lockVersion: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('amenities'),
);

amenitySchema.index({ isActive: 1, buildingId: 1 }); // danh sách tiện ích cư dân được dùng

export const Amenity = model('Amenity', amenitySchema);
