import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { notificationApi } from '../../api/moduleE.api';

/** Phát khi số thông báo chưa đọc thay đổi (đánh dấu đã đọc...) để chuông cập nhật ngay */
export const NOTIFICATIONS_CHANGED = 'sapms:notifications-changed';
const POLL_MS = 60_000;

// Chuông thông báo trên header — poll số chưa đọc mỗi phút (Socket.io là Should, chưa làm)
// variant="resident": nút 44×44 + badge đỏ theo thiết kế giao diện cư dân; mặc định giữ kiểu antd của giao diện nội bộ
export default function NotificationBell({ area, variant }) {
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

  if (variant === 'resident') {
    return (
      <button
        type="button"
        aria-label={count > 0 ? `Thông báo, ${count} chưa đọc` : 'Thông báo'}
        onClick={() => navigate(`/${area}/notifications`, { viewTransition: true })}
        className="relative w-11 h-11 flex items-center justify-center border-0 bg-transparent text-r-text cursor-pointer"
      >
        <BellOutlined style={{ fontSize: 22 }} />
        {count > 0 && (
          <span className="absolute top-1.5 right-[5px] min-w-[18px] h-[18px] px-1 rounded-full bg-r-danger text-white text-[11px] font-semibold flex items-center justify-center border-2 border-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    );
  }

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
