import { useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Select, Table, Tabs, Tag } from 'antd';
import { parkingGateApi } from '../../api/parkingGate.api';
import PageHeader from '../../components/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatMoney } from '../../utils/format';

const vehicleLabels = {
  CAR: 'Ô tô',
  MOTORBIKE: 'Xe máy',
  ELECTRIC_BICYCLE: 'Xe đạp điện',
  BICYCLE: 'Xe đạp',
};
const vehicleOptions = Object.entries(vehicleLabels).map(([value, label]) => ({ value, label }));
const directionOptions = [{ value: 'IN', label: 'Xe vào' }, { value: 'OUT', label: 'Xe ra' }];
const timestampFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});
const formatTimestamp = (date) => (date ? timestampFormat.format(new Date(date)) : '—');
const required = [{ required: true, whitespace: true, message: 'Vui lòng nhập thông tin' }];
const platePattern = /^(?=.*\d)[A-Z0-9]+(?:[ .-]+[A-Z0-9]+)*$/i;
const guestCardPattern = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/i;
const plateRule = { pattern: platePattern, transform: (value) => value?.trim(), message: 'Nhập biển số hợp lệ, ví dụ 51A-123.45 hoặc 51A12345.' };
const guestCardRule = { pattern: guestCardPattern, transform: (value) => value?.trim(), message: 'Mã thẻ dùng chữ, số, dấu gạch ngang hoặc gạch dưới, ví dụ KH-01.' };

function formatPlate(plate) {
  const value = plate.trim().toUpperCase();
  if (!platePattern.test(value)) return value;
  const parts = /^(\d{2}[A-Z][A-Z0-9]?)(\d{3})(\d{2})$/.exec(value.replace(/[ .-]/g, ''));
  return parts ? `${parts[1]}-${parts[2]}.${parts[3]}` : value;
}

function PlateField({ name, label, required: isRequired = false, extra }) {
  const form = Form.useFormInstance();

  return (
    <Form.Item name={name} label={label} rules={[...(isRequired ? required : []), plateRule]} extra={extra} validateTrigger="onBlur">
      <Input maxLength={30} autoComplete="off" allowClear placeholder="Ví dụ 51A-123.45 hoặc 51A12345"
        onBlur={(event) => {
          const value = event.target.value;
          const formatted = formatPlate(value);
          if (formatted !== value) form.setFieldValue(name, formatted);
        }} />
    </Form.Item>
  );
}

function VehicleIdentityFields({ temporary = false, issuingCard = false }) {
  const form = Form.useFormInstance();

  return (
    <>
      <Form.Item name="cardNumber" label={temporary ? 'Mã thẻ tạm' : 'Mã thẻ cư dân'}
        rules={issuingCard ? [...required, guestCardRule] : required} normalize={(value) => value?.toUpperCase()} validateTrigger="onBlur">
        <Input maxLength={50} autoComplete="off" placeholder={temporary ? 'Ví dụ KH-01' : 'Nhập mã trên thẻ'}
          onBlur={(event) => {
            const value = event.target.value;
            if (value !== value.trim()) form.setFieldValue('cardNumber', value.trim());
          }} />
      </Form.Item>
      <PlateField name="plateNumber" label={temporary ? 'Biển số xe' : 'Biển số'} extra="Có thể để trống nếu xe đạp không có biển." />
    </>
  );
}

function ResidentPassage({ onRecorded }) {
  const [form] = Form.useForm();
  const [bicycles, setBicycles] = useState([]);
  const [record, loading] = useAction(parkingGateApi.recordResident, {
    success: ({ data }) => (data.exitedAt ? 'Đã ghi xe ra · Mở thanh chắn mô phỏng' : 'Đã ghi xe vào · Mở thanh chắn mô phỏng'),
    onDone: () => {
      form.resetFields();
      setBicycles([]);
      onRecorded();
    },
  });

  return (
    <Card title="Mô phỏng quẹt thẻ cư dân">
      <Form form={form} name="resident-passage" layout="vertical" initialValues={{ direction: 'IN' }} disabled={loading}
        onValuesChange={(changed) => {
          if (!Object.hasOwn(changed, 'vehicleId')) {
            setBicycles([]);
            form.setFieldValue('vehicleId', undefined);
          }
        }}
        onFinish={(values) => record(values).catch((error) => {
          const options = error.details?.find(({ field }) => field === 'vehicleId')?.candidates;
          if (options) setBicycles(options);
        })}>
        <Form.Item name="direction" label="Chiều di chuyển" rules={[{ required: true }]}>
          <Select options={directionOptions} />
        </Form.Item>
        <VehicleIdentityFields />
        {bicycles.length > 0 && (
          <Form.Item name="vehicleId" label="Xe đạp đã đối chiếu" preserve={false}
            rules={[{ required: true, message: 'Chọn xe đạp sau khi đối chiếu' }]}>
            <Select options={bicycles.map((bike) => ({
              value: bike._id,
              label: [bike.brand || 'Xe đạp', bike.color, bike._id.slice(-6)].filter(Boolean).join(' · '),
            }))} />
          </Form.Item>
        )}
        <Button type="primary" htmlType="submit" loading={loading}>Kiểm tra và ghi nhận</Button>
      </Form>
    </Card>
  );
}

function GuestPassage({ onRecorded }) {
  const [form] = Form.useForm();
  const direction = Form.useWatch('direction', form) ?? 'IN';
  const [pendingEntry, setPendingEntry] = useState(null);
  const [vehicleType, setVehicleType] = useState(undefined);
  const [quote, setQuote] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [admit, admitting] = useAction(parkingGateApi.admitGuest, {
    success: 'Đã phát thẻ tạm và ghi giờ vào',
    onDone: () => {
      setPendingEntry(null);
      form.resetFields(['cardNumber', 'plateNumber']);
      onRecorded();
    },
  });
  const [quoteExit, quoting] = useAction(parkingGateApi.quoteGuestExit);
  const [closeExit, closing] = useAction(parkingGateApi.completeGuestExit, { success: 'Đã ghi thu tiền và đóng lượt gửi' });

  async function handlePassage({ direction: movement, ...identity }) {
    setQuote(null);
    setErrorMessage('');
    if (movement === 'IN') {
      setVehicleType(undefined);
      setPendingEntry(identity);
      return;
    }

    try {
      const { data } = await quoteExit(identity);
      setQuote(data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function confirmPayment() {
    setErrorMessage('');
    try {
      await closeExit(quote._id, {
        cardNumber: quote.cardNumber,
        plateNumber: quote.plateNumber,
        expectedFee: quote.feeAmount,
      });
      setQuote(null);
      form.resetFields(['cardNumber', 'plateNumber']);
      onRecorded();
    } catch (error) {
      setQuote(null);
      setErrorMessage(error.message);
    }
  }

  return (
    <Card title="Ghi nhận xe khách ra vào">
      <Form form={form} name="guest-passage" layout="vertical" initialValues={{ direction: 'IN' }}
        disabled={Boolean(pendingEntry) || quoting || closing} onFinish={handlePassage}
        onValuesChange={() => { setQuote(null); setErrorMessage(''); }}>
        <Form.Item name="direction" label="Chiều di chuyển" rules={[{ required: true }]}>
          <Select options={directionOptions} />
        </Form.Item>
        <VehicleIdentityFields temporary issuingCard={direction === 'IN'} />
        <Button type="primary" htmlType="submit" loading={quoting}>
          {direction === 'IN' ? 'Phát thẻ tạm' : 'Kiểm tra và tính phí'}
        </Button>
      </Form>
      <Modal title="Chọn loại xe để tính phí" open={Boolean(pendingEntry)} okText="Xác nhận phát thẻ"
        cancelText="Hủy" confirmLoading={admitting} okButtonProps={{ disabled: !vehicleType || admitting }}
        cancelButtonProps={{ disabled: admitting }}
        onCancel={() => { if (!admitting) setPendingEntry(null); }}
        onOk={() => admit({ ...pendingEntry, vehicleType }).catch(() => { })}>
        <Select aria-label="Loại xe" placeholder="Chọn loại xe" className="w-full" options={vehicleOptions}
          value={vehicleType} onChange={setVehicleType} disabled={admitting} />
      </Modal>
      {errorMessage && <Alert className="mt-4" showIcon type="warning" title={errorMessage} />}
      {quote && (
        <div className="mt-4 space-y-3">
          <Alert showIcon type="info" title={`Phí cần thu ${formatMoney(quote.feeAmount)}`}
            description={`${vehicleLabels[quote.vehicleType]} · ${quote.plateNumber ? formatPlate(quote.plateNumber) : 'Xe không có biển'} · Vào lúc ${formatTimestamp(quote.enteredAt)}`} />
          <Button type="primary" loading={closing} disabled={quoting} onClick={confirmPayment}>
            Xác nhận đã thu tiền và nhận lại thẻ
          </Button>
        </div>
      )}
    </Card>
  );
}

function PlateLookup() {
  const [result, setResult] = useState(null);
  const [lookup, loading] = useAction(parkingGateApi.lookup);

  async function search({ plate }) {
    setResult(null);
    try {
      const { data } = await lookup(plate);
      setResult(data);
    } catch {
      // useAction hiển thị lỗi tra cứu.
    }
  }

  return (
    <Card title="Tra cứu biển số">
      <Form name="plate-lookup" layout="vertical" disabled={loading} onFinish={search} onValuesChange={() => setResult(null)}>
        <PlateField name="plate" label="Biển số cần tra" required />
        <Button htmlType="submit" type="primary" loading={loading}>Tra cứu</Button>
      </Form>
      {result && (
        <div className="mt-4 space-y-2">
          {result.residentVehicle && <Alert showIcon type="success" title={`Xe cư dân đã đăng ký · ${formatPlate(result.plateNumber)}`}
            description={`${vehicleLabels[result.residentVehicle.type]} · Căn ${result.residentVehicle.apartmentId?.code ?? '—'}`} />}
          {result.guestSession && <Alert showIcon type="info" title={`Xe khách đang gửi · ${formatPlate(result.plateNumber)}`}
            description={`Thẻ ${result.guestSession.cardNumber} · Vào lúc ${formatTimestamp(result.guestSession.enteredAt)}`} />}
          {!result.residentVehicle && !result.guestSession && <Alert showIcon type="warning"
            title="Không tìm thấy biển số xe trong danh sách" />}
        </div>
      )}
    </Card>
  );
}

const historyColumns = [
  { title: 'Biển số', dataIndex: 'plateNumber', render: (plate) => (plate ? formatPlate(plate) : '—') },
  { title: 'Nhóm xe', dataIndex: 'kind', render: (kind) => (kind === 'GUEST' ? 'Khách' : 'Cư dân') },
  { title: 'Loại xe', dataIndex: 'vehicleType', render: (type) => vehicleLabels[type] },
  { title: 'Mã thẻ', dataIndex: 'cardNumber' },
  { title: 'Giờ vào', dataIndex: 'enteredAt', render: formatTimestamp },
  { title: 'Giờ ra', dataIndex: 'exitedAt', render: formatTimestamp },
  { title: 'Trạng thái', key: 'status', render: (_, row) => (row.exitedAt ? <Tag>Đã ra</Tag> : <Tag color="processing">Đang trong bãi</Tag>) },
  { title: 'Đã thu', dataIndex: 'feeAmount', render: (fee) => (fee == null ? '—' : formatMoney(fee)) },
  { title: 'Người xác nhận thu', key: 'collectedBy', render: (_, row) => (row.feeAmount == null ? '—' : row.exitedBy?.fullName ?? '—') },
];

export default function SecurityGatePage() {
  const { hasRole } = useAuth();
  const canOperate = hasRole('STAFF:SECURITY');
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const { data, pagination, loading, reload } = useApi(() => parkingGateApi.history(filters), [filters]);

  const history = (
    <Card title="Lịch sử xe ra vào">
      <Form name="parking-history" layout="vertical" onFinish={({ plate, dates }) => setFilters({
        page: 1, limit: filters.limit,
        plate: plate?.trim() || undefined,
        from: dates?.[0]?.format('YYYY-MM-DD'),
        to: dates?.[1]?.format('YYYY-MM-DD'),
      })}>
        <div className="flex flex-wrap items-end gap-x-3">
          <PlateField name="plate" label="Biển số" />
          <Form.Item name="dates" label="Khoảng ngày"><DatePicker.RangePicker format="DD/MM/YYYY" /></Form.Item>
          <Form.Item><Button htmlType="submit" type="primary">Lọc</Button></Form.Item>
          <Form.Item><Button onClick={reload}>Làm mới</Button></Form.Item>
        </div>
      </Form>
      <Table rowKey="_id" columns={historyColumns} dataSource={data ?? []} loading={loading} scroll={{ x: 'max-content' }}
        pagination={{
          current: filters.page, pageSize: filters.limit, total: pagination?.total ?? 0,
          onChange: (page, limit) => setFilters((current) => ({ ...current, page, limit })),
        }} />
    </Card>
  );

  const items = [
    ...(canOperate ? [
      { key: 'resident', label: 'Xe cư dân', children: <ResidentPassage onRecorded={reload} /> },
      { key: 'guest', label: 'Xe khách', children: <GuestPassage onRecorded={reload} /> },
    ] : []),
    { key: 'lookup', label: 'Tra cứu biển số', children: <PlateLookup /> },
    { key: 'history', label: 'Lịch sử ra vào', children: history },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lí bãi xe" subtitle="Quẹt thẻ mô phỏng, thu phí xe khách và tra cứu lịch sử ra vào." />
      <Tabs items={items} />
    </div>
  );
}
