import { BOARD_TITLES, ROLES, ROLE_TITLES, values } from '../constants/enums.js';
import { Schema, model, schemaOptions } from './_shared.js';

// users — tài khoản cho cả 6 role (Module A)
const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true },
    avatarUrl: String,
    role: { type: String, enum: values(ROLES), required: true, default: ROLES.RESIDENT },
    roleTitle: { type: String, enum: [...values(ROLE_TITLES), null], default: null },
    boardTitle: { type: String, enum: [...values(BOARD_TITLES), null], default: null },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: Date,
    dateOfBirth: { type: Date, default: null }, // BR-O24: ngày sinh (lưu 00:00 giờ VN)
    tokenVersion: { type: Number, default: 0 }, // BR-A3: thu hồi refresh token khi khóa/đổi mật khẩu
  },
  schemaOptions('users'),
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ role: 1, roleTitle: 1 });

// BR-R1: chỉ 1 MANAGER đang hoạt động; BR-R2: chỉ 1 CHAIRMAN đang hoạt động
userSchema.index(
  { role: 1 },
  {
    name: 'uniq_active_manager',
    unique: true,
    partialFilterExpression: { role: ROLES.MANAGER, isActive: true },
  },
);
userSchema.index(
  { boardTitle: 1 },
  {
    name: 'uniq_active_chairman',
    unique: true,
    partialFilterExpression: { boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true },
  },
);

export const User = model('User', userSchema);
