import { useState } from 'react';
import { Alert, App, Form, Input, InputNumber, Modal, Select, Table } from 'antd';
import { apartmentsApi } from '../../api/moduleA.api';
import { nextManagementPeriod } from './inventoryForm';

export default function ApartmentCorrectionModal({ apartment, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const building = apartment.building ?? apartment.buildingId;
  const future = (apartment.managementAreaHistory ?? []).filter((row) => new Date(row.effectiveFrom) > new Date());
  const latest = future.at(-1)?.area ?? apartment.managementArea ?? apartment.netArea ?? apartment.area;
  const area = Form.useWatch('managementArea', form);
  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      setError('');
      await apartmentsApi.correctCatalog(apartment._id, { ...values, expectedUpdatedAt: apartment.updatedAt });
      message.success('Đã ghi nhận điều chỉnh căn hộ');
      onSaved();
    } catch (err) { if (!err.errorFields) setError(err.message); }
    finally { setSaving(false); }
  };
  return <Modal open title={`Điều chỉnh thông tin — ${apartment.code}`} onCancel={saving ? undefined : onClose}
    width={680} onOk={save} okText="Ghi nhận điều chỉnh" confirmLoading={saving} maskClosable={false}>
    <Alert type="info" showIcon className="mb-4" title="Ghi rõ căn cứ điều chỉnh. Diện tích mới áp dụng từ kỳ tương lai; các thông báo phí đã lập được giữ nguyên." />
    {error && <Alert type="error" showIcon className="mb-4" title={error} />}
    <Form form={form} layout="vertical" initialValues={{ code: apartment.code, floor: apartment.floor,
      managementArea: latest, effectivePeriod: nextManagementPeriod() }}>
      <Form.Item name="code" label="Mã căn hộ" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]{1,20}$/, message: 'Mã căn chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới' }]}
        extra={apartment.identityLocked ? 'Mã căn bị khóa vì đã có hồ sơ liên quan.' : 'Chỉ đổi mã khi căn chưa có hồ sơ liên quan.'}>
        <Input disabled={apartment.identityLocked} maxLength={20} />
      </Form.Item>
      <Form.Item name="floor" label="Tầng theo hồ sơ" rules={[{ required: true }]}>
        <Select options={(building?.floorInventory?.length ? building.floorInventory.map((row) => row.floor)
          : Array.from({ length: building?.totalFloors ?? 0 }, (_, index) => index + 1)).map((floor) => ({ value: floor, label: `Tầng ${floor}` }))} />
      </Form.Item>
      <Form.Item name="managementArea" label="Diện tích tính phí quản lý mới (m²)" rules={[{ required: true }, { type: 'number', min: 1 }]}>
        <InputNumber min={1} max={100000} precision={2} />
      </Form.Item>
      {area !== latest && <Form.Item name="effectivePeriod" label="Kỳ bắt đầu áp dụng diện tích mới" rules={[{ required: true }]}>
        <Input type="month" min={nextManagementPeriod()} />
      </Form.Item>}
      <Form.Item name="reason" label="Lý do điều chỉnh" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      <Form.Item name="sourceReference" label="Tài liệu đối chiếu" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
    </Form>
    {future.length > 0 && <Table size="small" rowKey="effectiveFrom" pagination={false} dataSource={future}
      columns={[{ title: 'Diện tích đã hẹn áp dụng (m²)', dataIndex: 'area' }, { title: 'Từ ngày', dataIndex: 'effectiveFrom', render: (value) => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }]} />}
  </Modal>;
}
