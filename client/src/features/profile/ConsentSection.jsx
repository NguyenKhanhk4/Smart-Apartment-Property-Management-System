import { useState } from 'react';
import { Button, Tag } from 'antd';
import { useAuth } from '../../hooks/useAuth';
import ConsentModal from '../../components/resident/ConsentModal';
import { isConsentLocked } from '../../utils/consent';

// BR-X7: hiển thị trạng thái đồng ý và cho phép mở điều khoản trong hồ sơ cư dân.
export default function ConsentSection() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const accepted = !isConsentLocked(user);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-3 rounded-lg border border-line-strong">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">Điều khoản dữ liệu cá nhân</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-2">
          <Tag color={accepted ? 'success' : 'warning'} className="m-0">
            {accepted ? 'Đã đồng ý' : 'Chưa đồng ý'}
          </Tag>
          {user?.consentPolicyVersion && <span>Phiên bản {user.consentPolicyVersion}</span>}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="small" onClick={() => setOpen(true)}>
          Xem điều khoản
        </Button>
      </div>
      <ConsentModal open={open} readOnly={accepted} onClose={() => setOpen(false)} />
    </div>
  );
}
