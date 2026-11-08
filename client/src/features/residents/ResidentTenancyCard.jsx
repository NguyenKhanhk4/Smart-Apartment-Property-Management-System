import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Skeleton, Space, Tag } from 'antd';
import { residentsApi } from '../../api/moduleA.api';
import PhoneAccountNotice from '../../components/PhoneAccountNotice';
import { useAction, useApi } from '../../hooks/useApi';
import { usePhoneAccount } from '../../hooks/usePhoneAccount';
import { formatDate } from '../../utils/format';
import { PHONE_RULES } from '../../utils/phone';

function StartTenancyModal({ apartment, onCancel, onStarted }) {
  const [form] = Form.useForm();
  const check = usePhoneAccount(Form.useWatch('phone', form), apartment.apartmentId);
  const [start, starting] = useAction(({ phone, fullName, email, feePayer }) => residentsApi.startTenancy(apartment.apartmentId, {
    phone, tenantPaysFees: feePayer === 'TENANT', ...(check.isExisting ? { userId: check.userId } : { fullName, email }),
  }), {
    success: ({ data }) => data.activationInviteSent === false
      ? 'Đã bắt đầu cho thuê. Khách thuê có thể liên hệ lễ tân nếu cần mã kích hoạt.'
      : 'Đã bắt đầu cho thuê',
    onDone: onStarted,
  });

  return (
    <Modal open title={`Bắt đầu cho thuê · Căn ${apartment.code}`} okText="Lưu" cancelText="Hủy"
      confirmLoading={starting} okButtonProps={{ disabled: Boolean(check.blockReason) }}
      cancelButtonProps={{ disabled: starting }} onCancel={() => { if (!starting) onCancel(); }}
      onOk={() => form.submit()}>
      <Form form={form} layout="vertical" initialValues={{ feePayer: 'OWNER' }} disabled={starting}
        onFinish={(values) => { if (!check.blockReason) start(values).catch(() => check.reload()); }}>
        <Form.Item name="phone" label="Số điện thoại khách thuê" rules={PHONE_RULES}>
          <Input placeholder="0912345678" />
        </Form.Item>
        <PhoneAccountNotice check={check} />
        {!check.isExisting && (
          <>
            <Form.Item name="fullName" label="Họ và tên" rules={[{
              required: true, min: 2, transform: (value) => value?.trim(), message: 'Nhập họ và tên có ít nhất 2 ký tự',
            }]}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="email" label="Email (không bắt buộc)" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}>
              <Input />
            </Form.Item>
          </>
        )}
        <Form.Item name="feePayer" label="Người nộp phí dịch vụ">
          <Select options={[{ value: 'OWNER', label: 'Chủ sở hữu' }, { value: 'TENANT', label: 'Khách thuê' }]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function ResidentTenancyCard({ apartment, onChanged }) {
  const [showStart, setShowStart] = useState(false);
  const { data: tenancy, loading, error, reload } = useApi(
    () => residentsApi.tenancy(apartment.apartmentId), [apartment.apartmentId],
  );
  const [end, ending] = useAction(() => residentsApi.endTenancy(apartment.apartmentId, tenancy._id), { onDone: onChanged });

  return (
    <Card title="Quản lý cho thuê" extra={!loading && !error && !tenancy && (
      <Button type="primary" onClick={() => setShowStart(true)}>Bắt đầu cho thuê</Button>
    )}>
      {loading && <Skeleton active paragraph={{ rows: 1 }} />}
      {error && <Alert type="error" showIcon title="Chưa tải được thông tin cho thuê"
        action={<Button size="small" onClick={reload}>Thử lại</Button>} />}
      {!loading && !error && !tenancy && <span>Căn hộ chưa có khách thuê đang ở.</span>}
      {!loading && tenancy && (
        <Space orientation="vertical">
          <Space wrap>
            <strong>{tenancy.userId?.fullName ?? 'Khách thuê'}</strong>
            <Tag color="blue">Đang cho thuê</Tag>
            {tenancy.userId && !tenancy.userId.activatedAt && <Tag>Chờ kích hoạt</Tag>}
          </Space>
          {tenancy.userId?.phone && <span>Số điện thoại: {tenancy.userId.phone}</span>}
          {tenancy.moveInDate && <span>Bắt đầu ở: {formatDate(tenancy.moveInDate)}</span>}
          <span>Người nộp phí: {tenancy.tenantPaysFees ? 'Khách thuê' : 'Chủ sở hữu'}</span>
          <Popconfirm title="Xác nhận khách thuê đã rời căn hộ?" okText="Kết thúc cho thuê" cancelText="Hủy"
            onConfirm={() => end().catch(() => {})}>
            <Button danger loading={ending}>Kết thúc cho thuê</Button>
          </Popconfirm>
        </Space>
      )}
      {showStart && <StartTenancyModal apartment={apartment} onCancel={() => setShowStart(false)}
        onStarted={() => { setShowStart(false); onChanged(); }} />}
    </Card>
  );
}
