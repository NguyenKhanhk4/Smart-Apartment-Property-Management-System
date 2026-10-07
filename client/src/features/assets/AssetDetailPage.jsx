import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Button, Card, Descriptions, Flex, Skeleton, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { assetApi } from '../../api/moduleD.api';
import { useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import { ASSET_CATEGORIES, WORK_ORDER_STATUS } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
import PageHeader from '../../components/PageHeader';

// UC-D01 — Chi tiết tài sản: work order đang mở + lịch sử bảo trì (đúng hạn / trễ hạn)
export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Tên truyền từ danh sách → hiện ngay để tiêu đề morph từ dòng trong bảng (không chờ API)
  const passedName = useLocation().state?.name;
  const [page, setPage] = useState(1);
  const asset = useApi(() => assetApi.get(id), [id]);
  const history = useApi(() => assetApi.history(id, { page, limit: 10 }), [id, page]);
  const a = asset.data;
  const wo = a?.openWorkOrder;

  return (
    <Flex vertical gap={16}>
      <PageHeader
        className="mb-0"
        title={a?.name ?? passedName ?? <Skeleton.Input active size="small" />}
        titleTransitionName={`asset-${id}`}
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Tài sản', path: '/app/assets' },
          { label: 'Chi tiết' },
        ]}
        extra={
          <>
            {a && (a.isActive ? <Tag color="green">Đang theo dõi</Tag> : <Tag>Đã ngừng</Tag>)}
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/assets', { viewTransition: true })}>
              Danh sách
            </Button>
          </>
        }
      />
      <Card title="Thông tin tài sản" loading={asset.loading}>
        {a && (
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="Tòa">{a.buildingId?.name}</Descriptions.Item>
            <Descriptions.Item label="Loại"><EnumTag map={ASSET_CATEGORIES} value={a.category} /></Descriptions.Item>
            <Descriptions.Item label="Vị trí">{a.location || '—'}</Descriptions.Item>
            <Descriptions.Item label="Chu kỳ">{a.maintenanceCycleDays} ngày</Descriptions.Item>
            <Descriptions.Item label="Bảo trì gần nhất">{formatDate(a.lastMaintenanceDate)}</Descriptions.Item>
            <Descriptions.Item label="Bảo trì tiếp theo">{formatDate(a.nextMaintenanceDate)}</Descriptions.Item>
            <Descriptions.Item label="Số lần đã bảo trì">{a.doneCount}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú">{a.note || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>
      <Card title="Work order đang mở" size="small" loading={asset.loading}>
        {wo ? (
          <Descriptions column={{ xs: 1, md: 3 }} size="small">
            <Descriptions.Item label="Trạng thái"><EnumTag map={WORK_ORDER_STATUS} value={wo.status} /></Descriptions.Item>
            <Descriptions.Item label="Ngày lên lịch">{formatDate(wo.scheduledDate)}</Descriptions.Item>
            <Descriptions.Item label="Kỹ thuật viên">{wo.assignedTo?.fullName ?? <Typography.Text type="warning">Chưa phân công</Typography.Text>}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">Không có work order đang mở.</Typography.Text>
        )}
      </Card>
      <Card title="Lịch sử bảo trì" size="small">
        <Table
          rowKey="_id"
          size="small"
          loading={history.loading}
          dataSource={history.data ?? []}
          scroll={{ x: 700 }}
          pagination={{ current: page, pageSize: 10, total: history.pagination?.total, onChange: setPage, hideOnSinglePage: true }}
          columns={[
            { title: 'Ngày dự kiến', dataIndex: 'scheduledDate', width: 120, render: formatDate },
            { title: 'Hoàn thành', dataIndex: 'completedAt', width: 160, render: formatDateTime },
            { title: 'Kỹ thuật viên', dataIndex: ['assignedTo', 'fullName'], width: 150, render: (v) => v ?? '—' },
            { title: 'Đúng hạn', dataIndex: 'onTime', width: 100, render: (v) => (v ? <Tag color="green">Đúng hạn</Tag> : <Tag color="red">Trễ hạn</Tag>) },
            { title: 'Kết quả', dataIndex: 'note' },
          ]}
        />
      </Card>
    </Flex>
  );
}
