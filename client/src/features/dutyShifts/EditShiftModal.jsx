import { Button, DatePicker, Form, Input, Modal, Popconfirm, Select, TimePicker, Typography } from 'antd';
import dayjs from 'dayjs';
import { dutyShiftApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { toWindow } from './shiftWindow';

// Trưởng BQL sửa 1 ca chưa kết thúc: đổi người trực, ngày, giờ, ghi chú. Ca đang diễn ra chỉ đổi được người,
// giờ kết thúc và ghi chú (server chặn đổi giờ bắt đầu).
export default function EditShiftModal({ shift, onClose, onDone, onRemove }) {
  const [form] = Form.useForm();
  const started = dayjs(shift.startAt).isBefore(dayjs());
  const range = Form.useWatch('range', form);
  const overnight = range?.[0] && range?.[1] && !range[1].isAfter(range[0]);
  const { data: staff = [], loading } = useApi(() => dutyShiftApi.staff(shift.roleTitle), [shift.roleTitle]);
  const [save, saving] = useAction((body) => dutyShiftApi.update(shift._id, body), {
    success: 'Đã cập nhật ca trực',
    onDone: () => {
      onClose();
      onDone?.();
    },
  });

  const submit = ({ userId, date, range: r, note }) => {
    const window = toWindow(date, r);
    const body = { userId, note: note?.trim() ?? '', endAt: window.endAt };
    if (!started) body.startAt = window.startAt;
    save(body).catch(() => {});
  };

  return (
    <Modal
      title="Sửa ca trực"
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saving}
      destroyOnHidden
      footer={(_, { OkBtn, CancelBtn }) => (
        <div className="flex items-center justify-between gap-2">
          <Popconfirm
            title="Hủy ca trực này?"
            description="Nhân viên sẽ nhận thông báo ca bị hủy."
            okText="Hủy ca"
            cancelText="Không"
            onConfirm={() => onRemove(shift._id).then(onClose).catch(() => {})}
          >
            <Button danger>Hủy ca</Button>
          </Popconfirm>
          <div className="flex gap-2">
            <CancelBtn />
            <OkBtn />
          </div>
        </div>
      )}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          userId: shift.userId?._id,
          date: dayjs(shift.startAt),
          range: [dayjs(shift.startAt), dayjs(shift.endAt)],
          note: shift.note,
        }}
        onFinish={submit}
      >
        <Form.Item name="userId" label="Người trực" rules={[{ required: true, message: 'Chọn người trực' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={loading}
            options={staff.map((s) => ({ value: s._id, label: s.phone ? `${s.fullName} — ${s.phone}` : s.fullName }))}
          />
        </Form.Item>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Form.Item name="date" label="Ngày" rules={[{ required: true, message: 'Chọn ngày' }]}>
            <DatePicker format="DD/MM/YYYY" className="w-full" disabled={started} disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item
            name="range"
            label="Giờ ca"
            rules={[{ required: true, message: 'Chọn giờ ca' }]}
            extra={
              (started && <Typography.Text type="secondary">Ca đang diễn ra: chỉ đổi được giờ kết thúc</Typography.Text>) ||
              (overnight && <Typography.Text type="warning">Ca qua đêm, kết thúc ngày hôm sau</Typography.Text>)
            }
          >
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} className="w-full" disabled={started ? [true, false] : false} />
          </Form.Item>
        </div>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
