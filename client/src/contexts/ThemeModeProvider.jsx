import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { ThemeModeContext } from './ThemeModeContext';
import { runViewTransition } from '../motion/viewTransition';

const KEY = 'sapms.themeMode';

function readInitial() {
  try {
    return localStorage.getItem(KEY) === 'dark';
  } catch {
    return false;
  }
}

/**
 * Chế độ Sáng/Tối: lưu localStorage, gắn class `dark` lên <html> để Tailwind `dark:` hoạt động.
 * Mặc định luôn là Sáng (không theo cài đặt hệ điều hành) để chữ tối trên nền ngà luôn đọc được.
 */
export function ThemeModeProvider({ children }) {
  const [isDark, setIsDark] = useState(readInitial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(KEY, isDark ? 'dark' : 'light');
    } catch {
      /* bỏ qua: trình duyệt chặn localStorage */
    }
  }, [isDark]);

  // Đổi theme bằng view transition (màn hình chuyển màu mượt thay vì nháy)
  const toggle = useCallback(
    () => runViewTransition(() => flushSync(() => setIsDark((d) => !d))),
    [],
  );

  const value = useMemo(() => ({ isDark, toggle }), [isDark, toggle]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}
