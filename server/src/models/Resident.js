import { RELATION_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// residents — liên kết user ↔ căn hộ theo relationType
const residentSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    relationType: { type: String, enum: values(RELATION_TYPES), required: true },
    idNumber: String, // CCCD
    isActive: { type: Boolean, default: true }, // false khi đã chuyển đi
    moveInDate: Date,
    moveOutDate: Date,
  },
  schemaOptions('residents'),
);

residentSchema.index({ userId: 1, apartmentId: 1 }, { unique: true });
residentSchema.index({ apartmentId: 1, isActive: 1 });
// BR-O1: mỗi căn hộ tối đa 1 chủ sở hữu chính đang hoạt động
residentSchema.index(
  { apartmentId: 1 },
  {
    name: 'uniq_active_owner',
    unique: true,
    partialFilterExpression: { relationType: RELATION_TYPES.OWNER, isActive: true },
  },
);

export const Resident = model('Resident', residentSchema);
