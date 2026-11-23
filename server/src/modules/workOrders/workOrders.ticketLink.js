// Nối phản ánh của cư dân sang phiếu bảo trì (TICKET_LINKED).
// Trưởng BQL thấy phản ánh liên quan thiết bị → tạo phiếu bảo trì từ phản ánh; phiếu đi tiếp luồng bảo trì
// (phân công → kiểm tra → báo hư hỏng → quyết định nguồn chi → nghiệm thu). Phiếu xong / đóng thì ghi ngược về phản ánh;
// Trưởng BQL vẫn là người phản hồi và đóng phản ánh (UC42).
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, TICKET_HISTORY_ACTIONS, TICKET_SCOPES, TICKET_STATUS, TICKET_TYPES, WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { Asset, Ticket, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { assignWorkOrder } from './workOrders.service.js';

const OPEN_TICKET_STATUSES = [TICKET_STATUS.NEW, TICKET_STATUS.ASSIGNED, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING_PARTS];
const ENDED = [WORK_ORDER_STATUS.DONE, WORK_ORDER_STATUS.CLOSED];

const notifyReporter = (ticket, payload) => (
  ticket.createdByStaff ? notifyApartment(ticket.apartmentId, payload) : notify(ticket.createdBy, payload)
);

/**
 * Trưởng BQL, hoặc KTV đang được giao phiếu (kiểm tra xong thấy thiết bị hỏng), tạo phiếu bảo trì từ phản ánh / sự cố khu vực chung đang mở.
 * Phản ánh: Mới → Đang xử lý (tính là đã phản hồi; đã có KTV thì giữ trạng thái), gắn thiết bị, ghi lịch sử. Mỗi phản ánh chỉ có 1 phiếu bảo trì đang mở.
 * Có assignedTo thì phân công luôn; không thì phiếu hiện ở Checklist ca cho mọi KTV (như phiếu định kỳ chưa ai nhận).
 */
export async function createFromTicket(user, ticketId, { assetId, assignedTo = null, note = '' }, now = new Date()) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Không tìm thấy phản ánh');
  // Thiết bị bảo trì là thiết bị dùng chung của tòa nhà: chỉ phản ánh / sự cố ở khu vực chung. Sự cố trong căn hộ đi luồng báo giá riêng
  if (ticket.type !== TICKET_TYPES.COMPLAINT && ticket.scope !== TICKET_SCOPES.COMMON_AREA) {
    throw ApiError.badRequest('Sự cố trong căn hộ không tạo phiếu bảo trì thiết bị; chỉ phản ánh hoặc sự cố ở khu vực chung');
  }
  if (!OPEN_TICKET_STATUSES.includes(ticket.status)) {
    throw ApiError.badRequest('Phản ánh đã đóng hoặc bị từ chối, không tạo được phiếu bảo trì');
  }
  if (!isRole(user, 'MANAGER') && String(ticket.assignedTo) !== String(user.id)) {
    throw ApiError.forbidden('Chỉ Trưởng BQL hoặc kỹ thuật viên đang xử lý phản ánh này mới tạo phiếu bảo trì');
  }
  const asset = await Asset.findOne({ _id: assetId, isActive: true }).lean();
  if (!asset) throw ApiError.field('assetId', 'Thiết bị không tồn tại hoặc đã ngừng sử dụng');
  const open = await WorkOrder.findOne({ ticketId: ticket._id, status: { $nin: ENDED } }).select('_id').lean();
  if (open) throw ApiError.badRequest('Phản ánh này đã có phiếu bảo trì đang xử lý');

  const text = typeof note === 'string' ? note.trim() : '';
  const wo = await WorkOrder.create({
    assetId: asset._id,
    ticketId: ticket._id,
    type: WORK_ORDER_TYPES.TICKET_LINKED,
    status: WORK_ORDER_STATUS.PENDING,
    title: `Kiểm tra ${asset.name} theo phản ánh ${ticket.code}`,
    scheduledDate: now,
    checklist: asset.checklist ?? [],
    note: [ticket.title, text].filter(Boolean).join(' — '),
  });

  const fromStatus = ticket.status;
  if (fromStatus === TICKET_STATUS.NEW) ticket.status = TICKET_STATUS.IN_PROGRESS;
  ticket.respondedAt ??= now;
  ticket.linkedAssetId = asset._id;
  ticket.history.push({
    at: now,
    by: user.id,
    action: TICKET_HISTORY_ACTIONS.MAINTENANCE_LINKED,
    fromStatus,
    toStatus: ticket.status,
    note: `Đã tạo phiếu bảo trì cho ${asset.code} – ${asset.name}${text ? `. ${text}` : ''}`,
  });
  await ticket.save();

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_CREATED_FROM_TICKET,
    user,
    targetType: AUDIT_TARGETS.WORK_ORDER,
    targetId: wo._id,
    after: { ticketId: ticket._id, assetId: asset._id },
    metadata: { ticket: ticket.code, asset: asset.code },
  });
  // Lỗi thông báo / phân công không làm mất phiếu đã tạo
  try {
    await notifyReporter(ticket, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Phản ánh ${ticket.code} đang được kiểm tra`,
      content: `Ban quản lý đã chuyển kỹ thuật kiểm tra thiết bị liên quan đến "${ticket.title}".`,
      refId: ticket._id,
      link: `/r/tickets/${ticket._id}`,
    });
    // KTV tự tạo thì nhận luôn phiếu (đã đang xử lý phản ánh này)
    const owner = isRole(user, 'MANAGER') ? assignedTo : user.id;
    if (owner) await assignWorkOrder(user, wo._id, { assignedTo: owner, note: `Theo phản ánh ${ticket.code}` });
  } catch (err) {
    console.error('[ticketLink] Lỗi thông báo / phân công sau khi tạo phiếu:', err);
  }
  return WorkOrder.findById(wo._id).lean();
}

/**
 * Phiếu bảo trì theo phản ánh Hoàn thành / Đóng → ghi vào lịch sử phản ánh, báo Trưởng BQL (để phản hồi và đóng phản ánh) và cư dân.
 * Không bao giờ ném lỗi: bước chính của phiếu đã lưu xong rồi.
 */
export async function syncTicketOnEnd(wo, now = new Date()) {
  try {
    if (!wo?.ticketId) return;
    const ticket = await Ticket.findById(wo.ticketId).select('code title type status assignedTo createdBy createdByStaff apartmentId').lean();
    if (!ticket) return;
    const retired = wo.status === WORK_ORDER_STATUS.CLOSED;
    const note = retired
      ? 'Phiếu bảo trì đã đóng: thiết bị ngừng sử dụng'
      : 'Phiếu bảo trì đã hoàn thành, thiết bị đã được kiểm tra / sửa chữa';
    await Ticket.updateOne(
      { _id: ticket._id },
      { $push: { history: { at: now, by: null, action: TICKET_HISTORY_ACTIONS.MAINTENANCE_DONE, fromStatus: ticket.status, toStatus: ticket.status, note } } },
    );
    if (!OPEN_TICKET_STATUSES.includes(ticket.status)) return;
    // Phản ánh: Trưởng BQL phản hồi và đóng. Sự cố: KTV đang xử lý báo kết quả để cư dân nghiệm thu
    const complaint = ticket.type === TICKET_TYPES.COMPLAINT;
    const label = complaint ? 'Phản ánh' : 'Sự cố';
    const next = complaint
      ? `Vui lòng phản hồi kết quả cho cư dân và đóng phản ánh "${ticket.title}".`
      : `Vui lòng báo kết quả xử lý (kèm ảnh) cho sự cố "${ticket.title}" để cư dân nghiệm thu.`;
    const payload = {
      type: NOTIFICATION_TYPES.TICKET,
      title: `${label} ${ticket.code}: kỹ thuật đã xử lý xong`,
      content: `${note}. ${next}`,
      refId: ticket._id,
      link: `/app/tickets/${ticket._id}`,
    };
    if (complaint || !ticket.assignedTo) await notifyRoles(['MANAGER'], payload);
    else await notify(ticket.assignedTo, payload);
    await notifyReporter(ticket, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `${label} ${ticket.code} đã được kỹ thuật xử lý`,
      content: complaint ? 'Ban quản lý sẽ phản hồi kết quả cuối cùng cho bạn.' : 'Kỹ thuật viên sẽ báo kết quả để bạn nghiệm thu.',
      refId: ticket._id,
      link: `/r/tickets/${ticket._id}`,
    });
  } catch (err) {
    console.error('[ticketLink] Lỗi ghi ngược về phản ánh:', err);
  }
}
