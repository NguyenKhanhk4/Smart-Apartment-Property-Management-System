import { VERIFICATION_CHANNELS, VERIFICATION_PURPOSES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// verification_codes — OTP email và mã in tại quầy (BR-X4, BR-S05). Chỉ lưu bản băm, hết hạn thì TTL tự xóa.
const verificationCodeSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    codeHash: { type: String, required: true },
    purpose: { type: String, enum: values(VERIFICATION_PURPOSES), required: true },
    channel: { type: String, enum: values(VERIFICATION_CHANNELS), required: true },
    attempts: { type: Number, default: 0 }, // Số lần nhập; đủ giới hạn thì mã không còn dùng được
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    issuedBy: { type: ObjectId, ref: 'User', default: null }, // Lễ tân cấp mã tại quầy (UC02)
  },
  schemaOptions('verification_codes'),
);

verificationCodeSchema.index({ userId: 1, purpose: 1 });
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationCode = model('VerificationCode', verificationCodeSchema);
