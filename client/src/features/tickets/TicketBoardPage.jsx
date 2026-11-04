import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Card, Empty, Flex, Select, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { lookupApi, ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { usePolling } from '../../hooks/usePolling';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { PRIORITIES, TICKET_SCOPES, TICKET_STATUS } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import { AssignModal } from './TicketActionModals';

// Người 4 — Kanban điều phối sự cố của Trưởng BQL: mỗi cột một trạng thái, xử lý ngoại lệ (giao lại, quá hạn)
export default function TicketBoardPage() {
  const navigate = useNavigate();
  const [buildingId, setBuildingId] = useState();
  const [assigning, setAssigning] = useState(null);
  const { data, loading, reload } = useApi(() => ticketApi.board({ buildingId }), [buildingId]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  usePolling(reload, 60_000);
  const columns = data?.columns ?? [];

  return (
    <>
      <PageHeader
        title="Bảng điều phối sự cố"
        subtitle="Sự cố đang mở theo trạng thái; khẩn cấp và gần hạn lên đầu. Bấm thẻ để xem chi tiết."
        extra={
          <>
            <Select
              allowClear
              placeholder="Tất cả tòa"
              style={{ width: 180 }}
              value={buildingId}
              options={buildings.map((b) => ({ value: b._id, label: b.name }))}
              onChange={setBuildingId}
            />
            <Button icon={<ReloadOutlined />} onClick={reload}>
              Làm mới
            </Button>
          </>
        }
      />
      <Spin spinning={loading}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {columns.map((col) => (
            <Card
              key={col.status}
              size="small"
              className="shrink-0 w-[280px]"
              styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
              title={
                <Flex justify="space-between" align="center">
                  <EnumTag map={TICKET_STATUS} value={col.status} />
                  <Badge count={col.items.length} showZero color="#8c8c8c" />
                </Flex>
              }
            >
              {col.items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Trống" />
              ) : (
                <Flex vertical gap={8}>
                  {col.items.map((t) => (
                    <Card key={t._id} size="small" hoverable onClick={() => navigate(`/app/tickets/${t._id}`)}>
                      <Flex vertical gap={4}>
                        <Flex gap={4} wrap>
                          <EnumTag map={PRIORITIES} value={t.priority} />
                          {t.scope === 'IN_APARTMENT' && <EnumTag map={TICKET_SCOPES} value={t.scope} />}
                          {t.isOverdue && <Tag color="red">Quá hạn</Tag>}
                        </Flex>
                        <Typography.Text strong ellipsis>
                          {t.title}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t.code} · Căn {t.apartmentId?.code}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t.assignedTo?.fullName ?? 'Chưa có người nhận'} · hạn {formatDateTime(t.dueDate)}
                        </Typography.Text>
                        {col.status !== 'WAITING_CONFIRM' && (
                          <Button
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssigning(t);
                            }}
                          >
                            {t.assignedTo ? 'Giao lại' : 'Phân công'}
                          </Button>
                        )}
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              )}
            </Card>
          ))}
        </div>
      </Spin>
      {assigning && <AssignModal ticket={assigning} open onClose={() => setAssigning(null)} onDone={reload} />}
    </>
  );
}
