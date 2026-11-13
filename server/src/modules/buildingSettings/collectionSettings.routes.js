import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import * as service from './collectionSettings.service.js';

const router = Router();

const updateBody = Joi.object({
  utility: Joi.string().valid('ELECTRICITY', 'WATER').required(),
  enabled: Joi.boolean().required(),
  waterQuotaPerOccupant: Joi.number().min(0).allow(null),
});

router.get('/', authenticate, async (_req, res) => {
  const result = await service.getCollectionSettings();
  ok(res, result);
});

router.put('/', authenticate, authorize('MANAGER'), validate({ body: updateBody }), async (req, res) => {
  const result = await service.updateCollectionSetting(req.user, req.validated.body);
  ok(res, result.setting, result.message, 200, { effectiveFrom: result.effectiveFrom });
});

router.delete(
  '/:utility/upcoming',
  authenticate,
  authorize('MANAGER'),
  validate({ params: Joi.object({ utility: Joi.string().valid('ELECTRICITY', 'WATER').required() }) }),
  async (req, res) => {
    const result = await service.cancelUpcomingSetting(req.user, req.validated.params.utility);
    ok(res, null, result.message);
  },
);

export default router;

