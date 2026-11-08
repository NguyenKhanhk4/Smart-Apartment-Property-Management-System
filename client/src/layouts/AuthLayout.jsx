import { Link, Outlet } from 'react-router';
import { ConfigProvider } from 'antd';
import {
  ArrowRightOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  FileTextOutlined,
  QrcodeOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import BrandLogo from '../components/BrandLogo';
import { getResidentAntdTheme } from '../config/theme';
import { AuthPortalContext, PORTALS, portalPath } from '../features/auth/authPortal';

const residentTheme = getResidentAntdTheme();

// Nội dung panel trái theo cổng
const PANEL = {
  resident: {
    eyebrow: 'Cổng cư dân',
    title: ['Ngôi nhà của bạn,', 'gọn trong một ứng dụng.'],
    desc: 'Xem hóa đơn, đặt tiện ích, gửi phản ánh và quản lý khách ra vào — mọi lúc, mọi nơi.',
    features: [
      { icon: WalletOutlined, text: 'Hóa đơn & thanh toán online' },
      { icon: CalendarOutlined, text: 'Đặt hồ bơi, gym, BBQ' },
      { icon: ToolOutlined, text: 'Phản ánh sự cố, theo dõi tiến độ' },
      { icon: QrcodeOutlined, text: 'Mã cư dân, đăng ký khách' },
    ],
    switchText: 'Bạn là nhân viên Ban quản lý?',
  },
  staff: {
    eyebrow: 'Cổng Ban quản lý',
    title: ['Vận hành tòa nhà', 'tinh gọn, minh bạch.'],
    desc: 'Một nơi cho Ban quản lý, kế toán, lễ tân, kỹ thuật, bảo vệ và Ban quản trị.',
    features: [
      { icon: ClockCircleOutlined, text: 'Phản ánh, SLA và ca trực' },
      { icon: FileTextOutlined, text: 'Lập hóa đơn, theo dõi công nợ' },
      { icon: TeamOutlined, text: 'Cư dân, căn hộ, hợp đồng' },
      { icon: BarChartOutlined, text: 'Báo cáo quỹ và vận hành' },
    ],
    switchText: 'Bạn là cư dân?',
  },
};

/** Hàng tòa nhà minh họa ở đáy panel cư dân (cửa sổ sáng ngẫu nhiên cố định) */
function Skyline() {
  const towers = [
    [0, 120, 70], [78, 190, 84], [170, 150, 64], [242, 230, 96], [346, 170, 72], [426, 260, 90], [524, 140, 66], [598, 200, 82],
  ];
  return (
    <svg viewBox="0 0 680 270" className="w-full h-auto block" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      {towers.map(([x, h, w], i) => (
        <g key={x}>
          <rect x={x} y={270 - h} width={w} height={h} rx="6" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.18)" />
          {Array.from({ length: Math.floor((h - 24) / 26) }).flatMap((_, r) =>
            Array.from({ length: Math.floor((w - 16) / 18) }).map((__, c) => (
              <rect
                key={`${r}-${c}`}
                x={x + 12 + c * 18}
                y={270 - h + 16 + r * 26}
                width="8"
                height="12"
                rx="2"
                fill={(r * 7 + c * 3 + i) % 5 === 0 ? '#FDE68A' : 'rgba(255,255,255,0.22)'}
              />
            )),
          )}
        </g>
      ))}
    </svg>
  );
}

// Khung trang đăng nhập / kích hoạt / quên mật khẩu, full màn hình, 2 cổng tách riêng:
//  - resident: giao diện B (xanh lá, Mulish), panel trái minh họa dãy tòa nhà.
//  - staff:    giao diện A (xanh dương, Inter), panel trái tối có ánh xanh + thẻ thông báo minh họa.
// Trên điện thoại panel trái thu thành dải đầu trang. Logo có view-transition-name "brand-logo".
export default function AuthLayout({ portal = 'resident' }) {
  const isResident = portal === 'resident';
  const p = PANEL[portal];
  const other = PORTALS[portal].other;

  const page = (
    <div className={`min-h-screen grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-white ${isResident ? 'theme-resident' : ''}`}>
      {/* Panel thương hiệu: dải đầu trang trên điện thoại, nửa trái trên máy tính */}
      <section
        className={`relative overflow-hidden text-white flex flex-col ${
          isResident ? 'rounded-b-[28px] lg:rounded-none' : 'rounded-b-[24px] lg:rounded-none'
        }`}
        style={{
          background: isResident
            ? 'radial-gradient(90% 60% at 10% 0%, #22a55b 0%, transparent 60%), linear-gradient(160deg, #166534 0%, #0f3d22 100%)'
            : 'radial-gradient(110% 70% at 0% 0%, rgba(37,99,235,0.55) 0%, transparent 60%), radial-gradient(80% 60% at 100% 100%, rgba(13,148,136,0.28) 0%, transparent 65%), #0c111d',
        }}
      >
        {!isResident && (
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.07]"
            style={{
              backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
        )}

        <div className="relative flex items-center gap-3 px-[clamp(20px,4vw,56px)] pt-[clamp(20px,5vh,48px)]">
          <BrandLogo size={40} />
          <div className="vt-brand-title leading-tight">
            <div className="text-lg font-semibold tracking-tight">SAPMS</div>
            <div className="text-[11px] text-white/65 tracking-wider uppercase">{p.eyebrow}</div>
          </div>
        </div>

        <div className="relative px-[clamp(20px,4vw,56px)] pt-6 pb-8 lg:pt-[clamp(32px,10vh,96px)] lg:pb-0">
          <h1 className="m-0 text-[clamp(22px,2.8vw,36px)] leading-[1.2] font-semibold tracking-tight">
            {p.title[0]}
            <br />
            <span className={isResident ? 'text-[#BBF7D0]' : 'text-[#93C5FD]'}>{p.title[1]}</span>
          </h1>
          <p className="mt-3 mb-0 text-sm leading-relaxed text-white/70 max-w-md hidden sm:block">{p.desc}</p>
          <ul className="list-none m-0 p-0 mt-7 hidden lg:grid grid-cols-2 gap-2.5 max-w-lg">
            {p.features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5 text-[13px] text-white/90 rounded-xl bg-white/[0.08] border border-white/15 px-3 py-2.5">
                <span className={`text-base ${isResident ? 'text-[#BBF7D0]' : 'text-[#93C5FD]'}`}>
                  <Icon />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-auto hidden lg:block">
          {isResident ? (
            <div className="px-[clamp(20px,3vw,40px)]">
              <Skyline />
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-w-[360px] px-[clamp(20px,4vw,56px)] pb-[clamp(24px,6vh,56px)]" aria-hidden="true">
              <div className="flex items-center gap-3 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm px-3.5 py-2.5">
                <CheckCircleFilled className="text-[#4ADE80] text-base" />
                <div className="min-w-0 text-[12.5px]">
                  <div className="font-medium truncate">Phản ánh TK-1042 đã xử lý xong</div>
                  <div className="text-white/55 text-[11.5px]">Rò nước trần hành lang T12 · 2 phút trước</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm px-3.5 py-2.5 ml-8">
                <ClockCircleOutlined className="text-[#FBBF24] text-base" />
                <div className="min-w-0 text-[12.5px]">
                  <div className="font-medium truncate">Ca trực tối nay: 2 kỹ thuật viên</div>
                  <div className="text-white/55 text-[11.5px]">18:00 – 06:00 · Tòa A, B</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Form */}
      <main className="flex flex-col px-[clamp(20px,5vw,72px)] py-[clamp(24px,5vh,48px)]">
        <div className="flex-1 flex flex-col justify-center w-full max-w-[420px] mx-auto">
          <Outlet />
        </div>
        {/* Lối tắt sang cổng kia: chỉ khi chạy dev để tiện thử 2 vai trò; bản chính thức mỗi bên dùng đúng đường dẫn của mình */}
        {import.meta.env.DEV && (
          <div className="w-full max-w-[420px] mx-auto mt-8 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-surface-alt px-4 py-3 text-[13px]">
            <span className="text-ink-2">{p.switchText}</span>
            <Link to={portalPath(other, '/login')} className="font-medium text-navy hover:text-navy-hover no-underline whitespace-nowrap">
              {PORTALS[other].label} <ArrowRightOutlined />
            </Link>
          </div>
        )}
      </main>
    </div>
  );

  return (
    <AuthPortalContext.Provider value={portal}>
      {isResident ? <ConfigProvider theme={residentTheme}>{page}</ConfigProvider> : page}
    </AuthPortalContext.Provider>
  );
}
