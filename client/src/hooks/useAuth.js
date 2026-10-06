import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

/**
 * { user, isAuthenticated, startSession, updateUser, logout, hasRole }
 * hasRole('MANAGER', 'STAFF:RECEPTIONIST') cùng ngữ nghĩa với authorize() ở backend.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải được dùng bên trong <AuthProvider>');
  return ctx;
}
