import { Router } from 'express';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { validate } from '../../middlewares/validate.js';
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';

// CHỈ DÙNG KHI DEV (NODE_ENV=development) — đăng nhập nhanh bằng tài khoản seed, không cần mật khẩu,
// để cả nhóm xem/test giao diện trong lúc Module A (đăng nhập thật) chưa xong.
// routes.js chỉ gắn router này khi env.isDev, production không bao giờ có endpoint này.
const router = Router();

/** Danh sách tài khoản đang hoạt động để chọn nhanh ở trang đăng nhập */
router.get('/accounts', async (_req, res) => {
  const users = await User.find({ isActive: true })
    .select('email fullName role roleTitle boardTitle')
    .sort({ role: 1, email: 1 })
    .limit(50)
    .lean();
  ok(res, users);
});

router.post(
  '/login',
  validate({ body: Joi.object({ email: Joi.string().trim().lowercase().email().required() }) }),
  async (req, res) => {
    const user = await User.findOne({ email: req.body.email, isActive: true })
      .select('email fullName role roleTitle boardTitle phone')
      .lean();
    if (!user) throw ApiError.notFound('Không có tài khoản đang hoạt động với email này');
    // Cùng payload/secret/thuật toán mà middleware authenticate đọc
    const accessToken = jwt.sign(
      { sub: String(user._id), role: user.role, roleTitle: user.roleTitle ?? null, boardTitle: user.boardTitle ?? null },
      env.jwt.accessSecret,
      { expiresIn: '12h' },
    );
    ok(res, { user: { ...user, id: String(user._id) }, accessToken, refreshToken: null }, 'Đăng nhập dev thành công');
  },
);

export default router;
