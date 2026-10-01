import { AUDIT_ACTIONS } from '../../constants/enums.js';
import { ComplaintCategory, Ticket } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';

export async function list({ includeInactive }) {
  const filter = includeInactive ? {} : { isActive: true };
  return ComplaintCategory.find(filter).sort({ name: 1 }).lean();
}

export async function create(data, user) {
  const category = await ComplaintCategory.create(data);
  await logAudit({
    action: AUDIT_ACTIONS.COMPLAINT_CATEGORY_CHANGED,
    user,
    targetType: 'complaint_categories',
    targetId: category._id,
    metadata: { op: 'CREATE', after: data },
  });
  return category;
}

export async function update(id, data, user) {
  const category = await ComplaintCategory.findById(id);
  if (!category) throw ApiError.notFound('Không tìm thấy loại phản ánh');
  const before = category.toObject();
  category.set(data);
  await category.save();
  await logAudit({
    action: AUDIT_ACTIONS.COMPLAINT_CATEGORY_CHANGED,
    user,
    targetType: 'complaint_categories',
    targetId: category._id,
    metadata: {
      op: 'UPDATE',
      before: Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])),
      after: data,
    },
  });
  return category;
}

/** Đã có ticket dùng → chỉ ẩn (isActive=false) để giữ lịch sử; chưa dùng → xóa hẳn. */
export async function remove(id, user) {
  const category = await ComplaintCategory.findById(id);
  if (!category) throw ApiError.notFound('Không tìm thấy loại phản ánh');

  const inUse = await Ticket.exists({ category: id });
  if (inUse) {
    category.isActive = false;
    await category.save();
  } else {
    await category.deleteOne();
  }
  await logAudit({
    action: AUDIT_ACTIONS.COMPLAINT_CATEGORY_CHANGED,
    user,
    targetType: 'complaint_categories',
    targetId: category._id,
    metadata: { op: inUse ? 'DEACTIVATE' : 'DELETE', name: category.name },
  });
  return { deleted: !inUse, deactivated: Boolean(inUse) };
}
