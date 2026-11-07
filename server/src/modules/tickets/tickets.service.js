import {
  AUDIT_ACTIONS,
<<<<<<< HEAD
  AUDIT_TARGETS,
=======
>>>>>>> origin/minh
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PRIORITIES,
  ROLES,
  ROLE_TITLES,
<<<<<<< HEAD
  TICKET_FINAL_STATUSES,
  TICKET_HISTORY_ACTIONS as ACT,
  TICKET_OPEN_STATUSES,
  TICKET_SCOPES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { Apartment, ComplaintCategory, Ticket, User } from '../../models/index.js';
=======
  TICKET_STATUS,
} from '../../constants/enums.js';
import { ComplaintCategory, Ticket, User } from '../../models/index.js';
>>>>>>> origin/minh
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextMonthlyCode, retryOnDuplicate } from '../../utils/codeGenerator.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
<<<<<<< HEAD
import { HOUR_MS, fmtDateTimeVn } from '../../utils/time.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { getOnDuty, isUserOnDuty } from '../dutyShifts/dutyShifts.service.js';
import { recordQuoteDecision } from '../repairQuotes/repairQuotes.service.js';
import { BOARD_STATUSES, computeDeadlines, groupBoard, progressError } from './ticket.rules.js';

const { NEW, ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS, WAITING_CONFIRM, CLOSED, REJECTED } =
  TICKET_STATUS;
const { INCIDENT, COMPLAINT } = TICKET_TYPES;
const TECHNICIAN = ROLE_TITLES.TECHNICIAN;
const DISPATCHERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

/**
 * Quy tắc SLA hoàn thành (dueDate) — một nguồn cho mỗi thời điểm:
 *  - Lúc tạo: theo `slaHours` của loại phản ánh (form tạo hiển thị đúng số giờ này cho cư dân).
 *  - Khi Trưởng BQL / Lễ tân đổi mức ưu tiên: tính lại TỪ LÚC ĐỔI theo tham số SLA_HOURS_<ưu tiên>
 *    (đổi ưu tiên = đánh giá lại mức khẩn cấp, nên hạn chạy lại theo bảng SLA chung).
 * Quá hạn / leo thang chỉ xét TICKET_SLA_STATUSES (tạm dừng khi chờ cư dân đồng ý phí).
 */
const isOverdueNow = (ticket, now = new Date()) =>
  TICKET_SLA_STATUSES.includes(ticket.status) && Boolean(ticket.dueDate) && ticket.dueDate < now;
=======
import { HOUR_MS } from '../../utils/time.js';

const { NEW, ASSIGNED, IN_PROGRESS, WAITING_CONFIRM, CLOSED, REJECTED } = TICKET_STATUS;

// Ticket còn đang xử lý — dùng cho "quá hạn" và leo thang
export const OPEN_STATUSES = [NEW, ASSIGNED, IN_PROGRESS];
const FINAL_STATUSES = [CLOSED, REJECTED];
>>>>>>> origin/minh

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

<<<<<<< HEAD
const isTechnician = (user) => isRole(user, 'STAFF:TECHNICIAN');
const isDispatcher = (user) => isRole(user, ...DISPATCHERS);
=======
const isTechnician = (user) => user.role === ROLES.STAFF && user.roleTitle === ROLE_TITLES.TECHNICIAN;
const isDispatcher = (user) =>
  user.role === ROLES.MANAGER ||
  (user.role === ROLES.STAFF && user.roleTitle === ROLE_TITLES.RECEPTIONIST);
>>>>>>> origin/minh

const ticketLink = (ticket, forResident) =>
  forResident ? `/r/tickets/${ticket._id}` : `/app/tickets/${ticket._id}`;

function assertNotFinal(ticket) {
<<<<<<< HEAD
  if (TICKET_FINAL_STATUSES.includes(ticket.status)) throw new ApiError('TICKET_ALREADY_CLOSED');
=======
  if (FINAL_STATUSES.includes(ticket.status)) throw new ApiError('TICKET_ALREADY_CLOSED');
}

/**
 * Lưu ticket với optimisticConcurrency: nếu có request khác đã sửa ticket từ lúc đọc
 * (2 lần assign/confirm đồng thời) → 409 CONCURRENT_UPDATE thay vì ghi đè trạng thái.
 */
async function saveChecked(ticket) {
  try {
    await ticket.save();
  } catch (err) {
    if (err?.name === 'VersionError') throw new ApiError('CONCURRENT_UPDATE');
    throw err;
  }
>>>>>>> origin/minh
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

<<<<<<< HEAD
/** KTV cần báo khi có sự cố mới: người trực chính đang trong ca (không có thì dự phòng); chưa xếp lịch thì mọi KTV */
async function technicianRecipients(now = new Date()) {
  const duty = await getOnDuty(TECHNICIAN, now);
  if (duty.hasSchedule) return (duty.primary.length ? duty.primary : duty.backup).map((p) => p._id);
  const all = await User.find({ role: ROLES.STAFF, roleTitle: TECHNICIAN, isActive: true }).select('_id').lean();
  return all.map((u) => u._id);
}

/**
 * Lõi tạo phiếu cho cả cư dân tự gửi và Lễ tân tạo hộ. Sự cố → hàng chờ Kỹ thuật (báo KTV đang trực);
 * phản ánh → màn hình xử lý của Trưởng BQL (Người 2). Phản ánh không phân biệt phạm vi (luôn COMMON_AREA).
 */
async function placeTicket({ apartment, reporterId, staff = null, body, files }) {
  const { categoryId, title, description, type = INCIDENT, scope = TICKET_SCOPES.COMMON_AREA } = body;
=======
// ===== UC-E02: Cư dân tạo phản ánh kèm ảnh =====
export async function createTicket(user, { categoryId, title, description, apartmentId }, files) {
  const apartment = await resolveResidentApartment(user.id, apartmentId);
>>>>>>> origin/minh
  const category = await ComplaintCategory.findOne({ _id: categoryId, isActive: true }).lean();
  if (!category) throw ApiError.badRequest('Loại phản ánh không tồn tại hoặc đã ngưng sử dụng');

  const imageUrls = await uploadToCloudinary(files, 'tickets');
  const now = new Date();
<<<<<<< HEAD
  const [ackMinutes, responseHours] = await Promise.all([
    getConfig(CONFIG_KEYS.TICKET_ACK_MINUTES),
    getConfig(CONFIG_KEYS.COMPLAINT_RESPONSE_HOURS),
  ]);
  const deadlines = computeDeadlines({
    type,
    slaHours: category.slaHours, // BR-O7
    ackMinutes: Number(ackMinutes),
    responseHours: Number(responseHours),
    now,
  });
=======
>>>>>>> origin/minh

  const ticket = await retryOnDuplicate(async () =>
    Ticket.create({
      code: await nextMonthlyCode(Ticket, 'TK'),
      apartmentId: apartment._id,
      buildingId: apartment.buildingId,
<<<<<<< HEAD
      createdBy: reporterId,
      createdByStaff: staff?.id ?? null,
      type,
      scope: type === COMPLAINT ? TICKET_SCOPES.COMMON_AREA : scope,
=======
      createdBy: user.id,
>>>>>>> origin/minh
      category: category._id,
      title,
      description,
      imageUrls,
      priority: category.defaultPriority,
<<<<<<< HEAD
      ...deadlines,
      status: NEW,
      history: [{ at: now, by: reporterId, action: ACT.CREATED, toStatus: NEW, note: staff ? 'Lễ tân tạo hộ cư dân' : undefined }],
    }),
  );

  const payload = {
    type: NOTIFICATION_TYPES.TICKET,
    title: `${type === COMPLAINT ? 'Phản ánh' : 'Sự cố'} mới ${ticket.code}`,
    content: `Căn ${apartment.code} — ${category.name}: ${title}`,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  };
  await notifyRoles(DISPATCHERS, payload);
  if (type === INCIDENT) {
    await notify(await technicianRecipients(now), { ...payload, title: `Sự cố mới cần nhận ${ticket.code}` });
  }
  return ticket;
}

// ===== UC-E02: Cư dân gửi sự cố / phản ánh kèm ảnh =====
export async function createTicket(user, body, files) {
  const apartment = await resolveResidentApartment(user.id, body.apartmentId);
  return placeTicket({ apartment, reporterId: user.id, body, files });
}

/** Lễ tân tạo hộ cư dân gọi điện / đến quầy (người gửi ghi là Lễ tân, createdByStaff để truy vết) */
export async function createTicketByStaff(staff, body, files) {
  const apartment = await Apartment.findById(body.apartmentId).select('code buildingId').lean();
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
  return placeTicket({ apartment, reporterId: staff.id, staff, body, files });
}

=======
      dueDate: new Date(now.getTime() + category.slaHours * HOUR_MS), // BR-O7
      status: NEW,
      history: [{ at: now, by: user.id, action: 'CREATED', toStatus: NEW }],
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

>>>>>>> origin/minh
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
<<<<<<< HEAD
  if (query.type) filter.type = query.type;
  if (query.scope) filter.scope = query.scope;
=======
>>>>>>> origin/minh
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.apartmentId && user.role !== ROLES.RESIDENT) filter.apartmentId = query.apartmentId;
  if (query.assignedTo && isDispatcher(user)) filter.assignedTo = query.assignedTo;
  if (query.overdue) {
    filter.dueDate = { $lt: new Date() };
<<<<<<< HEAD
    filter.status = { $in: query.status?.filter((s) => TICKET_SLA_STATUSES.includes(s)) ?? TICKET_SLA_STATUSES };
=======
    filter.status = { $in: query.status?.filter((s) => OPEN_STATUSES.includes(s)) ?? OPEN_STATUSES };
>>>>>>> origin/minh
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ code: re }, { title: re }];
  }

<<<<<<< HEAD
  // Sort theo ưu tiên = theo mức độ nghiêm trọng (priorityRank), không theo bảng chữ cái
  const sort = query.sort?.replace(/^(-?)priority$/, '$1priorityRank');
  return paginate(Ticket, filter, { ...query, sort }, { populate: LIST_POPULATE, select: '-history' });
=======
  return paginate(Ticket, filter, query, { populate: LIST_POPULATE, select: '-history' });
>>>>>>> origin/minh
}

export async function getTicket(user, id) {
  const ticket = await Ticket.findById(id).populate(DETAIL_POPULATE).lean();
  if (!ticket) throw ApiError.notFound('Không tìm thấy phản ánh');
  await assertCanView(user, ticket);
<<<<<<< HEAD
  ticket.isOverdue = isOverdueNow(ticket);
=======
  ticket.isOverdue = OPEN_STATUSES.includes(ticket.status) && ticket.dueDate < new Date();
>>>>>>> origin/minh
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
<<<<<<< HEAD
    { $match: { assignedTo: { $in: techs.map((t) => t._id) }, status: { $in: TICKET_OPEN_STATUSES } } },
=======
    { $match: { assignedTo: { $in: techs.map((t) => t._id) }, status: { $in: [ASSIGNED, IN_PROGRESS] } } },
>>>>>>> origin/minh
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const loadMap = Object.fromEntries(load.map((l) => [String(l._id), l.count]));
  return techs.map((t) => ({ ...t, openTickets: loadMap[String(t._id)] ?? 0 }));
}

<<<<<<< HEAD
// ===== Hàng chờ sự cố theo ca (Người 4) =====
const QUEUE_FILTER = { type: INCIDENT, status: NEW, assignedTo: null };

/** Sự cố mới chưa ai nhận, khẩn cấp lên đầu rồi cũ trước; kèm cờ KTV hiện tại có đang trong ca không */
export async function listQueue(user, { now = new Date() } = {}) {
  const [items, duty] = await Promise.all([
    Ticket.find(QUEUE_FILTER)
      .sort({ priorityRank: -1, createdAt: 1 })
      .limit(100)
      .populate(LIST_POPULATE)
      .select('-history')
      .lean(),
    getOnDuty(TECHNICIAN, now),
  ]);
  const onDuty = [...duty.primary, ...duty.backup].some((p) => String(p._id) === user.id);
  return { items: items.map((t) => ({ ...t, isOverdue: isOverdueNow(t, now) })), hasSchedule: duty.hasSchedule, onDuty };
}

/**
 * KTV bấm "Nhận" sự cố trong hàng chờ. Cập nhật có điều kiện (còn NEW, chưa ai nhận) nên 2 người bấm cùng lúc
 * chỉ 1 người nhận được. Đang có lịch trực thì chỉ người trong ca (chính hoặc dự phòng) được nhận.
 */
export async function claimTicket(user, id, { now = new Date() } = {}) {
  const duty = await getOnDuty(TECHNICIAN, now);
  if (duty.hasSchedule && !(await isUserOnDuty(user.id, TECHNICIAN, now))) throw new ApiError('NOT_ON_DUTY');

  const ticket = await Ticket.findOneAndUpdate(
    { _id: id, ...QUEUE_FILTER },
    {
      $set: { status: ASSIGNED, assignedTo: user.id, assignedAt: now },
      $inc: { __v: 1 },
      $push: { history: { at: now, by: user.id, action: ACT.CLAIMED, fromStatus: NEW, toStatus: ASSIGNED } },
    },
    { returnDocument: 'after' },
  );
  if (!ticket) {
    const current = await Ticket.findById(id).select('status assignedTo type').lean();
    if (!current) throw ApiError.notFound('Không tìm thấy sự cố');
    if (current.assignedTo) throw new ApiError('TICKET_ALREADY_CLAIMED');
    assertNotFinal(current);
    throw ApiError.badRequest('Chỉ nhận được sự cố mới trong hàng chờ');
  }

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_CLAIMED,
    user,
    targetType: AUDIT_TARGETS.TICKET,
    targetId: ticket._id,
    metadata: { code: ticket.code },
  });
  await notify(ticket.createdBy, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Sự cố ${ticket.code} đã được tiếp nhận`,
    content: `Kỹ thuật viên đã nhận xử lý "${ticket.title}".`,
    refId: ticket._id,
    link: ticketLink(ticket, true),
  });
  return ticket;
}

/** Kanban điều phối của Trưởng BQL: sự cố đang mở + chờ nghiệm thu, nhóm theo cột trạng thái */
export async function getBoard(_user, { buildingId, now = new Date() } = {}) {
  const items = await Ticket.find({ type: INCIDENT, status: { $in: BOARD_STATUSES }, ...(buildingId && { buildingId }) })
    .sort({ priorityRank: -1, dueDate: 1 })
    .limit(500)
    .populate(LIST_POPULATE)
    .select('-history')
    .lean();
  return { columns: groupBoard(items.map((t) => ({ ...t, isOverdue: isOverdueNow(t, now) }))) };
}

=======
>>>>>>> origin/minh
// ===== UC-E03: Phân công kỹ thuật viên, điều chỉnh ưu tiên =====
export async function assignTicket(user, id, { assignedTo, priority, note }) {
  const ticket = await findTicketOr404(id);
  assertNotFinal(ticket);
  if (ticket.status === WAITING_CONFIRM) {
    throw ApiError.badRequest('Phản ánh đang chờ cư dân xác nhận, không thể phân công lại');
  }
<<<<<<< HEAD
  if (ticket.type === COMPLAINT) {
    throw ApiError.badRequest('Phản ánh do Trưởng BQL xử lý, không giao cho kỹ thuật viên');
  }
=======
>>>>>>> origin/minh

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
<<<<<<< HEAD
  // Giao lại giữa chừng giữ nguyên tiến độ (vd đang chờ linh kiện); chỉ phiếu mới chuyển sang Đã nhận
  ticket.status = fromStatus === NEW ? ASSIGNED : fromStatus;
  ticket.history.push({
    at: now,
    by: user.id,
    action: prevAssignee ? ACT.REASSIGNED : ACT.ASSIGNED,
    fromStatus,
    toStatus: ticket.status,
=======
  ticket.status = ASSIGNED;
  ticket.history.push({
    at: now,
    by: user.id,
    action: prevAssignee ? 'REASSIGNED' : 'ASSIGNED',
    fromStatus,
    toStatus: ASSIGNED,
>>>>>>> origin/minh
    note: [`Giao cho ${tech.fullName}`, priorityChanged && `ưu tiên ${priority}`, note]
      .filter(Boolean)
      .join(' — '),
  });
<<<<<<< HEAD
  // optimisticConcurrency: request đồng thời → VersionError → errorHandler trả 409 CONCURRENT_UPDATE
  await ticket.save();
=======
  await saveChecked(ticket);
>>>>>>> origin/minh

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_ASSIGNED,
    user,
<<<<<<< HEAD
    targetType: AUDIT_TARGETS.TICKET,
=======
    targetType: 'tickets',
>>>>>>> origin/minh
    targetId: ticket._id,
    metadata: { code: ticket.code, assignedTo: tech._id, prevAssignee, priority: ticket.priority },
  });
  await notify(tech._id, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Bạn được giao phản ánh ${ticket.code}`,
<<<<<<< HEAD
    content: `${ticket.title} — hạn xử lý ${fmtDateTimeVn(ticket.dueDate)}`,
=======
    content: `${ticket.title} — hạn xử lý ${ticket.dueDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
>>>>>>> origin/minh
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
<<<<<<< HEAD
  if (ticket.type === COMPLAINT) ticket.respondedAt ??= ticket.closedAt; // đã phản hồi cư dân → dừng SLA phản hồi
  ticket.history.push({ by: user.id, action: ACT.REJECTED, fromStatus, toStatus: REJECTED, note: reason });
  await ticket.save();
=======
  ticket.history.push({ by: user.id, action: 'REJECTED', fromStatus, toStatus: REJECTED, note: reason });
  await saveChecked(ticket);
>>>>>>> origin/minh

  await notify(ticket.createdBy, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phản ánh ${ticket.code} bị từ chối`,
    content: `Lý do: ${reason}`,
    refId: ticket._id,
    link: ticketLink(ticket, true),
  });
  return ticket;
}

<<<<<<< HEAD
// ===== UC-E04: Kỹ thuật viên cập nhật tiến độ (quy tắc chuyển trạng thái ở ticket.rules) =====
const PROGRESS_ACTION = {
  [WAITING_QUOTE_APPROVAL]: ACT.QUOTE_REQUESTED,
  [WAITING_PARTS]: ACT.WAITING_PARTS,
  [WAITING_CONFIRM]: ACT.RESOLVED,
  [IN_PROGRESS]: ACT.PROGRESS,
=======
// ===== UC-E04: Kỹ thuật viên cập nhật tiến độ =====
const PROGRESS_TRANSITIONS = {
  [ASSIGNED]: [IN_PROGRESS, WAITING_CONFIRM],
  [IN_PROGRESS]: [IN_PROGRESS, WAITING_CONFIRM],
>>>>>>> origin/minh
};

export async function updateProgress(user, id, { status, note }, files = []) {
  const ticket = await findTicketOr404(id);
  // Kiểm tra quyền trước khi kiểm tra trạng thái để không lộ trạng thái ticket của người khác
  if (String(ticket.assignedTo) !== user.id) {
    throw ApiError.forbidden('Phản ánh không được giao cho bạn');
  }
  assertNotFinal(ticket);
<<<<<<< HEAD
  const transitionError = progressError(ticket, status);
  if (transitionError) throw ApiError.field('status', transitionError);
  // Gửi báo giá phải qua form báo giá (hạng mục + chi phí) của Người 3: POST /repair-quotes
  if (status === WAITING_QUOTE_APPROVAL) {
    throw ApiError.field('status', 'Gửi báo giá bằng form báo giá sửa chữa (hạng mục và chi phí dự kiến)');
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
<<<<<<< HEAD
    action: PROGRESS_ACTION[status],
=======
    action: status === WAITING_CONFIRM ? 'RESOLVED' : 'PROGRESS',
>>>>>>> origin/minh
    fromStatus,
    toStatus: status,
    note,
    imageUrls,
  });
<<<<<<< HEAD
  await ticket.save();

  if (status === WAITING_QUOTE_APPROVAL) {
    await notifyApartment(ticket.apartmentId, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Sự cố ${ticket.code} cần đồng ý chi phí sửa chữa`,
      content: `Kỹ thuật viên đã gửi báo giá cho "${ticket.title}"${note ? `: ${note}` : ''}. Người nộp phí của căn vui lòng đồng ý hoặc từ chối.`,
      refId: ticket._id,
      link: ticketLink(ticket, true),
    });
  }
=======
  await saveChecked(ticket);

>>>>>>> origin/minh
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
<<<<<<< HEAD
      action: ACT.CONFIRMED,
=======
      action: 'CONFIRMED',
>>>>>>> origin/minh
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
<<<<<<< HEAD
      action: ACT.REOPENED,
=======
      action: 'REOPENED',
>>>>>>> origin/minh
      fromStatus: WAITING_CONFIRM,
      toStatus: IN_PROGRESS,
      note: reason,
    });
  }
<<<<<<< HEAD
  await ticket.save();
=======
  await saveChecked(ticket);
>>>>>>> origin/minh

  if (accepted) {
    await logAudit({
      action: AUDIT_ACTIONS.TICKET_CLOSED,
      user,
<<<<<<< HEAD
      targetType: AUDIT_TARGETS.TICKET,
=======
      targetType: 'tickets',
>>>>>>> origin/minh
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
<<<<<<< HEAD

// ===== Sự cố trong căn hộ: cư dân đồng ý / từ chối báo giá (form báo giá chi tiết do Người 3 làm) =====
/**
 * Chỉ Người nộp phí của căn được quyết định (X1): căn có hợp đồng thì lấy theo getPayer (BR-F7);
 * căn chưa có hợp đồng thì cư dân đang ở căn quyết định. Đồng ý → Đang xử lý; từ chối → phiếu bị từ chối.
 */
export async function decideQuote(user, id, { accepted, note }, { now = new Date() } = {}) {
  const ticket = await findTicketOr404(id);
  const myApartments = await getActiveApartmentIds(user.id);
  if (!myApartments.includes(String(ticket.apartmentId))) throw ApiError.forbidden('Sự cố không thuộc căn hộ của bạn');
  const payer = await getPayer(ticket.apartmentId, now);
  if (payer && String(payer.userId) !== user.id) {
    throw ApiError.forbidden('Chỉ người nộp phí của căn hộ mới được đồng ý hoặc từ chối báo giá');
  }
  assertNotFinal(ticket);
  if (ticket.status !== WAITING_QUOTE_APPROVAL) throw ApiError.badRequest('Sự cố không ở trạng thái chờ đồng ý phí');

  ticket.quoteDecision = { accepted, at: now, by: user.id, note };
  ticket.status = accepted ? IN_PROGRESS : REJECTED;
  if (!accepted) {
    ticket.rejectReason = `Cư dân từ chối báo giá${note ? `: ${note}` : ''}`;
    ticket.closedAt = now;
  }
  ticket.history.push({
    at: now,
    by: user.id,
    action: accepted ? ACT.QUOTE_ACCEPTED : ACT.QUOTE_DECLINED,
    fromStatus: WAITING_QUOTE_APPROVAL,
    toStatus: ticket.status,
    note,
  });
  await ticket.save();
  // Ghi quyết định lên bản báo giá đang chờ (Người 3) — chi phí được tính vào thông báo phí khi nghiệm thu
  await recordQuoteDecision(ticket._id, { accepted, note, userId: user.id, now });

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_QUOTE_DECIDED,
    user,
    targetType: AUDIT_TARGETS.TICKET,
    targetId: ticket._id,
    metadata: { code: ticket.code, accepted },
  });
  await notify(ticket.assignedTo, {
    type: NOTIFICATION_TYPES.TICKET,
    title: accepted ? `Cư dân đã đồng ý báo giá ${ticket.code}` : `Cư dân từ chối báo giá ${ticket.code}`,
    content: accepted ? `Bạn có thể tiến hành xử lý "${ticket.title}".` : ticket.rejectReason,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  });
  return ticket;
}
=======
>>>>>>> origin/minh
