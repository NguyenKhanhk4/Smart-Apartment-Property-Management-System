import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PRIORITIES,
  ROLES,
  ROLE_TITLES,
  TICKET_FINAL_STATUSES,
  TICKET_HISTORY_ACTIONS as ACT,
  TICKET_OPEN_STATUSES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { ComplaintCategory, Ticket, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextMonthlyCode, retryOnDuplicate } from '../../utils/codeGenerator.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { HOUR_MS, fmtDateTimeVn } from '../../utils/time.js';

const { NEW, ASSIGNED, IN_PROGRESS, WAITING_CONFIRM, CLOSED, REJECTED } = TICKET_STATUS;

/**
 * Quy tắc SLA hoàn thành (dueDate) — một nguồn cho mỗi thời điểm:
 *  - Lúc tạo: theo `slaHours` của loại phản ánh (form tạo hiển thị đúng số giờ này cho cư dân).
 *  - Khi Trưởng BQL / Lễ tân đổi mức ưu tiên: tính lại TỪ LÚC ĐỔI theo tham số SLA_HOURS_<ưu tiên>
 *    (đổi ưu tiên = đánh giá lại mức khẩn cấp, nên hạn chạy lại theo bảng SLA chung).
 * Quá hạn / leo thang chỉ xét TICKET_SLA_STATUSES (tạm dừng khi chờ cư dân đồng ý phí).
 */
const isOverdueNow = (ticket, now = new Date()) =>
  TICKET_SLA_STATUSES.includes(ticket.status) && Boolean(ticket.dueDate) && ticket.dueDate < now;

const SLA_KEY_BY_PRIORITY = {
  [PRIORITIES.URGENT]: CONFIG_KEYS.SLA_HOURS_URGENT,
  [PRIORITIES.HIGH]: CONFIG_KEYS.SLA_HOURS_HIGH,
  [PRIORITIES.MEDIUM]: CONFIG_KEYS.SLA_HOURS_MEDIUM,
  [PRIORITIES.LOW]: CONFIG_KEYS.SLA_HOURS_LOW,
};

/** BR-O7: số giờ SLA theo mức ưu tiên (system_configs) */
export async function slaHoursOf(priority) {
  return Number(await getConfig(SLA_KEY_BY_PRIORITY[priority]));
}

const DETAIL_POPULATE = [
  { path: 'category', select: 'name defaultPriority slaHours' },
  { path: 'apartmentId', select: 'code floor buildingId', populate: { path: 'buildingId', select: 'name' } },
  { path: 'createdBy', select: 'fullName phone email' },
  { path: 'assignedTo', select: 'fullName phone' },
  { path: 'assignedBy', select: 'fullName' },
  { path: 'history.by', select: 'fullName role roleTitle' },
];
const LIST_POPULATE = [
  { path: 'category', select: 'name' },
  { path: 'apartmentId', select: 'code' },
  { path: 'createdBy', select: 'fullName' },
  { path: 'assignedTo', select: 'fullName' },
];

const isTechnician = (user) => isRole(user, 'STAFF:TECHNICIAN');
const isDispatcher = (user) => isRole(user, 'MANAGER', 'STAFF:RECEPTIONIST');

const ticketLink = (ticket, forResident) =>
  forResident ? `/r/tickets/${ticket._id}` : `/app/tickets/${ticket._id}`;

function assertNotFinal(ticket) {
  if (TICKET_FINAL_STATUSES.includes(ticket.status)) throw new ApiError('TICKET_ALREADY_CLOSED');
}

async function findTicketOr404(id) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw ApiError.notFound('Không tìm thấy phản ánh');
  return ticket;
}

/** Kiểm tra người dùng có được xem ticket không (RESIDENT: căn của mình; TECHNICIAN: được giao) */
async function assertCanView(user, ticket) {
  if (isDispatcher(user)) return;
  if (isTechnician(user) && String(ticket.assignedTo?._id ?? ticket.assignedTo) === user.id) return;
  if (user.role === ROLES.RESIDENT) {
    const ids = await getActiveApartmentIds(user.id);
    if (ids.includes(String(ticket.apartmentId?._id ?? ticket.apartmentId))) return;
  }
  throw ApiError.forbidden('Bạn không có quyền xem phản ánh này');
}

// ===== UC-E02: Cư dân tạo phản ánh kèm ảnh =====
export async function createTicket(user, { categoryId, title, description, apartmentId }, files) {
  const apartment = await resolveResidentApartment(user.id, apartmentId);
  const category = await ComplaintCategory.findOne({ _id: categoryId, isActive: true }).lean();
  if (!category) throw ApiError.badRequest('Loại phản ánh không tồn tại hoặc đã ngưng sử dụng');

  const imageUrls = await uploadToCloudinary(files, 'tickets');
  const now = new Date();

  const ticket = await retryOnDuplicate(async () =>
    Ticket.create({
      code: await nextMonthlyCode(Ticket, 'TK'),
      apartmentId: apartment._id,
      buildingId: apartment.buildingId,
      createdBy: user.id,
      category: category._id,
      title,
      description,
      imageUrls,
      priority: category.defaultPriority,
      dueDate: new Date(now.getTime() + category.slaHours * HOUR_MS), // BR-O7
      status: NEW,
      history: [{ at: now, by: user.id, action: ACT.CREATED, toStatus: NEW }],
    }),
  );

  await notifyRoles(['MANAGER', 'STAFF:RECEPTIONIST'], {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phản ánh mới ${ticket.code}`,
    content: `Căn ${apartment.code} — ${category.name}: ${title}`,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  });
  return ticket;
}

// ===== Danh sách theo quyền (UC-E03 xem danh sách/quá hạn, E04 ticket được giao, E05 của căn mình) =====
export async function listTickets(user, query) {
  const filter = {};

  if (user.role === ROLES.RESIDENT) {
    filter.apartmentId = { $in: await getActiveApartmentIds(user.id) };
  } else if (isTechnician(user)) {
    filter.assignedTo = user.id;
  } else if (!isDispatcher(user)) {
    throw ApiError.forbidden();
  }

  if (query.status) filter.status = { $in: query.status };
  if (query.priority) filter.priority = { $in: query.priority };
  if (query.categoryId) filter.category = query.categoryId;
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.apartmentId && user.role !== ROLES.RESIDENT) filter.apartmentId = query.apartmentId;
  if (query.assignedTo && isDispatcher(user)) filter.assignedTo = query.assignedTo;
  if (query.overdue) {
    filter.dueDate = { $lt: new Date() };
    filter.status = { $in: query.status?.filter((s) => TICKET_SLA_STATUSES.includes(s)) ?? TICKET_SLA_STATUSES };
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ code: re }, { title: re }];
  }

  // Sort theo ưu tiên = theo mức độ nghiêm trọng (priorityRank), không theo bảng chữ cái
  const sort = query.sort?.replace(/^(-?)priority$/, '$1priorityRank');
  return paginate(Ticket, filter, { ...query, sort }, { populate: LIST_POPULATE, select: '-history' });
}

export async function getTicket(user, id) {
  const ticket = await Ticket.findById(id).populate(DETAIL_POPULATE).lean();
  if (!ticket) throw ApiError.notFound('Không tìm thấy phản ánh');
  await assertCanView(user, ticket);
  ticket.isOverdue = isOverdueNow(ticket);
  return ticket;
}

/** Kỹ thuật viên đang hoạt động + số ticket đang mở — để chọn người phân công */
export async function listAssignees() {
  const techs = await User.find({
    role: ROLES.STAFF,
    roleTitle: ROLE_TITLES.TECHNICIAN,
    isActive: true,
  })
    .select('fullName phone')
    .sort({ fullName: 1 })
    .lean();
  const load = await Ticket.aggregate([
    { $match: { assignedTo: { $in: techs.map((t) => t._id) }, status: { $in: TICKET_OPEN_STATUSES } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const loadMap = Object.fromEntries(load.map((l) => [String(l._id), l.count]));
  return techs.map((t) => ({ ...t, openTickets: loadMap[String(t._id)] ?? 0 }));
}

// ===== UC-E03: Phân công kỹ thuật viên, điều chỉnh ưu tiên =====
export async function assignTicket(user, id, { assignedTo, priority, note }) {
  const ticket = await findTicketOr404(id);
  assertNotFinal(ticket);
  if (ticket.status === WAITING_CONFIRM) {
    throw ApiError.badRequest('Phản ánh đang chờ cư dân xác nhận, không thể phân công lại');
  }

  const tech = await User.findOne({
    _id: assignedTo,
    role: ROLES.STAFF,
    roleTitle: ROLE_TITLES.TECHNICIAN,
    isActive: true,
  }).lean();
  if (!tech) throw ApiError.badRequest('Người được giao phải là kỹ thuật viên đang hoạt động');

  const now = new Date();
  const fromStatus = ticket.status;
  const prevAssignee = ticket.assignedTo ? String(ticket.assignedTo) : null;
  const priorityChanged = priority && priority !== ticket.priority;

  if (priorityChanged) {
    ticket.priority = priority;
    ticket.dueDate = new Date(now.getTime() + (await slaHoursOf(priority)) * HOUR_MS);
  }
  ticket.assignedTo = tech._id;
  ticket.assignedBy = user.id;
  ticket.assignedAt = now;
  ticket.status = ASSIGNED;
  ticket.history.push({
    at: now,
    by: user.id,
    action: prevAssignee ? ACT.REASSIGNED : ACT.ASSIGNED,
    fromStatus,
    toStatus: ASSIGNED,
    note: [`Giao cho ${tech.fullName}`, priorityChanged && `ưu tiên ${priority}`, note]
      .filter(Boolean)
      .join(' — '),
  });
  // optimisticConcurrency: request đồng thời → VersionError → errorHandler trả 409 CONCURRENT_UPDATE
  await ticket.save();

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_ASSIGNED,
    user,
    targetType: AUDIT_TARGETS.TICKET,
    targetId: ticket._id,
    metadata: { code: ticket.code, assignedTo: tech._id, prevAssignee, priority: ticket.priority },
  });
  await notify(tech._id, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Bạn được giao phản ánh ${ticket.code}`,
    content: `${ticket.title} — hạn xử lý ${fmtDateTimeVn(ticket.dueDate)}`,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  });
  if (!prevAssignee) {
    await notify(ticket.createdBy, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Phản ánh ${ticket.code} đã được tiếp nhận`,
      content: `Kỹ thuật viên ${tech.fullName} sẽ xử lý phản ánh "${ticket.title}".`,
      refId: ticket._id,
      link: ticketLink(ticket, true),
    });
  }
  return ticket;
}

/** Manager/Lễ tân từ chối phản ánh không hợp lệ (trạng thái REJECTED) */
export async function rejectTicket(user, id, { reason }) {
  const ticket = await findTicketOr404(id);
  assertNotFinal(ticket);
  if (![NEW, ASSIGNED].includes(ticket.status)) {
    throw ApiError.badRequest('Chỉ từ chối được phản ánh chưa bắt đầu xử lý');
  }
  const fromStatus = ticket.status;
  ticket.status = REJECTED;
  ticket.rejectReason = reason;
  ticket.closedAt = new Date();
  ticket.history.push({ by: user.id, action: ACT.REJECTED, fromStatus, toStatus: REJECTED, note: reason });
  await ticket.save();

  await notify(ticket.createdBy, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phản ánh ${ticket.code} bị từ chối`,
    content: `Lý do: ${reason}`,
    refId: ticket._id,
    link: ticketLink(ticket, true),
  });
  return ticket;
}

// ===== UC-E04: Kỹ thuật viên cập nhật tiến độ =====
const PROGRESS_TRANSITIONS = {
  [ASSIGNED]: [IN_PROGRESS, WAITING_CONFIRM],
  [IN_PROGRESS]: [IN_PROGRESS, WAITING_CONFIRM],
};

export async function updateProgress(user, id, { status, note }, files = []) {
  const ticket = await findTicketOr404(id);
  // Kiểm tra quyền trước khi kiểm tra trạng thái để không lộ trạng thái ticket của người khác
  if (String(ticket.assignedTo) !== user.id) {
    throw ApiError.forbidden('Phản ánh không được giao cho bạn');
  }
  assertNotFinal(ticket);
  if (!PROGRESS_TRANSITIONS[ticket.status]?.includes(status)) {
    throw ApiError.badRequest(`Không thể chuyển từ ${ticket.status} sang ${status}`);
  }

  // Báo đã xử lý xong phải có ảnh bằng chứng để Manager/Lễ tân kiểm tra
  if (status === WAITING_CONFIRM && !files.length) {
    throw ApiError.badRequest('Cần chụp hoặc đính kèm ít nhất 1 ảnh kết quả xử lý', [
      { field: 'images', message: 'Bắt buộc có ít nhất 1 ảnh' },
    ]);
  }
  const imageUrls = status === WAITING_CONFIRM ? await uploadToCloudinary(files, 'ticket-results') : undefined;

  const fromStatus = ticket.status;
  ticket.status = status;
  if (status === WAITING_CONFIRM) ticket.resolvedAt = new Date();
  ticket.history.push({
    by: user.id,
    action: status === WAITING_CONFIRM ? ACT.RESOLVED : ACT.PROGRESS,
    fromStatus,
    toStatus: status,
    note,
    imageUrls,
  });
  await ticket.save();

  if (status === WAITING_CONFIRM) {
    await notifyApartment(ticket.apartmentId, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Phản ánh ${ticket.code} đã xử lý xong`,
      content: `Vui lòng xác nhận kết quả và đánh giá cho phản ánh "${ticket.title}".`,
      refId: ticket._id,
      link: ticketLink(ticket, true),
    });
  }
  return ticket;
}

// ===== UC-E05: Cư dân xác nhận kết quả + đánh giá sao =====
export async function confirmTicket(user, id, { accepted, rating, comment, reason }) {
  const ticket = await findTicketOr404(id);
  const myApartments = await getActiveApartmentIds(user.id);
  if (!myApartments.includes(String(ticket.apartmentId))) {
    throw ApiError.forbidden('Phản ánh không thuộc căn hộ của bạn');
  }
  assertNotFinal(ticket);
  if (ticket.status !== WAITING_CONFIRM) {
    throw ApiError.badRequest('Phản ánh chưa ở trạng thái chờ xác nhận');
  }

  const now = new Date();
  if (accepted) {
    ticket.status = CLOSED;
    ticket.rating = rating;
    ticket.ratingComment = comment;
    ticket.closedAt = now;
    ticket.history.push({
      at: now,
      by: user.id,
      action: ACT.CONFIRMED,
      fromStatus: WAITING_CONFIRM,
      toStatus: CLOSED,
      note: `Đánh giá ${rating}★${comment ? ` — ${comment}` : ''}`,
    });
  } else {
    ticket.status = IN_PROGRESS;
    ticket.resolvedAt = undefined;
    ticket.history.push({
      at: now,
      by: user.id,
      action: ACT.REOPENED,
      fromStatus: WAITING_CONFIRM,
      toStatus: IN_PROGRESS,
      note: reason,
    });
  }
  await ticket.save();

  if (accepted) {
    await logAudit({
      action: AUDIT_ACTIONS.TICKET_CLOSED,
      user,
      targetType: AUDIT_TARGETS.TICKET,
      targetId: ticket._id,
      metadata: { code: ticket.code, rating },
    });
  }
  await notify(ticket.assignedTo, {
    type: NOTIFICATION_TYPES.TICKET,
    title: accepted
      ? `Phản ánh ${ticket.code} đã đóng (${rating}★)`
      : `Cư dân chưa đồng ý kết quả ${ticket.code}`,
    content: accepted ? comment || 'Cư dân đã xác nhận kết quả.' : `Lý do: ${reason}`,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  });
  return ticket;
}
