import { useState } from 'react';
import { DatePicker, Empty, Form, Modal, Select, Typography } from 'antd';
import dayjs from 'dayjs';
import { amenityApi, bookingApi } from '../../api/moduleD.api';
import { useAction, useApi } from '../../hooks/useApi';
import { rescheduleOptions } from './bookingHelpers';

// Đổi lịch (Người 4): chọn ngày + khung giờ còn trống của cùng tiện ích; server kiểm tra như đặt mới rồi hủy booking cũ
export default function RescheduleModal({ booking, apartmentId, onClose, onDone }) {
  const [form] = Form.useForm();
  const current = dayjs(booking.startAt ?? booking.date);
  const [date, setDate] = useState(current.startOf('day'));
  const ymd = date.format('YYYY-MM-DD');
  const { data, loading } = useApi(() => amenityApi.slots(booking.amenityId, { date: ymd, apartmentId }), [booking.amenityId, ymd, apartmentId]);
  const options = rescheduleOptions(data?.slots ?? [], { slotStart: booking.slotStart, sameDay: date.isSame(current, 'day') });
  const [save, saving] = useAction((v) => bookingApi.reschedule(booking._id, { date: ymd, slotStart: v.slotStart }), {
    success: 'Đã đổi lịch',
    onDone: () => {
      onClose();
      onDone?.();
    },
  });

  return (
    <Modal
      title={`Đổi lịch ${booking.amenity?.name ?? ''}`}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Đổi lịch"
      cancelText="Hủy"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Đang đặt: {current.format('DD/MM/YYYY')} · {booking.slotStart}–{booking.slotEnd}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item label="Ngày mới">
          <DatePicker
            value={date}
            format="DD/MM/YYYY"
            allowClear={false}
            className="w-full"
            disabledDate={(d) => d.isBefore(dayjs(), 'day') || (data?.maxDate && d.isAfter(dayjs(data.maxDate), 'day'))}
            onChange={(d) => {
              setDate(d.startOf('day'));
              form.resetFields(['slotStart']);
            }}
          />
        </Form.Item>
        <Form.Item name="slotStart" label="Khung giờ mới" rules={[{ required: true, message: 'Chọn khung giờ' }]}>
          <Select
            loading={loading}
            options={options}
            placeholder="Chọn khung giờ còn trống"
            notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ngày này không còn khung giờ trống" />}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
