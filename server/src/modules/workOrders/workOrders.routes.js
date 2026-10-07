import { Router } from 'express';
import Joi from 'joi';
import { CRON_JOBS, WORK_ORDER_STATUS, WORK_ORDER_TYPES, values } from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import { generateMaintenanceWorkOrders } from './workOrders.jobs.js';
import * as service from './workOrders.service.js';

// Module D — Thanh Bình. UC-D02: tự động tạo work order; UC-D03: danh sách, phân công / giao lại.
// Thứ tự khai báo: đường dẫn cố định (/assignees, /jobs/...) phải đứng TRƯỚC /:id.
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:TECHNICIAN'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('createdAt', 'scheduledDate', 'status'),
  status: csvEnum(values(WORK_ORDER_STATUS)),
  type: Joi.string().valid(...values(WORK_ORDER_TYPES)),
  buildingId: objectId(),
  assignedTo: objectId(),
  unassigned: Joi.boolean(),
  overdue: Joi.boolean(),
  q: Joi.string().trim().max(100),
});

const assignBody = Joi.object({
  assignedTo: objectId().required(),
  note: Joi.string().trim().max(500).allow(''),
});

/**
 * @openapi
 * /work-orders:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Danh sách work order (UC-D03). Manager thấy tất cả; kỹ thuật viên chỉ thấy việc được giao cho mình
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: status, schema: { type: string }, description: 'PENDING,IN_PROGRESS,DONE' }
 *       - { in: query, name: type, schema: { type: string, enum: [SCHEDULED, TICKET_LINKED] } }
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: assignedTo, schema: { type: string } }
 *       - { in: query, name: unassigned, schema: { type: boolean }, description: 'Chỉ work order chưa phân công' }
 *       - { in: query, name: overdue, schema: { type: boolean }, description: 'Chưa DONE và đã qua hết ngày lên lịch' }
 *       - { in: query, name: q, schema: { type: string }, description: 'Tìm theo tên tài sản' }
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({ query: listQuery }),
  async (req, res) => {
    const { items, pagination } = await service.listWorkOrders(req.user, req.validated.query);
    paginated(res, items, pagination);
  },
);

/**
 * @openapi
 * /work-orders/assignees:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Kỹ thuật viên đang hoạt động kèm số work order đang mở của từng người (UC-D03 bước 2)
 */
router.get('/assignees', authenticate, authorize('MANAGER'), async (_req, res) =>
  ok(res, await service.listAssignees()),
);

/**
 * @openapi
 * /work-orders/jobs/generate/run:
 *   post:
 *     tags: [Tài sản & bảo trì]
 *     summary: Chạy thủ công cron quét tài sản đến hạn và tạo work order bảo trì định kỳ (UC-D02), ghi cron_runs
 *     description: Trả về bản ghi cron_runs; affectedCount = số work order mới tạo.
 */
router.post('/jobs/generate/run', authenticate, authorize('MANAGER', 'ADMIN'), async (_req, res) =>
  ok(
    res,
    await runTrackedJob(CRON_JOBS.WORK_ORDER_GENERATE, () => generateMaintenanceWorkOrders(), {
      trigger: 'MANUAL',
    }),
  ),
);

/**
 * @openapi
 * /work-orders/{id}:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Chi tiết work order. Kỹ thuật viên xem việc không phải của mình → 403
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.get(
  '/:id',
  authenticate,
  authorize(...VIEWERS),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.getWorkOrder(req.user, req.params.id)),
);

/**
 * @openapi
 * /work-orders/{id}/assign:
 *   patch:
 *     tags: [Tài sản & bảo trì]
 *     summary: Phân công / giao lại kỹ thuật viên (UC-D03). Trạng thái work order giữ nguyên
 *     description: |
 *       Lỗi: WORKORDER_INVALID_ASSIGNEE (400) người nhận không phải KTV đang hoạt động;
 *       WORKORDER_INVALID_STATUS (409) work order đã DONE; CONCURRENT_UPDATE (409) vừa bị thao tác khác thay đổi.
 *       Chọn lại đúng người đang được giao → 200, không đổi gì, không thông báo, không audit.
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: string }
 *               note: { type: string, maxLength: 500 }
 */
router.patch(
  '/:id/assign',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: assignBody }),
  async (req, res) => {
    const { workOrder, changed } = await service.assignWorkOrder(req.user, req.params.id, req.body);
    ok(res, workOrder, changed ? 'Đã phân công kỹ thuật viên' : 'Work order đã được giao cho người này');
  },
);

export default router;
