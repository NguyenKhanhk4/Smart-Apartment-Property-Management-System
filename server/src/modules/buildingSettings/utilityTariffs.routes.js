import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { idParams, period } from '../../utils/validators.js';
import * as service from './utilityTariffs.service.js';

const router = Router();

const tierSchema = Joi.object({
  upTo: Joi.number().min(0).allow(null),
  unitPrice: Joi.number().min(0).required(),
});

const createBody = Joi.object({
  utility: Joi.string().valid('ELECTRICITY', 'WATER').required(),
  fromPeriod: period().required(),
  tiers: Joi.array().items(tierSchema).min(1).required(),
  perOccupant: Joi.boolean().default(false),
});

router.get('/', authenticate, async (req, res) => {
  const tariffs = await service.listTariffs(req.query);
  ok(res, tariffs);
});

router.post('/', authenticate, authorize('MANAGER'), validate({ body: createBody }), async (req, res) => {
  const result = await service.createTariff(req.user, req.validated.body);
  ok(res, result.tariff, result.message, 201, { movedTo: result.movedTo });
});

router.delete('/:id', authenticate, authorize('MANAGER'), validate({ params: idParams }), async (req, res) => {
  const result = await service.deleteTariff(req.user, req.validated.params.id);
  ok(res, result, 'Đã xóa biểu giá');
});

export default router;

