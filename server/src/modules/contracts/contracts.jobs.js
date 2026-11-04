import {
  APARTMENT_STATUS,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONTRACT_STATUS,
  CONTRACT_TYPES,
  NOTIFICATION_TYPES,
} from '../../constants/enums.js';
import { Apartment, Contract, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { DAY_MS, endOfVnDay, fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { disableActiveCardsByApartment } from '../parkingCards/parkingCards.service.js';

/**
 * BR-O2 & UC-A06.4: Cron job kiểm tra và xử lý hợp đồng cho thuê hết hạn
 * - Chạy lúc 00:00 hàng ngày (giờ VN).
 * - Tìm các hợp đồng LEASE có status ACTIVE và endDate < startOfVnDay().
 * - Xử lý từng hợp đồng trong một transaction riêng để một bản ghi lỗi không làm hỏng cả lô:
 *   + Cập nhật status sang EXPIRED.
 *   + Gỡ các cư dân gắn với contractId của hợp đồng đó (isActive: false, moveOutDate: now).
 *   + Cập nhật trạng thái căn hộ về OWNED (nếu còn SALE ACTIVE) hoặc VACANT.
 *   + Ghi audit log CONTRACT_EXPIRED (performedBy: null).
 * - Gọi ensureCodes cho từng căn hộ đã xử lý thành công (bọc try/catch).
 * - Idempotent, trả về số hợp đồng đã xử lý.
 */
export async function expireLeases() {
  const cutoff = startOfVnDay();

  const expiredContracts = await Contract.find({
    type: CONTRACT_TYPES.LEASE,
    status: CONTRACT_STATUS.ACTIVE,
    endDate: { $lt: cutoff },
  });

  if (!expiredContracts.length) {
    return 0;
  }

  const now = new Date();
  const processedApartmentIds = new Set();
  let processedCount = 0;

  for (const contract of expiredContracts) {
    try {
      let didExpire = false;

      await withTransaction(async (session) => {
        const current = await Contract.findOne({
          _id: contract._id,
          status: CONTRACT_STATUS.ACTIVE,
        }).session(session);

        if (!current) {
          return;
        }

        // 1. Chuyển trạng thái hợp đồng sang EXPIRED
        current.status = CONTRACT_STATUS.EXPIRED;
        await current.save({ session });

        // 2. Gỡ các cư dân thuộc hợp đồng thuê này
        await Resident.updateMany(
          { contractId: current._id, isActive: true },
          { isActive: false, moveOutDate: now },
          { session },
        );

        // 3. Đưa trạng thái căn hộ về OWNED nếu còn SALE ACTIVE, ngược lại VACANT
        const hasActiveSale = await Contract.exists({
          apartmentId: current.apartmentId,
          type: CONTRACT_TYPES.SALE,
          status: CONTRACT_STATUS.ACTIVE,
        }).session(session);

        await Apartment.findByIdAndUpdate(
          current.apartmentId,
          { status: hasActiveSale ? APARTMENT_STATUS.OWNED : APARTMENT_STATUS.VACANT },
          { session },
        );

        // Chuyển thẻ gửi xe ACTIVE sang DISABLED_TO_COLLECT (UC66)
        await disableActiveCardsByApartment(current.apartmentId, null, session, null);

        // 4. Ghi audit log CONTRACT_EXPIRED
        await logAudit(
          {
            action: AUDIT_ACTIONS.CONTRACT_EXPIRED,
            user: null,
            targetType: AUDIT_TARGETS.CONTRACT,
            targetId: current._id,
            metadata: {
              reason: 'Hết hạn hợp đồng cho thuê',
              apartmentId: current.apartmentId,
              endDate: current.endDate,
            },
          },
          { session },
        );

        didExpire = true;
      });

      if (didExpire) {
        processedCount += 1;
        processedApartmentIds.add(contract.apartmentId.toString());
      }
    } catch (err) {
      console.error('[module-a] expireLeases error for contract', contract._id, err.message);
    }
  }

  // 5. Đồng bộ mã cư dân (ensureCodes) ngoài transaction, có try/catch
  for (const aptId of processedApartmentIds) {
    try {
      await ensureCodes(aptId);
    } catch (err) {
      console.error('[module-a] ensureCodes', aptId, err.message);
    }
  }

  return processedCount;
}

/** Số ngày nhắc trước khi hợp đồng thuê hết hạn (UC19) */
export const LEASE_REMIND_DAYS = 15;

/**
 * UC19: Cron job nhắc hợp đồng cho thuê sắp hết hạn
 * - Chạy lúc 00:30 hằng ngày (giờ VN).
 * - Tìm hợp đồng LEASE ACTIVE có endDate từ hôm nay đến hết ngày (hôm nay + 15) theo giờ VN và CHƯA nhắc
 *   (remindedAt == null) → cron lỡ một hôm vẫn nhắc ở lần chạy sau, không bỏ sót.
 * - Gửi thông báo cho chủ hộ và người thuê, đánh dấu remindedAt có điều kiện để mỗi hợp đồng chỉ nhắc 1 lần.
 */
export async function remindExpiringLeases(now = new Date()) {
  const todayStart = startOfVnDay(now);
  const windowEnd = endOfVnDay(new Date(todayStart.getTime() + LEASE_REMIND_DAYS * DAY_MS));
  const notReminded = { $or: [{ remindedAt: null }, { remindedAt: { $exists: false } }] };

  const contracts = await Contract.find({
    type: CONTRACT_TYPES.LEASE,
    status: CONTRACT_STATUS.ACTIVE,
    endDate: { $gte: todayStart, $lte: windowEnd },
    ...notReminded,
  })
    .populate('apartmentId', 'code')
    .lean();

  let remindedCount = 0;
  for (const contract of contracts) {
    try {
      const updated = await Contract.findOneAndUpdate(
        { _id: contract._id, status: CONTRACT_STATUS.ACTIVE, ...notReminded },
        { $set: { remindedAt: now } },
        { returnDocument: 'after' },
      );
      if (!updated) continue;

      const aptCode = contract.apartmentId?.code || '';
      const daysLeft = Math.max(0, Math.round((startOfVnDay(contract.endDate) - todayStart) / DAY_MS));
      await notify([contract.ownerId, contract.tenantId], {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: `Hợp đồng thuê căn ${aptCode} sắp hết hạn sau ${daysLeft} ngày`,
        content: `Hợp đồng cho thuê căn hộ ${aptCode} sẽ hết hạn vào ngày ${fmtDateVn(contract.endDate)}. Vui lòng liên hệ Lễ tân / Ban quản lý để làm thủ tục gia hạn hoặc báo chuyển đi trước thời hạn.`,
        refId: contract._id,
        link: '/r/my-apartment',
        email: true,
      });
      remindedCount += 1;
    } catch (err) {
      console.error('[module-a] remindExpiringLeases error for contract', contract._id, err.message);
    }
  }
  return remindedCount;
}
