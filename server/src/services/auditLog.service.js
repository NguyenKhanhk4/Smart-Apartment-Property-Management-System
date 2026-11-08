import { currentRequest } from '../middlewares/requestContext.js';
import { AuditLog } from '../models/index.js';

/**
 * Ghi audit log (BR-S10, NFR-05). Chỉ ghi thêm; model chặn sửa / xóa.
 *
 * - `before` / `after`: giá trị cũ / mới của các trường bị đổi, vd `{ role: 'STAFF' }` → `{ role: 'ACCOUNTANT' }`.
 *   Module cũ ghi thay đổi trong `metadata` (before/after, from/to, changes...) vẫn hiện được ở UC06.
 * - `ip`: không truyền thì lấy IP của request đang xử lý (middleware requestContext).
 * - Truyền `session` khi đang trong MongoDB transaction để log rollback cùng nghiệp vụ.
 * @example await logAudit({ action: 'TICKET_ASSIGNED', user: req.user, targetType: 'tickets', targetId: t._id, before: {...}, after: {...} })
 */
export async function logAudit({ action, user, targetType, targetId, metadata, before, after, ip }, { session } = {}) {
  const [doc] = await AuditLog.create(
    [
      {
        action,
        performedBy: user?.id ?? user?._id ?? null,
        targetType,
        targetId,
        metadata,
        before,
        after,
        ip: ip ?? currentRequest()?.ip,
      },
    ],
    { session },
  );
  return doc;
}
