// Module 7: dùng lại màn vận hành để quản lý khách, bưu kiện, tuần tra và báo khẩn, không thêm component/file.
import { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Table,
  Typography,
  Alert, Image, Popconfirm, Space, Tabs, Tag, Upload,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { LoginOutlined, LogoutOutlined, UserAddOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { guestApi, lookupApi, dutyShiftApi } from '../../api/moduleE.api';
import QrScanModal from '../../components/QrScanModal';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { GUEST_STATUS } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import { useImageCheck } from '../../hooks/useImageCheck';
import { IMAGE_ACCEPT } from '../../utils/imageUpload';

function ApartmentSelect(props) {
  const [q, setQ] = useState('');
  const { data = [], loading } = useApi(() => lookupApi.apartments({ q }), [q]);
  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setQ }}
      loading={loading}
      placeholder="Gõ mã căn hộ"
      options={data.map((a) => ({ value: a._id, label: `${a.code} · ${a.buildingId?.name ?? ''}` }))}
      {...props}
    />
  );
}

// UC-E08 — Bảo vệ ghi nhận giờ khách đến/rời (gồm khách vãng lai — BR-O10). Lễ tân/Manager xem.
export default function GuestBookPage() {
  const { hasRole } = useAuth();
  const checkPhoto = useImageCheck(); // UC63
  const isGate = hasRole('STAFF:SECURITY');
  const isManager = hasRole('MANAGER');
  const isReception = hasRole('STAFF:RECEPTIONIST');
  const [tab, setTab] = useState('guests');
  const [operation, setOperation] = useState(null);
  const [opsForm] = Form.useForm();
  const [photos, setPhotos] = useState([]);
  const [scanTour, setScanTour] = useState(null);
  const [qrPoint, setQrPoint] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const signedRef = useRef(false);
  const incidentRequestRef = useRef(null);
  const [opsPage, setOpsPage] = useState(1);
  const [parcelStatus, setParcelStatus] = useState();
  const operations = useApi(() => guestApi.operations(tab, { page: opsPage, limit: 20, status: tab === 'parcels' ? parcelStatus : undefined }),
    [tab, opsPage, parcelStatus], { enabled: tab !== 'guests' });
  const checkpoints = useApi(() => guestApi.operations('checkpoints', { limit: 100 }), [], { enabled: operation?.kind === 'tour' });
  const shifts = useApi(() => dutyShiftApi.list({ roleTitle: 'SECURITY' }), [], { enabled: operation?.kind === 'tour' });
  const recipients = useApi(() => guestApi.recipients(operation.id), [operation?.id], { enabled: operation?.kind === 'handover' });
  const receipt = useApi(() => guestApi.receipt(operation.id), [operation?.id], { enabled: operation?.kind === 'receipt' });
  const openOperation = (kind, id) => {
    setPhotos([]); signedRef.current = false;
    incidentRequestRef.current = kind === 'incident' ? crypto.randomUUID() : null;
    setOperation({ kind, id });
  };
  const [perform, performing] = useAction(async (values) => {
    const files = photos.map((f) => f.originFileObj);
    switch (operation.kind) {
      case 'parcel': return guestApi.receiveParcel(values, files);
      case 'handover':
        if (!signedRef.current) throw new Error('Người nhận cần ký tên trên màn hình');
        return guestApi.handover(operation.id, { recipientId: values.recipientId, signature: canvasRef.current.toDataURL('image/png') });
      case 'checkpoint': return guestApi.checkpoint(values);
      case 'tour': return guestApi.tour({ ...values, startAt: values.startAt.toISOString(), endAt: values.endAt.toISOString() });
      case 'incident': return guestApi.incident({ ...values, requestId: incidentRequestRef.current }, files);
      default: throw new Error('Thao tác không hợp lệ');
    }
  }, { success: 'Đã lưu', onDone: () => { setOperation(null); operations.reload(); } });
  const [returnParcel, returning] = useAction((id) => guestApi.handover(id, { returned: true }), { success: 'Đã xác nhận trả đơn vị vận chuyển', onDone: operations.reload });
  const [acknowledge, acknowledging] = useAction(guestApi.acknowledge, { success: 'Đã tiếp nhận', onDone: operations.reload });
  const [broadcast, broadcasting] = useAction(guestApi.broadcast, { success: 'Đã phát cảnh báo cư dân', onDone: operations.reload });
  const [endBroadcast, endingBroadcast] = useAction(guestApi.endBroadcast, { success: 'Đã kết thúc cảnh báo cư dân', onDone: operations.reload });
  const [toggleCheckpoint] = useAction(guestApi.updateCheckpoint, { success: 'Đã cập nhật checkpoint', onDone: operations.reload });
  const [scan] = useAction(async (code) => {
    const position = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { timeout: 3000, maximumAge: 30000 });
    });
    return guestApi.scan(scanTour, { code, ...(position && { latitude: position.latitude, longitude: position.longitude }) });
  }, { success: 'Đã ghi nhận checkpoint', onDone: () => { setScanTour(null); operations.reload(); } });

  const parcelLabels = { STORED: 'Đang lưu quầy', AWAITING_RETURN: 'Chờ trả', COLLECTED: 'Đã bàn giao', RETURNED: 'Đã trả vận chuyển' };
  const operationColumns = tab === 'parcels' ? [
    { title: 'Bưu kiện', render: (_, p) => <><strong>{p.trackingCode}</strong><div>{p.carrier} · Căn {p.apartmentId?.code}</div></> },
    { title: 'Ảnh', render: (_, p) => <Image.PreviewGroup>{p.imageUrls?.map((url) => <Image key={url} src={url} width={56} height={56} style={{ objectFit: 'cover' }} />)}</Image.PreviewGroup> },
    { title: 'Nhận tại quầy', dataIndex: 'createdAt', render: formatDateTime },
    { title: 'Bàn giao', render: (_, p) => <>{p.recipientName || '—'}<div>{formatDateTime(p.handedOverAt)}</div></> },
    { title: 'Trạng thái', render: (_, p) => <Tag>{parcelLabels[p.status]}</Tag> },
    { title: 'Thao tác', render: (_, p) => <Space wrap>
      {p.status === 'COLLECTED' && (isReception || isManager) && <Button onClick={() => openOperation('receipt', p._id)}>Chữ ký nhận</Button>}
      {isReception && ['STORED', 'AWAITING_RETURN'].includes(p.status) && <>
      <Button onClick={() => openOperation('handover', p._id)}>Ký nhận</Button>
      {p.status === 'AWAITING_RETURN' && <Popconfirm title="Đã trả bưu kiện cho đơn vị vận chuyển?" onConfirm={() => returnParcel(p._id).catch(() => {})}><Button danger loading={returning}>Xác nhận trả</Button></Popconfirm>}
      </>}
    </Space> },
  ] : tab === 'checkpoints' ? [
    { title: 'Checkpoint', dataIndex: 'name' }, { title: 'Vị trí', dataIndex: 'location' },
    { title: 'QR', render: (_, p) => isManager && <Space wrap><Button onClick={() => setQrPoint(p)}>Mở QR để in</Button><Button onClick={() => toggleCheckpoint(p._id, !p.active).catch(() => {})}>{p.active ? 'Ngừng dùng cho lượt mới' : 'Mở lại'}</Button></Space> },
  ] : tab === 'tours' ? [
    { title: 'Lượt tuần tra', render: (_, t) => <><strong>{t.name}</strong><div>{t.guardId?.fullName}</div><div>{formatDateTime(t.startAt)} – {formatDateTime(t.endAt)}</div></> },
    { title: 'Các điểm phải đi', render: (_, t) => t.checkpoints?.map((p) => <div key={p.checkpointId}>{t.scans.some((s) => s.checkpointId === p.checkpointId) ? 'Đã quét' : 'Chưa quét'} · {p.name} ({p.location})</div>) },
    { title: 'Kết quả', render: (_, t) => dayjs().isBefore(t.startAt) ? 'Chưa đến giờ' : dayjs().isBefore(t.endAt) ? `${t.scans.length}/${t.checkpoints.length} điểm` : t.missed?.length ? `Bỏ sót: ${t.missed.map((p) => p.name).join(', ')}` : 'Đủ checkpoint' },
    { title: '', render: (_, t) => isGate && dayjs().isAfter(t.startAt) && dayjs().isBefore(t.endAt) && <Button onClick={() => setScanTour(t._id)}>Quét checkpoint</Button> },
  ] : [
    { title: 'Sự cố', render: (_, i) => <><strong>{i.location}</strong><div>{i.description}</div><div>{i.sourceTicketId ? 'Nguồn: sự cố kỹ thuật quá hạn nhận' : `Người báo: ${i.reportedBy?.fullName || 'Bảo vệ'}`}</div></> },
    { title: 'Ảnh', render: (_, i) => i.imageUrls?.map((url) => <Image key={url} src={url} width={56} />) },
    { title: 'Báo lúc', dataIndex: 'createdAt', render: formatDateTime },
    { title: 'Tiếp nhận', render: (_, i) => i.acknowledgedAt ? `${i.acknowledgedBy?.fullName || 'Đã được xử lý ở phiếu gốc'} · ${formatDateTime(i.acknowledgedAt)}` : <Tag color="red">Chờ tiếp nhận</Tag> },
    { title: 'Thao tác', render: (_, i) => isManager && <Space wrap>
      {!i.acknowledgedAt && <Button loading={acknowledging} onClick={() => acknowledge(i._id).catch(() => {})}>Đã tiếp nhận</Button>}
      {!i.broadcastAt && <Popconfirm title="Phát nội dung cảnh báo tới toàn bộ cư dân?" onConfirm={() => broadcast(i._id).catch(() => {})}><Button danger loading={broadcasting}>Báo cư dân</Button></Popconfirm>}
      {i.broadcastAt && !i.broadcastEndedAt && <Popconfirm title="Kết thúc banner cảnh báo cho cư dân?" onConfirm={() => endBroadcast(i._id).catch(() => {})}><Button loading={endingBroadcast}>Kết thúc cảnh báo cư dân</Button></Popconfirm>}
    </Space> },
  ];
  const [form] = Form.useForm();
  const [date, setDate] = useState(dayjs());
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState();
  const [page, setPage] = useState(1);
  const [walkInOpen, setWalkInOpen] = useState(false);

  const params = useMemo(
    () => ({
      date: date?.format('YYYY-MM-DD'),
      status: status === 'ALL' ? undefined : status,
      q,
      page,
      limit: 20,
      sort: 'expectedTime',
    }),
    [date, status, q, page],
  );
  const { data = [], pagination, loading, reload } = useApi(() => guestApi.list(params), [params], { enabled: tab === 'guests' });
  const [checkIn] = useAction((id) => guestApi.checkIn(id), { success: 'Đã ghi nhận khách đến', onDone: reload });
  const [checkOut] = useAction((id) => guestApi.checkOut(id), { success: 'Đã ghi nhận khách rời', onDone: reload });
  const [walkIn, walking] = useAction((v) => guestApi.walkIn(v), {
    success: 'Đã gửi yêu cầu xác nhận đến cư dân',
    onDone: () => (setWalkInOpen(false), reload()),
  });

  const columns = [
    {
      title: 'Khách',
      dataIndex: 'guestName',
      render: (v, r) => (
        <Flex vertical>
          <Typography.Text strong>
            {v} {r.numberOfGuests > 1 && `(+${r.numberOfGuests - 1})`}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[r.guestPhone, r.purpose, r.isWalkIn && 'Vãng lai'].filter(Boolean).join(' · ')}
          </Typography.Text>
        </Flex>
      ),
    },
    { title: 'Căn hộ', dataIndex: ['apartmentId', 'code'], width: 100 },
    { title: 'Dự kiến', dataIndex: 'expectedTime', width: 150, render: formatDateTime },
    { title: 'Vào', dataIndex: 'checkInTime', width: 150, render: formatDateTime },
    { title: 'Rời', dataIndex: 'checkOutTime', width: 150, render: formatDateTime },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <EnumTag map={GUEST_STATUS} value={v} /> },
    { title: 'Cư dân xác nhận', render: (_, g) => ({ PENDING: 'Chưa phản hồi', CONFIRMED: 'Đã xác nhận', DECLINED: 'Không xác nhận' }[g.residentConfirmation] || '—') },
    ...(isGate
      ? [
          {
            title: '',
            width: 110,
            render: (_, r) =>
              r.status === 'EXPECTED' ? (
                <Button disabled={r.isWalkIn && r.residentConfirmation !== 'CONFIRMED'} size="small" type="primary" icon={<LoginOutlined />} onClick={() => checkIn(r._id).catch(() => {})}>
                  Vào
                </Button>
              ) : r.status === 'CHECKED_IN' ? (
                <Button size="small" icon={<LogoutOutlined />} onClick={() => checkOut(r._id).catch(() => {})}>
                  Rời
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (<>
    <Tabs activeKey={tab} onChange={(key) => { setTab(key); setOpsPage(1); }} items={[
      { key: 'guests', label: 'Khách ra vào' }, { key: 'parcels', label: 'Bưu kiện' },
      { key: 'tours', label: 'Tuần tra' }, ...(isManager ? [{ key: 'checkpoints', label: 'Checkpoint' }] : []),
      { key: 'incidents', label: 'Sự cố khẩn' },
    ]} />
    {tab !== 'guests' && <Card title={{ parcels: 'Bưu kiện tại quầy', tours: 'Lượt tuần tra theo ca', checkpoints: 'Điểm tuần tra', incidents: 'Báo cáo khẩn cấp' }[tab]}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button onClick={operations.reload}>Làm mới</Button>
        {tab === 'parcels' && <Select allowClear placeholder="Trạng thái" style={{ width: 180 }} value={parcelStatus} onChange={(s) => { setParcelStatus(s); setOpsPage(1); }} options={Object.entries(parcelLabels).map(([value, label]) => ({ value, label }))} />}
        {tab === 'parcels' && isReception && <Button type="primary" onClick={() => openOperation('parcel')}>Nhận bưu kiện</Button>}
        {tab === 'checkpoints' && isManager && <Button type="primary" onClick={() => openOperation('checkpoint')}>Thêm checkpoint</Button>}
        {tab === 'tours' && isManager && <Button type="primary" onClick={() => openOperation('tour')}>Xếp lượt tuần tra</Button>}
        {tab === 'incidents' && isGate && <Button danger type="primary" onClick={() => openOperation('incident')}>Báo sự cố khẩn</Button>}
      </Space>
      {tab === 'incidents' && <Alert type="warning" showIcon title="Báo khẩn qua Web/Email. Cháy nổ cần dùng hệ thống báo cháy và liên hệ trực tiếp." style={{ marginBottom: 12 }} />}
      {operations.error && <Alert type="error" title={operations.error.message} />}
      <Table rowKey="_id" columns={operationColumns} dataSource={operations.data || []} loading={operations.loading} scroll={{ x: 760 }} pagination={{ current: opsPage, pageSize: 20, total: operations.pagination?.total, onChange: setOpsPage, showSizeChanger: false }} />
    </Card>}
    {tab === 'guests' &&
    <Card
      title="Sổ khách ra vào"
      extra={
        isGate && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setWalkInOpen(true)}>
            Khách vãng lai
          </Button>
        )
      }
    >
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <DatePicker value={date} onChange={(d) => (setDate(d), setPage(1))} format="DD/MM/YYYY" allowClear />
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[{ value: 'ALL', label: 'Tất cả' }, ...Object.entries(GUEST_STATUS).map(([value, { label }]) => ({ value, label }))]}
        />
        <Input.Search
          placeholder="Tên / SĐT / mã căn"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => (setQ(v || undefined), setPage(1))}
        />
      </Flex>
      <Table
        rowKey="_id"
        loading={loading}
        dataSource={data}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{ current: page, pageSize: 20, total: pagination?.total, onChange: setPage }}
      />

      <Modal
        title="Ghi nhận khách vãng lai"
        open={walkInOpen}
        onCancel={() => setWalkInOpen(false)}
        onOk={() => form.submit()}
        okText="Gửi cư dân xác nhận"
        confirmLoading={walking}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ numberOfGuests: 1 }} onFinish={(v) => walkIn(v).catch(() => {})}>
          <Form.Item name="guestName" label="Tên khách" rules={[{ required: true, min: 2, message: 'Bắt buộc nhập tên khách' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="apartmentId" label="Căn hộ đến thăm" rules={[{ required: true, message: 'Bắt buộc chọn căn hộ' }]}>
            <ApartmentSelect />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="guestPhone" label="Số điện thoại" style={{ flex: 1 }}>
              <Input maxLength={15} />
            </Form.Item>
            <Form.Item name="idNumber" label="4 số cuối CCCD" style={{ flex: 1 }} rules={[{ pattern: /^\d{4}$/, message: 'Chỉ nhập đúng 4 chữ số cuối' }]}>
              <Input maxLength={4} inputMode="numeric" />
            </Form.Item>
            <Form.Item name="numberOfGuests" label="Số người" style={{ width: 100 }}>
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
          </Flex>
          <Alert type="info" title="Thông tin được dùng để ghi nhận khách đến thăm và bảo đảm an ninh; không thu toàn bộ số CCCD." style={{ marginBottom: 12 }} />
          <Form.Item name="purpose" label="Mục đích">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>}

    <Modal open={Boolean(operation)} title={{ parcel: 'Nhận bưu kiện', handover: 'Bàn giao bưu kiện', receipt: 'Chứng cứ ký nhận', checkpoint: 'Thêm checkpoint', tour: 'Xếp lượt tuần tra', incident: 'Báo sự cố khẩn cấp' }[operation?.kind]}
      okButtonProps={{ style: operation?.kind === 'receipt' ? { display: 'none' } : undefined }}
      onCancel={() => !performing && setOperation(null)} onOk={() => opsForm.submit()} confirmLoading={performing} mask={{ closable: !performing }} destroyOnHidden>
      <Form form={opsForm} layout="vertical" preserve={false} onFinish={(v) => perform(v).catch(() => {})}>
        {operation?.kind === 'receipt' && <><p>{receipt.data?.recipientName} · {formatDateTime(receipt.data?.handedOverAt)}</p>{receipt.data?.signature && <Image src={receipt.data.signature} alt="Chữ ký nhận bưu kiện" />} {receipt.error && <Alert type="error" title={receipt.error.message} />}</>}
        {operation?.kind === 'parcel' && <>
          <Form.Item name="apartmentId" label="Căn hộ" rules={[{ required: true }]}><ApartmentSelect /></Form.Item>
          <Form.Item name="trackingCode" label="Mã vận đơn" rules={[{ required: true, min: 2 }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="carrier" label="Đơn vị vận chuyển" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
        </>}
        {['parcel', 'incident'].includes(operation?.kind) && <Form.Item label={operation.kind === 'parcel' ? 'Ảnh bưu kiện (bắt buộc)' : 'Ảnh hiện trường'}>
          <Upload accept={IMAGE_ACCEPT} beforeUpload={checkPhoto} fileList={photos} onChange={({ fileList }) => setPhotos(fileList)} maxCount={3} listType="picture"><Button>Chọn/chụp ảnh</Button></Upload>
        </Form.Item>}
        {operation?.kind === 'handover' && <>
          <Form.Item name="recipientId" label="Thành viên nhận hàng" rules={[{ required: true }]}><Select loading={recipients.loading} options={(recipients.data || []).map((p) => ({ value: p._id, label: p.fullName }))} /></Form.Item>
          <Typography.Paragraph>Người nhận ký tay vào vùng dưới đây:</Typography.Paragraph>
          <canvas ref={canvasRef} width={420} height={180} aria-label="Vùng ký nhận bưu kiện" style={{ width: '100%', height: 180, border: '1px solid #d9d9d9', touchAction: 'none' }}
            onPointerDown={(e) => { drawingRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext('2d'); ctx.beginPath(); ctx.moveTo((e.clientX - r.left) * 420 / r.width, e.clientY - r.top); }}
            onPointerMove={(e) => { if (!drawingRef.current) return; const r = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext('2d'); ctx.lineWidth = 2; ctx.lineTo((e.clientX - r.left) * 420 / r.width, e.clientY - r.top); ctx.stroke(); signedRef.current = true; }}
            onPointerUp={() => { drawingRef.current = false; }} onPointerCancel={() => { drawingRef.current = false; }} />
          <Button onClick={() => { canvasRef.current.getContext('2d').clearRect(0, 0, 420, 180); signedRef.current = false; }}>Ký lại</Button>
        </>}
        {['checkpoint', 'tour'].includes(operation?.kind) && <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>}
        {operation?.kind === 'checkpoint' && <Form.Item name="location" label="Vị trí" rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>}
        {operation?.kind === 'tour' && <>
          <Form.Item name="shiftId" label="Ca Bảo vệ" rules={[{ required: true }]}><Select loading={shifts.loading} options={(shifts.data || []).filter((s) => dayjs(s.endAt).isAfter(dayjs())).map((s) => ({ value: s._id, label: `${s.userId?.fullName} · ${formatDateTime(s.startAt)} – ${formatDateTime(s.endAt)}` }))} /></Form.Item>
          <Form.Item name="startAt" label="Bắt đầu" rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
          <Form.Item name="endAt" label="Kết thúc (trong ca)" rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
          <Form.Item name="checkpointIds" label="Các checkpoint phải đi" rules={[{ required: true, type: 'array', min: 1 }]}><Select mode="multiple" loading={checkpoints.loading} options={(checkpoints.data || []).filter((p) => p.active).map((p) => ({ value: p._id, label: `${p.name} · ${p.location}` }))} /></Form.Item>
        </>}
        {operation?.kind === 'incident' && <>
          <Form.Item name="type" label="Loại sự cố" rules={[{ required: true }]}><Select options={[{ value: 'FIRE', label: 'Cháy' }, { value: 'SECURITY', label: 'Mất an ninh' }, { value: 'COLLISION', label: 'Va chạm xe' }, { value: 'TECHNICAL', label: 'Sự cố kỹ thuật khẩn cấp' }]} /></Form.Item>
          <Form.Item name="location" label="Vị trí" rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="description" label="Mô tả" rules={[{ required: true, min: 5 }]}><Input.TextArea maxLength={2000} rows={3} /></Form.Item>
        </>}
      </Form>
    </Modal>
    <Modal open={Boolean(qrPoint)} title={qrPoint?.name} onCancel={() => setQrPoint(null)} footer={<Button onClick={() => window.print()}>In QR</Button>}>
      {qrPoint?.token && <QRCodeSVG value={`CP1.${qrPoint.token}`} size={220} />}
      <p>{qrPoint?.location}</p>
    </Modal>
    <QrScanModal open={Boolean(scanTour)} title="Quét checkpoint tuần tra" instruction="Quét QR dán tại checkpoint của lượt tuần tra đang chọn. GPS chỉ ghi kèm, không chặn khi thiếu tín hiệu." placeholder="CP1.…" onClose={() => setScanTour(null)} onResult={(code) => scan(code).catch(() => {})} />
  </>
  );
}
