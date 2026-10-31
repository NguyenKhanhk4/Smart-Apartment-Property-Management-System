import { useNavigate } from 'react-router';
import { Alert, Button, Card, Empty, Flex, Spin, Tag, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { ticketApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { usePolling } from '../../hooks/usePolling';
import EnumTag from '../../components/EnumTag';
import { PRIORITIES, TICKET_SCOPES } from '../../constants/enums';
import { formatDateTime, fromNow } from '../../utils/format';

// Hàng chờ sự cố theo ca (Người 4): KTV bấm "Nhận" — chỉ 1 người nhận được; thẻ dọc cho điện thoại
export default function TicketQueue({ onClaimed }) {
  const navigate = useNavigate();
  const { data, loading, reload } = useApi(() => ticketApi.queue(), []);
  usePolling(reload, 30_000);
  const [claim, claiming] = useAction((id) => ticketApi.claim(id), {
    success: 'Đã nhận sự cố',
    onDone: (res) => {
      onClaimed?.();
      navigate(`/app/tickets/${res.data._id}`);
    },
  });
  const items = data?.items ?? [];

  return (
    <Spin spinning={loading}>
      <Flex vertical gap={8}>
        {data?.hasSchedule && !data.onDuty && (
          <Alert type="warning" showIcon title="Bạn không trong ca trực hiện tại, chỉ người đang trực mới nhận được sự cố." />
        )}
        {!loading && !items.length && <Empty description="Không có sự cố nào đang chờ nhận" />}
        {items.map((t) => (
          <Card key={t._id} size="small" hoverable onClick={() => navigate(`/app/tickets/${t._id}`)}>
            <Flex justify="space-between" align="center" gap={12} wrap>
              <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
                <Flex gap={6} wrap align="center">
                  <EnumTag map={PRIORITIES} value={t.priority} />
                  <EnumTag map={TICKET_SCOPES} value={t.scope} />
                  {t.isOverdue && <Tag color="red">Quá hạn</Tag>}
                </Flex>
                <Typography.Text strong ellipsis>
                  {t.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t.code} · Căn {t.apartmentId?.code} · {t.category?.name} · {fromNow(t.createdAt)}
                </Typography.Text>
                {t.ackDueAt && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <ClockCircleOutlined /> Cần nhận trước {formatDateTime(t.ackDueAt)}
                  </Typography.Text>
                )}
              </Flex>
              <Button
                type="primary"
                loading={claiming}
                disabled={data?.hasSchedule && !data.onDuty}
                onClick={(e) => {
                  e.stopPropagation();
                  claim(t._id).catch(() => reload());
                }}
              >
                Nhận
              </Button>
            </Flex>
          </Card>
        ))}
      </Flex>
    </Spin>
  );
}
