import { useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Steps, Table, Tag } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { buildingsApi } from '../../api/moduleA.api';
import { initialInventory, copyFloorRows, inventoryPayload, inventoryProblems } from './inventoryForm';

export default function BuildingInventoryModal({ building, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form, setForm] = useState(() => initialInventory(building));
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copy, setCopy] = useState({});
  const problems = inventoryProblems(form);
  const total = form.floors.reduce((sum, row) => sum + row.apartments.length, 0);
  const set = (field, value) => setForm((old) => ({ ...old, [field]: value }));
  const changeFloor = (index, update) => setForm((old) => ({ ...old,
    floors: old.floors.map((row, i) => i === index ? { ...row, ...update } : row) }));
  const changeApartment = (index, number, field, value) => changeFloor(index, {
    apartments: form.floors[index].apartments.map((row, i) => i === number ? { ...row, [field]: value } : row),
  });

  const next = () => {
    if (step === 0 && (!form.code.trim() || !/^[A-Za-z0-9_-]{1,20}$/.test(form.code.trim())
      || !form.name.trim() || !Number.isInteger(form.totalFloors) || form.totalFloors < 1 || form.totalFloors > 200
      || (!building && !form.address.trim()) || !form.sourceReference.trim() || (building?.inventoryConfirmedAt && !form.reason.trim()))) {
      setError('Vui lòng nhập đủ thông tin tòa, số tầng, tài liệu đối chiếu và lý do nếu điều chỉnh danh mục đã xác nhận.');
      return;
    }
    if (step === 1 && problems.length) { setError(problems.slice(0, 6).join('\n')); return; }
    if (step === 1) setConfirmed(false);
    setError('');
    setStep(step + 1);
  };
  const save = async () => {
    if (saving || !confirmed || problems.length) return;
    setSaving(true);
    setError('');
    try {
      const body = inventoryPayload(form, building);
      if (building) await buildingsApi.confirmInventory(building._id, body);
      else await buildingsApi.create(body);
      message.success('Đã xác nhận danh mục tòa nhà và căn hộ');
      onSaved();
    } catch (err) { setError(err.message || 'Không thể xác nhận danh mục.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open title={building ? `Đối chiếu danh mục — ${building.name}` : 'Thiết lập tòa nhà theo hồ sơ'}
      width={1120} onCancel={saving ? undefined : onClose} maskClosable={false}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: 8 } }}
      footer={<Space>
        <Button onClick={onClose} disabled={saving}>Hủy</Button>
        {step > 0 && <Button onClick={() => { setStep(step - 1); setError(''); }} disabled={saving}>Quay lại</Button>}
        {step < 2 ? <Button type="primary" onClick={next}>Tiếp tục</Button>
          : <Button type="primary" loading={saving} disabled={!confirmed || problems.length > 0} onClick={save}>Xác nhận danh mục</Button>}
      </Space>}>
      <Steps className="mb-5" current={step} items={[{ title: 'Thông tin hồ sơ' }, { title: 'Tầng và căn hộ' }, { title: 'Đối chiếu, xác nhận' }]} />
      {error && <Alert className="mb-4 whitespace-pre-line" type="error" showIcon title={error} />}
      {step === 0 && <Form layout="vertical">
        <Alert className="mb-4" type="info" showIcon title="Nhập theo hồ sơ đã tiếp nhận. Số căn và diện tích có thể khác nhau giữa các tầng."
          description={building ? 'Các căn hiện có được giữ nguyên. Nếu cần sửa mã, tầng hoặc diện tích, mở Điều chỉnh tại danh sách căn hộ rồi tải lại danh mục.'
            : 'Tòa và các căn chỉ được ghi vào hệ thống sau bước xác nhận cuối. Chưa ghi nhận bàn giao hoặc người ở tại bước này.'} />
        <Row gutter={16}>
          <Col span={8}><Form.Item label="Mã tòa" required><Input maxLength={20} disabled={Boolean(building)} value={form.code} onChange={(e) => set('code', e.target.value)} /></Form.Item></Col>
          <Col span={16}><Form.Item label="Tên tòa" required><Input maxLength={100} disabled={Boolean(building)} value={form.name} onChange={(e) => set('name', e.target.value)} /></Form.Item></Col>
          <Col span={18}><Form.Item label="Địa chỉ" required><Input maxLength={200} disabled={Boolean(building)} value={form.address} onChange={(e) => set('address', e.target.value)} /></Form.Item></Col>
          <Col span={6}><Form.Item label="Tổng số tầng" required><InputNumber min={1} max={200} precision={0} value={form.totalFloors} onChange={(value) => set('totalFloors', value)} /></Form.Item></Col>
        </Row>
        <Form.Item label="Tài liệu đối chiếu danh mục" required extra="Tên hoặc số hiệu bản vẽ, danh sách căn, biên bản tiếp nhận đang dùng để kiểm tra.">
          <Input.TextArea rows={2} maxLength={500} value={form.sourceReference} onChange={(e) => set('sourceReference', e.target.value)} />
        </Form.Item>
        {building && <Form.Item label="Lý do bổ sung hoặc điều chỉnh" required={Boolean(building.inventoryConfirmedAt)}>
          <Input.TextArea rows={2} maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </Form.Item>}
      </Form>}
      {step === 1 && <div className="space-y-4">
        <Alert type="info" showIcon title="Chỉ khai báo tầng có căn hộ. Đối chiếu số căn theo hồ sơ; các dòng có sẵn được giữ nguyên." />
        {building && !building.inventoryConfirmedAt && <p className="text-gray-500">Số căn đang được gợi ý từ dữ liệu hiện có. Hãy kiểm tra và sửa số căn theo hồ sơ thực tế trước khi xác nhận.</p>}
        {form.floors.map((row, index) => <Card key={index} size="small" title={<Space wrap>
          <span>Tầng</span><Select aria-label={`Tầng nhóm ${index + 1}`} style={{ width: 100 }} disabled={row.apartments.some((item) => item.id)}
            value={row.floor} options={Array.from({ length: form.totalFloors || 0 }, (_, i) => ({ value: i + 1, label: `Tầng ${i + 1}` }))}
            onChange={(value) => changeFloor(index, { floor: value })} />
          <span>Số căn theo hồ sơ</span><InputNumber aria-label={`Số căn theo hồ sơ tầng ${row.floor}`} min={1} max={500} precision={0}
            value={row.expectedCount} onChange={(value) => changeFloor(index, { expectedCount: value })} />
          <Tag color={row.expectedCount === row.apartments.length ? 'green' : 'orange'}>Đã nhập {row.apartments.length}</Tag>
        </Space>} extra={!row.apartments.some((item) => item.id) && <Button danger type="text" icon={<DeleteOutlined />}
          onClick={() => set('floors', form.floors.filter((_, i) => i !== index))}>Bỏ tầng</Button>}>
          <Table size="small" rowKey={(_, number) => String(number)} dataSource={row.apartments} pagination={false}
            columns={[
              { title: 'Mã căn', render: (_, item, number) => <Input aria-label={`Mã căn tầng ${row.floor} dòng ${number + 1}`} maxLength={20}
                disabled={Boolean(item.id)} value={item.code} onChange={(e) => changeApartment(index, number, 'code', e.target.value)} /> },
              { title: 'Diện tích tính phí quản lý (m²)', render: (_, item, number) => <InputNumber aria-label={`Diện tích tầng ${row.floor} dòng ${number + 1}`}
                min={1} max={100000} precision={2} disabled={Boolean(item.id)} value={item.managementArea}
                onChange={(value) => changeApartment(index, number, 'managementArea', value)} /> },
              { title: 'Thông tin', width: 155, render: (_, item, number) => item.id ? <Tag>Đã có trên hệ thống</Tag>
                : <Button danger type="text" onClick={() => changeFloor(index, { apartments: row.apartments.filter((_, i) => i !== number) })}>Bỏ dòng</Button> },
            ]} />
          <Space wrap className="mt-3">
            <Button icon={<PlusOutlined />} onClick={() => changeFloor(index, { apartments: [...row.apartments, { code: '', managementArea: null }] })}>Thêm dòng căn hộ</Button>
            {!row.apartments.some((item) => item.id) && <>
              <Select placeholder="Sao chép từ tầng" style={{ width: 170 }} value={copy[index]?.from}
                options={form.floors.flatMap((item, i) => i !== index && item.apartments.length ? [{ value: i, label: `Tầng ${item.floor}` }] : [])}
                onChange={(from) => setCopy((old) => ({ ...old, [index]: { ...old[index], from } }))} />
              <Input aria-label={`Tiền tố mã căn tầng ${row.floor}`} style={{ width: 160 }} placeholder={`Tiền tố: ${form.code}${row.floor}`}
                value={copy[index]?.prefix ?? ''} onChange={(e) => setCopy((old) => ({ ...old, [index]: { ...old[index], prefix: e.target.value } }))} />
              <Button icon={<CopyOutlined />} disabled={copy[index]?.from === undefined} onClick={() => {
                const source = form.floors[copy[index].from];
                if (!source) return;
                const apartments = copyFloorRows(source.apartments, copy[index]?.prefix?.trim() || `${form.code}${row.floor}`);
                changeFloor(index, { apartments });
              }}>Sao chép danh sách</Button>
            </>}
          </Space>
        </Card>)}
        <Button icon={<PlusOutlined />} disabled={form.floors.length >= (form.totalFloors || 0)} onClick={() => {
          const floor = Array.from({ length: form.totalFloors }, (_, i) => i + 1).find((number) => !form.floors.some((row) => row.floor === number));
          set('floors', [...form.floors, { floor, expectedCount: 1, apartments: [] }]);
        }}>Thêm tầng có căn hộ</Button>
      </div>}
      {step === 2 && <div className="space-y-4">
        <p><strong>{form.name} ({form.code})</strong> — {form.totalFloors} tầng, {form.floors.length} tầng có căn hộ, {total} căn.</p>
        <p><strong>Tài liệu:</strong> {form.sourceReference}</p>
        <Table size="small" rowKey="floor" pagination={false} dataSource={form.floors} columns={[
          { title: 'Tầng', dataIndex: 'floor' }, { title: 'Số căn theo hồ sơ', dataIndex: 'expectedCount' },
          { title: 'Đã khai báo', render: (_, row) => row.apartments.length },
          { title: 'Đối chiếu', render: (_, row) => <Tag color={row.expectedCount === row.apartments.length ? 'green' : 'red'}>{row.expectedCount === row.apartments.length ? 'Khớp số lượng' : 'Chưa khớp'}</Tag> },
        ]} />
        <Table size="small" rowKey={(_, index) => String(index)} pagination={{ pageSize: 20 }}
          dataSource={form.floors.flatMap((row) => row.apartments.map((item) => ({ ...item, floor: row.floor })))} columns={[
            { title: 'Tầng', dataIndex: 'floor' }, { title: 'Mã căn', dataIndex: 'code' },
            { title: 'Diện tích tính phí quản lý (m²)', dataIndex: 'managementArea' },
            { title: 'Ghi nhận', render: (_, row) => row.id ? 'Giữ nguyên căn hiện có' : 'Bổ sung căn chưa bàn giao' },
          ]} />
        <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>Tôi đã đối chiếu danh sách và diện tích từng căn với hồ sơ tiếp nhận.</Checkbox>
      </div>}
    </Modal>
  );
}
