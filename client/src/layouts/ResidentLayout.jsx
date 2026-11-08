import { Suspense, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ConfigProvider } from 'antd';
import { getResidentAntdTheme } from '../config/theme';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useThemeMode } from '../hooks/useThemeMode';
import PageLoader from '../components/PageLoader';
import PageTransition from '../motion/PageTransition';
import { ResidentProvider } from './resident/ResidentProvider';
import { MobileHeader, WebHeader } from './resident/ResidentHeader';
import BottomNav from './resident/BottomNav';
import ResidentSidebar from './resident/ResidentSidebar';
import ConsentBanner from '../components/resident/ConsentBanner';
import ConsentGate from '../components/resident/ConsentGate';

// Khu cư dân chỉ có bản sáng theo thiết kế: bỏ class `dark` trên <html> khi ở đây (các trang cũ còn dùng `dark:`),
// rời khu thì trả lại theo lựa chọn của người dùng.
// Hệ giao diện B "Tòa nhà xanh" (Mulish, xanh lá) — tách khỏi hệ A của khu quản lý
const residentTheme = getResidentAntdTheme();

// Trang mobile dùng tiêu đề thay cho lời chào ở header (đường dẫn khớp tuyệt đối)
const HEADER_TITLES = { '/r/amenities': 'Tiện ích', '/r/my-code': 'Mã của tôi' };

// Layout cư dân, kiểu khung nổi tách rời (mỗi phần một khung trắng bo góc trên nền xanh nhạt), ưu tiên máy tính:
//  - ≥768px: sidebar nổi (thu gọn được) + thanh trên nổi + khung nội dung, giãn full màn hình như khu quản lý.
//    Màn hẹp hơn 1180px thì sidebar mặc định thu gọn còn cột icon.
//  - <768px: header nổi + khung nội dung + thanh điều hướng dưới nổi.
export default function ResidentLayout() {
  const isWide = useMediaQuery('(min-width: 768px)');
  const roomy = useMediaQuery('(min-width: 1180px)');
  const [userCollapsed, setUserCollapsed] = useState(null); // null = theo độ rộng màn hình
  const collapsed = userCollapsed ?? !roomy;
  const { isDark } = useThemeMode();
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark');
    return () => document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <ConfigProvider theme={residentTheme}>
      <ResidentProvider>
        <div className={`theme-resident min-h-screen bg-r-bg text-r-text font-sans ${isWide ? 'flex gap-3 p-3' : ''}`}>
          {isWide && <ResidentSidebar collapsed={collapsed} onToggle={() => setUserCollapsed(!collapsed)} />}

          <div className={isWide ? 'flex-1 min-w-0 flex flex-col gap-3' : ''}>
            {isWide ? <WebHeader /> : <MobileHeader title={HEADER_TITLES[pathname.replace(/\/$/, '')]} />}

            <main
              className={`bg-white border border-r-border rounded-[18px] shadow-float-r ${
                isWide
                  ? 'flex-1 px-[clamp(16px,2.2vw,32px)] py-[clamp(18px,3vh,28px)]'
                  : 'mx-2.5 mt-2.5 mb-[100px] px-4 py-4 min-h-[calc(100vh-190px)]'
              }`}
            >
              <ConsentBanner />
              <Suspense fallback={<PageLoader />}>
                <PageTransition key={pathname} className="page-stack">
                  <Outlet />
                </PageTransition>
              </Suspense>
            </main>
          </div>

          {!isWide && <BottomNav />}
          <ConsentGate />
        </div>
      </ResidentProvider>
    </ConfigProvider>
  );
}
