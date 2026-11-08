// Tài khoản cư dân + liên kết căn hộ, dùng chung cho Hợp đồng (UC-A06) và Thêm thành viên (UC-A07).
// Trước đây mỗi nơi tự chép logic tạo user / gửi mail mật khẩu tạm / gắn resident.
import { env } from '../../config/env.js';
import { ROLES } from '../../constants/enums.js';
import { Resident, User } from '../../models/index.js';
import { sendMail } from '../../services/mail.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalizePhone } from '../../utils/validators.js';
import { parseDateOfBirth } from '../memberCodes/memberCodes.service.js';
import { assertPhoneAndEmailFree, findUserByPhone, uniqueConflictError } from '../users/userLookup.js';
import { buildIdNumberFields } from './idCrypto.js';

/**
 * Lấy tài khoản cư dân đã được lễ tân xác nhận (userId), hoặc tạo mới ở trạng thái chờ kích hoạt khi SĐT chưa có tài khoản.
 * Hệ thống không tạo và không gửi mật khẩu; cư dân tự đặt khi kích hoạt (BR-S02, UC11).
 * SĐT đã có tài khoản mà chưa xác nhận → 409 ACCOUNT_CONFIRM_REQUIRED, tránh gõ nhầm số gắn nhầm người.
 * Không ghi đè thông tin của tài khoản có sẵn (BR-X5). Tạo mới cần họ tên; email không bắt buộc (BR-X4),
 * không có email thì Lễ tân cấp mã kích hoạt tại quầy (UC02).
 * SĐT thuộc tài khoản nội bộ → 409 PHONE_EXISTS.
 * @returns {{ user, created: boolean }}
 */
export async function findOrCreateResidentUser({ userId, email, fullName, phone, dateOfBirth }, session = null) {
  if (userId) {
    const user = await User.findById(userId).session(session);
    if (!user) throw ApiError.notFound('Tài khoản cư dân không tồn tại');
    if (user.role !== ROLES.RESIDENT) throw ApiError.badRequest('Chỉ tài khoản cư dân mới có thể đứng tên / làm thành viên căn hộ');
    // SĐT gửi kèm là số lễ tân đã đối chiếu: phải vẫn thuộc đúng tài khoản này
    if (phone && normalizePhone(phone) !== user.phone) throw new ApiError('ACCOUNT_CONFIRM_REQUIRED');
    return { user, created: false };
  }

  if (!phone) throw ApiError.field('phone', 'Số điện thoại là bắt buộc');

  const existing = await findUserByPhone(phone, session);
  if (existing) {
    if (existing.role !== ROLES.RESIDENT) {
      throw new ApiError('PHONE_EXISTS', 'Số điện thoại đã thuộc tài khoản nội bộ, không thể gắn làm cư dân');
    }
    throw new ApiError('ACCOUNT_CONFIRM_REQUIRED', undefined, {
      details: [{ field: 'phone', message: 'Số điện thoại này đã có tài khoản' }],
    });
  }

  if (!fullName) throw ApiError.field('fullName', 'Tạo tài khoản mới cần họ tên');
  const normEmail = email?.trim().toLowerCase() || null;
  await assertPhoneAndEmailFree({ phone, email: normEmail }, session);

  const [user] = await User.create(
    [
      {
        fullName: fullName.trim(),
        email: normEmail,
        phone,
        dateOfBirth: dateOfBirth ? parseDateOfBirth(dateOfBirth) : null,
        role: ROLES.RESIDENT,
        isActive: true,
      },
    ],
    { session },
  ).catch((err) => {
    throw uniqueConflictError(err) ?? err;
  });
  return { user, created: true };
}

/**
 * Gắn người vào một đợt cư trú; không tái sử dụng hoặc ghi đè đợt cư trú đã kết thúc.
 * CCCD chỉ ghi đè khi được gửi.
 */
export async function linkResident({ userId, apartmentId, relationType, contractId, moveInDate, idNumber }, session = null) {
  const existing = await Resident.findOne({ userId, apartmentId, isActive: true }).session(session);
  if (existing) {
    existing.relationType = relationType;
    existing.contractId = contractId || null;
    existing.isActive = true;
    existing.moveInDate ??= moveInDate || new Date();
    existing.moveOutDate = null;
    if (idNumber) Object.assign(existing, buildIdNumberFields(idNumber));
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
        ...buildIdNumberFields(idNumber),
      },
    ],
    { session },
  );
  return created;
}

/**
 * Mời cư dân vừa tạo tài khoản đi kích hoạt (gọi SAU khi transaction commit); email không chứa mật khẩu.
 * @returns {boolean|null} đã gửi được email hay chưa (không có email thì false); null nếu không tạo tài khoản mới
 */
export async function inviteNewResident({ user, created }) {
  return created ? sendActivationInvite(user) : null;
}

export async function sendActivationInvite(user) {
  if (!user.email) return false;
  const link = `${env.clientUrls[0]}/activate`;
  return sendMail({
    to: user.email,
    subject: '[SAPMS] Kích hoạt tài khoản cư dân',
    text: `Tài khoản SAPMS của bạn đã được tạo. Vui lòng kích hoạt và tự đặt mật khẩu tại: ${link}\nKhi kích hoạt, bạn cần số điện thoại, mã căn hộ và email này. Đăng nhập bằng số điện thoại.`,
  });
}
