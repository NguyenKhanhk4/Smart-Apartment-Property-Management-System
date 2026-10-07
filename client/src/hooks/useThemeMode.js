import { useContext } from 'react';
import { ThemeModeContext } from '../contexts/ThemeModeContext';

/** { isDark, toggle } */
export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode phải được dùng bên trong <ThemeModeProvider>');
  return ctx;
}
