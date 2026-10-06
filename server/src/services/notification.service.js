import { Apartment, Notification, Resident, User } from '../models/index.js';
import { hasPermission } from '../middlewares/authorize.js';
import { sendMail } from './mail.service.js';

/**
 * Notification service dùng chung (srs_final.md §2.4 #14) — mọi module gọi để báo cho người dùng.
 *
 * @example
 *   await notify(invoice.payerId, {
 *     type: 'INVOICE', title: 'Hóa đơn tháng 10', content: '...',
 *     refId: invoice._id, link: `/r/invoices/${invoice._id}`, email: true,
 *   });
 *   await notifyRoles(['MANAGER', 'STAFF:RECEPTIONIST'], { type: 'TICKET', ... });
 *   await notifyApartment(apartmentId, { type: 'ANNOUNCEMENT', ... });
 */

const uniqIds = (ids) => [...new Set(ids.filter(Boolean).map(String))];

/**
 * Tạo thông báo trong app cho 1 hoặc nhiều user; `email: true` thì gửi kèm email.
 * Trả về số thông báo đã tạo. Không throw khi email lỗi.
 */
export async function notify(userIds, { type, title, content, refId = null, link, email = false }) {
  const ids = uniqIds([userIds].flat());
  if (!ids.length) return 0;

  const docs = await Notification.insertMany(
    ids.map((userId) => ({ userId, type, title, content, refId, link })),
  );

  if (email) {
    const users = await User.find({ _id: { $in: ids }, isActive: true }).select('email').lean();
    const sent = await sendMail({
      to: users.map((u) => u.email),
      subject: `[SAPMS] ${title}`,
      text: content,
      html: `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
    });
    if (sent) {
      await Notification.updateMany(
        { _id: { $in: docs.map((d) => d._id) } },
        { $set: { emailSent: true } },
      );
    }
  }
  return docs.length;
}

/** Danh sách user đang hoạt động khớp spec phân quyền, vd ['MANAGER', 'STAFF:RECEPTIONIST']. */
export async function findUsersBySpecs(specs) {
  const roles = [...new Set(specs.map((s) => s.split(':')[0]))];
  const users = await User.find({ role: { $in: roles }, isActive: true })
    .select('role roleTitle boardTitle')
    .lean();
  return users.filter((u) => hasPermission(u, specs));
}

export async function notifyRoles(specs, payload) {
  const users = await findUsersBySpecs(specs);
  return notify(
    users.map((u) => u._id),
    payload,
  );
}

/** userId của các cư dân đang ở trong 1 hoặc nhiều căn hộ */
export async function findResidentUserIds(apartmentIds) {
  const residents = await Resident.find({
    apartmentId: { $in: [apartmentIds].flat() },
    isActive: true,
  })
    .select('userId')
    .lean();
  return uniqIds(residents.map((r) => r.userId));
}

export async function notifyApartment(apartmentId, payload) {
  return notify(await findResidentUserIds(apartmentId), payload);
}

export async function notifyBuilding(buildingId, payload) {
  const apartments = await Apartment.find({ buildingId }).select('_id').lean();
  return notify(await findResidentUserIds(apartments.map((a) => a._id)), payload);
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
