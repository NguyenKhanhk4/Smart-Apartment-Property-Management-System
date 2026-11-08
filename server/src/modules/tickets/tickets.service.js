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
  TICKET_SCOPES,
  TICKET_SLA_STATUSES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { Apartment, ComplaintCategory, Ticket, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextMonthlyCode, retryOnDuplicate } from '../../utils/codeGenerator.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { HOUR_MS, fmtDateTimeVn } from '../../utils/time.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { getOnDuty, isUserOnDuty } from '../dutyShifts/dutyShifts.service.js';
import { recordQuoteDecision } from '../repairQuotes/repairQuotes.service.js';
import {
  BOARD_STATUSES,
  applySlaTransition,
  complaintResponseError,
  computeDeadlines,
  groupBoard,
  isOverdue,
  overdueFilter,
  progressError,
  quoteResumeStatus,
} from './ticket.rules.js';

const { NEW, ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS, WAITING_CONFIRM, CLOSED, REJECTED, MERGED } =
  TICKET_STATUS;
const { COMMON_AREA } = TICKET_SCOPES;
const { INCIDENT, COMPLAINT } = TICKET_TYPES;
const TECHNICIAN = ROLE_TITLES.TECHNICIAN;
const DISPATCHERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

/**
 * Quy tắc SLA hoàn thành (dueDate) — một nguồn cho mỗi thời điểm:
 *  - Lúc tạo: theo `slaHours` của loại phản ánh (form tạo hiển thị đúng số giờ này cho cư dân).
 *  - Khi Trưởng BQL / Lễ tân đổi mức ưu tiên: tính lại TỪ LÚC ĐỔI theo tham số SLA_HOURS_<ưu tiên>
 *    (đổi ưu tiên = đánh giá lại mức khẩn cấp, nên hạn chạy lại theo bảng SLA chung).
 * Quá hạn / leo thang chỉ xét TICKET_SLA_STATUSES; SLA tạm dừng khi chờ cư dân đồng ý phí và chờ linh kiện
 * (tối đa TICKET_PARTS_PAUSE_HOURS) — M5-2, quy tắc ở ticket.rules.
 */
export async function partsPauseMs() {
  return Number(await getConfig(CONFIG_KEYS.TICKET_PARTS_PAUSE_HOURS)) * HOUR_MS;
}

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
const isDispatcher = (user) => isRole(user, ...DISPATCHERS);

const ticketLink = (ticket, forResident) =>
  forResident ? `/r/tickets/${ticket._id}` : `/app/tickets/${ticket._id}`;

function assertNotFinal(ticket) {
  if (TICKET_FINAL_STATUSES.includes(ticket.status)) throw new ApiError('TICKET_ALREADY_CLOSED');
  if (ticket.status === MERGED) throw ApiError.badRequest('Phiếu đã được gộp vào phiếu khác, thao tác trên phiếu chính');
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
  // KTV xem được sự cố đang chờ nhận trong hàng chờ (đọc mô tả trước khi bấm Nhận)
  if (isTechnician(user) && ticket.type === INCIDENT && ticket.status === NEW && !ticket.assignedTo) return;
  if (user.role === ROLES.RESIDENT) {
    const ids = await getActiveApartmentIds(user.id);
    if (ids.includes(String(ticket.apartmentId?._id ?? ticket.apartmentId))) return;
  }
  throw ApiError.forbidden('Bạn không có quyền xem phản ánh này');
}

/** Báo người báo phiếu. Lễ tân tạo hộ (createdBy là Lễ tân) → báo các cư dân của căn để cư dân theo dõi được */
const notifyReporter = (ticket, payload) =>
  ticket.createdByStaff ? notifyApartment(ticket.apartmentId, payload) : notify(ticket.createdBy, payload);

/** KTV cần báo khi có sự cố mới: người trực chính đang trong ca (không có thì dự phòng); chưa xếp lịch thì mọi KTV */
async function technicianRecipients(now = new Date()) {
  const duty = await getOnDuty(TECHNICIAN, now);
  if (duty.hasSchedule) return (duty.primary.length ? duty.primary : duty.backup).map((p) => p._id);
  const all = await User.find({ role: ROLES.STAFF, roleTitle: TECHNICIAN, isActive: true }).select('_id').lean();
  return all.map((u) => u._id);
}

/**
 * Lõi tạo phiếu cho cả cư dân tự gửi và Lễ tân tạo hộ. Sự cố → hàng chờ Kỹ thuật (báo KTV đang trực);
 * phản ánh → màn hình xử lý của Trưởng BQL. Phản ánh không phân biệt phạm vi (luôn COMMON_AREA).
 */
async function placeTicket({ apartment, reporterId, staff = null, body, files }) {
  const { categoryId, title, description, type = INCIDENT, scope = TICKET_SCOPES.COMMON_AREA } = body;
  const category = await ComplaintCategory.findOne({ _id: categoryId, isActive: true }).lean();
  if (!category) throw ApiError.badRequest('Loại phản ánh không tồn tại hoặc đã ngưng sử dụng');

  const imageUrls = await uploadToCloudinary(files, 'tickets');
  const now = new Date();
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

  const ticket = await retryOnDuplicate(async () =>
    Ticket.create({
      code: await nextMonthlyCode(Ticket, 'TK'),
      apartmentId: apartment._id,
      buildingId: apartment.buildingId,
      createdBy: reporterId,
      createdByStaff: staff?.id ?? null,
      type,
      scope: type === COMPLAINT ? TICKET_SCOPES.COMMON_AREA : scope,
      category: category._id,
      title,
      description,
      imageUrls,
      priority: category.defaultPriority,
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
  if (query.type) filter.type = query.type;
  if (query.scope) filter.scope = query.scope;
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.apartmentId && user.role !== ROLES.RESIDENT) filter.apartmentId = query.apartmentId;
  if (query.assignedTo && isDispatcher(user)) filter.assignedTo = query.assignedTo;
  const and = [];
  if (query.overdue) {
    delete filter.status;
    const statuses = query.status?.filter((s) => TICKET_SLA_STATUSES.includes(s)) ?? TICKET_SLA_STATUSES;
    and.push(overdueFilter(new Date(), await partsPauseMs(), statuses));
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q), 'i');
    and.push({ $or: [{ code: re }, { title: re }] });
  }
  if (and.length) filter.$and = and;

  // Sort theo ưu tiên = theo mức độ nghiêm trọng (priorityRank), không theo bảng chữ cái
  const sort = query.sort?.replace(/^(-?)priority$/, '$1priorityRank');
  return paginate(Ticket, filter, { ...query, sort }, { populate: LIST_POPULATE, select: '-history' });
}

export async function getTicket(user, id) {
  const ticket = await Ticket.findById(id).populate(DETAIL_POPULATE).lean();
  if (!ticket) throw ApiError.notFound('Không tìm thấy phản ánh');
  await assertCanView(user, ticket);
  ticket.isOverdue = isOverdue(ticket, new Date(), await partsPauseMs());
  // M5-6: phiếu con hiện phiếu chính; phiếu chính hiện các phiếu đã gộp vào (chỉ mã, căn, trạng thái)
  const [parent, children] = await Promise.all([
    ticket.mergedInto ? Ticket.findById(ticket.mergedInto).select('code title status').lean() : null,
    Ticket.find({ mergedInto: ticket._id }).select('code status apartmentId').populate('apartmentId', 'code').lean(),
  ]);
  ticket.mergedParent = parent;
  ticket.mergedChildren = children.map((c) => ({ _id: c._id, code: c.code, status: c.status, apartmentCode: c.apartmentId?.code ?? null }));
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

// ===== Hàng chờ sự cố theo ca =====
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
  const partsMs = await partsPauseMs();
  return { items: items.map((t) => ({ ...t, isOverdue: isOverdue(t, now, partsMs) })), hasSchedule: duty.hasSchedule, onDuty };
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
  await notifyReporter(ticket, {
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
  const partsMs = await partsPauseMs();
  return { columns: groupBoard(items.map((t) => ({ ...t, isOverdue: isOverdue(t, now, partsMs) }))) };
}

// ===== UC-E03: Phân công kỹ thuật viên, điều chỉnh ưu tiên =====
export async function assignTicket(user, id, { assignedTo, priority, note }) {
  const ticket = await findTicketOr404(id);
  assertNotFinal(ticket);
  if (ticket.status === WAITING_CONFIRM) {
    throw ApiError.badRequest('Phản ánh đang chờ cư dân xác nhận, không thể phân công lại');
  }
  if (ticket.type === COMPLAINT) {
    throw ApiError.badRequest('Phản ánh do Trưởng BQL xử lý, không giao cho kỹ thuật viên');
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
    // Hạn mới tính từ lúc đổi → phần đang tạm dừng (nếu có) cũng đếm lại từ lúc này
    if (ticket.slaPausedAt) ticket.slaPausedAt = now;
  }
  ticket.assignedTo = tech._id;
  ticket.assignedBy = user.id;
  ticket.assignedAt = now;
  // Giao lại giữa chừng giữ nguyên tiến độ (vd đang chờ linh kiện); chỉ phiếu mới chuyển sang Đã nhận
  ticket.status = fromStatus === NEW ? ASSIGNED : fromStatus;
  ticket.history.push({
    at: now,
    by: user.id,
    action: prevAssignee ? ACT.REASSIGNED : ACT.ASSIGNED,
    fromStatus,
    toStatus: ticket.status,
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
    await notifyReporter(ticket, {
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
  if (ticket.type === COMPLAINT) ticket.respondedAt ??= ticket.closedAt; // đã phản hồi cư dân → dừng SLA phản hồi
  ticket.history.push({ by: user.id, action: ACT.REJECTED, fromStatus, toStatus: REJECTED, note: reason });
  await ticket.save();
  await closeMergedChildren(ticket, ticket.closedAt);

  await notifyReporter(ticket, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phản ánh ${ticket.code} bị từ chối`,
    content: `Lý do: ${reason}`,
    refId: ticket._id,
    link: ticketLink(ticket, true),
  });
  return ticket;
}

/** UC42: Trưởng BQL phản hồi hoặc nhập kết quả và đóng phản ánh. */
export async function respondComplaint(user, id, { status, note }, files = []) {
  if (!isRole(user, 'MANAGER')) throw ApiError.forbidden('Chỉ Trưởng Ban quản lý được xử lý phản ánh');
  const ticket = await findTicketOr404(id);
  const transitionError = complaintResponseError(ticket, status);
  if (transitionError) throw ApiError.field('status', transitionError);
  const response = typeof note === 'string' ? note.trim() : '';
  if (response.length < 5 || response.length > 2000) {
    throw ApiError.field('note', 'Nhập nội dung phản hồi hoặc kết quả xử lý từ 5 đến 2000 ký tự');
  }
  const imageUrls = files.length ? await uploadToCloudinary(files, 'ticket-results') : undefined;
  const now = new Date();
  const fromStatus = ticket.status;
  ticket.status = status;
  ticket.respondedAt ??= now;
  if (status === CLOSED) {
    ticket.resolvedAt = now;
    ticket.closedAt = now;
  }
  ticket.history.push({ at: now, by: user.id, action: status === CLOSED ? ACT.RESOLVED : ACT.PROGRESS,
    fromStatus, toStatus: status, note: response, imageUrls });
  await ticket.save();
  await logAudit({ action: AUDIT_ACTIONS.TICKET_COMPLAINT_RESPONDED, user,
    targetType: AUDIT_TARGETS.TICKET, targetId: ticket._id, metadata: { fromStatus, status } });
  await notifyApartment(ticket.apartmentId, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phản ánh ${ticket.code} ${status === CLOSED ? 'đã được xử lý' : 'có phản hồi'}`,
    content: response, refId: ticket._id, link: ticketLink(ticket, true),
  });
  return ticket;
}

// ===== UC-E04: Kỹ thuật viên cập nhật tiến độ (quy tắc chuyển trạng thái ở ticket.rules) =====
const PROGRESS_ACTION = {
  [WAITING_QUOTE_APPROVAL]: ACT.QUOTE_REQUESTED,
  [WAITING_PARTS]: ACT.WAITING_PARTS,
  [WAITING_CONFIRM]: ACT.RESOLVED,
  [IN_PROGRESS]: ACT.PROGRESS,
};

export async function updateProgress(user, id, { status, note }, files = []) {
  const ticket = await findTicketOr404(id);
  // Kiểm tra quyền trước khi kiểm tra trạng thái để không lộ trạng thái ticket của người khác
  if (String(ticket.assignedTo) !== user.id) {
    throw ApiError.forbidden('Phản ánh không được giao cho bạn');
  }
  assertNotFinal(ticket);
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

  const now = new Date();
  const fromStatus = ticket.status;
  applySlaTransition(ticket, status, now, await partsPauseMs());
  ticket.status = status;
  if (status === WAITING_CONFIRM) {
    ticket.resolvedAt = now;
    ticket.confirmRemindedAt = null;
  }
  ticket.history.push({
    at: now,
    by: user.id,
    action: PROGRESS_ACTION[status],
    fromStatus,
    toStatus: status,
    note,
    imageUrls,
  });
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
  // Phản ánh đã được BQL đóng: đánh giá sau xử lý không mở lại hoặc thay đổi ngày đóng.
  if (ticket.type === COMPLAINT && ticket.status === CLOSED) {
    if (ticket.rating != null) throw ApiError.badRequest('Phản ánh đã được đánh giá');
    if (!accepted || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw ApiError.badRequest('Phản ánh đã xử lý chỉ nhận đánh giá từ 1 đến 5 sao');
    }
    ticket.rating = rating;
    ticket.ratingComment = comment;
    ticket.history.push({ by: user.id, action: ACT.CONFIRMED, fromStatus: CLOSED, toStatus: CLOSED,
      note: `Đánh giá ${rating}★${comment ? ` — ${comment}` : ''}` });
    await ticket.save();
    await notifyRoles(['MANAGER'], { type: NOTIFICATION_TYPES.TICKET,
      title: `Phản ánh ${ticket.code} được đánh giá ${rating}★`, content: comment || 'Cư dân đã đánh giá kết quả xử lý.',
      refId: ticket._id, link: ticketLink(ticket, false) });
    return ticket;
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
    await closeMergedChildren(ticket, now);
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

// ===== Sự cố trong căn hộ: cư dân đồng ý / từ chối báo giá (form báo giá chi tiết do Người 3 làm) =====
/**
 * Chỉ Người nộp phí của căn được quyết định (X1): căn có hợp đồng thì lấy theo getPayer (BR-F7);
 * căn chưa có hợp đồng thì cư dân đang ở căn quyết định. Đồng ý → Đang xử lý; từ chối → phiếu bị từ chối.
 * Bản báo giá lại (đã đồng ý bản trước, M5-3): đồng ý / từ chối đều quay về trạng thái trước khi báo giá lại;
 * từ chối thì giữ báo giá đã đồng ý.
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

  // M5-3: đã đồng ý một báo giá trước đó → đây là bản báo giá lại vượt ngưỡng %. Từ chối thì KTV làm tiếp theo
  // báo giá đã đồng ý (phiếu quay về trạng thái trước), không đóng phiếu đang sửa dở.
  const revision = ticket.quoteDecision?.accepted === true;
  const to = revision ? quoteResumeStatus(ticket) : accepted ? IN_PROGRESS : REJECTED;
  applySlaTransition(ticket, to, now, await partsPauseMs());
  if (accepted || !revision) ticket.quoteDecision = { accepted, at: now, by: user.id, note };
  ticket.status = to;
  if (to === REJECTED) {
    ticket.rejectReason = `Cư dân từ chối báo giá${note ? `: ${note}` : ''}`;
    ticket.closedAt = now;
  }
  ticket.history.push({
    at: now,
    by: user.id,
    action: accepted ? ACT.QUOTE_ACCEPTED : ACT.QUOTE_DECLINED,
    fromStatus: WAITING_QUOTE_APPROVAL,
    toStatus: ticket.status,
    note: !accepted && revision ? ['Không đồng ý chi phí phát sinh — tiếp tục theo báo giá đã đồng ý', note].filter(Boolean).join(': ') : note,
  });
  await ticket.save();
  // Ghi quyết định lên bản báo giá đang chờ — chi phí được tính vào thông báo phí khi nghiệm thu
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
    content: accepted
      ? `Bạn có thể tiến hành xử lý "${ticket.title}".`
      : revision
        ? `Người nộp phí không đồng ý chi phí phát sinh${note ? ` (${note})` : ''}. Tiếp tục xử lý "${ticket.title}" trong phạm vi báo giá đã đồng ý.`
        : ticket.rejectReason,
    refId: ticket._id,
    link: ticketLink(ticket, false),
  });
  return ticket;
}

// ===== M5-5: đổi loại / phạm vi phiếu =====
const RECLASSIFIABLE = [NEW, ASSIGNED];
const TYPE_LABEL = { [INCIDENT]: 'Sự cố kỹ thuật', [COMPLAINT]: 'Phản ánh' };
const SCOPE_LABEL = { [COMMON_AREA]: 'Khu vực chung', [TICKET_SCOPES.IN_APARTMENT]: 'Trong căn hộ' };

/**
 * Trưởng BQL / Lễ tân, hoặc KTV được giao (sau khảo sát) đổi loại / phạm vi phiếu chưa bắt đầu xử lý, bắt buộc lý do.
 * Hạn SLA tính lại từ lúc đổi theo loại mới. Đổi sang Phản ánh → bỏ KTV, chuyển bàn xử lý của Trưởng BQL;
 * đổi sang Sự cố → về hàng chờ Kỹ thuật. Chỉ đổi phạm vi thì giữ nguyên trạng thái và người nhận.
 */
export async function reclassifyTicket(user, id, { type, scope, reason }, { now = new Date() } = {}) {
  const ticket = await findTicketOr404(id);
  const prevTech = ticket.assignedTo ? String(ticket.assignedTo) : null;
  if (!isDispatcher(user) && !(isTechnician(user) && prevTech === user.id)) {
    throw ApiError.forbidden('Chỉ Trưởng BQL, Lễ tân hoặc kỹ thuật viên được giao mới đổi phân loại phiếu');
  }
  assertNotFinal(ticket);
  if (!RECLASSIFIABLE.includes(ticket.status)) throw ApiError.badRequest('Chỉ đổi phân loại được phiếu chưa bắt đầu xử lý (Mới / Đã nhận)');

  const nextType = type ?? ticket.type;
  const nextScope = nextType === COMPLAINT ? COMMON_AREA : (scope ?? ticket.scope);
  if (nextType === ticket.type && nextScope === ticket.scope) throw ApiError.badRequest('Loại và phạm vi phiếu không thay đổi');
  const typeChanged = nextType !== ticket.type;

  const [category, ackMinutes, responseHours] = await Promise.all([
    ComplaintCategory.findById(ticket.category).select('slaHours').lean(),
    getConfig(CONFIG_KEYS.TICKET_ACK_MINUTES),
    getConfig(CONFIG_KEYS.COMPLAINT_RESPONSE_HOURS),
  ]);
  const deadlines = computeDeadlines({
    type: nextType,
    slaHours: category?.slaHours ?? (await slaHoursOf(ticket.priority)),
    ackMinutes: Number(ackMinutes),
    responseHours: Number(responseHours),
    now,
  });

  const from = `${TYPE_LABEL[ticket.type]} / ${SCOPE_LABEL[ticket.scope]}`;
  const to = `${TYPE_LABEL[nextType]} / ${SCOPE_LABEL[nextScope]}`;
  const fromStatus = ticket.status;
  ticket.set({ type: nextType, scope: nextScope, ...deadlines, ackAlertedAt: null, responseAlertedAt: null, respondedAt: null });
  if (typeChanged) {
    ticket.set({ status: NEW, assignedTo: null, assignedBy: null, assignedAt: null });
  }
  ticket.history.push({ at: now, by: user.id, action: ACT.RECLASSIFIED, fromStatus, toStatus: ticket.status, note: `${from} → ${to}. Lý do: ${reason}` });
  await ticket.save();

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_RECLASSIFIED,
    user,
    targetType: AUDIT_TARGETS.TICKET,
    targetId: ticket._id,
    metadata: { code: ticket.code, from, to, reason },
  });
  await notifyReporter(ticket, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Phiếu ${ticket.code} được đổi phân loại`,
    content: `${from} → ${to}. Lý do: ${reason}`,
    refId: ticket._id,
    link: ticketLink(ticket, true),
  });
  if (typeChanged) {
    const payload = { type: NOTIFICATION_TYPES.TICKET, title: `Phiếu ${ticket.code} chuyển thành ${TYPE_LABEL[nextType]}`, content: ticket.title, refId: ticket._id, link: ticketLink(ticket, false) };
    if (nextType === COMPLAINT) await notifyRoles(['MANAGER'], payload);
    else await notify(await technicianRecipients(now), { ...payload, title: `Sự cố mới cần nhận ${ticket.code}` });
    if (prevTech && prevTech !== user.id) await notify(prevTech, { ...payload, title: `Phiếu ${ticket.code} không còn giao cho bạn` });
  }
  return ticket;
}

// ===== M5-6: phiếu trùng =====
const OPEN_OR_RESOLVED = [...TICKET_OPEN_STATUSES, WAITING_CONFIRM];

/**
 * Sự cố khu vực chung đang mở cùng tòa, cùng loại sự cố — gợi ý khi tạo phiếu để cư dân / Lễ tân không báo trùng,
 * và để Trưởng BQL chọn phiếu chính khi gộp. Chỉ trả mã, tiêu đề, trạng thái (không lộ căn / người báo).
 */
export async function findSimilarTickets(user, { apartmentId, categoryId, excludeId }) {
  const apartment =
    user.role === ROLES.RESIDENT
      ? await resolveResidentApartment(user.id, apartmentId)
      : await Apartment.findById(apartmentId).select('buildingId').lean();
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
  return Ticket.find({
    type: INCIDENT,
    scope: COMMON_AREA,
    category: categoryId,
    buildingId: apartment.buildingId ?? null,
    status: { $in: OPEN_OR_RESOLVED },
    ...(excludeId && { _id: { $ne: excludeId } }),
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('code title status createdAt')
    .lean();
}

/**
 * Trưởng BQL / Lễ tân gộp phiếu trùng `id` vào phiếu chính `parentId`: cả hai là sự cố khu vực chung cùng tòa;
 * phiếu con chưa bắt đầu xử lý → MERGED, bỏ người nhận; phiếu chính còn đang xử lý. Phiếu con đóng theo phiếu chính.
 */
export async function mergeTicket(user, id, { parentId, note }, { now = new Date() } = {}) {
  if (String(id) === String(parentId)) throw ApiError.badRequest('Không gộp phiếu vào chính nó');
  const [child, parent] = await Promise.all([findTicketOr404(id), findTicketOr404(parentId)]);
  assertNotFinal(child);
  assertNotFinal(parent);
  const commonIncident = (t) => t.type === INCIDENT && t.scope === COMMON_AREA;
  if (!commonIncident(child) || !commonIncident(parent)) throw ApiError.badRequest('Chỉ gộp sự cố kỹ thuật ở khu vực chung');
  if (String(child.buildingId ?? '') !== String(parent.buildingId ?? '')) throw ApiError.badRequest('Hai phiếu phải cùng tòa nhà');
  if (!RECLASSIFIABLE.includes(child.status)) throw ApiError.badRequest('Chỉ gộp được phiếu chưa bắt đầu xử lý (Mới / Đã nhận)');
  if (!OPEN_OR_RESOLVED.includes(parent.status)) throw ApiError.badRequest('Phiếu chính đã đóng');

  const prevTech = child.assignedTo ? String(child.assignedTo) : null;
  const fromStatus = child.status;
  child.set({ status: MERGED, mergedInto: parent._id, assignedTo: null, assignedBy: null, assignedAt: null });
  child.history.push({ at: now, by: user.id, action: ACT.MERGED, fromStatus, toStatus: MERGED, note: [`Gộp vào phiếu ${parent.code}`, note].filter(Boolean).join(' — ') });
  parent.history.push({ at: now, by: user.id, action: ACT.MERGED, fromStatus: parent.status, toStatus: parent.status, note: `Gộp phiếu trùng ${child.code}` });
  await child.save();
  await parent.save();

  await logAudit({
    action: AUDIT_ACTIONS.TICKET_MERGED,
    user,
    targetType: AUDIT_TARGETS.TICKET,
    targetId: child._id,
    metadata: { code: child.code, parent: parent.code, note },
  });
  await notifyReporter(child, {
    type: NOTIFICATION_TYPES.TICKET,
    title: `Sự cố ${child.code} đã được gộp`,
    content: `Sự cố bạn báo trùng với "${parent.title}" (${parent.code}) đang được xử lý. Bạn sẽ được báo khi xử lý xong.`,
    refId: child._id,
    link: ticketLink(child, true),
  });
  if (prevTech) {
    await notify(prevTech, { type: NOTIFICATION_TYPES.TICKET, title: `Phiếu ${child.code} đã gộp vào ${parent.code}`, content: child.title, refId: parent._id, link: ticketLink(parent, false) });
  }
  return child;
}

/** Phiếu chính đóng (Đã nghiệm thu / Từ chối) → các phiếu đã gộp đóng theo cùng trạng thái, báo người báo phiếu */
export async function closeMergedChildren(parent, now = new Date()) {
  const children = await Ticket.find({ mergedInto: parent._id, status: MERGED }).select('code title apartmentId createdBy createdByStaff').lean();
  const text = parent.status === CLOSED ? 'đã xử lý xong' : 'đã bị từ chối';
  for (const child of children) {
    const res = await Ticket.updateOne(
      { _id: child._id, status: MERGED },
      {
        $set: { status: parent.status, closedAt: now, ...(parent.status === REJECTED && { rejectReason: `Đóng theo phiếu ${parent.code}` }) },
        $inc: { __v: 1 },
        $push: { history: { at: now, by: null, action: parent.status === CLOSED ? ACT.AUTO_CLOSED : ACT.REJECTED, fromStatus: MERGED, toStatus: parent.status, note: `Đóng theo phiếu chính ${parent.code}` } },
      },
    );
    if (!res.modifiedCount) continue;
    await notifyReporter(child, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Sự cố ${child.code} ${text}`,
      content: `Đóng theo phiếu chính ${parent.code} — "${parent.title}".`,
      refId: child._id,
      link: ticketLink(child, true),
    });
  }
  return children.length;
}
