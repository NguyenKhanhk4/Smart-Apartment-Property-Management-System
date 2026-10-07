import { Outlet } from 'react-router';
import { CheckCircleFilled } from '@ant-design/icons';
import BrandLogo from '../components/BrandLogo';

const HIGHLIGHTS = [
  'Hóa đơn, quỹ bảo trì minh bạch cho cư dân và Ban quản trị',
  'Tự động nhắc bảo trì thiết bị, leo thang phản ánh quá hạn',
  'Đặt tiện ích, sổ khách, bảng tin trên cùng một ứng dụng',
];

// Khung trang đăng nhập / đăng ký: cột trái thương hiệu (nền midnight), cột phải là form (Outlet).
// Logo có view-transition-name "brand-logo" → đăng nhập xong logo bay lên góc sidebar.
export default function AuthLayout() {
  return (
    <div
      className="min-h-screen flex flex-col md:flex-row"
      style={{ background: 'linear-gradient(160deg, #0F1B2D 0%, #1E3A5F 100%)' }}
    >
      <section className="relative overflow-hidden md:w-5/12 p-8 md:p-14 flex flex-col justify-between text-white">
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, #C9A35B 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-10 md:mb-14">
            <BrandLogo size={48} />
            <div className="vt-brand-title">
              <div className="text-2xl font-bold tracking-tight">SAPMS</div>
              <div className="text-xs text-gold font-medium tracking-wider uppercase">Smart Apartment Property Management</div>
            </div>
          </div>
          <h1 className="font-serif-luxury text-3xl md:text-4xl leading-tight m-0 mb-4">
            Vận hành chung cư tinh gọn, minh bạch.
          </h1>
          <div className="w-8 h-0.5 bg-gold mb-4" />
          <p className="text-side-text text-sm leading-relaxed max-w-md m-0">
            Một nền tảng kết nối Ban quản lý, Ban quản trị, kỹ thuật viên, lễ tân và cư dân.
          </p>
        </div>
        <ul className="relative mt-10 pt-8 border-t border-white/10 space-y-3 list-none p-0 m-0 hidden md:block">
          {HIGHLIGHTS.map((h) => (
            <li key={h} className="flex items-center gap-2.5 text-xs text-[#E8EEF5]">
              <CheckCircleFilled className="text-gold" />
              {h}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex-1 flex items-center justify-center p-6 md:p-14">
        <div className="w-full max-w-md rounded-[14px] border border-line bg-white p-8 md:p-10 shadow-[0_8px_24px_rgba(15,27,45,0.12)]">
          <Outlet />
        </div>
      </section>
    </div>
  );
}
