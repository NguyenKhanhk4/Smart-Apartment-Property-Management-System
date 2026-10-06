import { Router } from 'express';
import Joi from 'joi';
import { ROLES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { Amenity, Apartment, Building } from '../../models/index.js';
import { getActiveApartmentIds } from '../../services/residency.service.js';
import { escapeRegex } from '../../utils/pagination.js';
import { ok } from '../../utils/response.js';
import { objectId } from '../../utils/validators.js';

// Danh sách rút gọn cho ô chọn (Select) ở frontend — chỉ đọc, không thay thế API CRUD của Module A/D.
const router = Router();
const INTERNAL = ['STAFF', 'ACCOUNTANT', 'MANAGER', 'BOARD', 'ADMIN'];

/**
 * @openapi
 * /lookups/buildings:
 *   get:
 *     tags: [Lookup]
 *     summary: Danh sách tòa (id, tên) cho ô chọn
 */
router.get('/buildings', authenticate, authorize(...INTERNAL), async (_req, res) => {
  ok(res, await Building.find().select('name').sort({ name: 1 }).lean());
});

/**
 * @openapi
 * /lookups/apartments:
 *   get:
 *     tags: [Lookup]
 *     summary: Tìm căn hộ theo mã (tối đa 20). Cư dân chỉ nhận căn của mình
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: buildingId, schema: { type: string } }
 */
router.get(
  '/apartments',
  authenticate,
  validate({
    query: Joi.object({ q: Joi.string().trim().max(30).allow(''), buildingId: objectId() }),
  }),
  async (req, res) => {
    const { q, buildingId } = req.validated.query;
    const filter = {};
    if (req.user.role === ROLES.RESIDENT) {
      filter._id = { $in: await getActiveApartmentIds(req.user.id) };
    }
    if (buildingId) filter.buildingId = buildingId;
    if (q) filter.code = new RegExp(escapeRegex(q), 'i');
    const items = await Apartment.find(filter)
      .select('code floor status buildingId')
      .populate('buildingId', 'name')
      .sort({ code: 1 })
      .limit(20)
      .lean();
    ok(res, items);
  },
);

/**
 * @openapi
 * /lookups/amenities:
 *   get:
 *     tags: [Lookup]
 *     summary: Danh sách tiện ích (id, tên) cho bộ lọc thống kê
 */
router.get('/amenities', authenticate, async (_req, res) => {
  ok(res, await Amenity.find().select('name capacityPerSlot isActive').sort({ name: 1 }).lean());
});

export default router;
