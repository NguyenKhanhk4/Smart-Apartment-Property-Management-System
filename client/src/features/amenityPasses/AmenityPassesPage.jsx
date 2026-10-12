import { useState } from 'react';
import { Avatar, Button, Card, DatePicker, Flex, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { amenityPassApi } from '../../api/moduleD.api';
import { lookupApi } from '../../api/moduleE.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { AGE_GROUPS, AMENITY_ACCESS_MODES, AMENITY_PASS_STATUS, enumOptions } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime, formatMoney } from '../../utils/format';

const monthLabel = (m) => `${m.slice(5)}/${m.slice(0, 4)}`;

// UC-D09 — Trưởng BQL / Lễ tân xem gói tháng của mọi hộ. Chỉ Trưởng BQL hủy được (bắt buộc lý do, ghi audit).
export default function AmenityPassesPage() {
  const { hasRole } = useAuth();
  const isManager = hasRole('MANAGER');
  const [filters, setFilters] = useState({ page: 1, limit: 20, sort: '-month', status: 'ACTIVE' });
  const [aptSearch, setAptSearch] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [form] = Form.useForm();
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data = [], pagination, loading, reload } = useApi(() => amenityPassApi.list(filters), [filters]);
  const { data: amenities = [] } = useApi(() => lookupApi.amenities(), []);
  const { data: apartments = [] } = useApi(() => lookupApi.apartments({ q: aptSearch }), [aptSearch]);

  const [cancel, cancelling$] = useAction((v) => amenityPassApi.cancel(cancelling._id, v.reason), {
    success: 'Đã hủy gói tháng',
    onDone: () => {
      setCancelling(null);
      form.resetFields();
      reload();
    },
  });

  const columns = [
    {
      title: 'Người dùng gói',
      dataIndex: 'userId',
      width: 220,
      fixed: 'left',
      render: (u, r) => (
        <Flex gap={8} align="center">
          <Avatar size={32} src={u?.avatarUrl} icon={<UserOutlined />} />
          <Flex vertical>
            <Typography.Text strong>{u?.fullName ?? '—'}</Typography.Text>
            {/* Mã cư dân để phân biệt người trùng tên */}
            <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {r.memberCode ?? '—'}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: 'Căn hộ',
      dataIndex: 'apartmentId',
      width: 150,
      render: (a) => (a ? `${a.code} · ${a.buildingId?.name ?? ''}` : '—'),
    },
    {
      title: 'Tiện ích',
      dataIndex: 'amenityId',
      width: 180,
      render: (a) => (
        <Flex vertical>
          <Typography.Text>{a?.name ?? '—'}</Typography.Text>
          {a && <EnumTag map={AMENITY_ACCESS_MODES} value={a.accessMode} />}
        </Flex>
      ),
    },
    { title: 'Tháng', dataIndex: 'month', width: 90, render: monthLabel },
    { title: 'Nhóm tuổi', dataIndex: 'ageGroup', width: 150, render: (v) => <EnumTag map={AGE_GROUPS} value={v} /> },
    { title: 'Phí', dataIndex: 'fee', width: 120, align: 'right', render: (v) => formatMoney(v) },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 170,
      render: (v, r) => (
        <Flex gap={4} wrap>
          <EnumTag map={AMENITY_PASS_STATUS} value={v} />
          {r.invoiceId && <Tag>Đã vào hóa đơn</Tag>}
          {r.cancelReason && (
            <Tooltip title={r.cancelReason}>
              <Tag color="orange">Lý do</Tag>
            </Tooltip>
          )}
        </Flex>
      ),
    },
    { title: 'Mua lúc', dataIndex: 'createdAt', width: 150, render: formatDateTime },
    ...(isManager
      ? [
          {
            title: '',
            width: 90,
            fixed: 'right',
            render: (_, r) =>
              r.canCancel && (
                <Button size="small" danger onClick={() => setCancelling(r)}>
                  Hủy gói
                </Button>
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Gói tháng"
        subtitle="Gói tháng tiện ích của cư dân. Phí tháng M được cộng vào hóa đơn đầu tháng M+1; gói đã vào hóa đơn không hủy được."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Gói tháng' }]}
      />
      <Card>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <DatePicker
            picker="month"
            format="MM/YYYY"
            placeholder="Tháng"
            allowClear
            onChange={(d) => set({ month: d ? d.format('YYYY-MM') : undefined })}
          />
          <Select
            allowClear
            showSearch
            filterOption={false}
            placeholder="Căn hộ"
            style={{ width: 160 }}
            onSearch={setAptSearch}
            onChange={(apartmentId) => set({ apartmentId })}
            options={apartments.map((a) => ({ value: a._id, label: `${a.code} · ${a.buildingId?.name ?? ''}` }))}
          />
          <Select
            allowClear
            placeholder="Tiện ích"
            style={{ width: 180 }}
            onChange={(amenityId) => set({ amenityId })}
            options={amenities.map((a) => ({ value: a._id, label: a.name }))}
          />
          <Select
            placeholder="Trạng thái"
            allowClear
            style={{ width: 150 }}
            value={filters.status}
            onChange={(status) => set({ status })}
            options={enumOptions(AMENITY_PASS_STATUS)}
          />
          <Select
            allowClear
            placeholder="Hóa đơn"
            style={{ width: 160 }}
            onChange={(invoiced) => set({ invoiced })}
            options={[
              { value: true, label: 'Đã vào hóa đơn' },
              { value: false, label: 'Chưa vào hóa đơn' },
            ]}
          />
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading}
          dataSource={data}
          columns={columns}
          scroll={{ x: 1250 }}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: pagination?.total,
            showSizeChanger: true,
            onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
          }}
        />
      </Card>

      <Modal
        title={cancelling ? `Hủy gói ${cancelling.amenityId?.name} — ${cancelling.userId?.fullName}${cancelling.memberCode ? ` (${cancelling.memberCode})` : ''}` : ''}
        open={Boolean(cancelling)}
        onCancel={() => setCancelling(null)}
        onOk={() => form.submit()}
        okText="Hủy gói"
        okButtonProps={{ danger: true }}
        cancelText="Đóng"
        confirmLoading={cancelling$}
        destroyOnHidden
      >
        {cancelling && (
          <Typography.Paragraph type="secondary">
            Gói tháng {monthLabel(cancelling.month)} · {formatMoney(cancelling.fee)}. Người dùng gói và chủ hộ sẽ nhận thông báo; thao tác được ghi nhật ký.
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" preserve={false} onFinish={cancel}>
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, min: 5, max: 500, message: 'Nhập lý do 5–500 ký tự' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
