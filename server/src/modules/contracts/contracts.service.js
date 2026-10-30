import {
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
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { disableActiveCardsByApartment } from '../parkingCards/parkingCards.service.js';
import { findOrCreateResidentUser, linkResident, welcomeNewResident } from '../residents/residentAccounts.js';

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
 * Tạo mới hợp đồng mua bán hoặc cho thuê trong 1 transaction (UC-A06.1, BR-A5)
 */
export async function createContract(receptionistUser, data, file, ip) {
  const { apartmentId, type, tenantPaysFees, owner, tenant } = data;
  const startDate = contractDay(data.startDate);
  const endDate = contractDay(data.endDate);
  const fileUrl = await uploadContractFile(file);

  let account = null; // { user, tempPass } của người đứng tên
  let savedContract = null;

  await withTransaction(async (session) => {
    const apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Căn hộ không tồn tại');

    let contractFields;
    let relationType;
    let party;

    if (type === CONTRACT_TYPES.SALE) {
      // BR-A5: Mỗi căn tối đa 1 SALE ACTIVE
      if (await findActiveContract(apartmentId, CONTRACT_TYPES.SALE, session)) {
        throw new ApiError('CONTRACT_ACTIVE_EXISTS', 'Căn hộ đã có hợp đồng mua bán đang hiệu lực');
      }
      account = await findOrCreateResidentUser(owner, session);
      relationType = RELATION_TYPES.OWNER;
      party = owner;
      contractFields = { ownerId: account.user._id, tenantId: null, endDate: null, tenantPaysFees: false };
      apartment.status = APARTMENT_STATUS.OWNED;
    } else if (type === CONTRACT_TYPES.LEASE) {
      // BR-A5: LEASE cần SALE ACTIVE và tối đa 1 LEASE ACTIVE
      const activeSale = await findActiveContract(apartmentId, CONTRACT_TYPES.SALE, session);
      if (!activeSale) throw ApiError.badRequest('Căn hộ chưa có hợp đồng mua bán đang hiệu lực');
      if (await findActiveContract(apartmentId, CONTRACT_TYPES.LEASE, session)) {
        throw new ApiError('CONTRACT_ACTIVE_EXISTS', 'Căn hộ đã có hợp đồng thuê đang hiệu lực');
      }
      if (!endDate || endDate <= startDate) {
        throw ApiError.field('endDate', 'Ngày kết thúc phải lớn hơn ngày bắt đầu hợp đồng');
      }
      // BR-A5: Không tạo LEASE khi căn còn FAMILY_MEMBER thuộc hợp đồng SALE
      const saleFamilyCount = await Resident.countDocuments({
        apartmentId,
        contractId: activeSale._id,
        relationType: RELATION_TYPES.FAMILY_MEMBER,
        isActive: true,
      }).session(session);
      if (saleFamilyCount > 0) {
        throw new ApiError(
          'STATUS_CONFLICT',
          'Căn hộ vẫn còn thành viên thuộc hợp đồng mua bán, vui lòng gỡ trước khi tạo hợp đồng thuê',
        );
      }
      if (!tenant?.userId && !tenant?.email) {
        throw ApiError.badRequest('Thông tin người thuê là bắt buộc đối với hợp đồng cho thuê');
      }
      account = await findOrCreateResidentUser(tenant, session);
      // BR-A5: Người thuê ≠ chủ sở hữu
      if (String(account.user._id) === String(activeSale.ownerId)) {
        throw ApiError.badRequest('Người thuê không được trùng với chủ sở hữu căn hộ');
      }
      relationType = RELATION_TYPES.TENANT;
      party = tenant;
      contractFields = {
        ownerId: activeSale.ownerId,
        tenantId: account.user._id,
        endDate,
        tenantPaysFees: Boolean(tenantPaysFees),
      };
      apartment.status = APARTMENT_STATUS.RENTED;
    } else {
      throw ApiError.badRequest('Loại hợp đồng không hợp lệ');
    }

    const [contract] = await Contract.create(
      [
        {
          apartmentId,
          type,
          ...contractFields,
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
        relationType,
        contractId: contract._id,
        moveInDate: startDate,
        idNumber: party.idNumber,
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

  // Sau commit: email mật khẩu tạm (nếu vừa tạo tài khoản), thông báo, đồng bộ mã cư dân
  const temporaryPassword = await welcomeNewResident(account);
  await notify(account.user._id, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Hợp đồng mới đã được tạo',
    content: `Hợp đồng ${savedContract.type === CONTRACT_TYPES.SALE ? 'mua bán' : 'cho thuê'} của bạn đã được thiết lập thành công.`,
    refId: savedContract._id,
    link: '/r/my-apartment',
  });
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

  return { contract: savedContract, temporaryPassword };
}

/**
 * Cập nhật gia hạn hợp đồng hoặc đổi người trả phí (UC-A06.2).
 * Ghi có điều kiện status = ACTIVE: hợp đồng vừa bị chấm dứt / hết hạn song song thì trả 409, không ghi đè.
 */
export async function updateContract(id, data, file, receptionistUser, ip) {
  const contract = await Contract.findById(id).lean();
  if (!contract) throw ApiError.notFound('Hợp đồng không tồn tại');
  if (contract.status !== CONTRACT_STATUS.ACTIVE) {
    throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể chỉnh sửa hợp đồng đang có hiệu lực');
  }

  const changes = {};
  const set = {};

  if (data.endDate !== undefined) {
    const endDate = contractDay(data.endDate);
    if (contract.type === CONTRACT_TYPES.LEASE && (!endDate || endDate <= contract.startDate)) {
      throw ApiError.field('endDate', 'Ngày kết thúc phải lớn hơn ngày bắt đầu hợp đồng');
    }
    changes.endDate = { from: contract.endDate, to: endDate };
    set.endDate = endDate;
    set.remindedAt = null;
  }

  if (data.tenantPaysFees !== undefined && contract.type === CONTRACT_TYPES.LEASE) {
    const val = Boolean(data.tenantPaysFees);
    if (val !== contract.tenantPaysFees) {
      changes.tenantPaysFees = { from: contract.tenantPaysFees, to: val };
      set.tenantPaysFees = val;
    }
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

    if (contract.status !== CONTRACT_STATUS.ACTIVE) {
      throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể chấm dứt hợp đồng đang có hiệu lực');
    }

    apartmentId = contract.apartmentId;
    const now = new Date();

    if (contract.type === CONTRACT_TYPES.LEASE) {
      // Chấm dứt LEASE:
      // 1. Contract sang TERMINATED
      contract.status = CONTRACT_STATUS.TERMINATED;
      contract.terminatedAt = now;
      await contract.save({ session });

      // 2. Gỡ residents có contractId là hợp đồng này
      await Resident.updateMany(
        { contractId: contract._id, isActive: true },
        { isActive: false, moveOutDate: now },
        { session },
      );

      // 3. Căn hộ về OWNED (vì còn SALE)
      await Apartment.findByIdAndUpdate(
        contract.apartmentId,
        { status: APARTMENT_STATUS.OWNED },
        { session },
      );

      // 4. Chuyển thẻ gửi xe ACTIVE sang DISABLED_TO_COLLECT (UC66)
      await disableActiveCardsByApartment(contract.apartmentId, null, session, receptionistUser);

      await logAudit(
        {
          action: AUDIT_ACTIONS.CONTRACT_TERMINATED,
          user: receptionistUser,
          targetType: AUDIT_TARGETS.CONTRACT,
          targetId: contract._id,
          metadata: { reason: 'Chấm dứt sớm hợp đồng cho thuê' },
          ip,
        },
        { session },
      );
    } else if (contract.type === CONTRACT_TYPES.SALE) {
      // BR-A5: Không chấm dứt SALE khi còn LEASE ACTIVE
      const activeLease = await Contract.findOne({
        apartmentId: contract.apartmentId,
        type: CONTRACT_TYPES.LEASE,
        status: CONTRACT_STATUS.ACTIVE,
      }).session(session);

      if (activeLease) {
        throw new ApiError(
          'STATUS_CONFLICT',
          'Không thể chấm dứt hợp đồng mua bán khi căn hộ vẫn còn hợp đồng thuê đang hiệu lực',
        );
      }

      // Chấm dứt SALE:
      contract.status = CONTRACT_STATUS.TERMINATED;
      contract.terminatedAt = now;
      await contract.save({ session });

      // Gỡ mọi residents đang hoạt động của căn hộ
      await Resident.updateMany(
        { apartmentId: contract.apartmentId, isActive: true },
        { isActive: false, moveOutDate: now },
        { session },
      );

      // Căn hộ về VACANT
      await Apartment.findByIdAndUpdate(
        contract.apartmentId,
        { status: APARTMENT_STATUS.VACANT },
        { session },
      );

      // Chuyển thẻ gửi xe ACTIVE sang DISABLED_TO_COLLECT (UC66)
      await disableActiveCardsByApartment(contract.apartmentId, null, session, receptionistUser);

      await logAudit(
        {
          action: AUDIT_ACTIONS.CONTRACT_TERMINATED,
          user: receptionistUser,
          targetType: AUDIT_TARGETS.CONTRACT,
          targetId: contract._id,
          metadata: { reason: 'Chấm dứt hợp đồng mua bán' },
          ip,
        },
        { session },
      );
    }
  });

  // Đồng bộ lại mã cư dân (ensureCodes) ngoài transaction
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

  return { message: 'Đã chấm dứt hợp đồng thành công' };
}
