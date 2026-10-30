import {
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
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { getHousehold } from '../household/household.service.js';
import { ensureCodes, parseDateOfBirth } from '../memberCodes/memberCodes.service.js';
import {
  buildIdNumberFields,
  decryptIdNumber,
  maskIdNumber,
} from './idCrypto.js';
import { findOrCreateResidentUser, linkResident, welcomeNewResident } from './residentAccounts.js';
import { toPublicUser } from '../auth/auth.service.js';

/**
 * Danh sách thành viên đang hoạt động trong căn hộ (UC-A07, BR-A8)
 * - Trả CCCD dạng che (********1234) cho mọi vai trò.
 * - Muốn xem đầy đủ CCCD dùng endpoint riêng GET /residents/:id/id-number (STAFF:RECEPTIONIST, MANAGER).
 */
export async function listApartmentResidents(apartmentId, viewer) {
  const apartment = await Apartment.findById(apartmentId)
    .select('_id code buildingId status')
    .lean();

  if (!apartment) {
    throw ApiError.notFound('Không tìm thấy căn hộ');
  }

  // BR-A8: Kiểm tra quyền với vai trò RESIDENT
  if (viewer.role === ROLES.RESIDENT) {
    const isMember = await Resident.exists({
      apartmentId,
      userId: viewer.id,
      isActive: true,
    });
    if (!isMember) {
      throw ApiError.forbidden('Bạn không thuộc căn hộ này');
    }
  }

  const rows = await Resident.find({ apartmentId, isActive: true })
    .populate('userId', 'fullName email phone dateOfBirth avatarUrl isActive')
    .lean();

  // Xác định chủ hộ từ getHousehold()
  const household = await getHousehold(apartmentId).catch(() => null);
  const headUserId = household?.head?.userId ? String(household.head.userId) : null;

  const results = rows.map((r) => {
    const u = r.userId || {};
    const isHead = headUserId ? String(u._id) === headUserId : false;
    const plainId = decryptIdNumber(r.idNumberEnc);

    return {
      _id: r._id,
      userId: u._id,
      fullName: u.fullName || '—',
      email: u.email,
      phone: u.phone,
      dateOfBirth: u.dateOfBirth,
      avatarUrl: u.avatarUrl,
      relationType: r.relationType,
      contractId: r.contractId,
      moveInDate: r.moveInDate,
      idNumber: maskIdNumber(plainId),
      hasIdNumber: Boolean(plainId),
      isHead,
    };
  });

  // Chủ hộ đứng đầu, tiếp theo xếp theo ngày dọn vào
  results.sort((a, b) => Number(b.isHead) - Number(a.isHead) || new Date(a.moveInDate) - new Date(b.moveInDate));

  return results;
}

/**
 * Thêm thành viên hộ gia đình (Lễ tân) — UC-A07
 * - Luôn là FAMILY_MEMBER (OWNER/TENANT do Hợp đồng tạo). Căn hộ phải OWNED hoặc RENTED.
 * - Chưa có tài khoản thì tạo mới + gửi mail mật khẩu tạm; mật khẩu chỉ trả về khi gửi mail thất bại.
 */
export async function addMember(receptionistUser, data, ip) {
  const { apartmentId, idNumber } = data;

  let apartment = null;
  let account = null;
  let savedResident = null;

  await withTransaction(async (session) => {
    apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
    if (apartment.status === APARTMENT_STATUS.VACANT) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ chưa có người ở');
    }

    // Thành viên gắn với hợp đồng đang hiệu lực: căn cho thuê → hợp đồng thuê, còn lại → hợp đồng mua bán
    const contractType = apartment.status === APARTMENT_STATUS.RENTED ? CONTRACT_TYPES.LEASE : CONTRACT_TYPES.SALE;
    const activeContract = await Contract.findOne({
      apartmentId,
      type: contractType,
      status: CONTRACT_STATUS.ACTIVE,
    }).session(session);
    if (!activeContract) {
      throw new ApiError(
        'STATUS_CONFLICT',
        contractType === CONTRACT_TYPES.LEASE
          ? 'Căn hộ đang cho thuê nhưng không có hợp đồng thuê hiệu lực'
          : 'Căn hộ chưa có hợp đồng mua bán hiệu lực',
      );
    }

    account = await findOrCreateResidentUser(data, session, { updateDateOfBirth: true });
    const alreadyActive = await Resident.exists({ apartmentId, userId: account.user._id, isActive: true }).session(session);
    if (alreadyActive) throw new ApiError('STATUS_CONFLICT', 'Cư dân đã là thành viên đang ở của căn hộ này');

    savedResident = await linkResident(
      {
        userId: account.user._id,
        apartmentId,
        relationType: RELATION_TYPES.FAMILY_MEMBER,
        contractId: activeContract._id,
        moveInDate: new Date(),
        idNumber: idNumber?.trim() || null,
      },
      session,
    );

    await logAudit(
      {
        action: AUDIT_ACTIONS.RESIDENT_ASSIGNED,
        user: receptionistUser,
        targetType: AUDIT_TARGETS.RESIDENT,
        targetId: savedResident._id,
        metadata: { apartmentId, userId: account.user._id, relationType: RELATION_TYPES.FAMILY_MEMBER },
        ip,
      },
      { session },
    );
  });

  const temporaryPassword = await welcomeNewResident(account);
  await notify(account.user._id, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Đã thêm vào căn hộ',
    content: `Bạn đã được thêm vào danh sách nhân khẩu căn hộ ${apartment.code}`,
    refId: apartmentId,
    link: '/r/my-apartment',
  });
  await syncMemberCodes(apartmentId);

  return { resident: savedResident, user: toPublicUser(account.user), temporaryPassword };
}

async function syncMemberCodes(apartmentId) {
  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }
}

async function findActiveMemberOr409(residentId) {
  const resident = await Resident.findById(residentId);
  if (!resident) throw ApiError.notFound('Không tìm thấy thông tin cư dân');
  if (!resident.isActive) throw new ApiError('STATUS_CONFLICT', 'Cư dân đã rời khỏi căn hộ');
  return resident;
}

/**
 * Cập nhật thông tin thành viên đang ở (Lễ tân) — UC-A07: CCCD trên Resident, ngày sinh trên User
 */
export async function updateMember(residentId, data, receptionistUser, ip) {
  const { idNumber, dateOfBirth } = data;
  const resident = await findActiveMemberOr409(residentId);
  const changes = {};
  const set = {};

  if (idNumber !== undefined) {
    const val = idNumber ? idNumber.trim() : null;
    const oldPlain = decryptIdNumber(resident.idNumberEnc);
    if (val !== oldPlain) {
      changes.idNumber = { from: maskIdNumber(oldPlain), to: maskIdNumber(val) };
      Object.assign(set, buildIdNumberFields(val));
    }
  }

  let dobChanged = false;
  if (dateOfBirth !== undefined) {
    const user = await User.findById(resident.userId).select('dateOfBirth');
    const parsed = dateOfBirth ? parseDateOfBirth(dateOfBirth) : null;
    if (user && String(parsed) !== String(user.dateOfBirth)) {
      changes.dateOfBirth = { from: user.dateOfBirth, to: parsed };
      await User.updateOne({ _id: user._id }, { $set: { dateOfBirth: parsed } });
      dobChanged = true;
    }
  }

  // Ghi có điều kiện isActive: thành viên vừa bị gỡ song song thì không sửa nữa
  const updated = await Resident.findOneAndUpdate(
    { _id: resident._id, isActive: true },
    { $set: set },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ApiError('STATUS_CONFLICT', 'Cư dân vừa rời khỏi căn hộ, vui lòng tải lại');

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.RESIDENT_UPDATED,
      user: receptionistUser,
      targetType: AUDIT_TARGETS.RESIDENT,
      targetId: updated._id,
      metadata: { changes },
      ip,
    });
  }
  if (dobChanged) await syncMemberCodes(updated.apartmentId);

  const obj = updated.toObject();
  obj.idNumber = maskIdNumber(decryptIdNumber(updated.idNumberEnc));
  delete obj.idNumberEnc;
  delete obj.idNumberHash;
  return obj;
}

/**
 * Xem đầy đủ CCCD của cư dân — chỉ STAFF:RECEPTIONIST và MANAGER, có ghi audit (Task 5)
 */
export async function revealResidentIdNumber(residentId, actorUser, ip) {
  const resident = await Resident.findById(residentId).lean();
  if (!resident) {
    throw ApiError.notFound('Không tìm thấy thông tin cư dân');
  }

  const plainId = decryptIdNumber(resident.idNumberEnc);

  await logAudit({
    action: AUDIT_ACTIONS.RESIDENT_ID_VIEWED,
    user: actorUser,
    targetType: AUDIT_TARGETS.RESIDENT,
    targetId: resident._id,
    metadata: {
      apartmentId: resident.apartmentId,
      userId: resident.userId,
    },
    ip,
  });

  return {
    residentId: resident._id,
    idNumber: plainId,
  };
}

/**
 * Gỡ thành viên khỏi căn hộ (Lễ tân) — UC-A07
 * - Chỉ gỡ FAMILY_MEMBER đang ở; OWNER/TENANT phải chấm dứt hợp đồng (409 STATUS_CONFLICT).
 */
export async function removeMember(residentId, receptionistUser, ip) {
  const resident = await findActiveMemberOr409(residentId);
  if (resident.relationType !== RELATION_TYPES.FAMILY_MEMBER) {
    throw new ApiError('STATUS_CONFLICT', 'Hãy chấm dứt hợp đồng để gỡ chủ sở hữu/người thuê');
  }

  const removed = await Resident.findOneAndUpdate(
    { _id: resident._id, isActive: true, relationType: RELATION_TYPES.FAMILY_MEMBER },
    { $set: { isActive: false, moveOutDate: new Date() } },
    { returnDocument: 'after' },
  );
  if (!removed) throw new ApiError('STATUS_CONFLICT', 'Cư dân vừa được cập nhật, vui lòng tải lại');

  await logAudit({
    action: AUDIT_ACTIONS.RESIDENT_REMOVED,
    user: receptionistUser,
    targetType: AUDIT_TARGETS.RESIDENT,
    targetId: removed._id,
    metadata: { apartmentId: removed.apartmentId, userId: removed.userId },
    ip,
  });
  await syncMemberCodes(removed.apartmentId);

  return { message: 'Đã gỡ thành viên khỏi căn hộ thành công' };
}

/**
 * Danh sách căn hộ của tôi (Cư dân) — UC-A08
 * Trả về các căn mà tôi có bản ghi resident isActive = true
 */
export async function myApartments(userOrId) {
  const uid = userOrId.id || userOrId;
  const rows = await Resident.find({ userId: uid, isActive: true })
    .populate({
      path: 'apartmentId',
      populate: { path: 'buildingId', select: 'code name address totalFloors' },
    })
    .sort({ createdAt: 1 })
    .lean();

  const validRows = rows.filter((r) => r.apartmentId);

  const out = [];
  for (const r of validRows) {
    const apt = r.apartmentId;
    const household = await getHousehold(apt._id).catch(() => null);
    const isHead = household?.head?.userId ? String(household.head.userId) === String(uid) : false;

    out.push({
      _id: r._id,
      apartmentId: apt._id,
      code: apt.code,
      floor: apt.floor,
      area: apt.area,
      status: apt.status,
      building: apt.buildingId,
      relationType: r.relationType,
      isHead,
      moveInDate: r.moveInDate,
    });
  }

  return out;
}
