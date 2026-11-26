import { useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Modal } from 'antd';
import dayjs from 'dayjs';
import { residentsApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';
import { formatDate, parseVnDate } from '../../utils/format';

export default function MoveInRequestCard({ apartment, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [send, sending] = useAction(({ moveInDate }) => residentsApi.requestMoveIn({
    apartmentId: apartment.apartmentId, moveInDate: moveInDate.format('YYYY-MM-DD'),
  }), { success: 'Đã thông báo bắt đầu ở. Vui lòng chờ Ban quản lý ghi nhận.', onDone: async () => { setOpen(false); await onChanged(); } });
  if (apartment.canUseServices) return null;
  const pending = apartment.moveInRequest;
  return <Card title="Thông báo bắt đầu ở">
    <Alert type="warning" showIcon className="mb-3" title={pending ? 'Đang chờ Ban quản lý ghi nhận vào ở' : 'Căn hộ chưa được ghi nhận vào ở'}
      description={pending
        ? `Bạn đã thông báo bắt đầu ở ngày ${formatDate(pending.date)}. Dịch vụ chỉ được mở sau khi BQL ghi nhận.`
        : 'Chưa thể đăng ký dịch vụ, xe, cấp thẻ hoặc gửi phản ánh. Phí quản lý vẫn tính theo ngày bàn giao.'} />
    {apartment.canRequestMoveIn ? <Button type="primary" onClick={() => {
      form.setFieldsValue({ moveInDate: parseVnDate(pending?.date) ?? dayjs() }); setOpen(true);
    }}>{pending ? 'Cập nhật ngày bắt đầu ở' : 'Thông báo bắt đầu ở'}</Button>
      : <p>Liên hệ Ban quản lý để hoàn tất bàn giao và quyền cư trú trước khi thông báo vào ở.</p>}
    <Modal open={open} title={`Thông báo bắt đầu ở · Căn ${apartment.code}`} okText="Gửi thông báo" cancelText="Hủy"
      confirmLoading={sending} cancelButtonProps={{ disabled: sending }}
      onCancel={() => { if (!sending) setOpen(false); }} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" disabled={sending} onFinish={(values) => send(values).catch(() => {})}>
        <Form.Item name="moveInDate" label="Ngày bắt đầu ở thực tế" rules={[{ required: true, message: 'Chọn ngày bắt đầu ở' }]}>
          <DatePicker format="DD/MM/YYYY" className="w-full" minDate={parseVnDate(apartment.handoverDate)} maxDate={dayjs()} />
        </Form.Item>
      </Form>
    </Modal>
  </Card>;
}
