import { useState } from 'react';
import { App, Avatar, Button, Card, Flex, Image, Input, Popconfirm, Select, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { AppstoreOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { amenityApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AMENITY_ACCESS_MODES, enumOptions } from '../../constants/enums';
import { lookupApi, systemConfigApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import PageHeader from '../../components/PageHeader';
import AmenityFormModal from './AmenityFormModal';

const configValue = (configs, key, fallback) => configs.find((c) => c.key === key)?.value ?? fallback;

// Chi tiết vận hành theo kiểu: BOOKING có slot + sức chứa, WALK_IN có giới hạn số người cùng lúc
function operationOf(r) {
  if (r.accessMode === 'BOOKING') return `Slot ${r.slotDurationMinutes} phút · ${r.capacityPerSlot} căn / slot`;
  if (r.accessMode === 'WALK_IN') return r.maxConcurrent ? `Tối đa ${r.maxConcurrent} người cùng lúc` : 'Không giới hạn số người';
  return 'Không cần đặt chỗ';
}

// UC-D05 — Quản lý tiện ích (Manager): kiểu tiện ích, giờ mở cửa, slot, sức chứa, giá theo nhóm tuổi, gói tháng, ngừng/kích hoạt
export default function AmenitiesPage() {
  const { message } = App.useApp();
  const [filters, setFilters] = useState({ page: 1, limit: 50, sort: 'name' });
  const [editing, setEditing] = useState(null); // null | {} (thêm) | amenity (sửa)
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data = [], pagination, loading, reload } = useApi(() => amenityApi.list(filters), [filters]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const { data: configs = [] } = useApi(() => systemConfigApi.list(), []);
  const reception = {
    open: configValue(configs, 'RECEPTION_OPEN_TIME', '05:00'),
    close: configValue(configs, 'RECEPTION_CLOSE_TIME', '22:00'),
  };
  const ages = {
    childFreeAge: configValue(configs, 'CHILD_FREE_AGE', 6),
    childAdultAge: configValue(configs, 'CHILD_ADULT_AGE', 12),
  };

  const toggle = async (a) => {
    try {
      await amenityApi.setStatus(a._id, !a.isActive);
      message.success(a.isActive ? 'Đã ngừng tiện ích' : 'Đã kích hoạt lại tiện ích');
      reload();
    } catch (e) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: 'Tiện ích',
      dataIndex: 'name',
      width: 220,
      render: (v, r) => (
        <Flex gap={10} align="center">
          {r.imageUrl ? (
            <Image src={r.imageUrl} width={38} height={38} style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} preview={false} />
          ) : (
            <Avatar shape="square" size={38} icon={<AppstoreOutlined />} style={{ borderRadius: 6, flexShrink: 0 }} />
          )}
          <Flex vertical style={{ minWidth: 0 }}>
            <Typography.Text strong style={{ fontSize: 13, lineHeight: 1.3 }} ellipsis={{ tooltip: v }}>
              {v}
            </Typography.Text>
            {r.location && (
              <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.2 }} ellipsis={{ tooltip: r.location }}>
                {r.location}
              </Typography.Text>
            )}
          </Flex>
        </Flex>
      ),
    },
    {
      title: 'Kiểu',
      dataIndex: 'accessMode',
      width: 90,
      render: (v) => <EnumTag map={AMENITY_ACCESS_MODES} value={v} />,
    },
    {
      title: 'Tòa',
      dataIndex: 'buildingId',
      width: 95,
      render: (b) => (b?.name ? <Tag>{b.name}</Tag> : <Tag color="default">Toàn khu</Tag>),
    },
    {
      title: 'Giờ mở cửa',
      width: 110,
      render: (_, r) => (
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          {r.openTime && r.closeTime ? `${r.openTime} – ${r.closeTime}` : <Typography.Text type="secondary">—</Typography.Text>}
        </span>
      ),
    },
    {
      title: 'Vận hành',
      width: 165,
      render: (_, r) => <Typography.Text style={{ fontSize: 12.5 }}>{operationOf(r)}</Typography.Text>,
    },
    {
      title: 'Giá',
      dataIndex: 'priceSummary',
      width: 220,
      render: (v, r) => {
        if (r.accessMode === 'FREE') return <Tag color="green">Miễn phí</Tag>;
        if (!v) return <Typography.Text type="secondary">—</Typography.Text>;
        const parts = v.split(' · Gói ');
        if (parts.length > 1) {
          return (
            <Flex vertical gap={1}>
              <Typography.Text style={{ fontSize: 12.5, lineHeight: 1.25 }}>{parts[0]}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.2 }}>
                Gói {parts[1]}
              </Typography.Text>
            </Flex>
          );
        }
        return <Typography.Text style={{ fontSize: 12.5, lineHeight: 1.25 }}>{v}</Typography.Text>;
      },
    },
    {
      title: 'Thao tác',
      width: 150,
      align: 'right',
      render: (_, r) => (
        <Flex gap={8} align="center" justify="end">
          <Tooltip title={r.isActive ? 'Đang hoạt động (bấm để tạm dừng)' : 'Đã ngừng (bấm để kích hoạt lại)'} placement="top">
            <Popconfirm
              title={r.isActive ? 'Tạm dừng tiện ích này?' : 'Kích hoạt lại tiện ích này?'}
              description={r.isActive ? 'Cư dân sẽ không thấy tiện ích này nữa. Không dừng được nếu còn lượt đặt sắp tới.' : undefined}
              onConfirm={() => toggle(r)}
              okText="Đồng ý"
              cancelText="Hủy"
            >
              <Switch
                size="small"
                checked={r.isActive}
                checkedChildren="Hoạt động"
                unCheckedChildren="Tạm dừng"
                style={r.isActive ? { backgroundColor: '#52c41a' } : { backgroundColor: '#ff4d4f' }}
              />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="Sửa tiện ích">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(r)}
            />
          </Tooltip>
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        className="!mb-4"
        title="Tiện ích"
        subtitle={`Tiện ích tự do, vào cửa và đặt chỗ. Tiện ích vào cửa / đặt chỗ phải mở trong giờ lễ tân ${reception.open}–${reception.close}.`}
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tiện ích' }]}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
            Thêm tiện ích
          </Button>
        }
      />
      <Card styles={{ body: { padding: '16px 20px' } }}>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Input.Search placeholder="Tên tiện ích" allowClear style={{ width: 200 }} onSearch={(q) => set({ q: q || undefined })} />
          <Select
            allowClear
            placeholder="Kiểu"
            style={{ width: 130 }}
            options={enumOptions(AMENITY_ACCESS_MODES)}
            onChange={(accessMode) => set({ accessMode })}
          />
          <Select
            allowClear
            placeholder="Tòa"
            style={{ width: 140 }}
            options={buildings.map((b) => ({ value: b._id, label: b.name }))}
            onChange={(buildingId) => set({ buildingId })}
          />
          <Select
            allowClear
            placeholder="Trạng thái"
            style={{ width: 160 }}
            options={[
              { value: true, label: 'Đang hoạt động' },
              { value: false, label: 'Đã ngừng' },
            ]}
            onChange={(isActive) => set({ isActive })}
          />
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading}
          dataSource={data}
          columns={columns}
          scroll={{ x: 1050 }}
          pagination={{
            size: 'small',
            current: filters.page,
            pageSize: filters.limit,
            total: pagination?.total,
            showSizeChanger: true,
            showTotal: (total) => `Tổng ${total} tiện ích`,
            onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
          }}
        />
      </Card>
      {editing && (
        <AmenityFormModal
          amenity={editing._id ? editing : null}
          buildings={buildings}
          reception={reception}
          ages={ages}
          open
          onClose={() => setEditing(null)}
          onDone={reload}
        />
      )}
    </>
  );
}
