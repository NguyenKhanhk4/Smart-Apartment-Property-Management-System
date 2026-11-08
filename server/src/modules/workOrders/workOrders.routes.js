import { Router } from 'express';
import Joi from 'joi';
import { CRON_JOBS, WORK_ORDER_RESULTS, WORK_ORDER_STATUS, WORK_ORDER_TYPES, values } from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import { generateMaintenanceWorkOrders } from './workOrders.jobs.js';
import * as inspection from './workOrders.inspection.js';
import * as service from './workOrders.service.js';

// Người 1 — Vũ Việt (Mô đun 10). Job tạo phiếu; danh sách, phân công / giao lại; UC08: checklist ca, quét QR, nộp kết quả.
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
/**
 * @openapi
 * /work-orders/shift-checklist:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Checklist ca của kỹ thuật viên (UC08 bước 1)
 *     description: |
 *       Phiếu định kỳ chưa ai nhận + phiếu của chính KTV đang làm / được giao, gần hạn trước.
 *       Kèm onDuty (đang trong ca), hasSchedule (lúc này có lịch trực kỹ thuật), canClaim (được nhận phiếu chưa ai nhận).
 */
router.get('/shift-checklist', authenticate, authorize('STAFF:TECHNICIAN'), async (req, res) =>
  ok(res, await inspection.shiftChecklist(req.user)),
);

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
router.post('/jobs/generate/run', authenticate, authorize('MANAGER'), async (_req, res) =>
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
 * /work-orders/{id}/scan:
 *   post:
 *     tags: [Tài sản & bảo trì]
 *     summary: Quét mã QR trên thiết bị để nhận phiếu và mở checklist (UC08 bước 2–4, BR-E04)
 *     description: |
 *       Sai thiết bị → 409 WORKORDER_WRONG_ASSET (MSG-E03), phiếu không đổi. Phiếu chưa ai nhận mà KTV không trong ca
 *       (khi có lịch trực) → 403 WORKORDER_NOT_ON_DUTY. Người khác đã nhận → 409 WORKORDER_TAKEN.
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [qrCode], properties: { qrCode: { type: string } } }
 */
router.post(
  '/:id/scan',
  authenticate,
  authorize('STAFF:TECHNICIAN'),
  validate({ params: idParams, body: Joi.object({ qrCode: Joi.string().trim().max(100).required() }) }),
  async (req, res) => ok(res, await inspection.scanWorkOrder(req.user, req.params.id, req.body.qrCode), 'Đúng thiết bị. Mở checklist kiểm tra.'),
);

/**
 * @openapi
 * /work-orders/{id}/inspection:
 *   post:
 *     tags: [Tài sản & bảo trì]
 *     summary: Nộp kết quả kiểm tra (UC08 bước 5–7)
 *     description: |
 *       results: chuỗi JSON, cùng thứ tự checklist của phiếu: [{ value }] cho mục đo, [{ ok }] cho mục tick.
 *       PASSED → hoàn thành, dời lịch bảo trì (MSG-E04). FAULTY → lưu kết quả, phiếu vẫn Đang kiểm tra, chờ báo cáo hư hỏng (UC09).
 *       Thiếu mục bắt buộc / ảnh → 400 (MSG-G01). Có mục bắt buộc không đạt mà chọn PASSED → 400 WORKORDER_RESULT_CONFLICT.
 *       Chưa quét QR → 409 WORKORDER_NOT_SCANNED.
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [result, images]
 *             properties:
 *               result: { type: string, enum: [PASSED, FAULTY] }
 *               note: { type: string, description: 'Bắt buộc ≥ 5 ký tự khi FAULTY (mô tả sự cố)' }
 *               results: { type: string, description: 'JSON: [{"value": 380}, {"ok": true}]' }
 *               images: { type: array, maxItems: 5, items: { type: string, format: binary } }
 */
const inspectionBody = Joi.object({
  result: Joi.string().valid(...values(WORK_ORDER_RESULTS)).required(),
  note: Joi.string().trim().max(1000).allow('').default(''),
  results: Joi.string().max(20000).default('[]'),
});
const resultItem = Joi.object({ value: Joi.number().allow(null, ''), ok: Joi.boolean().allow(null) });
router.post(
  '/:id/inspection',
  authenticate,
  authorize('STAFF:TECHNICIAN'),
  uploadImages('images', 5),
  validate({ params: idParams, body: inspectionBody }),
  async (req, res) => {
    let results;
    try {
      results = JSON.parse(req.body.results);
    } catch {
      results = null;
    }
    const { error } = Joi.array().items(resultItem.allow(null)).max(50).validate(results);
    if (error || !Array.isArray(results)) throw ApiError.field('results', 'Kết quả checklist không hợp lệ');
    const wo = await inspection.submitInspection(req.user, req.params.id, { ...req.body, results }, req.files);
    ok(res, wo, req.body.result === WORK_ORDER_RESULTS.PASSED ? 'Đã nộp kết quả kiểm tra: Đạt.' : 'Đã ghi nhận sự cố. Phiếu chờ báo cáo hư hỏng.'); // MSG-E04
  },
);

export default router;
