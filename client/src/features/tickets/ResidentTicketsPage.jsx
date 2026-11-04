import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Empty, Flex, Pagination, Segmented, Spin, Typography } from 'antd';
import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import { PRIORITIES, TICKET_FINAL_STATUSES, TICKET_OPEN_STATUSES, TICKET_STATUS, TICKET_TYPES } from '../../constants/enums';
import { fromNow } from '../../utils/format';
import TicketCreateModal from './TicketCreateModal';

const TABS = [
  { value: 'open', label: 'Đang xử lý', status: TICKET_OPEN_STATUSES.join(',') },
  { value: 'confirm', label: 'Chờ nghiệm thu', status: 'WAITING_CONFIRM' },
  { value: 'done', label: 'Đã đóng', status: TICKET_FINAL_STATUSES.join(',') },
];

// UC-E02, E05 — Cư dân xem phản ánh của căn hộ mình, tạo mới, vào chi tiết để xác nhận/đánh giá
export default function ResidentTicketsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const status = TABS.find((t) => t.value === tab).status;
  const { data = [], pagination, loading, reload } = useApi(
    () => ticketApi.list({ status, page, limit: 10 }),
    [status, page],
  );

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          Phản ánh
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          Gửi mới
        </Button>
      </Flex>
      <Segmented
        block
        options={TABS}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
      />
      <Spin spinning={loading}>
        <Flex vertical gap={8}>
          {!loading && !data.length && <Empty description="Chưa có phản ánh" />}
          {data.map((t) => (
            <Card key={t._id} size="small" hoverable onClick={() => navigate(`/r/tickets/${t._id}`)}>
              <Flex justify="space-between" align="center" gap={8}>
                <Flex vertical gap={4} style={{ minWidth: 0 }}>
                  <Typography.Text strong ellipsis>
                    {t.title}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t.code} · {t.category?.name} · {fromNow(t.createdAt)}
                  </Typography.Text>
                  <Flex gap={4} wrap>
                    <EnumTag map={TICKET_TYPES} value={t.type} />
                    <EnumTag map={TICKET_STATUS} value={t.status} />
                    <EnumTag map={PRIORITIES} value={t.priority} />
                  </Flex>
                </Flex>
                <RightOutlined />
              </Flex>
            </Card>
          ))}
        </Flex>
      </Spin>
      {pagination?.total > pagination?.limit && (
        <Pagination
          align="center"
          current={page}
          pageSize={pagination.limit}
          total={pagination.total}
          onChange={setPage}
        />
      )}
      <TicketCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(t) => {
          setCreating(false);
          if (tab === 'open') reload();
          else setTab('open');
          navigate(`/r/tickets/${t._id}`);
        }}
      />
    </Flex>
  );
}
