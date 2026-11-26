import { DatePicker, Form, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { residentsApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';
import { parseVnDate } from '../../utils/format';

export default function FamilyMemberModal({ apartmentId, apartmentCode, member, onCancel, onSaved }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(({ fullName, dateOfBirth }) => {
    const body = { apartmentId, fullName: fullName.trim(), dateOfBirth: dateOfBirth?.format('YYYY-MM-DD') ?? null };
    return member ? residentsApi.updateDeclaredFamilyMember(member._id, body) : residentsApi.declareFamilyMember(body);
  }, {
    success: member ? 'Đã cập nhật thông tin thành viên gia đình' : 'Đã thêm thành viên gia đình',
    onDone: onSaved,
  });

  return (
    <Modal open title={`${member ? 'Chỉnh sửa thông tin' : 'Thông tin'} thành viên gia đình · Căn ${apartmentCode}`}
      okText="Lưu" cancelText="Hủy" confirmLoading={saving} destroyOnHidden
      cancelButtonProps={{ disabled: saving }} mask={{ closable: !saving }}
      onCancel={() => { if (!saving) onCancel(); }} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" disabled={saving}
        initialValues={{ fullName: member?.fullName ?? '', dateOfBirth: parseVnDate(member?.dateOfBirth) }}
        onFinish={(values) => save(values).catch(() => {})}>
        <Form.Item name="fullName" label="Họ và tên" rules={[{
          required: true, min: 2, transform: (value) => value?.trim(), message: 'Nhập họ và tên có ít nhất 2 ký tự',
        }]}>
          <Input maxLength={100} autoComplete="off" />
        </Form.Item>
        <Form.Item name="dateOfBirth" label="Ngày sinh">
          <DatePicker className="w-full" format="DD/MM/YYYY" minDate={dayjs('1900-01-01')}
            maxDate={dayjs()} disabledDate={(date) => date.isAfter(dayjs(), 'day') || date.isBefore(dayjs('1900-01-01'), 'day')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
