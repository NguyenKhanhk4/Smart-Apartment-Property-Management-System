import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Badge, Button, Card, Empty, Flex, Pagination, Segmented, Spin, Typography } from 'antd';
import { notificationApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import { NOTIFICATION_TYPES } from '../../constants/enums';
import { fromNow, resolveLink } from '../../utils/format';
import { NOTIFICATIONS_CHANGED } from './NotificationBell';

// UC-E09 bước 3-4 — Thông báo cá nhân, đánh dấu đã đọc
export default function NotificationsPage() {
  const navigate = useNavigate();
  const area = useLocation().pathname.startsWith('/r') ? 'r' : 'app';
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data = [], raw, pagination, loading, reload } = useApi(
    () => notificationApi.list({ page, limit: 15, isRead: filter === 'unread' ? false : undefined }),
    [page, filter],
  );
  const changed = () => {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    return reload();
  };
  const [markAll, marking] = useAction(() => notificationApi.markRead(), { success: 'Đã đánh dấu tất cả là đã đọc', onDone: changed });

  const open = async (n) => {
    if (!n.isRead) {
      await notificationApi.markOneRead(n._id).catch(() => {});
      changed();
    }
    const link = resolveLink(n.link, area);
    if (link) navigate(link);
  };

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Thông báo {raw?.unreadCount > 0 && <Badge count={raw.unreadCount} />}
        </Typography.Title>
        <Flex gap={8}>
          <Segmented
            value={filter}
            onChange={(v) => (setFilter(v), setPage(1))}
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'unread', label: 'Chưa đọc' },
            ]}
          />
          <Button onClick={() => markAll().catch(() => {})} loading={marking} disabled={!raw?.unreadCount}>
            Đọc tất cả
          </Button>
        </Flex>
      </Flex>
      <Spin spinning={loading}>
        <Flex vertical gap={8}>
          {!loading && !data.length && <Empty description="Không có thông báo" />}
          {data.map((n) => (
            <Card
              key={n._id}
              size="small"
              hoverable
              onClick={() => open(n)}
              style={{ borderLeft: n.isRead ? undefined : '3px solid #1677ff', background: n.isRead ? undefined : '#f0f7ff' }}
            >
              <Flex vertical gap={4}>
                <Flex justify="space-between" gap={8}>
                  <Typography.Text strong={!n.isRead}>{n.title}</Typography.Text>
                  <EnumTag map={NOTIFICATION_TYPES} value={n.type} />
                </Flex>
                <Typography.Text type="secondary">{n.content}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fromNow(n.createdAt)}
                </Typography.Text>
              </Flex>
            </Card>
          ))}
        </Flex>
      </Spin>
      {pagination?.total > pagination?.limit && (
        <Pagination align="center" current={page} pageSize={pagination.limit} total={pagination.total} onChange={setPage} />
      )}
    </Flex>
  );
}
