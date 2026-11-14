// Module 8: chuông và thông báo trình duyệt khi được cấp quyền.
// An ninh (guest alerts) giữ dạng banner nổi; sự cố khẩn cấp (BR-X6) hiện modal chặn để không bị bỏ sót.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Alert, App, Badge, Button, Modal } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { guestApi, notificationApi, ticketApi } from '../../api/moduleE.api';
import { usePolling } from '../../hooks/usePolling';
import { useAuth } from '../../hooks/useAuth';

/** Phát khi số thông báo chưa đọc thay đổi (đánh dấu đã đọc...) để chuông cập nhật ngay */
export const NOTIFICATIONS_CHANGED = 'sapms:notifications-changed';
const POLL_MS = 60_000;

// Chuông thông báo trên header — poll số chưa đọc mỗi phút (Socket.io là Should, chưa làm)
// variant="resident": nút 44×44 + badge đỏ theo thiết kế giao diện cư dân; mặc định giữ kiểu antd của giao diện nội bộ
export default function NotificationBell({ area, variant }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const latestRef = useRef(undefined);
  const [alerts, setAlerts] = useState([]);
  const [receiving, setReceiving] = useState(null);
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  // Mỗi role chỉ nhận đúng 1 loại cảnh báo khẩn, không chồng nhau: Bảo vệ/Lễ tân → an ninh (banner);
  // Trưởng BQL/KTV → sự cố khẩn cấp ticket (modal). Cư dân chỉ xem được broadcast an ninh.
  const canSeeAlerts = hasRole('RESIDENT', 'STAFF:SECURITY', 'STAFF:RECEPTIONIST');
  // BR-X6 (Người 4): sự cố khẩn cấp quá hạn nhận chưa ai nhận — hiện modal riêng, không tự đóng được
  const canSeeTicketAlerts = hasRole('MANAGER', 'STAFF:TECHNICIAN');
  const isTechnician = hasRole('STAFF:TECHNICIAN');
  const [ticketAlerts, setTicketAlerts] = useState([]);
  // KTV: nhận = claim thật (gán phiếu cho mình), không chỉ tắt chuông — tránh nhầm với "Đã tiếp nhận" (chỉ ack cảnh báo)
  const claimTicket = async (id) => {
    setReceiving(id);
    try { await ticketApi.claim(id); setTicketAlerts((items) => items.filter((a) => a._id !== id)); message.success('Đã nhận sự cố'); }
    catch (error) { message.error(error.message); }
    finally { setReceiving(null); }
  };
  const receiveTicket = async (id) => {
    setReceiving(id);
    try { await ticketApi.emergencyAck(id); setTicketAlerts((items) => items.filter((a) => a._id !== id)); message.success('Đã tiếp nhận cảnh báo'); }
    catch (error) { message.error(error.message); }
    finally { setReceiving(null); }
  };
  const receive = async (id) => {
    setReceiving(id);
    try { await guestApi.acknowledge(id); setAlerts((items) => items.filter((a) => a._id !== id)); message.success('Đã tiếp nhận sự cố'); }
    catch (error) { message.error(error.message); }
    finally { setReceiving(null); }
  };

  const refresh = useCallback(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      notificationApi.list({ page: 1, limit: 1 }).then((res) => {
        const latest = res.data?.[0];
        if (latest && latestRef.current !== undefined && latestRef.current !== latest._id && !latest.isRead) {
          new Notification(latest.title, { body: latest.content, tag: latest._id });
        }
        latestRef.current = latest?._id ?? null;
      }).catch(() => {});
    }
    notificationApi
      .unreadCount()
      .then((res) => setCount(res.data.count))
      .catch(() => {});
    if (canSeeAlerts) guestApi.alerts().then((res) => setAlerts(res.data)).catch(() => {});
    if (canSeeTicketAlerts) ticketApi.emergencyAlerts().then((res) => setTicketAlerts(res.data)).catch(() => {});
  }, [canSeeAlerts, canSeeTicketAlerts]);

  usePolling(refresh, canSeeAlerts || canSeeTicketAlerts ? 15000 : POLL_MS);
  useEffect(() => {
    refresh();
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const banner = alerts.length ? createPortal(<div role="region" aria-label="Cảnh báo khẩn cấp" style={{ position: 'fixed', bottom: 76, left: 12, right: 12, zIndex: 1100, maxHeight: '30vh', overflowY: 'auto' }}>
    {alerts.map((a) => <Alert key={a._id} type="error" showIcon title={`KHẨN CẤP · ${a.location}`} description={a.description}
      action={a.canAcknowledge && <Button loading={receiving === a._id} onClick={() => receive(a._id)}>Đã tiếp nhận</Button>} />)}
  </div>, document.body) : null;

  const ticketModal = (
    <Modal
      open={ticketAlerts.length > 0}
      title={`KHẨN CẤP · ${ticketAlerts.length} sự cố chưa có người nhận`}
      closable={false}
      maskClosable={false}
      footer={null}
      width={520}
      zIndex={1200}
    >
      <div className="flex flex-col gap-3">
        {ticketAlerts.map((t) => (
          <Alert
            key={t._id}
            type="error"
            showIcon
            title={`Sự cố ${t.code}`}
            description={`${t.title}${t.location ? ` — ${t.location}` : ''}${t.apartmentId?.code ? ` (căn ${t.apartmentId.code})` : ''}`}
            action={
              <span className="flex flex-col gap-2">
                <Button onClick={() => navigate(`/app/tickets/${t._id}`)}>Xem phiếu</Button>
                {t.canAcknowledge && isTechnician && (
                  <Button type="primary" danger loading={receiving === t._id} onClick={() => claimTicket(t._id)}>
                    Nhận xử lý
                  </Button>
                )}
                {t.canAcknowledge && !isTechnician && (
                  <Button danger loading={receiving === t._id} onClick={() => receiveTicket(t._id)}>
                    Đã tiếp nhận
                  </Button>
                )}
              </span>
            }
          />
        ))}
      </div>
    </Modal>
  );
  if (variant === 'resident') {
    return (
      <>{banner}{ticketModal}<button
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
      </button></>
    );
  }

  return (
    <>{banner}{ticketModal}<Badge count={count} size="small" offset={[-4, 4]}>
      <Button
        type="text"
        aria-label="Thông báo"
        icon={<BellOutlined style={{ fontSize: 18 }} />}
        onClick={() => navigate(`/${area}/notifications`)}
      />
    </Badge></>
  );
}
