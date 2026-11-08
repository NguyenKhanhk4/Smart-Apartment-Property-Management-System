// Module 8: kiểm tra phạm vi bài, bình luận và bỏ phiếu nguyên tử theo căn; kết quả chỉ trả tổng hợp.
import {
  ANNOUNCEMENT_SCOPES,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  ROLES,
} from '../../constants/enums.js';
import { Announcement, Apartment, Building, User, Resident } from '../../models/index.js';
import { AnnouncementComment } from '../../models/Announcement.js';
import { logAudit } from '../../services/auditLog.service.js';
import { findResidentUserIds, notify } from '../../services/notification.service.js';
import { getActiveApartmentIds } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';

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
export async function publish(user, { title, content, targetScope, targetId, isPinned, sendEmail, poll, attachments = [] }) {
  if (user.role !== ROLES.MANAGER) throw ApiError.forbidden();
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
    attachments,
    ...(poll && { poll: { audience: poll.audience, options: poll.options, closesAt: poll.closesAt } }),
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
async function residentVisibility(userId, selectedId) {
  let apartmentIds = await getActiveApartmentIds(userId);
  if (selectedId) {
    if (!apartmentIds.includes(String(selectedId))) throw ApiError.forbidden('Không thuộc căn hộ đang chọn');
    apartmentIds = [String(selectedId)];
  }
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
      ? await residentVisibility(user.id, query.apartmentId)
      : { ...(query.targetScope && { targetScope: query.targetScope }) };
  if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');

  // Bài ghim lên đầu, sau đó mới nhất trước
  return paginate(Announcement, filter, { ...query, sort: { isPinned: -1, createdAt: -1 } }, { populate: POPULATE });
}

export async function getById(user, id) {
  const filter = { _id: id };
  if (user.role === ROLES.RESIDENT) Object.assign(filter, await residentVisibility(user.id));
  const doc = await Announcement.findOne(filter).populate(POPULATE).lean();
  if (!doc) throw ApiError.notFound('Không tìm thấy bài đăng');
  return doc;
}

async function findEditable(user, id) {
  if (user.role !== ROLES.MANAGER) throw ApiError.forbidden();
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
  await AnnouncementComment.deleteMany({ announcementId: id });
  return { deleted: true };
}

export async function comments(user, id, query = {}) {
  await getById(user, id);
  return paginate(AnnouncementComment, { announcementId: id, ...(user.role !== ROLES.MANAGER && { hidden: false }) },
    { ...query, sort: '-createdAt' }, { populate: [{ path: 'createdBy', select: 'fullName' }] });
}

export async function addComment(user, id, content) {
  if (user.role !== ROLES.RESIDENT) throw ApiError.forbidden();
  await getById(user, id);
  return AnnouncementComment.create({ announcementId: id, createdBy: user.id, content });
}

export async function hideComment(user, id, commentId) {
  if (user.role !== ROLES.MANAGER) throw ApiError.forbidden();
  const comment = await AnnouncementComment.findOneAndUpdate({ _id: commentId, announcementId: id },
    { $set: { hidden: true, hiddenBy: user.id, hiddenAt: new Date() } }, { returnDocument: 'after' });
  if (!comment) throw ApiError.notFound();
  return { hidden: true };
}

async function pollFor(user, id) {
  await getById(user, id);
  const doc = await Announcement.findById(id).select('+poll.votes').lean();
  if (!doc?.poll) throw ApiError.notFound('Không tìm thấy khảo sát');
  return doc;
}

async function checkPollApartment(doc, apartmentId) {
  const apartment = await Apartment.findById(apartmentId).select('buildingId').lean();
  if (!apartment || (doc.targetScope === 'APARTMENT' && String(doc.targetId) !== String(apartmentId)) ||
      (doc.targetScope === 'BUILDING' && String(doc.targetId) !== String(apartment.buildingId))) {
    throw ApiError.forbidden('Khảo sát không dành cho căn hộ đang chọn');
  }
}

export async function pollResults(user, id, apartmentId) {
  const doc = await pollFor(user, id);
  let mine;
  let eligible = true;
  if (user.role === ROLES.RESIDENT) {
    const ids = await getActiveApartmentIds(user.id);
    if (!apartmentId || !ids.includes(String(apartmentId))) throw ApiError.forbidden('Chọn căn hộ hợp lệ');
    await checkPollApartment(doc, apartmentId);
    mine = doc.poll.votes.find((v) => String(v.apartmentId) === String(apartmentId));
    const member = await Resident.findOne({ userId: user.id, apartmentId, isActive: true }).lean();
    eligible = Boolean(member) && (doc.poll.audience !== 'OWNER' || member.relationType === 'OWNER');
  } else if (![ROLES.MANAGER, ROLES.BOARD].includes(user.role)) throw ApiError.forbidden();
  const total = doc.poll.votes.length;
  return { total, closed: Boolean(doc.poll.closedAt) || +doc.poll.closesAt <= Date.now(),
    myOption: mine?.option, eligible, canEdit: eligible && (!mine || String(mine.userId) === String(user.id)),
    options: doc.poll.options.map((label, option) => {
      const count = doc.poll.votes.filter((v) => v.option === option).length;
      return { label, option, count, percentage: total ? Math.round(count / total * 10000) / 100 : 0 };
    }) };
}

export async function vote(user, id, { apartmentId, option }) {
  if (user.role !== ROLES.RESIDENT) throw ApiError.forbidden();
  const doc = await pollFor(user, id);
  const member = await Resident.findOne({ userId: user.id, apartmentId, isActive: true }).lean();
  if (!member || (doc.poll.audience === 'OWNER' && member.relationType !== 'OWNER')) throw ApiError.forbidden('Không thuộc nhóm được bỏ phiếu');
  await checkPollApartment(doc, apartmentId);
  if (!Number.isInteger(option) || option < 0 || option >= doc.poll.options.length) throw ApiError.badRequest('Lựa chọn không hợp lệ');
  const now = new Date();
  const filter = { _id: id, 'poll.closedAt': null, 'poll.closesAt': { $gt: now } };
  const updateOwnVote = () => Announcement.updateOne({ ...filter, 'poll.votes': { $elemMatch: { apartmentId, userId: user.id } } },
    { $set: { 'poll.votes.$.option': option, 'poll.votes.$.votedAt': now } });
  let result = await updateOwnVote();
  if (!result.matchedCount) result = await Announcement.updateOne({ ...filter, 'poll.votes.apartmentId': { $ne: apartmentId } },
    { $push: { 'poll.votes': { apartmentId, userId: user.id, option, votedAt: now } } });
  if (!result.matchedCount) result = await updateOwnVote();
  if (!result.matchedCount) throw ApiError.badRequest('Khảo sát đã đóng hoặc căn đã có người khác bỏ phiếu');
  return pollResults(user, id, apartmentId);
}

export async function closePoll(user, id) {
  if (user.role !== ROLES.MANAGER) throw ApiError.forbidden();
  const doc = await Announcement.findOneAndUpdate({ _id: id, poll: { $exists: true }, 'poll.closedAt': null },
    { $set: { 'poll.closedAt': new Date() } }, { returnDocument: 'after' });
  if (!doc) throw ApiError.badRequest('Khảo sát không tồn tại hoặc đã đóng');
  return { closed: true };
}
