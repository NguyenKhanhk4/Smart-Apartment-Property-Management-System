// Tài khoản cư dân + liên kết căn hộ, dùng chung cho Hợp đồng (UC-A06) và Thêm thành viên (UC-A07).
// Trước đây mỗi nơi tự chép logic tạo user / gửi mail mật khẩu tạm / gắn resident.
import bcrypt from 'bcryptjs';
import { ROLES } from '../../constants/enums.js';
import { Resident, User } from '../../models/index.js';
import { sendMail } from '../../services/mail.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateTemporaryPassword } from '../../utils/password.js';
import { parseDateOfBirth } from '../memberCodes/memberCodes.service.js';
import { buildIdNumberFields } from './idCrypto.js';

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Tìm tài khoản cư dân theo userId hoặc email; chưa có thì tạo mới với mật khẩu tạm.
 * Email thuộc tài khoản nội bộ → 409 EMAIL_EXISTS. `updateDateOfBirth`: user đã có thì cập nhật ngày sinh nếu được gửi.
 * @returns {{ user, tempPass: string|null }} tempPass chỉ có khi vừa tạo tài khoản
 */
export async function findOrCreateResidentUser(
  { userId, email, fullName, phone, dateOfBirth },
  session = null,
  { updateDateOfBirth = false } = {},
) {
  if (userId) {
    const user = await User.findById(userId).session(session);
    if (!user) throw ApiError.notFound('Tài khoản cư dân không tồn tại');
    if (user.role !== ROLES.RESIDENT) throw ApiError.badRequest('Chỉ tài khoản cư dân mới có thể đứng tên / làm thành viên căn hộ');
    return { user, tempPass: null };
  }

  const normEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normEmail }).session(session);
  if (existing) {
    if (existing.role !== ROLES.RESIDENT) {
      throw new ApiError('EMAIL_EXISTS', 'Email đã thuộc tài khoản nội bộ, không thể gắn làm cư dân');
    }
    if (updateDateOfBirth && dateOfBirth) {
      existing.dateOfBirth = parseDateOfBirth(dateOfBirth);
      await existing.save({ session });
    }
    return { user: existing, tempPass: null };
  }

  const tempPass = generateTemporaryPassword();
  const [user] = await User.create(
    [
      {
        fullName: fullName.trim(),
        email: normEmail,
        phone: phone?.trim() || null,
        dateOfBirth: dateOfBirth ? parseDateOfBirth(dateOfBirth) : null,
        passwordHash: await bcrypt.hash(tempPass, 10),
        role: ROLES.RESIDENT,
        isActive: true,
      },
    ],
    { session },
  );
  return { user, tempPass };
}

/**
 * Gắn hoặc kích hoạt lại bản ghi cư dân trong căn hộ (BR-A5, BR-O1) — không tạo 2 bản ghi cho cùng (userId, apartmentId).
 * CCCD chỉ ghi đè khi được gửi.
 */
export async function linkResident({ userId, apartmentId, relationType, contractId, moveInDate, idNumber }, session = null) {
  const existing = await Resident.findOne({ userId, apartmentId }).session(session);
  if (existing) {
    existing.relationType = relationType;
    existing.contractId = contractId || null;
    existing.isActive = true;
    existing.moveInDate = moveInDate || new Date();
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

/** Mật khẩu tạm chỉ trả về API khi KHÔNG gửi được email — lễ tân báo trực tiếp cho cư dân */
export const tempPasswordForResponse = (tempPass, emailSent) => (tempPass && !emailSent ? tempPass : null);

/**
 * Gửi email chào mừng kèm mật khẩu tạm cho tài khoản vừa tạo (gọi SAU khi transaction commit).
 * Trả về mật khẩu tạm cần hiển thị cho lễ tân (null nếu email đã gửi hoặc không tạo tài khoản mới).
 */
export async function welcomeNewResident({ user, tempPass }) {
  if (!tempPass) return null;
  const sent = await sendMail({
    to: user.email,
    subject: '[SAPMS] Thông tin tài khoản cư dân',
    text: `Chào mừng bạn đến với hệ thống SAPMS.\nEmail đăng nhập: ${user.email}\nMật khẩu tạm thời: ${tempPass}\nVui lòng đổi mật khẩu sau khi đăng nhập.`,
    html:
      `<p>Chào mừng bạn đến với hệ thống <b>SAPMS</b>.</p><p><b>Email:</b> ${escapeHtml(user.email)}</p>` +
      `<p><b>Mật khẩu tạm:</b> <code>${escapeHtml(tempPass)}</code></p><p>Vui lòng đổi mật khẩu sau khi đăng nhập.</p>`,
  });
  return tempPasswordForResponse(tempPass, sent);
}
