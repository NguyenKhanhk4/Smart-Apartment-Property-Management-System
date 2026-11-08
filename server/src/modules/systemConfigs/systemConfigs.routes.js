import { Router } from 'express';
import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_KEYS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { SystemConfig } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';
import { assertCrossValidation, assertValidValue } from './configRules.js';

const router = Router();


/**
 * @openapi
 * /system-configs:
 *   get:
 *     tags: [Tham số hệ thống]
 *     summary: Toàn bộ tham số hệ thống cho Trưởng BQL — UC-E01
 */
router.get('/', authenticate, authorize('MANAGER'), async (_req, res) => {
  ok(res, await SystemConfig.find().sort({ key: 1 }).lean());
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
  authorize('MANAGER'),
  validate({
    params: Joi.object({ key: Joi.string().trim().uppercase().max(50).required() }),
    body: Joi.object({ value: Joi.any().required() }),
  }),
  async (req, res) => {
    const config = await SystemConfig.findOne({ key: req.validated.params.key });
    if (!config) throw ApiError.notFound('Không tìm thấy tham số');
    assertValidValue(config.key, config.value, req.body.value);

    // Kiểm tra chéo giữa các cặp thời hạn (BR-X8)
    const relatedKeys = [
      CONFIG_KEYS.OWNER_CONFIRM_REMIND_DAYS,
      CONFIG_KEYS.OWNER_CONFIRM_AUTO_CANCEL_DAYS,
      CONFIG_KEYS.QUOTE_REMIND_DAYS,
      CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS,
    ];
    if (relatedKeys.includes(config.key)) {
      const allConfigs = await SystemConfig.find({ key: { $in: relatedKeys } }).lean();
      const currentValues = Object.fromEntries(allConfigs.map((c) => [c.key, c.value]));
      assertCrossValidation(config.key, req.body.value, currentValues);
    }

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
      ip: req.ip,
    });
    ok(res, config, 'Đã cập nhật tham số');
  },
);

export default router;
