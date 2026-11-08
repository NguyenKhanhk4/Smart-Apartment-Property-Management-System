import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { AuthProvider } from './contexts/AuthProvider';
import { ThemeModeProvider } from './contexts/ThemeModeProvider';
import { useThemeMode } from './hooks/useThemeMode';
import { AppRouter } from './routes/AppRouter';
import { getAntdTheme } from './config/theme';

function ThemedApp() {
  const { isDark } = useThemeMode();
  // AntApp cung cấp message / modal / notification qua App.useApp() cho mọi trang
  return (
    <ConfigProvider locale={viVN} theme={getAntdTheme(isDark)}>
      <AntApp>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <ThemeModeProvider>
      <ThemedApp />
    </ThemeModeProvider>
  );
}
