import { RELATION_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// residents — liên kết user ↔ căn hộ theo relationType
const residentSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', default: null },
    fullName: { type: String, trim: true, maxlength: 100, required() { return !this.userId; } },
    dateOfBirth: { type: Date, default: null },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    relationType: { type: String, enum: values(RELATION_TYPES), required: true },
    idNumber: String, // CCCD
    idNumberEnc: { type: String, default: null }, // CCCD mã hóa AES-256-GCM
    idNumberHash: { type: String, default: null }, // HMAC-SHA256 để tìm kiếm/chống trùng
    contractId: { type: ObjectId, ref: 'Contract', default: null }, // Hợp đồng SALE/LEASE tạo ra liên kết này
    tenantPaysFees: Boolean, // Có giá trị trên lượt thuê do chủ sở hữu khai báo (UC17).
    isActive: { type: Boolean, default: true }, // false khi đã chuyển đi
    moveInDate: Date,
    moveOutDate: Date,
  },
  schemaOptions('residents'),
);

// Chỉ một đợt đang ở cho mỗi tài khoản/căn; nhiều đợt cũ và nhiều người không tài khoản được giữ riêng.
residentSchema.index({ userId: 1, apartmentId: 1 }, {
  name: 'uniq_active_resident', unique: true,
  partialFilterExpression: { isActive: true, userId: { $type: 'objectId' } },
});
residentSchema.index({ apartmentId: 1, isActive: 1 });
residentSchema.index({ contractId: 1 });
residentSchema.index({ idNumberHash: 1 });
residentSchema.index({ apartmentId: 1, relationType: 1 }, {
  name: 'uniq_active_declared_tenant', unique: true,
  partialFilterExpression: { relationType: RELATION_TYPES.TENANT, isActive: true, tenantPaysFees: { $type: 'bool' } },
});
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
