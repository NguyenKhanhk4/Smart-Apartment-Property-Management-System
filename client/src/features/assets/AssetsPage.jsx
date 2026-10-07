import { useState } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Card, DatePicker, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { assetApi } from '../../api/moduleD.api';
import { lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { ASSET_CATEGORIES, WORK_ORDER_STATUS, enumOptions } from '../../constants/enums';
import { formatDate } from '../../utils/format';
import PageHeader from '../../components/PageHeader';
import { vtName } from '../../motion/viewTransition';

// Form thêm/sửa tài sản (UC-D01)
function AssetFormModal({ asset, buildings, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => {
      const body = {
        ...v,
        lastMaintenanceDate: v.lastMaintenanceDate ? v.lastMaintenanceDate.format('YYYY-MM-DD') : null,
      };
      return asset ? assetApi.update(asset._id, body) : assetApi.create(body);
    },
    { success: asset ? 'Đã cập nhật tài sản' : 'Đã thêm tài sản', onDone: () => { onClose(); onDone(); } },
  );
  return (
    <Modal
      title={asset ? 'Sửa tài sản' : 'Thêm tài sản'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={
          asset
            ? { ...asset, buildingId: asset.buildingId?._id ?? asset.buildingId, lastMaintenanceDate: asset.lastMaintenanceDate ? dayjs(asset.lastMaintenanceDate) : null }
            : { maintenanceCycleDays: 30, category: 'ELEVATOR' }
        }
        onFinish={(v) => save(v).catch(() => {})}
      >
        <Form.Item name="buildingId" label="Tòa nhà" rules={[{ required: true, message: 'Chọn tòa nhà' }]}>
          <Select options={buildings.map((b) => ({ value: b._id, label: b.name }))} placeholder="Chọn tòa" />
        </Form.Item>
        <Form.Item name="name" label="Tên tài sản" rules={[{ required: true, min: 2, message: 'Nhập tên tài sản' }]}>
          <Input maxLength={150} placeholder="vd Thang máy số 1" />
        </Form.Item>
        <Flex gap={12}>
          <Form.Item name="category" label="Loại" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Select options={enumOptions(ASSET_CATEGORIES)} />
          </Form.Item>
          <Form.Item name="maintenanceCycleDays" label="Chu kỳ bảo trì (ngày)" rules={[{ required: true, message: 'Nhập chu kỳ' }]} style={{ flex: 1 }}>
            <InputNumber min={1} max={3650} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Flex>
        <Form.Item name="location" label="Vị trí">
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item
          name="lastMaintenanceDate"
          label="Ngày bảo trì gần nhất"
          extra="Để trống: ngày bảo trì tiếp theo = hôm nay + chu kỳ."
        >
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// UC-D01 — Danh mục tài sản chung (Manager thêm/sửa/ngừng; KTV chỉ xem)
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
      title: 'Tài sản',
      dataIndex: 'name',
      width: 260,
      fixed: 'left',
      render: (v, r) => (
        <Flex vertical>
          <Typography.Text strong style={vtName('asset', r._id)}>{v}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.buildingId?.name}{r.location ? ` · ${r.location}` : ''}
          </Typography.Text>
        </Flex>
      ),
    },
    { title: 'Loại', dataIndex: 'category', width: 110, render: (v) => <EnumTag map={ASSET_CATEGORIES} value={v} /> },
    { title: 'Chu kỳ', dataIndex: 'maintenanceCycleDays', width: 90, render: (v) => `${v} ngày` },
    { title: 'Bảo trì gần nhất', dataIndex: 'lastMaintenanceDate', width: 140, render: formatDate },
    {
      title: 'Bảo trì tiếp theo',
      dataIndex: 'nextMaintenanceDate',
      width: 150,
      render: (v, r) => <Typography.Text type={r.isDue ? 'danger' : undefined}>{formatDate(v)}{r.isDue && ' (đến hạn)'}</Typography.Text>,
    },
    {
      title: 'Work order đang mở',
      dataIndex: 'openWorkOrder',
      width: 150,
      render: (w) => (w ? <EnumTag map={WORK_ORDER_STATUS} value={w.status} /> : '—'),
    },
    { title: 'Theo dõi', dataIndex: 'isActive', width: 100, render: (v) => (v ? <Tag color="green">Đang theo dõi</Tag> : <Tag>Đã ngừng</Tag>) },
    ...(canEdit
      ? [
          {
            title: '',
            width: 180,
            fixed: 'right',
            render: (_, r) => (
              <Flex gap={4} onClick={(e) => e.stopPropagation()}>
                <Button size="small" onClick={() => setEditing(r)}>Sửa</Button>
                <Popconfirm
                  title={r.isActive ? 'Ngừng theo dõi tài sản này?' : 'Kích hoạt lại tài sản này?'}
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
      title="Tài sản chung"
      subtitle="Thiết bị dùng chung của tòa nhà và lịch bảo trì định kỳ."
      breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tài sản' }]}
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Thêm tài sản</Button>}
    />
    <Card>
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Tên tài sản" allowClear style={{ width: 200 }} onSearch={(q) => set({ q: q || undefined })} />
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
        scroll={{ x: 1180 }}
        onRow={(r) => ({ onClick: () => navigate(`/app/assets/${r._id}`, { viewTransition: true, state: { name: r.name } }), style: { cursor: 'pointer' } })}
        pagination={{ current: filters.page, pageSize: filters.limit, total: pagination?.total, showSizeChanger: true, onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })) }}
      />
      {editing && (
        <AssetFormModal asset={editing._id ? editing : null} buildings={buildings} open onClose={() => setEditing(null)} onDone={reload} />
      )}
    </Card>
    </>
  );
}
