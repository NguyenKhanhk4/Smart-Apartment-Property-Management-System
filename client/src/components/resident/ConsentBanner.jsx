import { useState } from 'react';
import { Alert, Button } from 'antd';
import { useAuth } from '../../hooks/useAuth';
import { isConsentLocked } from '../../utils/consent';
import ConsentModal from './ConsentModal';

/** Nhắc cư dân chưa đồng ý điều khoản dữ liệu cá nhân: biết bị khóa gì và mở điều khoản để đồng ý (BR-X7, MSG-S19) */
export default function ConsentBanner() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  // Bản điều khoản cũ thì ConsentGate đã hiện modal bắt buộc, không cần banner
  if (!isConsentLocked(user) || user?.consentOutdated) return null;

  return (
    <>
      <Alert
        type="warning"
        showIcon
        className="mb-4"
        title="Bạn chưa đồng ý với điều khoản dữ liệu cá nhân"
        description="Khai báo nhân khẩu, đăng ký xe và tải ảnh đang bị khóa. Thông báo phí, thanh toán và bảng tin vẫn dùng bình thường."
        action={
          <Button size="small" type="primary" onClick={() => setOpen(true)}>
            Xem điều khoản
          </Button>
        }
      />
      <ConsentModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
