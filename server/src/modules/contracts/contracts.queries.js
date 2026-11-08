import { CONTRACT_STATUS, CONTRACT_TYPES, RELATION_TYPES } from '../../constants/enums.js';
import { Contract, Resident } from '../../models/index.js';
import { startOfVnDay } from '../../utils/time.js';

/**
 * BR-F7: Xác định người chịu trách nhiệm thanh toán của căn hộ tại thời điểm `at`.
 * - Tra hồ sơ sở hữu đang có hiệu lực hoặc hồ sơ cũ trước thời điểm đổi chủ.
 * - Lượt cư trú UC17 xác định người nộp phí theo thời gian ở và lựa chọn của chủ sở hữu.
 * - Với hồ sơ LEASE cũ, giữ người nộp phí đến hết ngày kết thúc cư trú thực tế.
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
    startDate: { $lte: checkTime },
    $or: [
      { status: CONTRACT_STATUS.ACTIVE },
      { transferredToContractId: { $type: 'objectId' }, terminatedAt: { $gt: checkTime } },
    ],
  }).sort({ startDate: -1 }).lean();

  if (!saleContract) {
    return null;
  }

  const tenancy = await Resident.findOne({
    apartmentId, relationType: RELATION_TYPES.TENANT, contractId: null, tenantPaysFees: { $type: 'bool' },
    moveInDate: { $lte: checkTime },
    $or: [{ isActive: true }, { moveOutDate: { $gte: startOfVnDay(checkTime) } }],
  }).sort({ moveInDate: -1 }).select('userId tenantPaysFees').lean();
  if (tenancy) return tenancy.tenantPaysFees
    ? { userId: tenancy.userId, source: 'TENANT', contractId: saleContract._id }
    : { userId: saleContract.ownerId, source: 'OWNER', contractId: saleContract._id };

  // Ngày hết hạn dự kiến của hồ sơ cũ không tự kết thúc quyền cư trú trong UC17.
  const day = startOfVnDay(checkTime);
  const leaseContract = await Contract.findOne({
    apartmentId,
    type: CONTRACT_TYPES.LEASE,
    startDate: { $lte: checkTime },
    $or: [
      { status: CONTRACT_STATUS.ACTIVE },
      { status: CONTRACT_STATUS.TERMINATED, terminatedAt: { $gte: day }, $expr: { $gte: ['$terminatedAt', '$startDate'] } },
      { status: CONTRACT_STATUS.EXPIRED, endDate: { $gte: day } },
    ],
  }).sort({ startDate: -1 }).lean();

  // BR-F7: người thuê trả phí nếu đã được chọn trên hồ sơ.
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
