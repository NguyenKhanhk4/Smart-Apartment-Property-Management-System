import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import { SESSION_EXPIRED_EVENT } from '../api/axiosClient';
import { authStorage } from '../utils/authStorage';
import { hasRole as matchRoles } from '../utils/permission';

/**
 * Giữ phiên đăng nhập phía client. Chưa gọi API nào — module Auth (thành viên A) sẽ:
 *   - gọi POST /auth/login rồi `startSession({ user, accessToken, refreshToken })`
 *   - gọi POST /auth/logout trước khi `logout()`
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authStorage.getUser());

  // Refresh token thất bại ở bất kỳ request nào → xóa phiên; RequireAuth sẽ đưa về /login.
  useEffect(() => {
    const handleExpired = () => setUser(null);
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
