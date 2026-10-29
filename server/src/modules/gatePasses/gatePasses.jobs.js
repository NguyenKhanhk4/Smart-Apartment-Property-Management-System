import {
  AUDIT_ACTIONS,
  GATE_PASS_STATUS,
  NOTIFICATION_TYPES,
} from '../../constants/enums.js';
import { GatePass } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { computeSlotStart } from './gatePasses.service.js';

/**
 * Cron mỗi 15 phút:
 * - Đơn AWAITING_OWNER / PENDING đã qua giờ bắt đầu → EXPIRED
 * - Đơn APPROVED hết ngày (scheduledDate < startOfVnDay(now)) chưa dùng → EXPIRED
 * Idempotent: chỉ xử lý các đơn còn ở trạng thái trên, từng đơn trong transaction riêng.
 */
export async function expireGatePasses() {
  const now = new Date();
  const todayStart = startOfVnDay(now);

  // 1. Tìm các đơn AWAITING_OWNER / PENDING có scheduledDate <= endOfVnDay(now) để kiểm tra giờ bắt đầu
  const waitingCandidates = await GatePass.find({
    status: { $in: [GATE_PASS_STATUS.AWAITING_OWNER, GATE_PASS_STATUS.PENDING] },
    scheduledDate: { $lte: now },
  }).lean();

  const expiredWaitingIds = waitingCandidates
    .filter((gp) => {
      try {
        const slotStart = computeSlotStart(gp.scheduledDate, gp.timeSlot?.from || '00:00');
        return slotStart <= now;
      } catch {
        return gp.scheduledDate < todayStart;
      }
    })
    .map((gp) => gp._id);

  // 2. Tìm các đơn APPROVED đã qua ngày thực hiện (scheduledDate < startOfVnDay(now))
  const expiredApproved = await GatePass.find({
    status: GATE_PASS_STATUS.APPROVED,
    scheduledDate: { $lt: todayStart },
  })
    .select('_id')
    .lean();

  const targetIds = [
    ...expiredWaitingIds,
    ...expiredApproved.map((gp) => gp._id),
  ];

  if (!targetIds.length) {
    return 0;
  }

  let expiredCount = 0;

  for (const id of targetIds) {
    try {
      let expiredDoc = null;

      await withTransaction(async (session) => {
        const current = await GatePass.findOne({
          _id: id,
          status: {
            $in: [
              GATE_PASS_STATUS.AWAITING_OWNER,
              GATE_PASS_STATUS.PENDING,
              GATE_PASS_STATUS.APPROVED,
            ],
          },
        }).session(session);

        if (!current) {
          return;
        }

        const prevStatus = current.status;
        current.status = GATE_PASS_STATUS.EXPIRED;
        await current.save({ session });
        expiredDoc = current.toObject();

        await logAudit(
          {
            action: AUDIT_ACTIONS.GATEPASS_EXPIRED,
            user: null,
            targetType: 'GatePass',
            targetId: current._id,
            metadata: {
              code: current.code,
              apartmentId: current.apartmentId,
              fromStatus: prevStatus,
              reason:
                prevStatus === GATE_PASS_STATUS.APPROVED
                  ? 'Quá ngày thực hiện nhưng chưa sử dụng'
                  : 'Quá giờ bắt đầu nhưng chưa được duyệt',
            },
          },
          { session },
        );
      });

      if (expiredDoc) {
        expiredCount += 1;
        await notify(expiredDoc.createdBy, {
          type: NOTIFICATION_TYPES.SYSTEM,
          title: 'Đơn chuyển đồ đã hết hạn',
          content: `Đơn chuyển đồ ${expiredDoc.code} đã tự động chuyển sang trạng thái Hết hạn.`,
          refId: expiredDoc._id,
          link: '/r/gate-passes',
        }).catch((err) => console.error('[gate-passes] notify expired error:', err.message));
      }
    } catch (err) {
      console.error('[gate-passes] expireGatePasses error for', id, err.message);
    }
  }

  return expiredCount;
}
