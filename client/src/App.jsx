import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { AuthProvider } from './contexts/AuthProvider';
import { AppRouter } from './routes/AppRouter';
import { themeConfig } from './config/theme';

// AntApp cung cấp message / modal / notification qua App.useApp() cho mọi trang
export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={themeConfig}>
      <AntApp>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
