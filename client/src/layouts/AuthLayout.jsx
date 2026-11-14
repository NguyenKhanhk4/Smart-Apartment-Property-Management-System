import { Link, Outlet } from 'react-router';
import { ConfigProvider } from 'antd';
import { AppstoreOutlined, DatabaseOutlined, MessageOutlined, TeamOutlined, ToolOutlined, WalletOutlined } from '@ant-design/icons';
import BrandLogo from '../components/BrandLogo';
import { getAntdTheme } from '../config/theme';
import { AuthPortalContext, PORTALS, portalPath } from '../features/auth/authPortal';
import './AuthLayout.css';

// Ảnh minh họa tạo từ hai bản thiết kế đã duyệt, lưu cùng project để không phụ thuộc URL bên ngoài.
const PORTAL_CONTENT = {
  resident: {
    image: '/images/auth/resident-courtyard-v1.jpg',
    badge: 'Cổng cư dân',
    title: ['Chào mừng bạn về nhà.'],
    description: 'Theo dõi phí dịch vụ, gửi phản ánh và sử dụng tiện ích ngay tại nơi bạn sống.',
    features: [
      { icon: WalletOutlined, label: 'Phí dịch vụ' },
      { icon: MessageOutlined, label: 'Phản ánh' },
      { icon: AppstoreOutlined, label: 'Tiện ích' },
    ],
  },
  staff: {
    image: '/images/auth/staff-evening-v1.jpg',
    badge: 'Cổng nội bộ',
    title: ['Vận hành tòa nhà,', 'kết nối cộng đồng.'],
    description: 'Quản lý thông tin cư trú, công việc vận hành và tài chính trên SAPMS.',
    features: [
      { icon: TeamOutlined, label: 'Cư trú' },
      { icon: ToolOutlined, label: 'Vận hành' },
      { icon: DatabaseOutlined, label: 'Tài chính' },
    ],
  },
};

export default function AuthLayout({ portal = 'resident' }) {
  const content = PORTAL_CONTENT[portal];
  const otherPortal = PORTALS[portal].other;
  return (
    <ConfigProvider theme={getAntdTheme(false)}>
      <div className={`auth-shell auth-shell--${portal}`}>
        <section className="auth-hero" aria-labelledby="auth-hero-title">
          <img className="auth-hero-image" src={content.image} alt="" fetchPriority="high" decoding="async" />
          <div className="auth-hero-shade" aria-hidden="true" />
          <div className="auth-brand">
            <BrandLogo size={54} />
            <div className="vt-brand-title">
              <div className="auth-brand-name">SAPMS</div>
              <div className="auth-brand-caption">Smart Apartment Property Management</div>
            </div>
          </div>
          <div className="auth-hero-content">
            <h1 id="auth-hero-title" className="auth-hero-title">
              {content.title.map((line) => <span key={line}>{line}</span>)}
            </h1>
            <p className="auth-hero-description">{content.description}</p>
            <ul className="auth-feature-list">
              {content.features.map(({ icon: Icon, label }) => (
                <li key={label}><Icon aria-hidden="true" /><span>{label}</span></li>
              ))}
            </ul>
          </div>
        </section>

        <main className="auth-content-pane" aria-labelledby="auth-form-title">
          <div className="auth-form-wrap">
            <div className="auth-portal-badge">{content.badge}</div>
            <AuthPortalContext.Provider value={portal}>
              <Outlet />
            </AuthPortalContext.Provider>
            <Link className="auth-portal-switch" to={portalPath(otherPortal, '/login')}>
              {otherPortal === 'staff' ? 'Sang cổng Ban quản lý' : 'Sang cổng cư dân'}
            </Link>
          </div>
        </main>
      </div>
    </ConfigProvider>
  );
}
