import { DatePicker, Form, Input, InputNumber, Modal, Select, Switch, TimePicker, Typography } from 'antd';
import dayjs from 'dayjs';
import { dutyShiftApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { DUTY_ROLE_TITLES, enumOptions } from '../../constants/enums';

// Giờ kết thúc ≤ giờ bắt đầu = ca qua đêm, kết thúc vào ngày hôm sau (vd 22:00 – 06:00)
function toWindow(date, [from, to]) {
  const startAt = date.hour(from.hour()).minute(from.minute()).second(0).millisecond(0);
  let endAt = date.hour(to.hour()).minute(to.minute()).second(0).millisecond(0);
  if (!endAt.isAfter(startAt)) endAt = endAt.add(1, 'day');
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

// Người 4 — Trưởng BQL xếp ca cho Kỹ thuật viên / Bảo vệ, có thể lặp nhiều ngày liên tiếp
export default function CreateShiftModal({ open, roleTitle, defaultDate, onClose, onDone }) {
  const [form] = Form.useForm();
  const role = Form.useWatch('roleTitle', form) ?? roleTitle;
  const range = Form.useWatch('range', form);
  const overnight = range?.[0] && range?.[1] && !range[1].isAfter(range[0]);

  const { data: staff = [], loading } = useApi(() => dutyShiftApi.staff(role), [role], { enabled: open && Boolean(role) });
  const [save, saving] = useAction(dutyShiftApi.create, {
    success: (res) => `Đã xếp ${res.data.length} ca trực`,
    onDone: () => {
      onClose();
      onDone?.();
    },
  });

  const submit = ({ date, range: r, note, ...rest }) =>
    save({ ...rest, ...toWindow(date, r), note: note?.trim() || undefined }).catch(() => {});

  return (
    <Modal
      title="Xếp ca trực"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Xếp ca"
      cancelText="Hủy"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          roleTitle,
          date: defaultDate ?? dayjs(),
          range: [dayjs().hour(6).minute(0), dayjs().hour(14).minute(0)],
          isBackup: false,
          repeatDays: 1,
        }}
        onValuesChange={(changed) => changed.roleTitle && form.setFieldValue('userId', undefined)}
        onFinish={submit}
      >
        <Form.Item name="roleTitle" label="Bộ phận" rules={[{ required: true }]}>
          <Select options={enumOptions(DUTY_ROLE_TITLES)} />
        </Form.Item>
        <Form.Item name="userId" label="Nhân viên" rules={[{ required: true, message: 'Chọn nhân viên' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={loading}
            placeholder="Chọn nhân viên"
            options={staff.map((s) => ({ value: s._id, label: s.phone ? `${s.fullName} — ${s.phone}` : s.fullName }))}
          />
        </Form.Item>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Form.Item name="date" label="Ngày bắt đầu" rules={[{ required: true, message: 'Chọn ngày' }]}>
            <DatePicker format="DD/MM/YYYY" className="w-full" />
          </Form.Item>
          <Form.Item
            name="range"
            label="Giờ ca"
            rules={[{ required: true, message: 'Chọn giờ ca' }]}
            extra={overnight && <Typography.Text type="warning">Ca qua đêm, kết thúc ngày hôm sau</Typography.Text>}
          >
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} order={false} className="w-full" />
          </Form.Item>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Form.Item name="repeatDays" label="Lặp liên tiếp (ngày)" extra="Ví dụ 7 = cùng giờ này cả tuần">
            <InputNumber min={1} max={31} className="w-full" />
          </Form.Item>
          <Form.Item
            name="isBackup"
            label="Trực dự phòng"
            valuePropName="checked"
            extra="Nhận cảnh báo khẩn khi người trực chính chưa xử lý"
          >
            <Switch />
          </Form.Item>
        </div>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
