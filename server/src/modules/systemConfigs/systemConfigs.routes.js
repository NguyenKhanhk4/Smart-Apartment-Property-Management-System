import { Router } from 'express';
import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONFIG_DEFAULTS, CONFIG_KEYS, DEFAULT_CONFIGS } from '../../constants/enums.js';
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
  // Tham số chưa có trong DB (chưa chạy db:sync) vẫn trả về với giá trị mặc định mà job đang dùng
  const docs = await SystemConfig.find().sort({ key: 1 }).lean();
  const have = new Set(docs.map((d) => d.key));
  const missing = DEFAULT_CONFIGS.filter((c) => !have.has(c.key)).map((c) => ({ ...c, isDefault: true }));
  ok(res, [...docs, ...missing].sort((a, b) => a.key.localeCompare(b.key)));
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
    const { key } = req.validated.params;
    let config = await SystemConfig.findOne({ key });
    // Tham số có mặc định trong code nhưng DB chưa có → tạo mới từ mặc định rồi sửa
    if (!config) {
      const def = DEFAULT_CONFIGS.find((c) => c.key === key);
      if (!def) throw ApiError.notFound('Không tìm thấy tham số');
      config = new SystemConfig({ ...def });
    }
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
      // Tham số chưa có trong DB thì so với giá trị mặc định
      const currentValues = Object.fromEntries(relatedKeys.map((k) => [k, CONFIG_DEFAULTS[k]]));
      allConfigs.forEach((c) => (currentValues[c.key] = c.value));
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
