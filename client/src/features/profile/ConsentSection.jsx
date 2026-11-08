import { useState } from 'react';
import { Button, Popconfirm, Tag } from 'antd';
import { usersApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import ConsentModal from '../../components/resident/ConsentModal';
import { isConsentLocked } from '../../utils/consent';

// BR-X7: một dòng trong hồ sơ cư dân — trạng thái đồng ý, mở điều khoản để đồng ý, hoặc rút lại đồng ý bất cứ lúc nào
export default function ConsentSection() {
  const { user, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [withdraw, withdrawing] = useAction(() => usersApi.updateConsent('WITHDRAWN'), {
    success: 'Bạn đã rút lại đồng ý. Khai báo nhân khẩu, đăng ký xe và tải ảnh đã bị khóa.',
    onDone: (res) => updateUser(res.data),
  });
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
        {accepted && (
          <Popconfirm
            title="Rút lại đồng ý?"
            description="Khai báo nhân khẩu, đăng ký xe và tải ảnh sẽ bị khóa."
            okText="Rút lại"
            cancelText="Hủy"
            onConfirm={() => withdraw().catch(() => {})}
          >
            <Button size="small" danger loading={withdrawing}>
              Rút lại đồng ý
            </Button>
          </Popconfirm>
        )}
      </div>
      <ConsentModal open={open} readOnly={accepted} onClose={() => setOpen(false)} />
    </div>
  );
}
