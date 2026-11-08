import { useCallback, useState } from 'react';
import { Alert, Button, Checkbox, Modal } from 'antd';
import { usersApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import PersonalDataTerms from '../../features/auth/PersonalDataTerms';

// Đã cuộn tới cuối khung (chừa 8px cho làm tròn)
const atEnd = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 8;

/**
 * Modal điều khoản dữ liệu cá nhân (BR-X7), hộp thoại giữa màn hình: tiêu đề và nút đứng yên,
 * nội dung điều khoản nằm trong khung riêng tự cuộn. Phải cuộn đọc hết mới tick được "Tôi đã đọc".
 * - forced: điều khoản vừa cập nhật phiên bản → không có nút đóng, không tắt bằng Esc / bấm ra ngoài;
 *   chỉ đóng khi cư dân đồng ý (hoặc đăng xuất).
 * - không forced: cư dân chưa đồng ý / đã rút tự mở để xem và đồng ý, đóng lúc nào cũng được.
 * - readOnly: đã đồng ý, chỉ xem lại nội dung.
 */
export default function ConsentModal({ open, forced = false, readOnly = false, onClose }) {
  const { user, updateUser, logout } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState(0);
  const read = progress >= 1;
  const [accept, accepting] = useAction(() => usersApi.updateConsent('ACCEPTED'), {
    success: 'Bạn đã đồng ý với điều khoản dữ liệu cá nhân.',
    onDone: (res) => {
      updateUser(res.data);
      setAgreed(false);
      onClose?.();
    },
  });

  // Dùng làm ref luôn: màn hình cao, điều khoản hiện trọn không cần cuộn → tính là đã đọc ngay
  const track = useCallback((el) => {
    if (!el) return;
    setProgress((p) => Math.max(p, atEnd(el) ? 1 : (el.scrollTop + el.clientHeight) / el.scrollHeight));
  }, []);

  const footer = readOnly ? (
    <Button onClick={onClose}>Đóng</Button>
  ) : (
    <div className="flex flex-col gap-3 text-left">
      <Checkbox checked={agreed} disabled={!read} onChange={(e) => setAgreed(e.target.checked)}>
        Tôi đã đọc và đồng ý với điều khoản xử lý dữ liệu cá nhân
      </Checkbox>
      <div className="flex gap-2 justify-end [&>button]:flex-1 sm:[&>button]:flex-none">
        {forced ? <Button onClick={logout}>Đăng xuất</Button> : <Button onClick={onClose}>Để sau</Button>}
        <Button type="primary" disabled={!agreed} loading={accepting} onClick={() => accept().catch(() => {})}>
          Tôi đồng ý
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={
        <div>
          <div>{forced ? 'Điều khoản dữ liệu cá nhân đã được cập nhật' : 'Điều khoản xử lý dữ liệu cá nhân'}</div>
          {user?.currentPolicyVersion && (
            <div className="mt-0.5 text-xs font-normal text-r-subtle">Phiên bản {user.currentPolicyVersion}</div>
          )}
        </div>
      }
      width="min(640px, 94vw)"
      centered
      closable={!forced}
      mask={{ closable: !forced }}
      keyboard={!forced}
      onCancel={forced ? undefined : onClose}
      footer={footer}
      destroyOnHidden
      afterClose={() => setProgress(0)}
    >
      <div className="flex flex-col gap-2.5">
        {forced && (
          <Alert
            type="info"
            showIcon
            title="Ban quản lý đã cập nhật điều khoản. Vui lòng đọc và đồng ý để tiếp tục sử dụng ứng dụng."
          />
        )}
        {!readOnly && (
          <div className="h-[3px] rounded-full bg-r-border overflow-hidden" aria-hidden>
            <div className="h-full bg-r-navy transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <PersonalDataTerms
          ref={track}
          onScroll={(e) => track(e.currentTarget)}
          className="max-h-[min(46vh,380px)] text-[13.5px]!"
        />
        {!readOnly && (
          <div className={`text-xs ${read ? 'text-r-ok-fg' : 'text-r-subtle'}`} aria-live="polite">
            {read ? 'Đã đọc hết ✓' : 'Cuộn hết nội dung điều khoản để tiếp tục'}
          </div>
        )}
      </div>
    </Modal>
  );
}
