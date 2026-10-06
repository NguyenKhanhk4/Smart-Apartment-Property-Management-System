import { AuditLog } from '../models/index.js';

/**
 * Ghi audit log (NFR-05, BR-O11). Bản tối thiểu để các module dùng ngay;
 * Module C (Trọng Minh — UC-C08) mở rộng thêm API xem/lọc log.
 *
 * Truyền `session` khi đang trong MongoDB transaction để log rollback cùng nghiệp vụ.
 * @example await logAudit({ action: 'TICKET_ASSIGNED', user: req.user, targetType: 'tickets', targetId: t._id, metadata: {...} })
 */
export async function logAudit({ action, user, targetType, targetId, metadata, ip }, { session } = {}) {
  const [doc] = await AuditLog.create(
    [
      {
        action,
        performedBy: user?.id ?? user?._id ?? null,
        targetType,
        targetId,
        metadata,
        ip,
      },
    ],
    { session },
  );
  return doc;
}
