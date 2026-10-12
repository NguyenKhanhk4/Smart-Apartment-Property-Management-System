import {
  APARTMENT_STATUS,
  AUDIT_ACTIONS,
  CONTRACT_STATUS,
  CONTRACT_TYPES,
} from '../../constants/enums.js';
import { Apartment, Contract, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { startOfVnDay } from '../../utils/time.js';

/**
 * BR-O2 & UC-A06.4: Cron job kiểm tra và xử lý hợp đồng cho thuê hết hạn
 * - Chạy lúc 00:00 hàng ngày (giờ VN).
 * - Tìm các hợp đồng LEASE có status ACTIVE và endDate < startOfVnDay().
 * - Cập nhật status sang EXPIRED.
 * - Gỡ các cư dân gắn với contractId của hợp đồng đó (isActive: false, moveOutDate: now).
 * - Cập nhật trạng thái căn hộ về OWNED (nếu còn SALE ACTIVE) hoặc VACANT.
 * - Ghi audit log CONTRACT_EXPIRED (performedBy: null).
 * - Gọi ensureCodes cho từng căn hộ (bọc try/catch).
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

  const expiredIds = expiredContracts.map((c) => c._id);
  const apartmentIds = [...new Set(expiredContracts.map((c) => c.apartmentId.toString()))];
  const now = new Date();

  // 1. Chuyển trạng thái hợp đồng sang EXPIRED
  await Contract.updateMany(
    { _id: { $in: expiredIds } },
    { status: CONTRACT_STATUS.EXPIRED },
  );

  // 2. Gỡ các cư dân thuộc các hợp đồng thuê này
  await Resident.updateMany(
    { contractId: { $in: expiredIds }, isActive: true },
    { isActive: false, moveOutDate: now },
  );

  // 3. Đưa trạng thái căn hộ về OWNED nếu còn SALE ACTIVE, ngược lại VACANT
  for (const aptId of apartmentIds) {
    const hasActiveSale = await Contract.exists({
      apartmentId: aptId,
      type: CONTRACT_TYPES.SALE,
      status: CONTRACT_STATUS.ACTIVE,
    });

    await Apartment.findByIdAndUpdate(aptId, {
      status: hasActiveSale ? APARTMENT_STATUS.OWNED : APARTMENT_STATUS.VACANT,
    });
  }

  // 4. Ghi audit log CONTRACT_EXPIRED
  for (const contract of expiredContracts) {
    await logAudit({
      action: AUDIT_ACTIONS.CONTRACT_EXPIRED,
      user: null,
      targetType: 'Contract',
      targetId: contract._id,
      metadata: {
        reason: 'Hết hạn hợp đồng cho thuê',
        apartmentId: contract.apartmentId,
        endDate: contract.endDate,
      },
    });
  }

  // 5. Đồng bộ mã cư dân (ensureCodes) ngoài transaction, có try/catch
  for (const aptId of apartmentIds) {
    try {
      await ensureCodes(aptId);
    } catch (err) {
      console.error('[module-a] ensureCodes', aptId, err.message);
    }
  }

  return expiredContracts.length;
}
