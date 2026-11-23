import { Router } from 'express';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { validate } from '../../middlewares/validate.js';
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { apartmentsOf } from '../auth/auth.service.js';
import { ok } from '../../utils/response.js';

// CHỈ DÙNG KHI DEV (NODE_ENV=development) — đăng nhập nhanh bằng tài khoản seed, không cần mật khẩu,
// để cả nhóm xem/test giao diện trong lúc Module A (đăng nhập thật) chưa xong.
// routes.js chỉ gắn router này khi env.isDev, production không bao giờ có endpoint này.
const router = Router();

// Thứ tự hiển thị: nhân viên / Ban quản lý trước, cư dân sau (cư dân nhiều, không được đẩy nhân viên khỏi danh sách)
const ROLE_ORDER = { MANAGER: 0, ACCOUNTANT: 1, STAFF: 2, BOARD: 3, RESIDENT: 4 };

/** Danh sách tài khoản đang hoạt động để chọn nhanh ở trang đăng nhập (đủ mọi tài khoản, kể cả không có email) */
router.get('/accounts', async (_req, res) => {
  const users = await User.find({ isActive: true }).select('email phone fullName role roleTitle boardTitle activatedAt').limit(500).lean();
  users.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || String(a.fullName).localeCompare(String(b.fullName), 'vi'));
  ok(res, users);
});

router.post(
  '/login',
  // Chọn theo id (tài khoản không có email vẫn vào được) hoặc theo email
  validate({ body: Joi.object({ id: Joi.string().hex().length(24), email: Joi.string().trim().lowercase().email() }).or('id', 'email') }),
  async (req, res) => {
    const user = await User.findOne({ ...(req.body.id ? { _id: req.body.id } : { email: req.body.email }), isActive: true })
      .select('email fullName role roleTitle boardTitle phone consents')
      .lean();
    if (!user) throw ApiError.notFound('Không có tài khoản đang hoạt động này');
    // Cùng payload/secret/thuật toán mà middleware authenticate đọc
    const accessToken = jwt.sign(
      { sub: String(user._id), role: user.role, roleTitle: user.roleTitle ?? null, boardTitle: user.boardTitle ?? null },
      env.jwt.accessSecret,
      { expiresIn: '12h' },
    );
    const { consents, ...profile } = user;
    const publicUser = { ...profile, id: String(user._id), consentStatus: consents?.at(-1)?.action ?? null };
    // Trả danh sách căn như đăng nhập thật, để cư dân từ 2 căn vào được màn Chọn căn hộ (UC01 bước 5)
    const apartments = await apartmentsOf(user);
    ok(res, { user: publicUser, accessToken, refreshToken: null, apartments }, 'Đăng nhập dev thành công');
  },
);

export default router;
