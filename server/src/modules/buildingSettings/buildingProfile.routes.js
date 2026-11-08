import { Router } from 'express';
import Joi from 'joi';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { BuildingProfile } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { uploadImages, uploadToCloudinary } from '../../services/upload.service.js';
import { ok } from '../../utils/response.js';

const router = Router();

// Mã số thuế: 10 hoặc 13 chữ số (dạng xxxxxxxxxx hoặc xxxxxxxxxx-xxx)
const TAX_CODE_RE = /^(\d{10}|\d{10}-\d{3})$/;
const BANK_ACCOUNT_RE = /^\d*$/; // Rỗng hoặc chỉ chứa chữ số

const updateBody = Joi.object({
  name: Joi.string().trim().max(200).allow(''),
  address: Joi.string().trim().max(500).allow(''),
  taxCode: Joi.string().trim().max(20).allow('')
    .custom((val, helpers) => {
      if (val && !TAX_CODE_RE.test(val)) {
        return helpers.message('Mã số thuế phải là 10 hoặc 13 chữ số (dạng xxxxxxxxxx-xxx)');
      }
      return val;
    }),
  bankName: Joi.string().trim().max(200).allow(''),
  bankAccountNo: Joi.string().trim().max(30).allow('')
    .regex(BANK_ACCOUNT_RE)
    .message('Số tài khoản chỉ được chứa chữ số'),
  bankAccountName: Joi.string().trim().max(200).allow(''),
});

router.get('/', authenticate, async (_req, res) => {
  const profile = await BuildingProfile.findOne().lean();
  ok(res, profile ?? {});
});

router.put(
  '/',
  authenticate,
  authorize('MANAGER'),
  uploadImages('logo', 1),
  validate({ body: updateBody }),
  async (req, res) => {
    const before = (await BuildingProfile.findOne().lean()) ?? {};
    let logoUrl = before.logoUrl ?? '';

    if (req.files?.length) {
      const [url] = await uploadToCloudinary(req.files, 'building-profile');
      logoUrl = url;
    }

    const payload = { ...req.validated.body };
    const update = {
      ...payload,
      logoUrl,
      updatedBy: req.user.id,
    };

    const profile = await BuildingProfile.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, returnDocument: 'after', new: true },
    ).lean();

    await logAudit({
      action: AUDIT_ACTIONS.BUILDING_PROFILE_UPDATED,
      user: req.user,
      targetType: AUDIT_TARGETS.BUILDING_PROFILE,
      targetId: profile._id,
      before: {
        name: before.name ?? '',
        address: before.address ?? '',
        taxCode: before.taxCode ?? '',
        bankName: before.bankName ?? '',
        bankAccountNo: before.bankAccountNo ?? '',
        bankAccountName: before.bankAccountName ?? '',
        logoUrl: before.logoUrl ?? '',
      },
      after: {
        name: profile.name ?? '',
        address: profile.address ?? '',
        taxCode: profile.taxCode ?? '',
        bankName: profile.bankName ?? '',
        bankAccountNo: profile.bankAccountNo ?? '',
        bankAccountName: profile.bankAccountName ?? '',
        logoUrl: profile.logoUrl ?? '',
      },
    });

    ok(res, profile, 'Đã lưu cấu hình. Thay đổi phí áp dụng từ kỳ tính phí sau.');
  },
);

export default router;
