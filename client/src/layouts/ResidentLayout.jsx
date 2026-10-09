import { Suspense, useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ConfigProvider } from 'antd';
import { getAntdTheme } from '../config/theme';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useThemeMode } from '../hooks/useThemeMode';
import PageLoader from '../components/PageLoader';
import PageTransition from '../motion/PageTransition';
import { ResidentProvider } from './resident/ResidentProvider';
import { MobileHeader, WebHeader } from './resident/ResidentHeader';
import BottomNav from './resident/BottomNav';

// Khu cư dân chỉ có bản sáng theo thiết kế: bỏ class `dark` trên <html> khi ở đây (các trang cũ còn dùng `dark:`),
// rời khu thì trả lại theo lựa chọn của người dùng.
const lightTheme = { ...getAntdTheme(false), inherit: false };

// Trang mobile dùng tiêu đề thay cho lời chào ở header (đường dẫn khớp tuyệt đối)
const HEADER_TITLES = { '/r/amenities': 'Tiện ích', '/r/my-code': 'Mã của tôi' };

// Layout cư dân, responsive: <768px = header gọn + thanh dưới 5 mục; ≥768px = nav ngang, nội dung tối đa 1200px.
export default function ResidentLayout() {
  const isWide = useMediaQuery('(min-width: 768px)');
  const { isDark } = useThemeMode();
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark');
    return () => document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <ConfigProvider theme={lightTheme}>
      <ResidentProvider>
        <div className="min-h-screen bg-r-bg text-r-text font-sans">
          {isWide ? <WebHeader /> : <MobileHeader title={HEADER_TITLES[pathname.replace(/\/$/, '')]} />}

          <main className={isWide ? 'max-w-[1200px] mx-auto px-6 pt-8 pb-12' : 'px-5 pt-5 pb-28'}>
            <Suspense fallback={<PageLoader />}>
              <PageTransition key={pathname}>
                <Outlet />
              </PageTransition>
            </Suspense>
          </main>

          {!isWide && <BottomNav />}
        </div>
      </ResidentProvider>
    </ConfigProvider>
  );
}
