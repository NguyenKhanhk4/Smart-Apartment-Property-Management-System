import { Router } from 'express';
import Joi from 'joi';
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, BOARD_CONFIRM_CONFIG_KEYS, CONFIG_DEFAULTS, CONFIG_KEYS, DEFAULT_CONFIGS, NOTIFICATION_TYPES, ROLES,
} from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { SystemConfig, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';
import { assertCrossValidation, assertValidValue } from './configRules.js';

const router = Router();
// Chỉ các khóa còn dùng trong code; bản ghi cũ còn sót trong DB (vd SLA_HOURS_* đã bỏ) không hiện / không sửa được
const KNOWN_KEYS = new Set(Object.values(CONFIG_KEYS));
const configLabel = (c) => (c.description ? c.description.split(/[.(—]/)[0].trim() : c.key);
async function notifyBoard({ title, content }) {
  try {
    const members = await User.find({ role: ROLES.BOARD, isActive: true }).select('_id').lean();
    if (members.length) await notify(members.map((m) => m._id), { type: NOTIFICATION_TYPES.FUND_APPROVAL, title, content, link: '/app/fund', email: true });
  } catch (err) {
    console.error('[BR-S12] Lỗi gửi thông báo:', err);
  }
}

/**
 * @openapi
 * /system-configs:
 *   get:
 *     tags: [Tham số hệ thống]
 *     summary: Toàn bộ tham số hệ thống cho Trưởng BQL — UC-E01
 */
router.get('/', authenticate, authorize('MANAGER'), async (_req, res) => {
  // Tham số chưa có trong DB (chưa chạy db:sync) vẫn trả về với giá trị mặc định mà job đang dùng
  const docs = await SystemConfig.find({ key: { $in: [...KNOWN_KEYS] } }).sort({ key: 1 }).lean();
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
 *     parameters: [{ in: path, name: key, required: true, schema: { type: string, example: TICKET_AUTO_CLOSE_DAYS } }]
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
    if (!KNOWN_KEYS.has(key)) throw ApiError.notFound('Không tìm thấy tham số');
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

    // BR-S12: tham số tài chính → chỉ ghi giá trị chờ, giá trị đang dùng giữ nguyên tới khi Ban quản trị xác nhận
    if (BOARD_CONFIRM_CONFIG_KEYS.includes(config.key)) {
      if (config.pendingValue != null) {
        throw new ApiError('CONFIG_AWAITING_BOARD', `Đang chờ Ban quản trị xác nhận đổi thành ${config.pendingValue}. Chờ Ban quản trị xác nhận hoặc từ chối rồi mới đổi tiếp được`);
      }
      if (req.body.value === config.value) throw ApiError.field('value', 'Giá trị mới trùng giá trị đang dùng');
      config.pendingValue = req.body.value;
      config.pendingBy = req.user.id;
      config.pendingAt = new Date();
      config.markModified('pendingValue');
      await config.save();
      await logAudit({
        action: AUDIT_ACTIONS.CONFIG_CHANGE_REQUESTED,
        user: req.user,
        targetType: AUDIT_TARGETS.SYSTEM_CONFIG,
        targetId: config._id,
        metadata: { key: config.key, before: config.value, after: config.pendingValue, financial: true },
        ip: req.ip,
      });
      await notifyBoard({
        title: 'Thay đổi tham số chờ Ban quản trị xác nhận',
        content: `Trưởng BQL đề nghị đổi "${configLabel(config)}" từ ${config.value} thành ${config.pendingValue}. Giá trị cũ vẫn áp dụng tới khi Ban quản trị xác nhận.`,
      });
      return ok(res, config, 'Đã gửi thay đổi, chờ Ban quản trị xác nhận');
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

/**
 * @openapi
 * /system-configs/pending:
 *   get:
 *     tags: [Tham số hệ thống]
 *     summary: BR-S12 — thay đổi tham số tài chính đang chờ Ban quản trị xác nhận
 */
router.get('/pending', authenticate, authorize('MANAGER', 'BOARD'), async (_req, res) => {
  const docs = await SystemConfig.find({ key: { $in: [...BOARD_CONFIRM_CONFIG_KEYS] }, pendingValue: { $ne: null } })
    .populate('pendingBy', 'fullName')
    .sort({ pendingAt: 1 })
    .lean();
  ok(res, docs);
});

const keyParams = Joi.object({ key: Joi.string().trim().uppercase().max(50).required() });
async function loadPending(key) {
  if (!BOARD_CONFIRM_CONFIG_KEYS.includes(key)) throw ApiError.notFound('Tham số không cần Ban quản trị xác nhận');
  const config = await SystemConfig.findOne({ key, pendingValue: { $ne: null } });
  if (!config) throw new ApiError('STATUS_CONFLICT', 'Tham số không có thay đổi đang chờ xác nhận');
  return config;
}

/**
 * @openapi
 * /system-configs/{key}/approve:
 *   post:
 *     tags: [Tham số hệ thống]
 *     summary: BR-S12 — Ban quản trị xác nhận thay đổi đang chờ → giá trị mới có hiệu lực ngay
 *     parameters: [{ in: path, name: key, required: true, schema: { type: string, example: REPAIR_FUND_THRESHOLD } }]
 */
router.post('/:key/approve', authenticate, authorize('BOARD'), validate({ params: keyParams }), async (req, res) => {
  const config = await loadPending(req.validated.params.key);
  const before = config.value;
  const after = config.pendingValue;
  const done = await SystemConfig.findOneAndUpdate(
    { _id: config._id, pendingAt: config.pendingAt },
    {
      $set: { value: after, updatedBy: config.pendingBy, confirmedBy: req.user.id, confirmedAt: new Date(), pendingValue: null, pendingBy: null, pendingAt: null },
    },
    { new: true },
  ).lean();
  if (!done) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.CONFIG_CHANGE_CONFIRMED,
    user: req.user,
    targetType: AUDIT_TARGETS.SYSTEM_CONFIG,
    targetId: config._id,
    metadata: { key: config.key, before, after, financial: true },
    ip: req.ip,
  });
  await notifyRoles(['MANAGER'], {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Ban quản trị đã xác nhận thay đổi tham số',
    content: `"${configLabel(config)}" đổi từ ${before} thành ${after}, có hiệu lực ngay.`,
    link: '/app/building-settings',
  }).catch((err) => console.error('[BR-S12] Lỗi gửi thông báo:', err));
  ok(res, done, 'Đã xác nhận thay đổi tham số');
});

/**
 * @openapi
 * /system-configs/{key}/reject:
 *   post:
 *     tags: [Tham số hệ thống]
 *     summary: BR-S12 — Ban quản trị từ chối thay đổi đang chờ (lý do ≥ 5 ký tự), giữ giá trị cũ
 *     parameters: [{ in: path, name: key, required: true, schema: { type: string } }]
 */
router.post(
  '/:key/reject',
  authenticate,
  authorize('BOARD'),
  validate({ params: keyParams, body: Joi.object({ reason: Joi.string().trim().min(5).max(500).required() }) }),
  async (req, res) => {
    const config = await loadPending(req.validated.params.key);
    const proposed = config.pendingValue;
    const done = await SystemConfig.findOneAndUpdate(
      { _id: config._id, pendingAt: config.pendingAt },
      { $set: { pendingValue: null, pendingBy: null, pendingAt: null } },
      { new: true },
    ).lean();
    if (!done) throw new ApiError('CONCURRENT_UPDATE');
    await logAudit({
      action: AUDIT_ACTIONS.CONFIG_CHANGE_REJECTED,
      user: req.user,
      targetType: AUDIT_TARGETS.SYSTEM_CONFIG,
      targetId: config._id,
      metadata: { key: config.key, value: config.value, proposed, reason: req.body.reason, financial: true },
      ip: req.ip,
    });
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Ban quản trị không đồng ý thay đổi tham số',
      content: `"${configLabel(config)}" giữ ${config.value} (đề nghị ${proposed}): ${req.body.reason}`,
      link: '/app/building-settings',
    }).catch((err) => console.error('[BR-S12] Lỗi gửi thông báo:', err));
    ok(res, done, 'Đã từ chối thay đổi tham số');
  },
);

export default router;
