import { Router } from 'express';
import Joi from 'joi';
import { CRON_JOBS, WORK_ORDER_STATUS, WORK_ORDER_TYPES, values } from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
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
  sort: sortable('createdAt', 'scheduledDate', 'completedAt', 'status'),
  status: csvEnum(values(WORK_ORDER_STATUS)),
  type: Joi.string().valid(...values(WORK_ORDER_TYPES)),
  buildingId: objectId(),
  assignedTo: objectId(),
  unassigned: Joi.boolean(),
  overdue: Joi.boolean(),
  q: Joi.string().trim().max(100),
});

// Hoàn thành bắt buộc ghi chú kết quả ≥ 5 ký tự; bắt đầu thì không cần ghi chú
const statusBody = Joi.object({
  status: Joi.string().valid(WORK_ORDER_STATUS.IN_PROGRESS, WORK_ORDER_STATUS.DONE).required(),
  note: Joi.when('status', {
    is: WORK_ORDER_STATUS.DONE,
    then: Joi.string().trim().min(5).max(1000).required(),
    otherwise: Joi.string().trim().max(1000).allow(''),
  }),
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

/**
 * @openapi
 * /work-orders/{id}/status:
 *   patch:
 *     tags: [Tài sản & bảo trì]
 *     summary: Kỹ thuật viên bắt đầu (PENDING → IN_PROGRESS) hoặc hoàn thành (IN_PROGRESS → DONE) work order (UC-D04)
 *     description: |
 *       Hoàn thành: bắt buộc `note` (≥ 5 ký tự) và ít nhất 1 ảnh bằng chứng (tối đa 5); trong 1 transaction đặt DONE + completedAt và cập nhật
 *       lastMaintenanceDate / nextMaintenanceDate của tài sản (BR-O18), sau đó báo Trưởng BQL.
 *       Lỗi: FORBIDDEN_ROLE (403) không phải việc của mình; WORKORDER_INVALID_STATUS (409) sai thứ tự.
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [IN_PROGRESS, DONE] }
 *               note: { type: string, minLength: 5, maxLength: 1000, description: 'Bắt buộc khi DONE' }
 *               images: { type: array, maxItems: 5, items: { type: string, format: binary }, description: 'Ảnh bằng chứng jpg/png ≤ 5MB, bắt buộc ≥ 1 ảnh khi DONE' }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize('STAFF:TECHNICIAN'),
  uploadImages('images', 5),
  validate({ params: idParams, body: statusBody }),
  async (req, res) =>
    ok(
      res,
      await service.updateWorkOrderStatus(req.user, req.params.id, req.body, req.files),
      req.body.status === WORK_ORDER_STATUS.DONE ? 'Đã hoàn thành work order' : 'Đã bắt đầu xử lý',
    ),
);

export default router;
