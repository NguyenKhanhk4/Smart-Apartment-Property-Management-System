import { useState } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Card, Flex, Input, Popconfirm, Select, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined, ScanOutlined } from '@ant-design/icons';
import { assetApi, workOrderApi } from '../../api/equipment.api';
import { lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import AssetFormModal from './AssetFormModal';
import { cycleText, dueText } from './assetFormat';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { ASSET_CATEGORIES, WORK_ORDER_STATUS, enumOptions } from '../../constants/enums';
import { formatDate } from '../../utils/format';
import PageHeader from '../../components/PageHeader';
import { vtName } from '../../motion/viewTransition';

// UC07 — Danh sách thiết bị (Trưởng BQL thêm / sửa / ngừng theo dõi; Kỹ thuật viên chỉ xem)
export default function AssetsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const canEdit = hasRole('MANAGER');
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const [editing, setEditing] = useState(null); // null | {} (thêm) | asset (sửa)
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data = [], pagination, loading, reload } = useApi(() => assetApi.list(filters), [filters]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);

  const [runScan, scanning] = useAction(() => workOrderApi.runGenerate(), {
    success: (res) =>
      res.data?.status === 'FAILED'
        ? undefined
        : `Đã tạo ${res.data?.affectedCount ?? 0} work order`,
    onDone: (res) => (res.data?.status === 'FAILED' ? message.error(res.data.errorMessage || 'Quét tài sản đến hạn thất bại') : reload()),
  });

  const toggle = async (asset) => {
    try {
      await assetApi.setStatus(asset._id, !asset.isActive);
      message.success(asset.isActive ? 'Đã ngừng theo dõi' : 'Đã kích hoạt lại');
      reload();
    } catch (e) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: 'Thiết bị',
      dataIndex: 'name',
      width: 240,
      fixed: 'left',
      render: (v, r) => (
        <Flex vertical>
          <Typography.Text strong style={vtName('asset', r._id)}>{v}</Typography.Text>
          <Typography.Text code style={{ fontSize: 13, alignSelf: 'flex-start' }}>{r.code}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.buildingId?.name}{r.location ? ` · ${r.location}` : ''}
          </Typography.Text>
        </Flex>
      ),
    },
    { title: 'Loại', dataIndex: 'category', width: 110, render: (v) => <EnumTag map={ASSET_CATEGORIES} value={v} /> },
    { title: 'Chu kỳ', dataIndex: 'cycleValue', width: 90, render: (_, r) => cycleText(r) },
    { title: 'Bảo trì gần nhất', dataIndex: 'lastMaintenanceDate', width: 140, render: formatDate },
    {
      title: 'Bảo trì tiếp theo',
      dataIndex: 'nextMaintenanceDate',
      width: 180,
      render: (v, r) => {
        const due = r.isActive && dueText(v);
        return <Typography.Text type={due ? 'danger' : undefined}>{formatDate(v)}{due && ` (${due})`}</Typography.Text>;
      },
    },
    {
      title: 'Phiếu đang mở',
      dataIndex: 'openWorkOrder',
      width: 130,
      render: (w) => (w ? <EnumTag map={WORK_ORDER_STATUS} value={w.status} /> : '—'),
    },
    { title: 'Theo dõi', dataIndex: 'isActive', width: 100, render: (v) => (v ? <Tag color="green">Đang theo dõi</Tag> : <Tag>Đã ngừng</Tag>) },
    ...(canEdit
      ? [
          {
            title: '',
            width: 150,
            fixed: 'right',
            render: (_, r) => (
              <Flex gap={4} onClick={(e) => e.stopPropagation()}>
                <Button size="small" onClick={() => setEditing(r)}>Sửa</Button>
                <Popconfirm
                  title={r.isActive ? 'Ngừng theo dõi thiết bị này?' : 'Theo dõi lại thiết bị này?'}
                  onConfirm={() => toggle(r)}
                  okText="Đồng ý"
                  cancelText="Hủy"
                >
                  <Button size="small" danger={r.isActive}>{r.isActive ? 'Ngừng' : 'Kích hoạt'}</Button>
                </Popconfirm>
              </Flex>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
    <PageHeader
      title="Thiết bị"
      subtitle="Thiết bị dùng chung của tòa nhà, chu kỳ bảo trì, mẫu checklist và mã QR."
      breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Thiết bị' }]}
      extra={
        canEdit && (
          <>
            <Popconfirm
              title="Quét thiết bị đến hạn?"
              description="Tạo phiếu bảo trì định kỳ cho các thiết bị đã đến hạn mà chưa có phiếu đang mở."
              onConfirm={() => runScan().catch(() => {})}
              okText="Quét"
              cancelText="Hủy"
            >
              <Button icon={<ScanOutlined />} loading={scanning}>Quét thiết bị đến hạn</Button>
            </Popconfirm>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Thêm thiết bị</Button>
          </>
        )
      }
    />
    <Card>
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Mã hoặc tên thiết bị" allowClear style={{ width: 220 }} onSearch={(q) => set({ q: q || undefined })} />
        <Select allowClear placeholder="Tòa" style={{ width: 140 }} options={buildings.map((b) => ({ value: b._id, label: b.name }))} onChange={(buildingId) => set({ buildingId })} />
        <Select allowClear mode="multiple" placeholder="Loại" style={{ minWidth: 160 }} options={enumOptions(ASSET_CATEGORIES)} onChange={(c) => set({ category: c?.length ? c.join(',') : undefined })} />
        <Select allowClear placeholder="Trạng thái" style={{ width: 150 }} options={[{ value: true, label: 'Đang theo dõi' }, { value: false, label: 'Đã ngừng' }]} onChange={(isActive) => set({ isActive })} />
        <Flex align="center" gap={6}>
          <Switch size="small" onChange={(on) => set({ dueWithinDays: on ? 7 : undefined })} />
          <span>Đến hạn trong 7 ngày</span>
        </Flex>
      </Flex>
      <Table
        rowKey="_id"
        size="middle"
        loading={loading}
        dataSource={data}
        columns={columns}
        scroll={{ x: 1130 }}
        onRow={(r) => ({ onClick: () => navigate(`/app/assets/${r._id}`, { viewTransition: true, state: { name: r.name } }), style: { cursor: 'pointer' } })}
        pagination={{ current: filters.page, pageSize: filters.limit, total: pagination?.total, showSizeChanger: true, onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })) }}
      />
      {editing && (
        <AssetFormModal
          asset={editing._id ? editing : null}
          buildings={buildings}
          open
          onClose={() => setEditing(null)}
          // Thêm mới: mở trang chi tiết để in mã QR ngay (MSG-E02); sửa: tải lại danh sách
          onDone={(saved) => (editing._id ? reload() : navigate(`/app/assets/${saved._id}`, { viewTransition: true, state: { name: saved.name } }))}
        />
      )}
    </Card>
    </>
  );
}
