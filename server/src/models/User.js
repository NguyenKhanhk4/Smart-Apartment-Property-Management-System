<<<<<<< HEAD
import { BOARD_TITLES, CONSENT_ACTIONS, ROLES, ROLE_TITLES, values } from '../constants/enums.js';
import { normalizePhone } from '../utils/validators.js';
import { Schema, model, schemaOptions } from './_shared.js';

// users — tài khoản, 1 SĐT = 1 tài khoản (BR-S01, BR-X5). Vai trò theo căn hộ nằm ở residents.
const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: [true, 'Số điện thoại là bắt buộc'], unique: true, set: normalizePhone },
    email: { type: String, lowercase: true, trim: true }, // Không bắt buộc: dùng cho OTP và thông báo (BR-X4)
    passwordHash: { type: String, select: false }, // Trống cho đến khi kích hoạt (BR-S02)
    activatedAt: { type: Date, default: null }, // null = chờ kích hoạt (UC11)
    failedLoginCount: { type: Number, default: 0, select: false }, // BR-S03
    lockedUntil: { type: Date, default: null, select: false }, // BR-S03: khóa tạm sau 5 lần sai
    consents: {
      type: [
        {
          _id: false,
          action: { type: String, enum: values(CONSENT_ACTIONS), required: true },
          policyVersion: { type: String, required: true },
          createdAt: { type: Date, required: true },
        },
      ],
      default: [],
    }, // BR-X7: lịch sử đồng ý điều khoản
=======
import { BOARD_TITLES, ROLES, ROLE_TITLES, values } from '../constants/enums.js';
import { Schema, model, schemaOptions } from './_shared.js';

// users — tài khoản cho cả 6 role (Module A)
const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true },
>>>>>>> origin/minh
    avatarUrl: String,
    role: { type: String, enum: values(ROLES), required: true, default: ROLES.RESIDENT },
    roleTitle: { type: String, enum: [...values(ROLE_TITLES), null], default: null },
    boardTitle: { type: String, enum: [...values(BOARD_TITLES), null], default: null },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: Date,
    dateOfBirth: { type: Date, default: null }, // BR-O24: ngày sinh (lưu 00:00 giờ VN)
    tokenVersion: { type: Number, default: 0, select: false }, // BR-A3: thu hồi refresh token khi khóa/đổi mật khẩu
  },
  schemaOptions('users'),
);

<<<<<<< HEAD
// Đăng nhập còn tìm theo email đến UC01 nên email phải duy nhất; tài khoản không có email thì không bị tính
userSchema.index(
  { email: 1 },
  { name: 'uniq_email', unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
=======
>>>>>>> origin/minh
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
