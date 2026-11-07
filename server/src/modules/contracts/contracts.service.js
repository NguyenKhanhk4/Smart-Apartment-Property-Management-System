<<<<<<< HEAD
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
=======
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import {
  APARTMENT_STATUS,
  AUDIT_ACTIONS,
  CONTRACT_STATUS,
  CONTRACT_TYPES,
  RELATION_TYPES,
  ROLES,
} from '../../constants/enums.js';
import {
  Apartment,
  Contract,
  Resident,
  User,
} from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
>>>>>>> origin/minh
import { notify } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
<<<<<<< HEAD
import { DAY_MS, endOfVnDay, startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { disableActiveCardsByApartment } from '../parkingCards/parkingCards.service.js';
import { findOrCreateResidentUser, linkResident, welcomeNewResident } from '../residents/residentAccounts.js';
=======
import { withTransaction } from '../../utils/transaction.js';
import { ensureCodes, parseDateOfBirth } from '../memberCodes/memberCodes.service.js';

function generateTemporaryPassword(length = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  const chars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
  ];

  for (let i = 3; i < length; i += 1) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
>>>>>>> origin/minh

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
<<<<<<< HEAD
    // Theo ngày lịch VN: từ hôm nay đến hết ngày thứ N
    const today = startOfVnDay();
    filter.status = CONTRACT_STATUS.ACTIVE;
    filter.type = CONTRACT_TYPES.LEASE;
    filter.endDate = { $gte: today, $lte: endOfVnDay(new Date(today.getTime() + query.endingWithinDays * DAY_MS)) };
=======
    const now = new Date();
    const future = new Date(Date.now() + query.endingWithinDays * 24 * 60 * 60 * 1000);
    filter.status = CONTRACT_STATUS.ACTIVE;
    filter.type = CONTRACT_TYPES.LEASE;
    filter.endDate = { $gte: now, $lte: future };
>>>>>>> origin/minh
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

<<<<<<< HEAD
/** Ngày hợp đồng lưu 00:00 giờ VN (Joi.date() parse "YYYY-MM-DD" thành 07:00 VN → lệch kỳ hóa đơn bắt đầu ngày 1) */
const contractDay = (value) => (value ? startOfVnDay(new Date(value)) : null);

async function uploadContractFile(file) {
  if (!file) return null;
  const [url] = await uploadToCloudinary([file], 'contracts'); // trả về mảng URL (chuỗi)
  return url ?? null;
}

const findActiveContract = (apartmentId, type, session) =>
  Contract.findOne({ apartmentId, type, status: CONTRACT_STATUS.ACTIVE }).session(session);

=======
>>>>>>> origin/minh
/**
 * Tạo mới hợp đồng mua bán hoặc cho thuê trong 1 transaction (UC-A06.1, BR-A5)
 */
export async function createContract(receptionistUser, data, file, ip) {
<<<<<<< HEAD
  const { apartmentId, type, tenantPaysFees, owner, tenant } = data;
  const startDate = contractDay(data.startDate);
  const endDate = contractDay(data.endDate);
  const fileUrl = await uploadContractFile(file);

  let account = null; // { user, tempPass } của người đứng tên
=======
  const { apartmentId, type, startDate, endDate, tenantPaysFees, owner, tenant } = data;

  // Upload file đính kèm nếu có
  let fileUrl = null;
  if (file) {
    const uploaded = await uploadToCloudinary([file], 'contracts');
    fileUrl = uploaded[0]?.url || null;
  }

  let createdNewUser = null;
>>>>>>> origin/minh
  let savedContract = null;

  await withTransaction(async (session) => {
    const apartment = await Apartment.findById(apartmentId).session(session);
<<<<<<< HEAD
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
=======
    if (!apartment) {
      throw ApiError.notFound('Căn hộ không tồn tại');
    }

    if (type === CONTRACT_TYPES.SALE) {
      // BR-A5: Mỗi căn tối đa 1 SALE ACTIVE
      const activeSale = await Contract.findOne({
        apartmentId,
        type: CONTRACT_TYPES.SALE,
        status: CONTRACT_STATUS.ACTIVE,
      }).session(session);

      if (activeSale) {
        throw ApiError.badRequest('Căn hộ đã có hợp đồng mua bán đang hiệu lực');
      }

      // Xác định chủ sở hữu (User)
      let ownerUser;
      if (owner.userId) {
        ownerUser = await User.findById(owner.userId).session(session);
        if (!ownerUser) throw ApiError.notFound('Chủ sở hữu không tồn tại');
        if (ownerUser.role !== ROLES.RESIDENT) {
          throw ApiError.badRequest('Chỉ tài khoản cư dân mới có thể đứng tên hợp đồng');
        }
      } else {
        const normEmail = owner.email.trim().toLowerCase();
        ownerUser = await User.findOne({ email: normEmail }).session(session);
        if (ownerUser) {
          if (ownerUser.role !== ROLES.RESIDENT) {
            throw ApiError.badRequest('Email của tài khoản nội bộ không được gắn làm cư dân');
          }
        } else {
          // Tạo tài khoản cư dân mới
          const tempPass = generateTemporaryPassword(10);
          const passwordHash = await bcrypt.hash(tempPass, 10);
          const dob = owner.dateOfBirth ? parseDateOfBirth(owner.dateOfBirth) : null;

          [ownerUser] = await User.create(
            [
              {
                fullName: owner.fullName.trim(),
                email: normEmail,
                phone: owner.phone?.trim() || null,
                dateOfBirth: dob,
                passwordHash,
                role: ROLES.RESIDENT,
                isActive: true,
              },
            ],
            { session },
          );
          createdNewUser = { user: ownerUser, tempPass };
          if (!env.isProd) console.log('[module-a] mật khẩu tạm', ownerUser.email, tempPass);
        }
      }

      // Tạo Contract
      const [contract] = await Contract.create(
        [
          {
            apartmentId,
            type: CONTRACT_TYPES.SALE,
            ownerId: ownerUser._id,
            tenantId: null,
            startDate: new Date(startDate),
            endDate: null,
            tenantPaysFees: false,
            status: CONTRACT_STATUS.ACTIVE,
            fileUrl,
            createdBy: receptionistUser._id,
          },
        ],
        { session },
      );
      savedContract = contract;

      // Tạo hoặc kích hoạt lại Resident
      const existingResident = await Resident.findOne({
        userId: ownerUser._id,
        apartmentId,
      }).session(session);

      if (existingResident) {
        existingResident.relationType = RELATION_TYPES.OWNER;
        existingResident.contractId = contract._id;
        existingResident.isActive = true;
        existingResident.moveInDate = new Date(startDate);
        existingResident.moveOutDate = null;
        if (owner.idNumber) existingResident.idNumber = owner.idNumber;
        await existingResident.save({ session });
      } else {
        await Resident.create(
          [
            {
              userId: ownerUser._id,
              apartmentId,
              relationType: RELATION_TYPES.OWNER,
              contractId: contract._id,
              isActive: true,
              moveInDate: new Date(startDate),
              idNumber: owner.idNumber || null,
            },
          ],
          { session },
        );
      }

      // Đặt trạng thái căn hộ thành OWNED
      apartment.status = APARTMENT_STATUS.OWNED;
      await apartment.save({ session });

      await logAudit({
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        user: receptionistUser,
        targetType: 'Contract',
        targetId: contract._id,
        metadata: {
          type: 'SALE',
          apartmentId,
          ownerId: ownerUser._id,
        },
        session,
        ip,
      });
    } else if (type === CONTRACT_TYPES.LEASE) {
      // BR-A5: LEASE cần SALE ACTIVE
      const activeSale = await Contract.findOne({
        apartmentId,
        type: CONTRACT_TYPES.SALE,
        status: CONTRACT_STATUS.ACTIVE,
      }).session(session);

      if (!activeSale) {
        throw ApiError.badRequest('Căn hộ chưa có hợp đồng mua bán đang hiệu lực');
      }

      // BR-A5: Mỗi căn tối đa 1 LEASE ACTIVE
      const activeLease = await Contract.findOne({
        apartmentId,
        type: CONTRACT_TYPES.LEASE,
        status: CONTRACT_STATUS.ACTIVE,
      }).session(session);

      if (activeLease) {
        throw ApiError.badRequest('Căn hộ đã có hợp đồng thuê đang hiệu lực');
      }

      // Kiểm tra ngày kết thúc
      if (!endDate || new Date(endDate) <= new Date(startDate)) {
        throw ApiError.badRequest('Ngày kết thúc phải lớn hơn ngày bắt đầu hợp đồng');
      }

>>>>>>> origin/minh
      // BR-A5: Không tạo LEASE khi căn còn FAMILY_MEMBER thuộc hợp đồng SALE
      const saleFamilyCount = await Resident.countDocuments({
        apartmentId,
        contractId: activeSale._id,
        relationType: RELATION_TYPES.FAMILY_MEMBER,
        isActive: true,
      }).session(session);
<<<<<<< HEAD
      if (saleFamilyCount > 0) {
        throw new ApiError(
          'STATUS_CONFLICT',
          'Căn hộ vẫn còn thành viên thuộc hợp đồng mua bán, vui lòng gỡ trước khi tạo hợp đồng thuê',
        );
      }
      if (!tenant?.userId && !tenant?.phone) {
        throw ApiError.badRequest('Số điện thoại người thuê là bắt buộc đối với hợp đồng cho thuê');
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
=======

      if (saleFamilyCount > 0) {
        throw ApiError.badRequest(
          'Căn hộ vẫn còn thành viên thuộc hợp đồng mua bán, vui lòng gỡ trước khi tạo hợp đồng thuê',
        );
      }

      // Xác định người thuê (User)
      let tenantUser;
      if (tenant?.userId) {
        tenantUser = await User.findById(tenant.userId).session(session);
        if (!tenantUser) throw ApiError.notFound('Người thuê không tồn tại');
        if (tenantUser.role !== ROLES.RESIDENT) {
          throw ApiError.badRequest('Chỉ tài khoản cư dân mới có thể đứng tên hợp đồng thuê');
        }
      } else if (tenant?.email) {
        const normEmail = tenant.email.trim().toLowerCase();
        tenantUser = await User.findOne({ email: normEmail }).session(session);
        if (tenantUser) {
          if (tenantUser.role !== ROLES.RESIDENT) {
            throw ApiError.badRequest('Email của tài khoản nội bộ không được gắn làm cư dân');
          }
        } else {
          const tempPass = generateTemporaryPassword(10);
          const passwordHash = await bcrypt.hash(tempPass, 10);
          const dob = tenant.dateOfBirth ? parseDateOfBirth(tenant.dateOfBirth) : null;

          [tenantUser] = await User.create(
            [
              {
                fullName: tenant.fullName.trim(),
                email: normEmail,
                phone: tenant.phone?.trim() || null,
                dateOfBirth: dob,
                passwordHash,
                role: ROLES.RESIDENT,
                isActive: true,
              },
            ],
            { session },
          );
          createdNewUser = { user: tenantUser, tempPass };
          if (!env.isProd) console.log('[module-a] mật khẩu tạm', tenantUser.email, tempPass);
        }
      } else {
        throw ApiError.badRequest('Thông tin người thuê là bắt buộc đối với hợp đồng cho thuê');
      }

      // BR-A5: Người thuê ≠ chủ sở hữu
      if (String(tenantUser._id) === String(activeSale.ownerId)) {
        throw ApiError.badRequest('Người thuê không được trùng với chủ sở hữu căn hộ');
      }

      // Tạo Contract LEASE
      const [contract] = await Contract.create(
        [
          {
            apartmentId,
            type: CONTRACT_TYPES.LEASE,
            ownerId: activeSale.ownerId,
            tenantId: tenantUser._id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            tenantPaysFees: Boolean(tenantPaysFees),
            status: CONTRACT_STATUS.ACTIVE,
            fileUrl,
            createdBy: receptionistUser._id,
          },
        ],
        { session },
      );
      savedContract = contract;

      // Tạo hoặc kích hoạt lại Resident cho người thuê
      const existingResident = await Resident.findOne({
        userId: tenantUser._id,
        apartmentId,
      }).session(session);

      if (existingResident) {
        existingResident.relationType = RELATION_TYPES.TENANT;
        existingResident.contractId = contract._id;
        existingResident.isActive = true;
        existingResident.moveInDate = new Date(startDate);
        existingResident.moveOutDate = null;
        if (tenant.idNumber) existingResident.idNumber = tenant.idNumber;
        await existingResident.save({ session });
      } else {
        await Resident.create(
          [
            {
              userId: tenantUser._id,
              apartmentId,
              relationType: RELATION_TYPES.TENANT,
              contractId: contract._id,
              isActive: true,
              moveInDate: new Date(startDate),
              idNumber: tenant.idNumber || null,
            },
          ],
          { session },
        );
      }

      // Đặt trạng thái căn hộ thành RENTED
      apartment.status = APARTMENT_STATUS.RENTED;
      await apartment.save({ session });

      await logAudit({
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        user: receptionistUser,
        targetType: 'Contract',
        targetId: contract._id,
        metadata: {
          type: 'LEASE',
          apartmentId,
          ownerId: activeSale.ownerId,
          tenantId: tenantUser._id,
        },
        session,
        ip,
      });
    } else {
      throw ApiError.badRequest('Loại hợp đồng không hợp lệ');
    }
  });

  // Sau khi transaction commit thành công:
  // 1. Gửi email mật khẩu tạm nếu có tạo user mới
  if (createdNewUser) {
    await sendMail({
      to: createdNewUser.user.email,
      subject: '[SAPMS] Thông tin tài khoản cư dân',
      text: `Chào mừng bạn đến với hệ thống SAPMS.\nEmail đăng nhập: ${createdNewUser.user.email}\nMật khẩu tạm thời: ${createdNewUser.tempPass}\nVui lòng đổi mật khẩu sau khi đăng nhập.`,
      html: `<p>Chào mừng bạn đến với hệ thống <b>SAPMS</b>.</p><p><b>Email:</b> ${createdNewUser.user.email}</p><p><b>Mật khẩu tạm:</b> <code>${createdNewUser.tempPass}</code></p><p>Vui lòng đổi mật khẩu sau khi đăng nhập.</p>`,
    });
  }

  // 2. Gửi thông báo trong app
  const targetId = savedContract.type === CONTRACT_TYPES.SALE ? savedContract.ownerId : savedContract.tenantId;
  await notify(targetId, {
    type: 'SYSTEM',
>>>>>>> origin/minh
    title: 'Hợp đồng mới đã được tạo',
    content: `Hợp đồng ${savedContract.type === CONTRACT_TYPES.SALE ? 'mua bán' : 'cho thuê'} của bạn đã được thiết lập thành công.`,
    refId: savedContract._id,
    link: '/r/my-apartment',
  });
<<<<<<< HEAD
=======

  // 3. Đồng bộ mã cư dân ensureCodes ngoài transaction (bọc try/catch)
>>>>>>> origin/minh
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

<<<<<<< HEAD
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
=======
  return {
    contract: savedContract,
    temporaryPassword: createdNewUser?.tempPass || null,
  };
}

/**
 * Cập nhật gia hạn hợp đồng hoặc đổi người trả phí (UC-A06.2)
 */
export async function updateContract(id, data, file, receptionistUser, ip) {
  const contract = await Contract.findById(id);
  if (!contract) {
    throw ApiError.notFound('Hợp đồng không tồn tại');
  }

  if (contract.status !== CONTRACT_STATUS.ACTIVE) {
    throw ApiError.badRequest('Chỉ có thể chỉnh sửa hợp đồng đang có hiệu lực');
  }

  const changes = {};

  if (data.endDate !== undefined) {
    if (contract.type === CONTRACT_TYPES.LEASE) {
      if (!data.endDate || new Date(data.endDate) <= new Date(contract.startDate)) {
        throw ApiError.badRequest('Ngày kết thúc phải lớn hơn ngày bắt đầu hợp đồng');
      }
    }
    changes.endDate = { from: contract.endDate, to: data.endDate };
    contract.endDate = data.endDate ? new Date(data.endDate) : null;
>>>>>>> origin/minh
  }

  if (data.tenantPaysFees !== undefined && contract.type === CONTRACT_TYPES.LEASE) {
    const val = Boolean(data.tenantPaysFees);
    if (val !== contract.tenantPaysFees) {
      changes.tenantPaysFees = { from: contract.tenantPaysFees, to: val };
<<<<<<< HEAD
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
=======
      contract.tenantPaysFees = val;
    }
  }

  if (file) {
    const uploaded = await uploadToCloudinary([file], 'contracts');
    if (uploaded[0]?.url) {
      changes.fileUrl = { from: contract.fileUrl, to: uploaded[0].url };
      contract.fileUrl = uploaded[0].url;
    }
  }

  await contract.save();
>>>>>>> origin/minh

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.CONTRACT_UPDATED,
      user: receptionistUser,
<<<<<<< HEAD
      targetType: AUDIT_TARGETS.CONTRACT,
      targetId: updated._id,
=======
      targetType: 'Contract',
      targetId: contract._id,
>>>>>>> origin/minh
      metadata: { changes },
      ip,
    });
  }

<<<<<<< HEAD
  return updated;
=======
  return contract;
>>>>>>> origin/minh
}

/**
 * Chấm dứt sớm hợp đồng (UC-A06.3, BR-A5)
 */
export async function terminateContract(id, receptionistUser, ip) {
<<<<<<< HEAD
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
=======
  const contract = await Contract.findById(id);
  if (!contract) {
    throw ApiError.notFound('Hợp đồng không tồn tại');
  }

  if (contract.status !== CONTRACT_STATUS.ACTIVE) {
    throw ApiError.badRequest('Chỉ có thể chấm dứt hợp đồng đang có hiệu lực');
  }

  const now = new Date();

  if (contract.type === CONTRACT_TYPES.LEASE) {
    // Chấm dứt LEASE:
    // 1. Contract sang TERMINATED
    contract.status = CONTRACT_STATUS.TERMINATED;
    contract.terminatedAt = now;
    await contract.save();

    // 2. Gỡ residents có contractId là hợp đồng này
    await Resident.updateMany(
      { contractId: contract._id, isActive: true },
      { isActive: false, moveOutDate: now },
    );

    // 3. Căn hộ về OWNED (vì còn SALE)
    await Apartment.findByIdAndUpdate(contract.apartmentId, {
      status: APARTMENT_STATUS.OWNED,
    });

    await logAudit({
      action: AUDIT_ACTIONS.CONTRACT_TERMINATED,
      user: receptionistUser,
      targetType: 'Contract',
      targetId: contract._id,
      metadata: { reason: 'Chấm dứt sớm hợp đồng cho thuê' },
      ip,
    });
  } else if (contract.type === CONTRACT_TYPES.SALE) {
    // BR-A5: Không chấm dứt SALE khi còn LEASE ACTIVE
    const activeLease = await Contract.findOne({
      apartmentId: contract.apartmentId,
      type: CONTRACT_TYPES.LEASE,
      status: CONTRACT_STATUS.ACTIVE,
    });

    if (activeLease) {
      throw ApiError.badRequest(
        'Không thể chấm dứt hợp đồng mua bán khi căn hộ vẫn còn hợp đồng thuê đang hiệu lực',
      );
    }

    // Chấm dứt SALE:
    contract.status = CONTRACT_STATUS.TERMINATED;
    contract.terminatedAt = now;
    await contract.save();

    // Gỡ mọi residents đang hoạt động của căn hộ
    await Resident.updateMany(
      { apartmentId: contract.apartmentId, isActive: true },
      { isActive: false, moveOutDate: now },
    );

    // Căn hộ về VACANT
    await Apartment.findByIdAndUpdate(contract.apartmentId, {
      status: APARTMENT_STATUS.VACANT,
    });

    await logAudit({
      action: AUDIT_ACTIONS.CONTRACT_TERMINATED,
      user: receptionistUser,
      targetType: 'Contract',
      targetId: contract._id,
      metadata: { reason: 'Chấm dứt hợp đồng mua bán' },
      ip,
    });
  }

  // Đồng bộ lại mã cư dân (ensureCodes) ngoài transaction
  try {
    await ensureCodes(contract.apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', contract.apartmentId, err.message);
>>>>>>> origin/minh
  }

  return { message: 'Đã chấm dứt hợp đồng thành công' };
}
