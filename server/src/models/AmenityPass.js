import { AGE_GROUPS, AMENITY_PASS_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// amenity_passes — gói tháng tiện ích (Module D, UC-D09, BR-O22): theo NGƯỜI, theo THÁNG DƯƠNG LỊCH ('YYYY-MM').
// Hiệu lực ngay khi mua (mua giữa tháng tính trọn tháng), không tự gia hạn. Phí là snapshot lúc mua (BR-O23);
// phí tháng M được cộng vào hóa đơn đầu tháng M+1 (Module B, qua hàm billing của Module D) rồi gắn invoiceId để không tính trùng.
const amenityPassSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true }, // người dùng gói
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true }, // căn chịu phí
    amenityId: { type: ObjectId, ref: 'Amenity', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    ageGroup: { type: String, enum: values(AGE_GROUPS), required: true }, // tính tại ngày 1 của tháng gói (BR-O24)
    fee: { type: Number, required: true, min: 0 }, // VND, snapshot
    purchasedBy: { type: ObjectId, ref: 'User', required: true },
    status: { type: String, enum: values(AMENITY_PASS_STATUS), required: true, default: AMENITY_PASS_STATUS.ACTIVE },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // chống tính phí 2 lần
  },
  schemaOptions('amenity_passes'),
);

// Mỗi người chỉ có 1 gói hiệu lực cho mỗi tiện ích trong mỗi tháng (chặn mua trùng kể cả gửi đồng thời)
amenityPassSchema.index(
  { userId: 1, amenityId: 1, month: 1 },
  {
    name: 'uniq_active_pass',
    unique: true,
    partialFilterExpression: { status: AMENITY_PASS_STATUS.ACTIVE },
  },
);
amenityPassSchema.index({ apartmentId: 1, month: 1, status: 1 }); // gói của hộ
amenityPassSchema.index({ month: 1, status: 1, invoiceId: 1 }); // billing đầu tháng sau
amenityPassSchema.index({ amenityId: 1, month: 1 });

export const AmenityPass = model('AmenityPass', amenityPassSchema);
