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
import { notify } from '../../services/notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { getHousehold } from '../household/household.service.js';
import { ensureCodes, parseDateOfBirth } from '../memberCodes/memberCodes.service.js';
import { generateTemporaryPassword } from '../users/password.utils.js';

/**
 * Gắn hoặc kích hoạt lại bản ghi cư dân trong căn hộ (BR-A5, BR-O1)
 * Đảm bảo không tạo 2 bản ghi cho cùng (userId, apartmentId)
 */
export async function linkResident(
  { userId, apartmentId, relationType, contractId, moveInDate, idNumber },
  session = null,
) {
  const query = Resident.findOne({ userId, apartmentId });
  if (session) query.session(session);
  const existing = await query;

  if (existing) {
    existing.relationType = relationType;
    existing.contractId = contractId || null;
    existing.isActive = true;
    existing.moveInDate = moveInDate || existing.moveInDate || new Date();
    existing.moveOutDate = null;
    if (idNumber) existing.idNumber = idNumber;
    await existing.save({ session });
    return existing;
  }

  const [created] = await Resident.create(
    [
      {
        userId,
        apartmentId,
        relationType,
        contractId: contractId || null,
        isActive: true,
        moveInDate: moveInDate || new Date(),
        idNumber: idNumber || null,
      },
    ],
    { session },
  );
  return created;
}

/**
 * Danh sách thành viên đang hoạt động trong căn hộ (UC-A07, BR-A8)
 * - RESIDENT chỉ xem căn mình đang ở (BR-A8) và bị ẩn idNumber (CCCD).
 * - Trưởng BQL / Lễ tân xem được đầy đủ CCCD.
 * - isHead lấy từ getHousehold (chỉ đọc).
 */
export async function listApartmentResidents(apartmentId, viewer) {
  const apartment = await Apartment.findById(apartmentId)
    .select('_id code buildingId status')
    .lean();

  if (!apartment) {
    throw ApiError.notFound('Không tìm thấy căn hộ');
  }

  // BR-A8: Kiểm tra quyền với vai trò RESIDENT
  const viewerId = viewer?.id || viewer?._id;
  if (viewer.role === ROLES.RESIDENT) {
    const isMember = await Resident.exists({
      apartmentId,
      userId: viewerId,
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
  const isResidentViewer = viewer.role === ROLES.RESIDENT;

  const results = rows.map((r) => {
    const u = r.userId || {};
    const isHead = headUserId ? String(u._id) === headUserId : false;

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
      idNumber: isResidentViewer ? undefined : r.idNumber,
      isHead,
    };
  });

  // Chủ hộ đứng đầu, tiếp theo xếp theo ngày dọn vào
  results.sort((a, b) => Number(b.isHead) - Number(a.isHead) || new Date(a.moveInDate) - new Date(b.moveInDate));

  return results;
}

/**
 * Thêm thành viên hộ gia đình (Lễ tân) — UC-A07
 * - Luôn là FAMILY_MEMBER (OWNER/TENANT do Hợp đồng tạo).
 * - Căn hộ phải OWNED hoặc RENTED.
 * - Tự động tạo user mới nếu chưa có, gửi mail mật khẩu tạm.
 */
export async function addMember(receptionistUser, data, ip) {
  const { apartmentId, email, fullName, phone, idNumber, dateOfBirth } = data;

  const apartment = await Apartment.findById(apartmentId);
  if (!apartment) {
    throw ApiError.notFound('Không tìm thấy căn hộ');
  }

  if (apartment.status === APARTMENT_STATUS.VACANT) {
    throw ApiError.badRequest('Căn hộ chưa có người ở');
  }

  // Xác định hợp đồng ACTIVE để gắn contractId
  let contractId = null;
  if (apartment.status === APARTMENT_STATUS.RENTED) {
    const activeLease = await Contract.findOne({
      apartmentId,
      type: CONTRACT_TYPES.LEASE,
      status: CONTRACT_STATUS.ACTIVE,
    });
    if (!activeLease) {
      throw ApiError.badRequest('Căn hộ đang cho thuê nhưng không có hợp đồng thuê hiệu lực');
    }
    contractId = activeLease._id;
  } else {
    const activeSale = await Contract.findOne({
      apartmentId,
      type: CONTRACT_TYPES.SALE,
      status: CONTRACT_STATUS.ACTIVE,
    });
    if (!activeSale) {
      throw ApiError.badRequest('Căn hộ chưa có hợp đồng mua bán hiệu lực');
    }
    contractId = activeSale._id;
  }

  // Kiểm tra tài khoản User
  const normEmail = email.trim().toLowerCase();
  let user = await User.findOne({ email: normEmail });
  let createdNewUser = null;

  if (user) {
    if (user.role !== ROLES.RESIDENT) {
      throw ApiError.badRequest('Email của tài khoản nội bộ không được gắn làm cư dân');
    }

    const alreadyActive = await Resident.findOne({
      apartmentId,
      userId: user._id,
      isActive: true,
    });
    if (alreadyActive) {
      throw ApiError.badRequest('Cư dân đã là thành viên đang ở của căn hộ này');
    }

    if (dateOfBirth) {
      user.dateOfBirth = parseDateOfBirth(dateOfBirth);
      await user.save();
    }
  } else {
    const tempPass = generateTemporaryPassword(10);
    const passwordHash = await bcrypt.hash(tempPass, 10);
    const parsedDob = dateOfBirth ? parseDateOfBirth(dateOfBirth) : null;

    user = await User.create({
      fullName: fullName.trim(),
      email: normEmail,
      phone: phone?.trim() || null,
      dateOfBirth: parsedDob,
      passwordHash,
      role: ROLES.RESIDENT,
      isActive: true,
    });
    createdNewUser = { user, tempPass };
    if (!env.isProd) console.log('[module-a] mật khẩu tạm', user.email, tempPass);
  }

  let savedResident = null;
  await withTransaction(async (session) => {
    savedResident = await linkResident(
      {
        userId: user._id,
        apartmentId,
        relationType: RELATION_TYPES.FAMILY_MEMBER,
        contractId,
        moveInDate: new Date(),
        idNumber: idNumber?.trim() || null,
      },
      session,
    );

    await logAudit({
      action: AUDIT_ACTIONS.RESIDENT_ASSIGNED,
      user: receptionistUser,
      targetType: 'Resident',
      targetId: savedResident._id,
      metadata: {
        apartmentId,
        userId: user._id,
        relationType: RELATION_TYPES.FAMILY_MEMBER,
      },
      session,
      ip,
    });
  });

  // Sau commit:
  if (createdNewUser) {
    await sendMail({
      to: user.email,
      subject: '[SAPMS] Thông tin tài khoản cư dân',
      text: `Chào mừng bạn đến với hệ thống SAPMS.\nEmail đăng nhập: ${user.email}\nMật khẩu tạm thời: ${createdNewUser.tempPass}\nVui lòng đổi mật khẩu sau khi đăng nhập.`,
      html: `<p>Chào mừng bạn đến với hệ thống <b>SAPMS</b>.</p><p><b>Email:</b> ${user.email}</p><p><b>Mật khẩu tạm:</b> <code>${createdNewUser.tempPass}</code></p><p>Vui lòng đổi mật khẩu sau khi đăng nhập.</p>`,
    });
  }

  await notify(user._id, {
    type: 'SYSTEM',
    title: 'Đã thêm vào căn hộ',
    content: `Bạn đã được thêm vào danh sách nhân khẩu căn hộ ${apartment.code}`,
    refId: apartmentId,
    link: '/r/my-apartment',
  });

  try {
    await ensureCodes(apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', apartmentId, err.message);
  }

  return {
    resident: savedResident,
    user,
    temporaryPassword: createdNewUser?.tempPass || null,
  };
}

/**
 * Cập nhật thông tin thành viên (Lễ tân) — UC-A07
 * Sửa CCCD trên Resident, sửa dateOfBirth trên User
 */
export async function updateMember(residentId, data, receptionistUser, ip) {
  const { idNumber, dateOfBirth } = data;

  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw ApiError.notFound('Không tìm thấy thông tin cư dân');
  }

  const changes = {};

  if (idNumber !== undefined) {
    const val = idNumber ? idNumber.trim() : null;
    if (val !== resident.idNumber) {
      changes.idNumber = { from: resident.idNumber, to: val };
      resident.idNumber = val;
    }
  }

  let dobChanged = false;
  if (dateOfBirth !== undefined) {
    const user = await User.findById(resident.userId);
    if (user) {
      const parsed = dateOfBirth ? parseDateOfBirth(dateOfBirth) : null;
      if (String(parsed) !== String(user.dateOfBirth)) {
        changes.dateOfBirth = { from: user.dateOfBirth, to: parsed };
        user.dateOfBirth = parsed;
        await user.save();
        dobChanged = true;
      }
    }
  }

  await resident.save();

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.RESIDENT_ASSIGNED,
      user: receptionistUser,
      targetType: 'Resident',
      targetId: resident._id,
      metadata: { changes, action: 'UPDATE_INFO' },
      ip,
    });
  }

  if (dobChanged) {
    try {
      await ensureCodes(resident.apartmentId);
    } catch (err) {
      console.error('[module-a] ensureCodes', resident.apartmentId, err.message);
    }
  }

  return resident;
}

/**
 * Gỡ thành viên khỏi căn hộ (Lễ tân) — UC-A07
 * - Chỉ gỡ FAMILY_MEMBER.
 * - OWNER/TENANT ném 409 STATUS_CONFLICT.
 */
export async function removeMember(residentId, receptionistUser, ip) {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw ApiError.notFound('Không tìm thấy thông tin cư dân');
  }

  if (!resident.isActive) {
    throw ApiError.badRequest('Cư dân đã rời khỏi căn hộ');
  }

  if (resident.relationType !== RELATION_TYPES.FAMILY_MEMBER) {
    throw new ApiError('STATUS_CONFLICT', 'Hãy chấm dứt hợp đồng để gỡ chủ sở hữu/người thuê');
  }

  const now = new Date();
  resident.isActive = false;
  resident.moveOutDate = now;
  await resident.save();

  await logAudit({
    action: AUDIT_ACTIONS.RESIDENT_REMOVED,
    user: receptionistUser,
    targetType: 'Resident',
    targetId: resident._id,
    metadata: {
      apartmentId: resident.apartmentId,
      userId: resident.userId,
    },
    ip,
  });

  try {
    await ensureCodes(resident.apartmentId);
  } catch (err) {
    console.error('[module-a] ensureCodes', resident.apartmentId, err.message);
  }

  return { message: 'Đã gỡ thành viên khỏi căn hộ thành công' };
}

/**
 * Danh sách căn hộ của tôi (Cư dân) — UC-A08
 * Trả về các căn mà tôi có bản ghi resident isActive = true
 */
export async function myApartments(userOrId) {
  const uid = userOrId?.id || userOrId?._id || userOrId;
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
