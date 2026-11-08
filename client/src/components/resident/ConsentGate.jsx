import { useCallback, useEffect, useRef } from 'react';
import { usersApi } from '../../api/moduleA.api';
import { useAuth } from '../../hooks/useAuth';
import ConsentModal from './ConsentModal';

/**
 * BR-X7: điều khoản dữ liệu cá nhân đổi phiên bản thì cư dân đã đồng ý bản cũ phải đồng ý lại.
 * Thông tin người dùng lưu từ lúc đăng nhập nên nạp lại /users/me khi vào khu cư dân và khi quay lại tab,
 * để biết điều khoản vừa cập nhật mà không phải đăng nhập lại.
 */
export default function ConsentGate() {
  const { user, updateUser } = useAuth();
  const isResident = user?.role === 'RESIDENT';
  // Đọc user qua ref để không gọi lại API mỗi lần user đổi
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refresh = useCallback(() => {
    if (!isResident) return;
    usersApi
      .me()
      .then((res) => {
        const next = res.data;
        const current = userRef.current;
        if (next && (next.consentOutdated !== current?.consentOutdated || next.consentStatus !== current?.consentStatus)) {
          updateUser({ ...current, ...next });
        }
      })
      .catch(() => {}); // lỗi mạng: giữ nguyên, server vẫn chặn chức năng cần đồng ý
  }, [isResident, updateUser]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return <ConsentModal open={isResident && Boolean(user?.consentOutdated)} forced />;
}
