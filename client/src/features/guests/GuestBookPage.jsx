import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Table,
  Typography,
} from 'antd';
import { LoginOutlined, LogoutOutlined, UserAddOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { guestApi, lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { GUEST_STATUS } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';

function ApartmentSelect(props) {
  const [q, setQ] = useState('');
  const { data = [], loading } = useApi(() => lookupApi.apartments({ q }), [q]);
  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setQ }}
      loading={loading}
      placeholder="Gõ mã căn hộ"
      options={data.map((a) => ({ value: a._id, label: `${a.code} · ${a.buildingId?.name ?? ''}` }))}
      {...props}
    />
  );
}

// UC-E08 — Bảo vệ ghi nhận giờ khách đến/rời (gồm khách vãng lai — BR-O10). Lễ tân/Manager xem.
export default function GuestBookPage() {
  const { hasRole } = useAuth();
  const isGate = hasRole('STAFF:SECURITY');
  const [form] = Form.useForm();
  const [date, setDate] = useState(dayjs());
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState();
  const [page, setPage] = useState(1);
  const [walkInOpen, setWalkInOpen] = useState(false);

  const params = useMemo(
    () => ({
      date: date?.format('YYYY-MM-DD'),
      status: status === 'ALL' ? undefined : status,
      q,
      page,
      limit: 20,
      sort: 'expectedTime',
    }),
    [date, status, q, page],
  );
  const { data = [], pagination, loading, reload } = useApi(() => guestApi.list(params), [params]);
  const [checkIn] = useAction((id) => guestApi.checkIn(id), { success: 'Đã ghi nhận khách đến', onDone: reload });
  const [checkOut] = useAction((id) => guestApi.checkOut(id), { success: 'Đã ghi nhận khách rời', onDone: reload });
  const [walkIn, walking] = useAction((v) => guestApi.walkIn(v), {
    success: 'Đã ghi nhận khách vãng lai',
    onDone: () => (setWalkInOpen(false), reload()),
  });

  const columns = [
    {
      title: 'Khách',
      dataIndex: 'guestName',
      render: (v, r) => (
        <Flex vertical>
          <Typography.Text strong>
            {v} {r.numberOfGuests > 1 && `(+${r.numberOfGuests - 1})`}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[r.guestPhone, r.purpose, r.isWalkIn && 'Vãng lai'].filter(Boolean).join(' · ')}
          </Typography.Text>
        </Flex>
      ),
    },
    { title: 'Căn hộ', dataIndex: ['apartmentId', 'code'], width: 100 },
    { title: 'Dự kiến', dataIndex: 'expectedTime', width: 150, render: formatDateTime },
    { title: 'Vào', dataIndex: 'checkInTime', width: 150, render: formatDateTime },
    { title: 'Rời', dataIndex: 'checkOutTime', width: 150, render: formatDateTime },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <EnumTag map={GUEST_STATUS} value={v} /> },
    ...(isGate
      ? [
          {
            title: '',
            width: 110,
            render: (_, r) =>
              r.status === 'EXPECTED' ? (
                <Button size="small" type="primary" icon={<LoginOutlined />} onClick={() => checkIn(r._id).catch(() => {})}>
                  Vào
                </Button>
              ) : r.status === 'CHECKED_IN' ? (
                <Button size="small" icon={<LogoutOutlined />} onClick={() => checkOut(r._id).catch(() => {})}>
                  Rời
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Card
      title="Sổ khách ra vào"
      extra={
        isGate && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setWalkInOpen(true)}>
            Khách vãng lai
          </Button>
        )
      }
    >
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <DatePicker value={date} onChange={(d) => (setDate(d), setPage(1))} format="DD/MM/YYYY" allowClear />
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[{ value: 'ALL', label: 'Tất cả' }, ...Object.entries(GUEST_STATUS).map(([value, { label }]) => ({ value, label }))]}
        />
        <Input.Search
          placeholder="Tên / SĐT / mã căn"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => (setQ(v || undefined), setPage(1))}
        />
      </Flex>
      <Table
        rowKey="_id"
        loading={loading}
        dataSource={data}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{ current: page, pageSize: 20, total: pagination?.total, onChange: setPage }}
      />

      <Modal
        title="Ghi nhận khách vãng lai"
        open={walkInOpen}
        onCancel={() => setWalkInOpen(false)}
        onOk={() => form.submit()}
        okText="Cho vào"
        confirmLoading={walking}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ numberOfGuests: 1 }} onFinish={(v) => walkIn(v).catch(() => {})}>
          <Form.Item name="guestName" label="Tên khách" rules={[{ required: true, min: 2, message: 'Bắt buộc nhập tên khách' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="apartmentId" label="Căn hộ đến thăm" rules={[{ required: true, message: 'Bắt buộc chọn căn hộ' }]}>
            <ApartmentSelect />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="guestPhone" label="Số điện thoại" style={{ flex: 1 }}>
              <Input maxLength={15} />
            </Form.Item>
            <Form.Item name="idNumber" label="CCCD" style={{ flex: 1 }}>
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="numberOfGuests" label="Số người" style={{ width: 100 }}>
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
          </Flex>
          <Form.Item name="purpose" label="Mục đích">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
