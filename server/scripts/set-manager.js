// Tạo hoặc thay Trưởng BQL khi cài đặt (BR-S01). UC03 không cho tạo role này trên giao diện.
// Tài khoản Trưởng BQL cũ và tài khoản ADMIN còn sót lại bị khóa, không bị xóa (BR-S12).
//
//   MANAGER_PASSWORD='MatKhau123' npm run db:set-manager -- --email a@b.vn --name "Nguyễn Văn A" --phone 0901234567
//
// Mật khẩu lấy từ biến môi trường để không lưu trong lịch sử lệnh; bắt buộc khi tạo tài khoản mới.
// Sau khi có kích hoạt tài khoản (UC11), tài khoản mới sẽ tự đặt mật khẩu và không cần biến này nữa.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { AUDIT_ACTIONS, ROLES } from '../src/constants/enums.js';
import { User } from '../src/models/index.js';
import { logAudit } from '../src/services/auditLog.service.js';
import { withTransaction } from '../src/utils/transaction.js';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,100}$/;

/** Trả về { user, lockedCount } với lockedCount là số tài khoản quản trị cũ vừa bị khóa */
export async function setManager({ email, fullName, phone, password }) {
  if (!email) throw new Error('Thiếu --email');
  if (password && !PASSWORD_RULE.test(password)) {
    throw new Error('Mật khẩu tối thiểu 8 ký tự, có cả chữ và số');
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  return withTransaction(async (session) => {
    let user = await User.findOne({ email: normalizedEmail }).select('+passwordHash +tokenVersion').session(session);
    if (user?.role === ROLES.RESIDENT) throw new Error('Không dùng tài khoản cư dân làm Trưởng BQL');
    if (!user && (!fullName || !passwordHash)) {
      throw new Error('Tạo tài khoản mới cần --name và biến môi trường MANAGER_PASSWORD');
    }

    // Khóa trước khi gán để không vi phạm index "chỉ 1 Trưởng BQL đang hoạt động" (BR-R1)
    const oldAdmins = { isActive: true, role: { $in: [ROLES.MANAGER, 'ADMIN'] } };
    if (user) oldAdmins._id = { $ne: user._id };
    const { modifiedCount: lockedCount } = await User.updateMany(
      oldAdmins,
      { $set: { isActive: false }, $inc: { tokenVersion: 1 } },
      { session },
    );

    if (user) {
      user.set({ role: ROLES.MANAGER, roleTitle: null, boardTitle: null, isActive: true });
      if (fullName) user.fullName = fullName.trim();
      if (phone) user.phone = phone.trim();
      if (passwordHash) user.passwordHash = passwordHash;
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await user.save({ session });
    } else {
      [user] = await User.create(
        [
          {
            email: normalizedEmail,
            fullName: fullName.trim(),
            phone: phone?.trim() || null,
            passwordHash,
            role: ROLES.MANAGER,
            isActive: true,
          },
        ],
        { session },
      );
    }

    await logAudit(
      {
        action: AUDIT_ACTIONS.ROLE_ASSIGNED,
        user: null,
        targetType: 'users',
        targetId: user._id,
        metadata: { role: ROLES.MANAGER, source: 'set-manager', lockedCount },
      },
      { session },
    );
    return { user, lockedCount };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' } },
  });
  await connectDB();
  try {
    const { user, lockedCount } = await setManager({
      email: values.email,
      fullName: values.name,
      phone: values.phone,
      password: process.env.MANAGER_PASSWORD,
    });
    console.log(`Trưởng BQL: ${user.email}. Đã khóa ${lockedCount} tài khoản quản trị cũ.`);
  } finally {
    await disconnectDB();
  }
}
