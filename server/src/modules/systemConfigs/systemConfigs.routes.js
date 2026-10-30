import { Router } from 'express';
import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_SCOPES, ROLES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { SystemConfig } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';
import { assertValidValue } from './configRules.js';

const router = Router();

// BUSINESS do Manager sửa (UC-E01), TECHNICAL do Admin sửa
const SCOPE_OF_ROLE = { [ROLES.MANAGER]: CONFIG_SCOPES.BUSINESS, [ROLES.ADMIN]: CONFIG_SCOPES.TECHNICAL };

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
      targetType: AUDIT_TARGETS.SYSTEM_CONFIG,
      targetId: config._id,
      metadata: { key: config.key, before, after: config.value },
    });
    ok(res, config, 'Đã cập nhật tham số');
  },
);

export default router;
