import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import { authApi } from '../api/auth.api';
import { SESSION_EXPIRED_EVENT } from '../api/axiosClient';
import { SESSION_EXPIRED_FLAG, authStorage } from '../utils/authStorage';
import { hasRole as matchRoles } from '../utils/permission';
import { permissionApi } from '../api/moduleA.api';
import { PERMISSIONS_CHANGED_EVENT } from '../utils/permissionEvents';

const EMPTY = new Set();

/**
 * Giữ phiên đăng nhập phía client. Module Auth (Module A — Vũ Việt):
 *   - gọi POST /auth/login rồi `startSession({ user, accessToken, refreshToken })`
 *   - gọi POST /auth/logout (fire-and-forget) khi `logout()`
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authStorage.getUser());

  // Refresh token thất bại ở bất kỳ request nào → xóa phiên; RequireAuth sẽ đưa về /login.
  useEffect(() => {
    const handleExpired = () => {
      // Trang đăng nhập đọc cờ này để hiện MSG-S03 (UC01 Step 7a)
      try {
        window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1');
      } catch {
        // Không lưu được thì chỉ thiếu thông báo
      }
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);

  const startSession = useCallback(({ user: nextUser, accessToken, refreshToken }) => {
    authStorage.setTokens({ accessToken, refreshToken });
    authStorage.setUser(nextUser);
    setUser(nextUser);
  }, []);

  const updateUser = useCallback((nextUser) => {
    authStorage.setUser(nextUser);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    // Lấy token trước khi xóa phiên. Tài khoản đăng nhập dev không có refresh token thì không cần gọi.
    const refreshToken = authStorage.getRefreshToken();
    if (refreshToken) authApi.logout(refreshToken).catch(() => {});
    authStorage.clear();
    setUser(null);
  }, []);

  const hasRole = useCallback((...specs) => matchRoles(user, specs), [user]);

  // UC04 bước 6: menu bị Trưởng BQL tắt quyền Xem. Nạp lại khi đổi người dùng, khi quay lại tab và khi có sự kiện
  // PERMISSIONS_CHANGED_EVENT (vd vừa gặp lỗi PERMISSION_REVOKED). Lưu kèm userId để không dùng nhầm của người trước.
  const userId = user?.id ?? user?._id ?? null;
  const [hidden, setHidden] = useState({ userId: null, keys: new Set() });
  const reloadPermissions = useCallback(() => {
    if (!userId) return;
    permissionApi
      .me()
      .then((res) => setHidden({ userId, keys: new Set(res.data?.hiddenMenuKeys ?? []) }))
      .catch(() => {}); // lỗi mạng: giữ nguyên menu, server vẫn chặn API
  }, [userId]);
  useEffect(() => {
    reloadPermissions();
    window.addEventListener('focus', reloadPermissions);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, reloadPermissions);
    return () => {
      window.removeEventListener('focus', reloadPermissions);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, reloadPermissions);
    };
  }, [reloadPermissions]);
  const hiddenMenuKeys = hidden.userId === userId ? hidden.keys : EMPTY;

  /** Mục menu hiện được không: đúng vai trò và chưa bị tắt quyền Xem */
  const canSee = useCallback(
    (item) => Boolean(item) && matchRoles(user, item.roles ?? []) && !hiddenMenuKeys.has(item.key),
    [user, hiddenMenuKeys],
  );

  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), startSession, updateUser, logout, hasRole, canSee }),
    [user, startSession, updateUser, logout, hasRole, canSee],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
