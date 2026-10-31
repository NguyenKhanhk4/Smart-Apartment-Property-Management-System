import { Router } from 'express';
import Joi from 'joi';
import { CRON_JOBS, CRON_TRIGGERS, PRIORITIES, TICKET_SCOPES, TICKET_STATUS, TICKET_TYPES, values } from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import { alertSlaBreaches, autoCloseTickets, escalateOverdueTickets } from './tickets.jobs.js';
import * as service from './tickets.service.js';

const router = Router();
const DISPATCHERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('createdAt', 'dueDate', 'priority', 'status', 'updatedAt'),
  status: csvEnum(values(TICKET_STATUS)),
  priority: csvEnum(values(PRIORITIES)),
  categoryId: objectId(),
  buildingId: objectId(),
  apartmentId: objectId(),
  assignedTo: objectId(),
  type: Joi.string().valid(...values(TICKET_TYPES)),
  scope: Joi.string().valid(...values(TICKET_SCOPES)),
  overdue: Joi.boolean(),
  q: Joi.string().trim().max(100),
});

const ticketFields = {
  categoryId: objectId().required(),
  title: Joi.string().trim().min(5).max(150).required(),
  description: Joi.string().trim().min(10).max(2000).required(),
  type: Joi.string().valid(...values(TICKET_TYPES)).default(TICKET_TYPES.INCIDENT),
  scope: Joi.string().valid(...values(TICKET_SCOPES)).default(TICKET_SCOPES.COMMON_AREA),
};
const createBody = Joi.object({ ...ticketFields, apartmentId: objectId() });
const staffCreateBody = Joi.object({ ...ticketFields, apartmentId: objectId().required() });

// Chạy lại thủ công các cron của ticket (ghi cron_runs)
const MANUAL_JOBS = {
  escalate: [CRON_JOBS.TICKET_ESCALATE, escalateOverdueTickets],
  'auto-close': [CRON_JOBS.TICKET_AUTO_CLOSE, autoCloseTickets],
  'sla-alert': [CRON_JOBS.TICKET_SLA_ALERT, alertSlaBreaches],
};

/**
 * @openapi
 * /tickets:
 *   get:
 *     tags: [Ticket]
 *     summary: Danh sách phản ánh theo quyền (cư dân → căn mình; KTV → được giao; Manager/Lễ tân → tất cả)
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: status, schema: { type: string }, description: 'NEW,ASSIGNED,...' }
 *       - { in: query, name: priority, schema: { type: string } }
 *       - { in: query, name: overdue, schema: { type: boolean }, description: 'Chỉ ticket quá hạn' }
 *       - { in: query, name: q, schema: { type: string }, description: 'Tìm theo mã/tiêu đề' }
 *   post:
 *     tags: [Ticket]
 *     summary: Cư dân gửi sự cố (INCIDENT → hàng chờ Kỹ thuật) hoặc phản ánh (COMPLAINT → Trưởng BQL), tối đa 5 ảnh (UC-E02)
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [categoryId, title, description]
 *             properties:
 *               categoryId: { type: string }
 *               title: { type: string }
 *               description: { type: string }
 *               apartmentId: { type: string, description: 'Bắt buộc nếu cư dân ở nhiều căn' }
 *               type: { type: string, enum: [INCIDENT, COMPLAINT] }
 *               scope: { type: string, enum: [COMMON_AREA, IN_APARTMENT], description: 'Chỉ áp dụng cho sự cố' }
 *               images: { type: array, items: { type: string, format: binary } }
 */
router.get(
  '/',
  authenticate,
  authorize('RESIDENT', 'STAFF:TECHNICIAN', ...DISPATCHERS),
  validate({ query: listQuery }),
  async (req, res) => {
    const { items, pagination } = await service.listTickets(req.user, req.validated.query);
    paginated(res, items, pagination);
  },
);

router.post(
  '/',
  authenticate,
  authorize('RESIDENT'),
  uploadImages('images', 5),
  validate({ body: createBody }),
  async (req, res) =>
    created(res, await service.createTicket(req.user, req.body, req.files), 'Đã gửi phản ánh'),
);

/**
 * @openapi
 * /tickets/staff:
 *   post:
 *     tags: [Ticket]
 *     summary: Lễ tân tạo hộ sự cố / phản ánh cho cư dân (bắt buộc apartmentId), ghi createdByStaff
 */
router.post(
  '/staff',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  uploadImages('images', 5),
  validate({ body: staffCreateBody }),
  async (req, res) =>
    created(res, await service.createTicketByStaff(req.user, req.body, req.files), 'Đã tạo phiếu giúp cư dân'),
);

/**
 * @openapi
 * /tickets/queue:
 *   get:
 *     tags: [Ticket]
 *     summary: Hàng chờ sự cố chưa ai nhận (khẩn cấp lên đầu) + cờ KTV có đang trong ca không — { items, hasSchedule, onDuty }
 */
router.get('/queue', authenticate, authorize('STAFF:TECHNICIAN'), async (req, res) =>
  ok(res, await service.listQueue(req.user)),
);

/**
 * @openapi
 * /tickets/board:
 *   get:
 *     tags: [Ticket]
 *     summary: Kanban điều phối sự cố của Trưởng BQL — { columns: [{ status, items }] }
 *     parameters: [{ in: query, name: buildingId, schema: { type: string } }]
 */
router.get(
  '/board',
  authenticate,
  authorize('MANAGER'),
  validate({ query: Joi.object({ buildingId: objectId() }) }),
  async (req, res) => ok(res, await service.getBoard(req.user, req.validated.query)),
);

/**
 * @openapi
 * /tickets/assignees:
 *   get:
 *     tags: [Ticket]
 *     summary: Kỹ thuật viên đang hoạt động + số ticket đang mở (để phân công)
 */
router.get('/assignees', authenticate, authorize(...DISPATCHERS), async (_req, res) =>
  ok(res, await service.listAssignees()),
);

/**
 * @openapi
 * /tickets/jobs/{job}/run:
 *   post:
 *     tags: [Ticket]
 *     summary: Chạy lại thủ công cron leo thang (escalate), tự đóng (auto-close) hoặc cảnh báo SLA (sla-alert), ghi cron_runs
 *     parameters: [{ in: path, name: job, required: true, schema: { type: string, enum: [escalate, auto-close, sla-alert] } }]
 */
router.post(
  '/jobs/:job/run',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  validate({ params: Joi.object({ job: Joi.string().valid(...Object.keys(MANUAL_JOBS)).required() }) }),
  async (req, res) => {
    const [name, handler] = MANUAL_JOBS[req.params.job];
    ok(res, await runTrackedJob(name, () => handler(), { trigger: CRON_TRIGGERS.MANUAL }));
  },
);

/**
 * @openapi
 * /tickets/{id}:
 *   get:
 *     tags: [Ticket]
 *     summary: Chi tiết phản ánh + lịch sử xử lý
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.get(
  '/:id',
  authenticate,
  authorize('RESIDENT', 'STAFF:TECHNICIAN', ...DISPATCHERS),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.getTicket(req.user, req.params.id)),
);

/**
 * @openapi
 * /tickets/{id}/assign:
 *   patch:
 *     tags: [Ticket]
 *     summary: Phân công KTV, đổi ưu tiên → tính lại hạn theo SLA (UC-E03)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: string }
 *               priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *               note: { type: string }
 */
router.patch(
  '/:id/assign',
  authenticate,
  authorize(...DISPATCHERS),
  validate({
    params: idParams,
    body: Joi.object({
      assignedTo: objectId().required(),
      priority: Joi.string().valid(...values(PRIORITIES)),
      note: Joi.string().trim().max(500).allow(''),
    }),
  }),
  async (req, res) =>
    ok(res, await service.assignTicket(req.user, req.params.id, req.body), 'Đã phân công'),
);

/**
 * @openapi
 * /tickets/{id}/reject:
 *   patch:
 *     tags: [Ticket]
 *     summary: Từ chối phản ánh không hợp lệ (Manager/Lễ tân)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/reject',
  authenticate,
  authorize(...DISPATCHERS),
  validate({
    params: idParams,
    body: Joi.object({ reason: Joi.string().trim().min(5).max(500).required() }),
  }),
  async (req, res) =>
    ok(res, await service.rejectTicket(req.user, req.params.id, req.body), 'Đã từ chối phản ánh'),
);

/**
 * @openapi
 * /tickets/{id}/progress:
 *   patch:
 *     tags: [Ticket]
 *     summary: KTV cập nhật tiến độ IN_PROGRESS / WAITING_CONFIRM (UC-E04). WAITING_CONFIRM bắt buộc kèm ≥ 1 ảnh kết quả (field images, multipart)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/progress',
  authenticate,
  authorize('STAFF:TECHNICIAN'),
  uploadImages('images', 5),
  validate({
    params: idParams,
    body: Joi.object({
      status: Joi.string()
        .valid(
          TICKET_STATUS.WAITING_QUOTE_APPROVAL,
          TICKET_STATUS.IN_PROGRESS,
          TICKET_STATUS.WAITING_PARTS,
          TICKET_STATUS.WAITING_CONFIRM,
        )
        .required(),
      note: Joi.string().trim().max(1000).allow(''),
    }),
  }),
  async (req, res) =>
    ok(res, await service.updateProgress(req.user, req.params.id, req.body, req.files), 'Đã cập nhật tiến độ'),
);

/**
 * @openapi
 * /tickets/{id}/confirm:
 *   patch:
 *     tags: [Ticket]
 *     summary: Cư dân xác nhận + đánh giá sao, hoặc không đồng ý → quay lại IN_PROGRESS (UC-E05)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accepted: { type: boolean }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *               reason: { type: string, description: 'Bắt buộc khi accepted=false' }
 */
router.patch(
  '/:id/confirm',
  authenticate,
  authorize('RESIDENT'),
  validate({
    params: idParams,
    body: Joi.object({
      accepted: Joi.boolean().required(),
      rating: Joi.when('accepted', {
        is: true,
        then: Joi.number().integer().min(1).max(5).required(),
        otherwise: Joi.forbidden(),
      }),
      comment: Joi.string().trim().max(500).allow(''),
      reason: Joi.when('accepted', {
        is: false,
        then: Joi.string().trim().min(5).max(500).required(),
        otherwise: Joi.forbidden(),
      }),
    }),
  }),
  async (req, res) =>
    ok(res, await service.confirmTicket(req.user, req.params.id, req.body), 'Đã ghi nhận'),
);

/**
 * @openapi
 * /tickets/{id}/claim:
 *   patch:
 *     tags: [Ticket]
 *     summary: KTV nhận sự cố trong hàng chờ — chỉ 1 người nhận được (TICKET_ALREADY_CLAIMED); có lịch trực thì phải trong ca (NOT_ON_DUTY)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch('/:id/claim', authenticate, authorize('STAFF:TECHNICIAN'), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.claimTicket(req.user, req.params.id), 'Đã nhận sự cố'),
);

/**
 * @openapi
 * /tickets/{id}/quote-decision:
 *   patch:
 *     tags: [Ticket]
 *     summary: Người nộp phí của căn đồng ý (→ Đang xử lý) hoặc từ chối (→ Từ chối) báo giá sửa chữa trong căn hộ
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accepted]
 *             properties:
 *               accepted: { type: boolean }
 *               note: { type: string }
 */
router.patch(
  '/:id/quote-decision',
  authenticate,
  authorize('RESIDENT'),
  validate({
    params: idParams,
    body: Joi.object({ accepted: Joi.boolean().required(), note: Joi.string().trim().max(500).allow('') }),
  }),
  async (req, res) => ok(res, await service.decideQuote(req.user, req.params.id, req.body), 'Đã ghi nhận quyết định'),
);

export default router;
