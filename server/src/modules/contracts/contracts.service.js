import {
  APARTMENT_OCCUPANCY,
  APARTMENT_STATUS,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONTRACT_STATUS,
  CONTRACT_TYPES,
  NOTIFICATION_TYPES,
  RELATION_TYPES,
} from '../../constants/enums.js';
import { Apartment, Contract, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS, endOfVnDay, startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { recordOccupancy } from '../apartments/apartmentOccupancy.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { revokeDepartedResidentServices } from '../residents/residentExit.service.js';
import { findOrCreateResidentUser, inviteNewResident, linkResident } from '../residents/residentAccounts.js';

/**
 * Danh sách hợp đồng phân trang, lọc theo tòa/căn/loại/trạng thái/sắp hết hạn (UC-A06)
 */
export async function listContracts(query = {}) {
  const filter = {};

  if (query.apartmentId) {
    filter.apartmentId = query.apartmentId;
  } else if (query.buildingId) {
    const apts = await Apartment.find({ buildingId: query.buildingId }).select('_id').lean();
    filter.apartmentId = { $in: apts.map((a) => a._id) };
  }

  if (query.type) {
    filter.type = query.type;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.endingWithinDays !== undefined) {
    // Theo ngày lịch VN: từ hôm nay đến hết ngày thứ N
    const today = startOfVnDay();
    filter.status = CONTRACT_STATUS.ACTIVE;
    filter.type = CONTRACT_TYPES.LEASE;
    filter.endDate = { $gte: today, $lte: endOfVnDay(new Date(today.getTime() + query.endingWithinDays * DAY_MS)) };
  }

  return paginate(Contract, filter, query, {
    populate: [
      {
        path: 'apartmentId',
        select: 'code floor area status buildingId',
        populate: { path: 'buildingId', select: 'code name' },
      },
      { path: 'ownerId', select: 'fullName email phone' },
      { path: 'tenantId', select: 'fullName email phone' },
    ],
  });
}

/**
 * Chi tiết một hợp đồng (UC-A06)
 */
export async function getContractById(id) {
  const contract = await Contract.findById(id)
    .populate({
      path: 'apartmentId',
      populate: { path: 'buildingId', select: 'code name address totalFloors' },
    })
    .populate('ownerId', 'fullName email phone dateOfBirth')
    .populate('tenantId', 'fullName email phone dateOfBirth')
    .populate('createdBy', 'fullName email role')
    .lean();

  if (!contract) {
    throw ApiError.notFound('Hợp đồng không tồn tại');
  }

  return contract;
}

/** Ngày hợp đồng lưu 00:00 giờ VN (Joi.date() parse "YYYY-MM-DD" thành 07:00 VN → lệch kỳ hóa đơn bắt đầu ngày 1) */
const contractDay = (value) => (value ? startOfVnDay(new Date(value)) : null);

async function uploadContractFile(file) {
  if (!file) return null;
  const [url] = await uploadToCloudinary([file], 'contracts'); // trả về mảng URL (chuỗi)
  return url ?? null;
}

const findActiveContract = (apartmentId, type, session) =>
  Contract.findOne({ apartmentId, type, status: CONTRACT_STATUS.ACTIVE }).session(session);

/**
 * Tạo mới hợp đồng mua bán trong 1 transaction (UC-A06.1, BR-A5)
 */
export async function createContract(receptionistUser, data, file, ip) {
  const { apartmentId, type, owner } = data;
  if (type !== CONTRACT_TYPES.SALE) throw ApiError.field('type', 'Chủ sở hữu khai báo lượt thuê trong Căn hộ của tôi');
  const startDate = contractDay(data.startDate);
  const fileUrl = await uploadContractFile(file);

  let account = null; // { user, created } của người đứng tên
  let savedContract = null;

  await withTransaction(async (session) => {
    const apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Căn hộ không tồn tại');

    if (await findActiveContract(apartmentId, CONTRACT_TYPES.SALE, session)) {
      throw new ApiError('CONTRACT_ACTIVE_EXISTS', 'Căn hộ đã có hợp đồng mua bán đang hiệu lực');
    }
    account = await findOrCreateResidentUser(owner, session);
    apartment.status = APARTMENT_STATUS.OWNED;

    const [contract] = await Contract.create(
      [
        {
          apartmentId,
          type,
          ownerId: account.user._id,
          startDate,
          status: CONTRACT_STATUS.ACTIVE,
          fileUrl,
          createdBy: receptionistUser?.id ?? null,
        },
      ],
      { session },
    );
    savedContract = contract;

    await linkResident(
      {
        userId: account.user._id,
        apartmentId,
        relationType: RELATION_TYPES.OWNER,
        contractId: contract._id,
        moveInDate: startDate,
        idNumber: owner.idNumber,
      },
      session,
    );
    await apartment.save({ session });

    await logAudit(
      {
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        user: receptionistUser,
        targetType: AUDIT_TARGETS.CONTRACT,
        targetId: contract._id,
        metadata: { type, apartmentId, ownerId: contract.ownerId, tenantId: contract.tenantId },
        ip,
      },
      { session },
    );
  });

  // Sau commit: email mời kích hoạt (nếu vừa tạo tài khoản), thông báo, đồng bộ mã cư dân
  const activationInviteSent = await inviteNewResident(account);
  await notify(account.user._id, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Hợp đồng mới đã được tạo',
    content: 'Hợp đồng mua bán của bạn đã được thiết lập thành công.',
    refId: savedContract._id,
    link: '/r/my-apartment',
  });
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

  return { contract: savedContract, activationInviteSent };
}

/**
 * Cập nhật hồ sơ hợp đồng mua bán (UC-A06.2).
 * Ghi có điều kiện status = ACTIVE: hợp đồng vừa bị chấm dứt / hết hạn song song thì trả 409, không ghi đè.
 */
export async function updateContract(id, data, file, receptionistUser, ip) {
  const contract = await Contract.findById(id).lean();
  if (!contract) throw ApiError.notFound('Hợp đồng không tồn tại');
  if (contract.type !== CONTRACT_TYPES.SALE) throw new ApiError('STATUS_CONFLICT', 'Hồ sơ thuê cũ chỉ dùng để tra cứu');
  if (contract.status !== CONTRACT_STATUS.ACTIVE) {
    throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể chỉnh sửa hợp đồng đang có hiệu lực');
  }

  const changes = {};
  const set = {};

  if (data.endDate !== undefined) {
    const endDate = contractDay(data.endDate);
    changes.endDate = { from: contract.endDate, to: endDate };
    set.endDate = endDate;
  }

  const fileUrl = await uploadContractFile(file);
  if (fileUrl) {
    changes.fileUrl = { from: contract.fileUrl, to: fileUrl };
    set.fileUrl = fileUrl;
  }

  const updated = await Contract.findOneAndUpdate(
    { _id: id, status: CONTRACT_STATUS.ACTIVE },
    { $set: set },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ApiError('STATUS_CONFLICT', 'Hợp đồng vừa được chấm dứt hoặc hết hạn, vui lòng tải lại');

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.CONTRACT_UPDATED,
      user: receptionistUser,
      targetType: AUDIT_TARGETS.CONTRACT,
      targetId: updated._id,
      metadata: { changes },
      ip,
    });
  }

  return updated;
}

/**
 * Chấm dứt sớm hợp đồng (UC-A06.3, BR-A5)
 */
export async function terminateContract(id, receptionistUser, ip) {
  let apartmentId = null;

  await withTransaction(async (session) => {
    const contract = await Contract.findById(id).session(session);
    if (!contract) {
      throw ApiError.notFound('Hợp đồng không tồn tại');
    }
    if (contract.type !== CONTRACT_TYPES.SALE) {
      throw new ApiError('STATUS_CONFLICT', 'Chủ sở hữu kết thúc lượt thuê trong Căn hộ của tôi');
    }

    if (contract.status !== CONTRACT_STATUS.ACTIVE) {
      throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể chấm dứt hợp đồng đang có hiệu lực');
    }

    apartmentId = contract.apartmentId;
    const now = new Date();

    const activeLease = await findActiveContract(apartmentId, CONTRACT_TYPES.LEASE, session);
    const activeTenant = await Resident.exists({ apartmentId, relationType: RELATION_TYPES.TENANT, isActive: true }).session(session);
    if (activeLease || activeTenant) {
      throw new ApiError('STATUS_CONFLICT', 'Cần kết thúc lượt thuê trước khi chấm dứt hợp đồng mua bán');
    }

    contract.status = CONTRACT_STATUS.TERMINATED;
    contract.terminatedAt = now;
    await contract.save({ session });

    const departing = await Resident.find({ apartmentId, isActive: true }).select('userId').session(session).lean();
    await Resident.updateMany({ apartmentId, isActive: true }, { isActive: false, moveOutDate: now }, { session });
    await Apartment.findByIdAndUpdate(apartmentId, { status: APARTMENT_STATUS.VACANT }, { session });
    await recordOccupancy(apartmentId, APARTMENT_OCCUPANCY.VACANT, session);
    await revokeDepartedResidentServices({ apartmentId, userIds: [...departing.map((r) => r.userId), contract.ownerId],
      endedAt: now, session, actor: receptionistUser, ip });
    await logAudit({ action: AUDIT_ACTIONS.CONTRACT_TERMINATED, user: receptionistUser, targetType: AUDIT_TARGETS.CONTRACT,
      targetId: contract._id, metadata: { reason: 'Chấm dứt hợp đồng mua bán' }, ip }, { session });
  });

  // Đồng bộ lại mã cư dân (ensureCodes) ngoài transaction
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

  return { message: 'Đã chấm dứt hợp đồng thành công' };
}
