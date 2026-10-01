import { Router } from 'express';
import Joi from 'joi';
import { AUDIT_ACTIONS, CONFIG_KEYS, CONFIG_SCOPES, ROLES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { SystemConfig } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';

const router = Router();

// BUSINESS do Manager sửa (UC-E01), TECHNICAL do Admin sửa
const SCOPE_OF_ROLE = { [ROLES.MANAGER]: CONFIG_SCOPES.BUSINESS, [ROLES.ADMIN]: CONFIG_SCOPES.TECHNICAL };

// Tham số dạng tỷ lệ: 0 < value ≤ 1
const RATIO_KEYS = new Set([CONFIG_KEYS.FUND_APPROVAL_RATIO]);
const MAX_NUMBER = 1e12;
const MAX_ARRAY = 50;
const isPositiveNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_NUMBER;

/**
 * Giá trị mới phải cùng kiểu với giá trị đang lưu; số phải > 0 (vd slaHours ≤ 0 → VALIDATION_ERROR).
 * Số ngày/giờ/số lượng phải là số nguyên; tỷ lệ ≤ 1; danh sách số không rỗng, không trùng.
 */
function assertValidValue(key, current, next) {
  if (typeof current === 'number') {
    if (!isPositiveNumber(next)) throw ApiError.badRequest('Giá trị phải là số lớn hơn 0');
    if (RATIO_KEYS.has(key)) {
      if (next > 1) throw ApiError.badRequest('Tỷ lệ phải nằm trong khoảng (0, 1]');
    } else if (!Number.isInteger(next)) {
      throw ApiError.badRequest('Giá trị phải là số nguyên');
    }
  } else if (Array.isArray(current)) {
    if (!Array.isArray(next) || !next.length || next.length > MAX_ARRAY) {
      throw ApiError.badRequest(`Giá trị phải là danh sách 1–${MAX_ARRAY} số lớn hơn 0`);
    }
    if (next.some((n) => !isPositiveNumber(n) || !Number.isInteger(n))) {
      throw ApiError.badRequest('Giá trị phải là danh sách số nguyên lớn hơn 0');
    }
    if (new Set(next).size !== next.length) throw ApiError.badRequest('Danh sách không được trùng giá trị');
  } else if (typeof current === 'boolean') {
    if (typeof next !== 'boolean') throw ApiError.badRequest('Giá trị phải là true/false');
  } else if (typeof next !== 'string' || !next.trim() || next.length > 500) {
    throw ApiError.badRequest('Giá trị phải là chuỗi 1–500 ký tự');
  }
}

/**
 * @openapi
 * /system-configs:
 *   get:
 *     tags: [Tham số hệ thống]
 *     summary: Tham số nghiệp vụ (Manager → BUSINESS) hoặc kỹ thuật (Admin → TECHNICAL) — UC-E01
 */
router.get('/', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  const scope = SCOPE_OF_ROLE[req.user.role];
  ok(res, await SystemConfig.find({ scope }).sort({ key: 1 }).lean());
});

/**
 * @openapi
 * /system-configs/{key}:
 *   patch:
 *     tags: [Tham số hệ thống]
 *     summary: Cập nhật giá trị 1 tham số, ghi audit log CONFIG_CHANGED (NFR-08)
 *     parameters: [{ in: path, name: key, required: true, schema: { type: string, example: SLA_HOURS_URGENT } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [value], properties: { value: { example: 24 } } }
 */
router.patch(
  '/:key',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  validate({
    params: Joi.object({ key: Joi.string().trim().uppercase().max(50).required() }),
    body: Joi.object({ value: Joi.any().required() }),
  }),
  async (req, res) => {
    const config = await SystemConfig.findOne({ key: req.validated.params.key });
    if (!config) throw ApiError.notFound('Không tìm thấy tham số');
    if (config.scope !== SCOPE_OF_ROLE[req.user.role]) {
      throw ApiError.forbidden(
        config.scope === CONFIG_SCOPES.BUSINESS
          ? 'Tham số nghiệp vụ chỉ Trưởng BQL được sửa'
          : 'Tham số kỹ thuật chỉ Admin được sửa',
      );
    }
    assertValidValue(config.key, config.value, req.body.value);

    const before = config.value;
    config.value = req.body.value;
    config.updatedBy = req.user.id;
    config.markModified('value');
    await config.save();
    await logAudit({
      action: AUDIT_ACTIONS.CONFIG_CHANGED,
      user: req.user,
      targetType: 'system_configs',
      targetId: config._id,
      metadata: { key: config.key, before, after: config.value },
    });
    ok(res, config, 'Đã cập nhật tham số');
  },
);

export default router;
