import { CONTRACT_STATUS, CONTRACT_TYPES } from '../../constants/enums.js';
import { Contract } from '../../models/Contract.js';

/**
 * BR-F7: Xác định người chịu trách nhiệm thanh toán của căn hộ tại thời điểm `at`.
 * - Căn không có hợp đồng SALE ACTIVE tại thời điểm `at` → trả về null.
 * - Căn có hợp đồng LEASE ACTIVE tại thời điểm `at` và `tenantPaysFees = true` → trả về người thuê (TENANT).
 * - Còn lại → trả về chủ sở hữu (OWNER).
 *
 * @param {string|import('mongoose').Types.ObjectId} apartmentId
 * @param {Date} [at=new Date()]
 * @returns {Promise<{ userId: import('mongoose').Types.ObjectId, source: 'OWNER'|'TENANT', contractId: import('mongoose').Types.ObjectId }|null>}
 */
export async function getPayer(apartmentId, at = new Date()) {
  const checkTime = new Date(at);

  // 1. Kiểm tra hợp đồng SALE ACTIVE
  const saleContract = await Contract.findOne({
    apartmentId,
    type: CONTRACT_TYPES.SALE,
    status: CONTRACT_STATUS.ACTIVE,
    startDate: { $lte: checkTime },
  }).lean();

  if (!saleContract) {
    return null;
  }

  // 2. Kiểm tra hợp đồng LEASE ACTIVE tại thời điểm `at`
  const leaseContract = await Contract.findOne({
    apartmentId,
    type: CONTRACT_TYPES.LEASE,
    status: CONTRACT_STATUS.ACTIVE,
    startDate: { $lte: checkTime },
    $or: [{ endDate: null }, { endDate: { $gte: checkTime } }],
  }).lean();

  // BR-F7: nếu LEASE ACTIVE có tenantPaysFees = true → người thuê
  if (leaseContract && leaseContract.tenantPaysFees && leaseContract.tenantId) {
    return {
      userId: leaseContract.tenantId,
      source: 'TENANT',
      contractId: leaseContract._id,
    };
  }

  // Còn lại → chủ sở hữu
  return {
    userId: saleContract.ownerId,
    source: 'OWNER',
    contractId: saleContract._id,
  };
}
