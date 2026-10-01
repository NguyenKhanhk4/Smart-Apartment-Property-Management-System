import {
  ANNOUNCEMENT_SCOPES,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  ROLES,
} from '../../constants/enums.js';
import { Announcement, Apartment, Building, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { findResidentUserIds, notify } from '../../services/notification.service.js';
import { getActiveApartmentIds } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, getPagination } from '../../utils/pagination.js';

const POPULATE = [{ path: 'createdBy', select: 'fullName role roleTitle' }];

/** Người nhận theo phạm vi: ALL = mọi tài khoản đang hoạt động; BUILDING/APARTMENT = cư dân đang ở */
async function resolveRecipients(targetScope, targetId) {
  if (targetScope === ANNOUNCEMENT_SCOPES.ALL) {
    const users = await User.find({ isActive: true }).select('_id').lean();
    return users.map((u) => u._id);
  }
  if (targetScope === ANNOUNCEMENT_SCOPES.BUILDING) {
    if (!(await Building.exists({ _id: targetId }))) throw ApiError.badRequest('Tòa nhà không tồn tại');
    const apartments = await Apartment.find({ buildingId: targetId }).select('_id').lean();
    return findResidentUserIds(apartments.map((a) => a._id));
  }
  if (!(await Apartment.exists({ _id: targetId }))) throw ApiError.badRequest('Căn hộ không tồn tại');
  return findResidentUserIds(targetId);
}

// ===== UC-E09: Đăng bảng tin + gửi thông báo theo phạm vi =====
export async function publish(user, { title, content, targetScope, targetId, isPinned, sendEmail }) {
  const scopedId = targetScope === ANNOUNCEMENT_SCOPES.ALL ? null : targetId;
  const recipients = await resolveRecipients(targetScope, scopedId);

  const announcement = await Announcement.create({
    title,
    content,
    targetScope,
    targetId: scopedId,
    isPinned,
    sendEmail,
    createdBy: user.id,
  });

  announcement.recipientCount = await notify(recipients, {
    type: NOTIFICATION_TYPES.ANNOUNCEMENT,
    title,
    content: content.length > 300 ? `${content.slice(0, 297)}...` : content,
    refId: announcement._id,
    link: '/announcements',
    email: sendEmail,
  });
  await announcement.save();

  await logAudit({
    action: AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    user,
    targetType: 'announcements',
    targetId: announcement._id,
    metadata: { targetScope, targetId: scopedId, recipientCount: announcement.recipientCount },
  });
  return announcement;
}

/** Bộ lọc bài cư dân được xem: toàn khu + tòa của mình + căn của mình */
async function residentVisibility(userId) {
  const apartmentIds = await getActiveApartmentIds(userId);
  const apartments = await Apartment.find({ _id: { $in: apartmentIds } })
    .select('buildingId')
    .lean();
  return {
    $or: [
      { targetScope: ANNOUNCEMENT_SCOPES.ALL },
      {
        targetScope: ANNOUNCEMENT_SCOPES.BUILDING,
        targetId: { $in: [...new Set(apartments.map((a) => String(a.buildingId)))] },
      },
      { targetScope: ANNOUNCEMENT_SCOPES.APARTMENT, targetId: { $in: apartmentIds } },
    ],
  };
}

export async function list(user, query) {
  const filter =
    user.role === ROLES.RESIDENT
      ? await residentVisibility(user.id)
      : { ...(query.targetScope && { targetScope: query.targetScope }) };
  if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');

  // Bài ghim lên đầu, sau đó mới nhất trước
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Announcement.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(POPULATE)
      .lean(),
    Announcement.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

export async function getById(user, id) {
  const filter = { _id: id };
  if (user.role === ROLES.RESIDENT) Object.assign(filter, await residentVisibility(user.id));
  const doc = await Announcement.findOne(filter).populate(POPULATE).lean();
  if (!doc) throw ApiError.notFound('Không tìm thấy bài đăng');
  return doc;
}

async function findEditable(user, id) {
  const doc = await Announcement.findById(id);
  if (!doc) throw ApiError.notFound('Không tìm thấy bài đăng');
  if (user.role !== ROLES.MANAGER && String(doc.createdBy) !== user.id) {
    throw ApiError.forbidden('Chỉ người đăng hoặc Trưởng BQL được sửa/xóa bài');
  }
  return doc;
}

/** Sửa nội dung/ghim — không gửi lại thông báo */
export async function update(user, id, data) {
  const doc = await findEditable(user, id);
  doc.set(data);
  await doc.save();
  return doc;
}

export async function remove(user, id) {
  const doc = await findEditable(user, id);
  await doc.deleteOne();
  return { deleted: true };
}
