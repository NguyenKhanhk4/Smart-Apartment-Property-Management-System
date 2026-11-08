import {
  APARTMENT_OCCUPANCY,
  APARTMENT_STATUS,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONTRACT_STATUS,
  CONTRACT_TYPES,
  NOTIFICATION_TYPES,
  RELATION_TYPES,
  ROLES,
} from '../../constants/enums.js';
import { Apartment, Contract, Resident, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS, endOfVnDay, startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { normalizePhone } from '../../utils/validators.js';
import { recordOccupancy } from '../apartments/apartmentOccupancy.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { revokeDepartedResidentServices } from '../residents/residentExit.service.js';
import { decryptIdNumber, encryptIdNumber } from '../residents/idCrypto.js';
import { findOrCreateResidentUser, linkResident, sendActivationInvite } from '../residents/residentAccounts.js';
import { uniqueConflictError } from '../users/userLookup.js';

/**
 * Danh sách hợp đồng phân trang, lọc theo tòa/tầng/căn/loại/trạng thái/sắp hết hạn (UC-A06)
 */
export async function listContracts(query = {}) {
  const filter = {};

  if (query.floor !== undefined || (query.buildingId && !query.apartmentId)) {
    const apartments = await Apartment.find({
      ...(query.apartmentId ? { _id: query.apartmentId } : {}),
      ...(query.buildingId ? { buildingId: query.buildingId } : {}),
      ...(query.floor !== undefined ? { floor: query.floor } : {}),
    }).select('_id').lean();
    filter.apartmentId = { $in: apartments.map((apartment) => apartment._id) };
  } else if (query.apartmentId) {
    filter.apartmentId = query.apartmentId;
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
export async function createContract(actor, data, file, ip) {
  const { apartmentId, type, owner, ownershipDocumentType, ownershipDocumentNumber } = data;
  if (type !== CONTRACT_TYPES.SALE) throw ApiError.field('type', 'Chủ sở hữu khai báo lượt thuê trong Căn hộ của tôi');
  const startDate = contractDay(data.startDate);
  const fileUrl = await uploadContractFile(file);

  return withTransaction(async (session) => {
    const apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Căn hộ không tồn tại');

    if (await findActiveContract(apartmentId, CONTRACT_TYPES.SALE, session)) {
      throw new ApiError('CONTRACT_ACTIVE_EXISTS', 'Căn hộ đã có hợp đồng mua bán đang hiệu lực');
    }
    const { user } = await findOrCreateResidentUser(owner, session);
    const currentOwner = await Resident.findOne({
      apartmentId, relationType: RELATION_TYPES.OWNER, isActive: true,
    }).select('userId').session(session).lean();
    if (currentOwner && String(currentOwner.userId) !== String(user._id)) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ đang có chủ sở hữu khác. Hãy xử lý qua Chuyển nhượng căn hộ');
    }

    if (!currentOwner) {
      apartment.occupancyStatus ??= apartment.handoverDate
        ? APARTMENT_OCCUPANCY.VACANT
        : APARTMENT_OCCUPANCY.NOT_HANDED_OVER;
    }
    apartment.status = APARTMENT_STATUS.OWNED;
    // Các yêu cầu ghi hồ sơ cùng căn phải tranh chấp trên cùng bản ghi trong transaction.
    apartment.markModified('status');

    const [contract] = await Contract.create(
      [
        {
          apartmentId,
          type,
          ownerId: user._id,
          ownerIdNumberEnc: currentOwner ? undefined : encryptIdNumber(owner.idNumber),
          ownerAccountPending: !currentOwner,
          ownershipDocumentType,
          ownershipDocumentNumber,
          startDate,
          status: CONTRACT_STATUS.ACTIVE,
          fileUrl,
          createdBy: actor?.id ?? null,
        },
      ],
      { session },
    );
    if (currentOwner) {
      await linkResident({
        userId: user._id, apartmentId, relationType: RELATION_TYPES.OWNER, contractId: contract._id,
        moveInDate: startDate, idNumber: owner.idNumber,
      }, session);
    }
    await apartment.save({ session });

    await logAudit(
      {
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        user: actor,
        targetType: AUDIT_TARGETS.CONTRACT,
        targetId: contract._id,
        metadata: { type, apartmentId, ownerId: contract.ownerId, tenantId: contract.tenantId },
        ip,
      },
      { session },
    );

    return { contract: await Contract.findById(contract._id).session(session) };
  });
}

/** UC22 — Liên kết đúng người đứng tên trong hồ sơ mua bán đã đối chiếu. */
export async function issueOwnerAccount(apartmentId, { contractId, phone, email }, actor, ip) {
  const owner = await withTransaction(async (session) => {
    const contract = await Contract.findOne({
      _id: contractId, apartmentId, type: CONTRACT_TYPES.SALE, status: CONTRACT_STATUS.ACTIVE,
      startDate: { $lte: startOfVnDay() },
    }).select('+ownerIdNumberEnc').session(session);
    if (!contract) {
      throw new ApiError('STATUS_CONFLICT', 'Cần hồ sơ mua bán đang có hiệu lực của căn hộ này');
    }

    const user = await User.findById(contract.ownerId).session(session);
    if (!user?.isActive || user.role !== ROLES.RESIDENT) {
      throw new ApiError('STATUS_CONFLICT', 'Tài khoản người đứng tên phải là tài khoản cư dân đang hoạt động');
    }
    if (normalizePhone(phone) !== user.phone) {
      throw ApiError.field('phone', 'Số điện thoại phải khớp với người đứng tên trong hồ sơ mua bán');
    }

    const residents = await Resident.find({
      apartmentId,
      isActive: true,
      $or: [{ relationType: RELATION_TYPES.OWNER }, { userId: user._id }],
    }).select('userId relationType').session(session).lean();
    if (residents.some((resident) => String(resident.userId) !== String(user._id))) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ đang có chủ sở hữu khác. Hãy xử lý qua Chuyển nhượng căn hộ');
    }
    if (residents.some((resident) => resident.relationType === RELATION_TYPES.OWNER)) {
      throw new ApiError('STATUS_CONFLICT', 'Chủ sở hữu đã có quyền truy cập căn hộ này');
    }
    if (residents.length) {
      throw new ApiError('STATUS_CONFLICT', 'Tài khoản đã có vai trò khác tại căn hộ. Hãy đối chiếu lại hồ sơ');
    }

    const confirmedEmail = email?.trim().toLowerCase();
    if (confirmedEmail && confirmedEmail !== user.email) {
      if (user.email || user.activatedAt) {
        throw ApiError.field('email', 'Email đã lưu thuộc hồ sơ tài khoản. Hãy cập nhật qua chức năng quản lý tài khoản');
      }
      if (await User.exists({ email: confirmedEmail }).session(session)) {
        throw new ApiError('EMAIL_EXISTS');
      }
      user.email = confirmedEmail;
      await user.save({ session }).catch((error) => { throw uniqueConflictError(error) ?? error; });
    }

    contract.ownerAccountPending = false;
    contract.ownerAccountIssuedAt = new Date();
    contract.ownerAccountIssuedBy = actor.id;
    await contract.save({ session });

    const resident = await linkResident({
      userId: user._id,
      apartmentId,
      relationType: RELATION_TYPES.OWNER,
      contractId: contract._id,
      moveInDate: contract.startDate,
      idNumber: decryptIdNumber(contract.ownerIdNumberEnc),
    }, session);
    await logAudit({
      action: AUDIT_ACTIONS.OWNER_ACCOUNT_ISSUED,
      user: actor,
      targetType: AUDIT_TARGETS.RESIDENT,
      targetId: resident._id,
      metadata: { apartmentId, contractId: contract._id, userId: user._id },
      ip,
    }, { session });
    return user;
  }).catch((error) => {
    if (error?.code === 11000) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ hoặc tài khoản vừa được liên kết. Vui lòng làm mới');
    }
    throw error;
  });

  const activationInviteSent = owner.activatedAt ? null : await sendActivationInvite(owner);
  try {
    await Promise.all([
      notify(owner._id, {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: 'Đã cấp quyền truy cập căn hộ',
        content: 'Ban quản lý đã liên kết căn hộ với tài khoản của bạn.',
        refId: apartmentId,
        link: '/r/my-apartment',
      }),
      ensureCodes(apartmentId),
    ]);
  } catch (err) {
    console.error('[UC22] Đồng bộ quyền căn hộ', apartmentId, err.message);
  }
  return { activationInviteSent };
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
