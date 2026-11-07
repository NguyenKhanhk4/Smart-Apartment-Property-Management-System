import { Alert, Button } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { CONSENT_TAB_PATH, isConsentLocked } from '../../utils/consent';

/** Nhắc cư dân chưa đồng ý điều khoản dữ liệu cá nhân: biết bị khóa gì và đồng ý ở đâu (BR-X7, MSG-S19) */
export default function ConsentBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!isConsentLocked(user) || pathname.startsWith('/r/profile')) return null;

  return (
    <Alert
      type="warning"
      showIcon
      className="mb-4"
      title="Bạn chưa đồng ý với điều khoản dữ liệu cá nhân"
      description="Khai báo nhân khẩu, đăng ký xe và tải ảnh đang bị khóa. Thông báo phí, thanh toán và bảng tin vẫn dùng bình thường."
      action={
        <Button size="small" type="primary" onClick={() => navigate(CONSENT_TAB_PATH)}>
          Xem điều khoản
        </Button>
      }
    />
  );
}
