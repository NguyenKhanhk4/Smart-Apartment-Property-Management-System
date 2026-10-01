import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { notificationApi } from '../../api/moduleE.api';

/** Phát khi số thông báo chưa đọc thay đổi (đánh dấu đã đọc...) để chuông cập nhật ngay */
export const NOTIFICATIONS_CHANGED = 'sapms:notifications-changed';
const POLL_MS = 60_000;

// Chuông thông báo trên header — poll số chưa đọc mỗi phút (Socket.io là Should, chưa làm)
export default function NotificationBell({ area }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    notificationApi
      .unreadCount()
      .then((res) => setCount(res.data.count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return (
    <Badge count={count} size="small" offset={[-4, 4]}>
      <Button
        type="text"
        aria-label="Thông báo"
        icon={<BellOutlined style={{ fontSize: 18 }} />}
        onClick={() => navigate(`/${area}/notifications`)}
      />
    </Badge>
  );
}
