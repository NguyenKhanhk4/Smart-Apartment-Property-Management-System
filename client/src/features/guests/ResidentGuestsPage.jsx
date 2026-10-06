import { useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { guestApi, lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import { GUEST_STATUS } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';

// UC-E07 — Cư dân đăng ký khách trước để bảo vệ đối chiếu
export default function ResidentGuestsPage() {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const { data = [], loading, reload } = useApi(() => guestApi.list({ limit: 50 }), []);
  const { data: apartments = [] } = useApi(() => lookupApi.apartments(), []);
  const [register, registering] = useAction(
    (v) => guestApi.register({ ...v, expectedTime: v.expectedTime.toISOString() }),
    { success: 'Đã đăng ký khách', onDone: () => (setOpen(false), reload()) },
  );
  const [cancel] = useAction((id) => guestApi.cancel(id), { success: 'Đã hủy đăng ký', onDone: reload });

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          Khách đến thăm
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Đăng ký khách
        </Button>
      </Flex>
      <Spin spinning={loading}>
        <Flex vertical gap={8}>
          {!loading && !data.length && <Empty description="Chưa có khách nào" />}
          {data.map((g) => (
            <Card key={g._id} size="small">
              <Flex justify="space-between" align="center" gap={8}>
                <Flex vertical gap={2}>
                  <Typography.Text strong>
                    {g.guestName}
                    {g.numberOfGuests > 1 && ` (+${g.numberOfGuests - 1})`}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Căn {g.apartmentId?.code} · Dự kiến {formatDateTime(g.expectedTime)}
                  </Typography.Text>
                  {g.checkInTime && (
                    <Typography.Text style={{ fontSize: 12 }}>
                      Vào {formatDateTime(g.checkInTime)}
                      {g.checkOutTime && ` · Rời ${formatDateTime(g.checkOutTime)}`}
                    </Typography.Text>
                  )}
                </Flex>
                <Flex vertical align="end" gap={4}>
                  <EnumTag map={GUEST_STATUS} value={g.status} />
                  {g.status === 'EXPECTED' && (
                    <Popconfirm title="Hủy đăng ký khách này?" onConfirm={() => cancel(g._id).catch(() => {})}>
                      <Button size="small" type="link" danger>
                        Hủy
                      </Button>
                    </Popconfirm>
                  )}
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>
      </Spin>

      <Modal
        title="Đăng ký khách"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={registering}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{ numberOfGuests: 1, expectedTime: dayjs().add(1, 'hour').startOf('hour') }}
          onFinish={(v) => register(v).catch(() => {})}
        >
          {apartments.length > 1 && (
            <Form.Item name="apartmentId" label="Căn hộ" rules={[{ required: true, message: 'Chọn căn hộ' }]}>
              <Select options={apartments.map((a) => ({ value: a._id, label: a.code }))} />
            </Form.Item>
          )}
          <Form.Item name="guestName" label="Tên khách" rules={[{ required: true, min: 2, message: 'Nhập tên khách' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="guestPhone" label="Số điện thoại">
            <Input maxLength={15} />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item
              name="expectedTime"
              label="Thời gian dự kiến đến"
              style={{ flex: 2 }}
              rules={[{ required: true, message: 'Chọn thời gian' }]}
            >
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                format="HH:mm DD/MM/YYYY"
                style={{ width: '100%' }}
                disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
              />
            </Form.Item>
            <Form.Item name="numberOfGuests" label="Số người" style={{ flex: 1 }}>
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
          </Flex>
          <Form.Item name="purpose" label="Mục đích">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
