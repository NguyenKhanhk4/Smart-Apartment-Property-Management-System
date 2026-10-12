import {
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  ROLES,
  ROLE_TITLES,
  WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Asset, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { DAY_MS, startOfVnDay } from '../../utils/time.js';
import { computeNextMaintenance } from '../assets/assets.service.js';

export const OPEN_WO_STATUSES = [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PROGRESS];

const TECHNICIAN = { role: ROLES.STAFF, roleTitle: ROLE_TITLES.TECHNICIAN, isActive: true };
const ASSET_POPULATE = {
  path: 'assetId',
  select: 'name category location buildingId',
  populate: { path: 'buildingId', select: 'code name' },
};

/** Quá hạn = chưa DONE và đã qua hết ngày lên lịch (scheduledDate + 1 ngày < hiện tại) — UC-D03 */
export const isOverdue = (wo, now = new Date()) =>
  wo.status !== WORK_ORDER_STATUS.DONE &&
  Boolean(wo.scheduledDate) &&
  new Date(wo.scheduledDate).getTime() + DAY_MS < now.getTime();

const withOverdue = (wo, now) => ({ ...wo, isOverdue: isOverdue(wo, now) });

const dateVn = (date) =>
  date ? new Date(date).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

/** Manager thấy tất cả; KTV chỉ thấy work order được giao cho mình */
const isTechnician = (user) => user.role === ROLES.STAFF && user.roleTitle === ROLE_TITLES.TECHNICIAN;

// ===== UC-D03 bước 1: danh sách work order =====
export async function listWorkOrders(user, query) {
  const now = new Date();
  const filter = {};
  if (query.status) filter.status = { $in: query.status };
  if (query.type) filter.type = query.type;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.unassigned) filter.assignedTo = null;
  if (query.overdue) {
    // Chỉ work order chưa DONE; lọc thêm status=DONE thì kết quả rỗng là đúng
    filter.status = { $in: (query.status ?? OPEN_WO_STATUSES).filter((s) => s !== WORK_ORDER_STATUS.DONE) };
    filter.scheduledDate = { $lt: new Date(now.getTime() - DAY_MS) };
  }
  if (query.buildingId || query.q) {
    const assetFilter = {};
    if (query.buildingId) assetFilter.buildingId = query.buildingId;
    if (query.q) assetFilter.name = new RegExp(escapeRegex(query.q), 'i');
    filter.assetId = { $in: await Asset.find(assetFilter).distinct('_id') };
  }
  if (isTechnician(user)) filter.assignedTo = user.id;

  const result = await paginate(WorkOrder, filter, query, {
    populate: [ASSET_POPULATE, { path: 'assignedTo', select: 'fullName phone' }],
  });
  result.items = result.items.map((wo) => withOverdue(wo, now));
  return result;
}

// ===== Chi tiết work order (KTV chỉ xem được việc của mình) =====
export async function getWorkOrder(user, id) {
  const wo = await WorkOrder.findById(id)
    .populate(ASSET_POPULATE)
    .populate('assignedTo', 'fullName phone')
    .populate('assignedBy', 'fullName')
    .lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy work order');
  if (isTechnician(user) && String(wo.assignedTo?._id) !== String(user.id)) throw ApiError.forbidden();
  return withOverdue(wo, new Date());
}

// ===== UC-D03 bước 2: KTV đang hoạt động + số work order đang mở của từng người =====
export async function listAssignees() {
  const techs = await User.find(TECHNICIAN).select('fullName phone').sort({ fullName: 1 }).lean();
  const load = await WorkOrder.aggregate([
    { $match: { assignedTo: { $in: techs.map((t) => t._id) }, status: { $in: OPEN_WO_STATUSES } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const loadMap = Object.fromEntries(load.map((l) => [String(l._id), l.count]));
  return techs.map((t) => ({ ...t, openWorkOrders: loadMap[String(t._id)] ?? 0 }));
}

// ===== UC-D03: phân công / giao lại (BR-O20) =====
// Trạng thái work order GIỮ NGUYÊN (PENDING hoặc IN_PROGRESS) — KTV tự bấm "Bắt đầu" ở bước sau.
// Cập nhật có điều kiện (còn mở + người được giao vẫn như lúc đọc): 2 Manager cùng giao, hoặc KTV vừa
// hoàn thành work order → bên đến sau nhận CONCURRENT_UPDATE thay vì ghi đè.
export async function assignWorkOrder(user, id, { assignedTo, note }) {
  const wo = await WorkOrder.findById(id).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy work order');
  if (wo.status === WORK_ORDER_STATUS.DONE) throw new ApiError('WORKORDER_INVALID_STATUS');

  const tech = await User.findOne({ _id: assignedTo, ...TECHNICIAN }).select('fullName').lean();
  if (!tech) throw new ApiError('WORKORDER_INVALID_ASSIGNEE');

  const from = wo.assignedTo ? String(wo.assignedTo) : null;
  if (from === String(tech._id)) return { workOrder: await getWorkOrder(user, id), changed: false };

  const now = new Date();
  const updated = await WorkOrder.findOneAndUpdate(
    { _id: id, status: { $in: OPEN_WO_STATUSES }, assignedTo: wo.assignedTo ?? null },
    { $set: { assignedTo: tech._id, assignedBy: user.id, assignedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new ApiError('CONCURRENT_UPDATE');

  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_ASSIGNED,
    user,
    targetType: 'work_orders',
    targetId: updated._id,
    metadata: { from, to: String(tech._id), note: note || null, assetId: updated.assetId },
  });

  const noteText = note ? ` Ghi chú: ${note}` : '';
  const link = '/app/my-work-orders';
  await notify(tech._id, {
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: 'Bạn được giao một work order bảo trì',
    content: `${updated.title} — ngày lên lịch ${dateVn(updated.scheduledDate)}.${noteText}`,
    refId: updated._id,
    link,
  });
  if (from) {
    await notify(from, {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Work order đã được giao lại',
      content: `${updated.title} đã được giao cho ${tech.fullName}, bạn không còn phụ trách việc này.`,
      refId: updated._id,
      link,
    });
  }
  return { workOrder: await getWorkOrder(user, id), changed: true };
}

/** Câu báo lỗi WORKORDER_INVALID_STATUS theo đúng tình huống (BR-O21) */
function invalidStatus(current, target) {
  let message = 'Trạng thái work order không cho phép thao tác này';
  if (current === WORK_ORDER_STATUS.DONE) message = 'Work order đã hoàn thành, không thể cập nhật';
  else if (target === WORK_ORDER_STATUS.DONE) message = 'Cần bấm "Bắt đầu" trước khi hoàn thành work order';
  else if (current === WORK_ORDER_STATUS.IN_PROGRESS) message = 'Work order đã được bắt đầu';
  return new ApiError('WORKORDER_INVALID_STATUS', message);
}

// ===== UC-D04: KTV bắt đầu / hoàn thành work order =====
// Chỉ đi tiến PENDING → IN_PROGRESS → DONE (BR-O21). Mọi bước ghi đều có điều kiện (status cũ + assignedTo = KTV)
// nên 2 request trùng nhau, hoặc Manager giao lại giữa chừng, không ghi đè nhau.
export async function updateWorkOrderStatus(user, id, { status, note }, files = []) {
  const wo = await WorkOrder.findById(id).select('assignedTo status').lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy work order');
  if (String(wo.assignedTo) !== String(user.id)) throw ApiError.forbidden();

  const from = status === WORK_ORDER_STATUS.DONE ? WORK_ORDER_STATUS.IN_PROGRESS : WORK_ORDER_STATUS.PENDING;
  if (wo.status !== from) throw invalidStatus(wo.status, status);
  // Hoàn thành phải có ảnh bằng chứng để Manager kiểm tra
  if (status === WORK_ORDER_STATUS.DONE && !files.length) {
    throw ApiError.badRequest('Cần chụp hoặc đính kèm ít nhất 1 ảnh kết quả bảo trì', [
      { field: 'images', message: 'Bắt buộc có ít nhất 1 ảnh' },
    ]);
  }

  const now = new Date();
  const condition = { _id: id, status: from, assignedTo: user.id };
  // Điều kiện không khớp lúc ghi → đọc lại để báo đúng nguyên nhân
  const failUpdate = async () => {
    const latest = await WorkOrder.findById(id).select('assignedTo status').lean();
    return String(latest?.assignedTo) === String(user.id)
      ? invalidStatus(latest?.status, status)
      : ApiError.forbidden();
  };

  if (status === WORK_ORDER_STATUS.IN_PROGRESS) {
    const res = await WorkOrder.updateOne(condition, { $set: { status, startedAt: now } });
    if (!res.modifiedCount) throw await failUpdate();
    return getWorkOrder(user, id);
  }

  // Upload ảnh trước (gọi dịch vụ ngoài, không đặt trong transaction). Nếu ghi DB không thành công thì ảnh bị bỏ rơi
  // trên Cloudinary — chấp nhận được, không ảnh hưởng dữ liệu.
  const completionImages = await uploadToCloudinary(files, 'work-orders');

  // DONE: work order + lịch bảo trì của tài sản phải đổi cùng nhau (hoặc cùng không đổi)
  const result = await withTransaction(async (session) => {
    const done = await WorkOrder.findOneAndUpdate(
      condition,
      { $set: { status, completedAt: now, note: note.trim(), completionImages } },
      { returnDocument: 'after', session },
    ).lean();
    if (!done) throw await failUpdate();

    const asset = await Asset.findById(done.assetId).session(session);
    if (!asset) return { title: done.title, nextDate: null };
    asset.lastMaintenanceDate = startOfVnDay(now);
    asset.nextMaintenanceDate = computeNextMaintenance(asset.lastMaintenanceDate, asset.maintenanceCycleDays);
    await asset.save({ session });
    return { title: done.title, nextDate: asset.nextMaintenanceDate };
  });

  // Thông báo gửi SAU khi transaction đã commit; lỗi gửi không làm hỏng việc đã hoàn thành
  try {
    const tech = await User.findById(user.id).select('fullName').lean();
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Work order bảo trì đã hoàn thành',
      content: `${tech?.fullName ?? 'Kỹ thuật viên'} đã hoàn thành "${result.title}".${
        result.nextDate ? ` Ngày bảo trì tiếp theo: ${dateVn(result.nextDate)}.` : ''
      }`,
      refId: id,
      link: '/app/work-orders',
    });
  } catch (err) {
    console.error('[UC-D04] Lỗi gửi thông báo cho Trưởng BQL:', err);
  }
  return getWorkOrder(user, id);
}
