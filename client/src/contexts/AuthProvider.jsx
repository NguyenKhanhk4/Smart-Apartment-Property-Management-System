import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import { authApi } from '../api/auth.api';
import { SESSION_EXPIRED_EVENT } from '../api/axiosClient';
import { SESSION_EXPIRED_FLAG, authStorage } from '../utils/authStorage';
import { hasRole as matchRoles } from '../utils/permission';

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

  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), startSession, updateUser, logout, hasRole }),
    [user, startSession, updateUser, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
