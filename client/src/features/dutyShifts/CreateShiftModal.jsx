import { DatePicker, Form, Input, InputNumber, Modal, Select, TimePicker, Typography } from 'antd';
import dayjs from 'dayjs';
import { dutyShiftApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { DUTY_ROLE_TITLES, enumOptions } from '../../constants/enums';
import { toWindow } from './shiftWindow';


// Trưởng BQL xếp ca cho Kỹ thuật viên / Bảo vệ: 1 ca có thể nhiều người trực, có thể lặp nhiều ngày liên tiếp
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

  // Lịch cũ chỉ để xem: chặn ca đã kết thúc ngay trên form (server cũng chặn)
  const submit = ({ date, range: r, note, ...rest }) => {
    const window = toWindow(date, r);
    if (!dayjs(window.endAt).isAfter(dayjs())) {
      form.setFields([{ name: 'range', errors: ['Ca này đã kết thúc, chọn giờ khác'] }]);
      return;
    }
    save({ ...rest, ...window, note: note?.trim() || undefined }).catch(() => {});
  };

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
          // Mặc định ca 8 tiếng bắt đầu từ giờ của ô vừa bấm (bấm nút "Xếp ca" thì 06:00)
          range: [
            (defaultDate ?? dayjs().hour(6)).minute(0),
            (defaultDate ?? dayjs().hour(6)).minute(0).add(8, 'hour'),
          ],
          repeatDays: 1,
        }}
        onValuesChange={(changed) => changed.roleTitle && form.setFieldValue('userIds', undefined)}
        onFinish={submit}
      >
        <Form.Item name="roleTitle" label="Bộ phận" rules={[{ required: true }]}>
          <Select options={enumOptions(DUTY_ROLE_TITLES)} />
        </Form.Item>
        <Form.Item name="userIds" label="Người trực" rules={[{ required: true, message: 'Chọn ít nhất 1 người trực' }]}>
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            loading={loading}
            placeholder="Chọn 1 hoặc nhiều người trực cùng ca"
            options={staff.map((s) => ({ value: s._id, label: s.phone ? `${s.fullName} — ${s.phone}` : s.fullName }))}
          />
        </Form.Item>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          <Form.Item name="date" label="Ngày bắt đầu" rules={[{ required: true, message: 'Chọn ngày' }]}>
            <DatePicker format="DD/MM/YYYY" className="w-full" disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
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
        <Form.Item name="repeatDays" label="Lặp liên tiếp (ngày)" extra="Ví dụ 7 = cùng giờ này cả tuần">
          <InputNumber min={1} max={31} className="w-full" />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
