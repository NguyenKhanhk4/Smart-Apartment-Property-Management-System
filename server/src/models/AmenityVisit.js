import { AGE_GROUPS, VISIT_CHARGE_TYPES, VISIT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// amenity_visits — lượt vào tiện ích WALK_IN (Module D, UC-D10, BR-O23): lễ tân tra mã rồi ghi 1 lượt, KHÔNG thu tiền tại chỗ.
// Phí là snapshot lúc ghi (BR-O23); phí vé lẻ tháng M được Module B cộng vào hóa đơn đầu tháng M+1 rồi gắn invoiceId để không tính trùng.
const amenityVisitSchema = new Schema(
  {
    amenityId: { type: ObjectId, ref: 'Amenity', required: true },
    userId: { type: ObjectId, ref: 'User', required: true }, // người vào
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    visitedAt: { type: Date, required: true },
    ageGroup: { type: String, enum: values(AGE_GROUPS), required: true }, // tính tại visitedAt (BR-O24)
    chargeType: { type: String, enum: values(VISIT_CHARGE_TYPES), required: true },
    passId: { type: ObjectId, ref: 'AmenityPass', default: null }, // chargeType PASS
    fee: { type: Number, required: true, min: 0 }, // VND, snapshot; PASS và FREE = 0
    accompaniedBy: { type: ObjectId, ref: 'User', default: null }, // người lớn đi kèm (trẻ em 6–11 tuổi bắt buộc có)
    accompaniedChildren: { type: Number, default: 0, min: 0 }, // số trẻ dưới CHILD_FREE_AGE vào cùng, tính vào sức chứa nhưng không tính phí
    chargedTo: { type: ObjectId, ref: 'User', default: null }, // người chịu phí khi fee > 0: chính người vào hoặc người lớn cùng căn
    recordedBy: { type: ObjectId, ref: 'User', required: true }, // lễ tân ghi
    billingMonth: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // 'YYYY-MM' theo visitedAt giờ VN
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // chống tính phí 2 lần
    status: { type: String, enum: values(VISIT_STATUS), required: true, default: VISIT_STATUS.VALID },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
  },
  schemaOptions('amenity_visits'),
);

amenityVisitSchema.index({ amenityId: 1, visitedAt: 1 }); // đếm số người đang trong tiện ích, lịch trong ngày
amenityVisitSchema.index({ apartmentId: 1, billingMonth: 1, status: 1 }); // billing đầu tháng sau
amenityVisitSchema.index({ userId: 1, visitedAt: -1 }); // lượt hôm nay của một người, chống ghi trùng

export const AmenityVisit = model('AmenityVisit', amenityVisitSchema);
