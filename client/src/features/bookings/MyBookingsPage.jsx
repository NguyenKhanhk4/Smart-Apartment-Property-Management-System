import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { App, Button, Card, Empty, Flex, Pagination, Popconfirm, Segmented, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { bookingApi, memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { BOOKING_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';
import { formatDate, formatMoney } from '../../utils/format';
import { AmenityCover } from './AmenityListPage';

const SCOPES = [
  { value: 'upcoming', label: 'Sắp tới' },
  { value: 'past', label: 'Đã qua' },
];

// UC-D06 — "Lịch sử đặt": chủ hộ thấy cả hộ, thành viên thấy booking mình đặt; hủy khi còn trước giờ bắt đầu
export default function MyBookingsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [search, setSearch] = useSearchParams();
  const { data: mine = [] } = useApi(() => memberCodeApi.mine(), []);
  const apartmentId = search.get('apartmentId') ?? mine[0]?.apartment._id;
  const [scope, setScope] = useState('upcoming');
  const [page, setPage] = useState(1);

  const { data = [], pagination, loading, reload } = useApi(
    () => bookingApi.mine({ scope, page, limit: 10, apartmentId }),
    [scope, page, apartmentId],
    { enabled: Boolean(apartmentId) },
  );

  const cancel = async (b) => {
    try {
      await bookingApi.cancel(b._id);
      message.success('Đã hủy booking, không mất phí');
      reload();
    } catch (e) {
      message.error(e.message);
      reload();
    }
  };

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          aria-label="Quay lại"
          onClick={() => navigate(`/r/amenities${apartmentId ? `?apartmentId=${apartmentId}` : ''}`, { viewTransition: true })}
        />
        <Typography.Title level={4} style={{ margin: 0, ...vtName('amenities-title') }}>
          Lịch sử đặt
        </Typography.Title>
      </Flex>

      {mine.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={(id) => {
            setSearch({ apartmentId: id });
            setPage(1);
          }}
          options={mine.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}
      <Segmented
        block
        options={SCOPES}
        value={scope}
        onChange={(v) => {
          setScope(v);
          setPage(1);
        }}
      />

      <Spin spinning={loading}>
        {!loading && !data.length && <Empty description={scope === 'upcoming' ? 'Chưa có booking sắp tới' : 'Chưa có booking nào đã qua'} />}
        <Flex vertical gap={8}>
          {data.map((b) => (
            <Card key={b._id} size="small">
              <Flex gap={12} align="center">
                <div style={{ width: 72, flex: '0 0 auto' }}>
                  {b.amenity && <AmenityCover amenity={{ ...b.amenity, _id: `${b.amenity._id}-${b._id}` }} height={72} />}
                </div>
                <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
                  <Typography.Text strong ellipsis>
                    {b.amenity?.name ?? 'Tiện ích'}
                  </Typography.Text>
                  <Typography.Text>
                    {formatDate(b.date)} · {b.slotStart}–{b.slotEnd}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {b.fee > 0 ? formatMoney(b.fee) : b.passId ? 'Miễn phí theo gói tháng' : 'Miễn phí'}
                    {!b.isMine && b.bookedBy?.fullName ? ` · Đặt bởi ${b.bookedBy.fullName}` : ''}
                  </Typography.Text>
                  <Flex gap={4} wrap>
                    <EnumTag map={BOOKING_STATUS} value={b.status} />
                    {b.invoiceId && <Tag>Đã vào hóa đơn</Tag>}
                  </Flex>
                </Flex>
                {b.canCancel && (
                  <Popconfirm
                    title="Hủy booking này?"
                    description="Hủy trước giờ bắt đầu thì không mất phí."
                    okText="Hủy booking"
                    cancelText="Giữ lại"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => cancel(b)}
                  >
                    <Button danger size="small">
                      Hủy
                    </Button>
                  </Popconfirm>
                )}
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
