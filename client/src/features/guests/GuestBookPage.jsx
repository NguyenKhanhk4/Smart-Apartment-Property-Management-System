// Module 7: dùng lại màn vận hành để quản lý khách, bưu kiện, tuần tra và báo khẩn, không thêm component/file.
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  Table,
  Typography,
  Alert, Descriptions, Empty, Image, Popconfirm, Progress, Space, Tabs, Tag, Upload,
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
import { useMediaQuery } from '../../hooks/useMediaQuery';
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

// Điện thoại hiển thị dữ liệu và thao tác trong cùng một dòng dọc, không phải kéo ngang để quét/cho vào.
function mobileColumns(columns) {
  return [{ key: 'mobile', render: (_, record) => <Flex vertical gap={10}>{columns.map((column, index) => {
    const value = [column.dataIndex].flat().filter(Boolean).reduce((result, key) => result?.[key], record);
    return <div key={index}>{column.title && <Typography.Text type="secondary">{column.title}: </Typography.Text>}{column.render ? column.render(value, record) : value || '—'}</div>;
  })}</Flex> }];
}

// UC-E08 — Bảo vệ ghi nhận giờ khách đến/rời (gồm khách vãng lai — BR-O10). Lễ tân/Manager xem.
function GuestOperations() {
  const compact = useMediaQuery('(max-width: 640px)');
  const { hasRole } = useAuth();
  const checkPhoto = useImageCheck(); // UC63
  const isGate = hasRole('STAFF:SECURITY');
  const isManager = hasRole('MANAGER');
  const isReception = hasRole('STAFF:RECEPTIONIST');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = ['guests', 'parcels', 'tours', 'incidents', ...(isManager ? ['checkpoints'] : [])].includes(requestedTab) ? requestedTab : 'guests';
  const [detail, setDetail] = useState(null);
  const [operation, setOperation] = useState(null);
  const [opsForm] = Form.useForm();
  const [photos, setPhotos] = useState([]);
  const [scanTour, setScanTour] = useState(null);
  const [qrPoint, setQrPoint] = useState(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);
  const signedRef = useRef(false);
  const [signatureError, setSignatureError] = useState('');
  const incidentRequestRef = useRef(null);
  const [opsPage, setOpsPage] = useState(1);
  const [parcelStatus, setParcelStatus] = useState();
  const [parcelRange, setParcelRange] = useState(null);
  const operations = useApi(() => guestApi.operations(tab, { page: opsPage, limit: 20,
    ...(tab === 'parcels' && { status: parcelStatus, from: parcelRange?.[0].format('YYYY-MM-DD'), to: parcelRange?.[1].format('YYYY-MM-DD') }),
  }), [tab, opsPage, parcelStatus, parcelRange], { enabled: tab !== 'guests' });
  const checkpoints = useApi(() => guestApi.operations('checkpoints', { limit: 100 }), [], { enabled: operation?.kind === 'tour' });
  const shifts = useApi(() => dutyShiftApi.list({ roleTitle: 'SECURITY' }), [], { enabled: operation?.kind === 'tour' });
  const recipients = useApi(() => guestApi.recipients(operation.id), [operation?.id], { enabled: operation?.kind === 'handover' });
  const receipt = useApi(() => guestApi.receipt(operation.id), [operation?.id], { enabled: operation?.kind === 'receipt' });
  const clearSignature = () => {
    canvasRef.current?.getContext('2d').clearRect(0, 0, 420, 180);
    signedRef.current = false;
    drawingRef.current = null;
    setSignatureError('');
  };
  const openOperation = (kind, id) => {
    opsForm.resetFields();
    setPhotos([]); clearSignature();
    incidentRequestRef.current = kind === 'incident' ? crypto.randomUUID() : null;
    setOperation({ kind, id });
  };
  const [perform, performing] = useAction(async (values) => {
    const files = photos.map((f) => f.originFileObj);
    const body = { ...values };
    delete body.evidenceImages;
    if (['parcel', 'incident'].includes(operation.kind) && !files.length) throw new Error('Vui lòng chọn ít nhất một ảnh trước khi gửi');
    switch (operation.kind) {
      case 'parcel': return guestApi.receiveParcel(body, files);
      case 'handover':
        if (!signedRef.current) {
          setSignatureError('Vui lòng ký trước khi xác nhận');
          throw new Error('Người nhận cần ký tên trên màn hình');
        }
        return guestApi.handover(operation.id, { recipientId: values.recipientId, signature: canvasRef.current.toDataURL('image/png') });
      case 'checkpoint': return guestApi.checkpoint(values);
      case 'tour': return guestApi.tour({ ...values, startAt: values.startAt.toISOString(), endAt: values.endAt.toISOString() });
      case 'incident': return guestApi.incident({ ...body, requestId: incidentRequestRef.current }, files);
      default: throw new Error('Thao tác không hợp lệ');
    }
  }, { success: 'Đã lưu', onDone: () => { setOperation(null); operations.reload(); } });
  const [returnParcel, returning] = useAction((id) => guestApi.handover(id, { returned: true }), { success: 'Đã xác nhận trả đơn vị vận chuyển', onDone: operations.reload });
  const [acknowledge, acknowledging] = useAction(guestApi.acknowledge, { success: 'Đã tiếp nhận', onDone: operations.reload });
  const [broadcast, broadcasting] = useAction(guestApi.broadcast, { success: 'Đã phát cảnh báo cư dân', onDone: operations.reload });
  const [endBroadcast, endingBroadcast] = useAction(guestApi.endBroadcast, { success: 'Đã kết thúc cảnh báo cư dân', onDone: operations.reload });
  const [toggleCheckpoint] = useAction(guestApi.updateCheckpoint, { success: 'Đã cập nhật checkpoint', onDone: operations.reload });
  const scanBusy = useRef(false);
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
      <Button onClick={() => setDetail({ kind: 'parcel', record: p })}>Chi tiết</Button>
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
    { title: 'Tiến độ', render: (_, t) => <><Progress percent={t.checkpoints.length ? Math.round(t.scans.length / t.checkpoints.length * 100) : 0} size="small" showInfo={false} /><span>{t.scans.length}/{t.checkpoints.length} điểm đã quét</span></> },
    { title: 'Kết quả', render: (_, t) => dayjs().isBefore(t.startAt) ? 'Chưa đến giờ' : dayjs().isBefore(t.endAt) ? `${t.scans.length}/${t.checkpoints.length} điểm` : t.missed?.length ? `Bỏ sót: ${t.missed.map((p) => p.name).join(', ')}` : 'Đủ checkpoint' },
    { title: 'Thao tác', render: (_, t) => <Space wrap><Button onClick={() => setDetail({ kind: 'tour', record: t })}>Lộ trình</Button>{isGate && !dayjs().isBefore(t.startAt) && dayjs().isBefore(t.endAt) && t.scans.length < t.checkpoints.length && <Button type="primary" onClick={() => setScanTour(t._id)}>Quét checkpoint</Button>}</Space> },
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
  const [date, setDate] = useState(null);
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [guestToCheckIn, setGuestToCheckIn] = useState(null);

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
  const { data = [], pagination, loading, reload, error } = useApi(() => guestApi.list(params), [params], { enabled: tab === 'guests' });
  const [checkIn, checkingIn] = useAction(({ id, body }) => guestApi.checkIn(id, body), {
    success: 'Đã ghi nhận khách đến', onDone: () => { setWalkInOpen(false); reload(); },
  });
  const [checkOut, checkingOut] = useAction((id) => guestApi.checkOut(id), { success: 'Đã ghi nhận khách rời', onDone: reload });
  const [walkIn, walking] = useAction((v) => guestApi.walkIn(v), {
    success: 'Đã ghi nhận khách vào',
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
    { title: 'Chi tiết', render: (_, g) => <Button onClick={() => setDetail({ kind: 'guest', record: g })}>Xem</Button> },
    ...(isGate
      ? [
          {
            title: '',
            width: 110,
            render: (_, r) =>
              r.status === 'EXPECTED' ? (
                <Button disabled={checkingOut} type="primary" icon={<LoginOutlined />} onClick={() => {
                  form.resetFields();
                  form.setFieldsValue({ guestName: r.guestName, guestPhone: r.guestPhone, numberOfGuests: r.numberOfGuests,
                    purpose: r.purpose, apartmentId: r.apartmentId?._id, idType: r.idType || 'CCCD', idNumber: '' });
                  setGuestToCheckIn(r);
                  setWalkInOpen(true);
                }}>
                  Vào
                </Button>
              ) : r.status === 'CHECKED_IN' ? (
                <Popconfirm title={`Xác nhận ${r.guestName} đã rời tòa nhà?`} onConfirm={() => checkOut(r._id).catch(() => {})}><Button loading={checkingOut} disabled={checkingIn} icon={<LogoutOutlined />}>Rời</Button></Popconfirm>
              ) : null,
          },
        ]
      : []),
  ];

  return (<>
    <Typography.Title level={3} style={{ marginTop: 0 }}>Khách và vận hành an ninh</Typography.Title>
    <Typography.Paragraph type="secondary">{isGate ? 'Theo dõi khách ra vào, tra cứu bưu kiện và thực hiện lượt tuần tra được giao.' : isReception ? 'Theo dõi khách, tiếp nhận bưu kiện và bàn giao có chữ ký cho đúng thành viên của căn hộ.' : 'Theo dõi sổ khách, bưu kiện và phân công lộ trình tuần tra theo ca Bảo vệ.'}</Typography.Paragraph>
    <Tabs activeKey={tab} onChange={(key) => { setSearchParams({ tab: key }, { replace: true }); setOpsPage(1); setDetail(null); }} items={[
      { key: 'guests', label: 'Khách ra vào' }, { key: 'parcels', label: 'Bưu kiện' },
      { key: 'tours', label: 'Tuần tra' }, ...(isManager ? [{ key: 'checkpoints', label: 'Checkpoint' }] : []),
      { key: 'incidents', label: 'Sự cố khẩn' },
    ]} />
    {tab !== 'guests' && <Card title={{ parcels: 'Bưu kiện tại quầy', tours: 'Lượt tuần tra theo ca', checkpoints: 'Điểm tuần tra', incidents: 'Báo cáo khẩn cấp' }[tab]}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button onClick={operations.reload}>Làm mới</Button>
        {tab === 'parcels' && <Select allowClear placeholder="Trạng thái" style={{ width: 180 }} value={parcelStatus} onChange={(s) => { setParcelStatus(s); setOpsPage(1); }} options={Object.entries(parcelLabels).map(([value, label]) => ({ value, label }))} />}
        {tab === 'parcels' && <DatePicker.RangePicker aria-label="Ngày tiếp nhận bưu kiện" placeholder={['Nhận từ ngày', 'Đến ngày']} value={parcelRange} onChange={(range) => { setParcelRange(range); setOpsPage(1); }} format="DD/MM/YYYY" />}
        {tab === 'parcels' && isReception && <Button type="primary" onClick={() => openOperation('parcel')}>Nhận bưu kiện</Button>}
        {tab === 'checkpoints' && isManager && <Button type="primary" onClick={() => openOperation('checkpoint')}>Thêm checkpoint</Button>}
        {tab === 'tours' && isManager && <Button type="primary" onClick={() => openOperation('tour')}>Xếp lượt tuần tra</Button>}
        {tab === 'incidents' && isGate && <Button danger type="primary" onClick={() => openOperation('incident')}>Báo sự cố khẩn</Button>}
      </Space>
      {tab === 'parcels' && <Typography.Paragraph type="secondary">{isReception ? 'Nhận kiện kèm ảnh, chọn đúng người nhận và ký trước khi bàn giao. Kiện chờ trả vẫn có thể bàn giao trước khi trả vận chuyển.' : 'Bảo vệ tra cứu tình trạng kiện; vui lòng liên hệ Lễ tân để tiếp nhận, ký nhận hoặc trả vận chuyển.'}</Typography.Paragraph>}
      {tab === 'tours' && <Typography.Paragraph type="secondary">{isManager ? 'Tạo checkpoint trước, sau đó chọn ca Bảo vệ và khung giờ nằm trong ca để xếp lượt.' : 'Chỉ hiển thị các lượt được giao cho bạn. Quét QR hoặc nhập mã khi đến giờ; GPS là thông tin bổ sung.'}</Typography.Paragraph>}
      {tab === 'incidents' && <Alert type="warning" showIcon title="Báo khẩn qua Web/Email. Cháy nổ cần dùng hệ thống báo cháy và liên hệ trực tiếp." style={{ marginBottom: 12 }} />}
      {operations.error && <Alert type="error" title={operations.error.message} action={<Button onClick={operations.reload}>Thử lại</Button>} />}
      <Table rowKey="_id" showHeader={!compact} columns={compact ? mobileColumns(operationColumns) : operationColumns} dataSource={operations.data || []} loading={operations.loading} scroll={compact ? undefined : { x: 760 }} locale={{ emptyText: operations.error ? 'Không thể tải dữ liệu. Vui lòng thử lại.' : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tab === 'parcels' ? (parcelStatus || parcelRange ? 'Không có bưu kiện khớp bộ lọc.' : 'Chưa có bưu kiện. Lễ tân tiếp nhận kiện tại quầy để bắt đầu theo dõi.') : tab === 'tours' ? (isManager ? 'Chưa xếp lượt tuần tra. Tạo checkpoint và chọn ca để phân công.' : 'Bạn chưa được giao lượt tuần tra. Vui lòng liên hệ BQL để xếp lượt theo ca.') : 'Chưa có dữ liệu.'} /> }} pagination={{ current: opsPage, pageSize: 20, total: operations.pagination?.total, onChange: setOpsPage, showSizeChanger: false, showTotal: (total) => `${total} bản ghi` }} />
    </Card>}
    {tab === 'guests' &&
    <Card
      title="Sổ khách ra vào"
      extra={
        isGate && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => {
            setGuestToCheckIn(null); form.resetFields(); setWalkInOpen(true);
          }}>
            Khách vãng lai
          </Button>
        )
      }
    >
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <DatePicker placeholder="Tất cả ngày" value={date} onChange={(d) => (setDate(d), setPage(1))} format="DD/MM/YYYY" allowClear />
        <Button onClick={() => { setDate(dayjs()); setPage(1); }}>Hôm nay</Button>
        <Select style={{ minWidth: 155 }}
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[{ value: 'ALL', label: 'Tất cả' }, ...Object.entries(GUEST_STATUS).map(([value, { label }]) => ({ value, label }))]}
        />
        <Input.Search value={searchText} onChange={(e) => setSearchText(e.target.value)}
          placeholder="Tên / SĐT / mã căn"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => (setQ(v || undefined), setPage(1))}
        />
        <Button onClick={() => { setDate(null); setStatus('ALL'); setQ(undefined); setSearchText(''); setPage(1); }}>Bỏ bộ lọc</Button>
        <Button loading={loading} onClick={reload}>Làm mới</Button>
      </Flex>
      {error && <Alert type="error" title={error.message} action={<Button onClick={reload}>Thử lại</Button>} />}
      <Typography.Paragraph type="secondary">{date ? `Khách dự kiến đến hoặc đã vào ngày ${date.format('DD/MM/YYYY')}.` : 'Đang xem tất cả ngày, bao gồm khách đã đăng ký trước.'} Bảo vệ đang trực đối chiếu giấy tờ và ghi nhận giờ vào tại sảnh.</Typography.Paragraph>
      <Table
        rowKey="_id"
        loading={loading}
        dataSource={data}
        showHeader={!compact}
        columns={compact ? mobileColumns(columns) : columns}
        scroll={compact ? undefined : { x: 1100 }}
        locale={{ emptyText: error ? 'Không thể tải sổ khách. Vui lòng thử lại.' : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có khách khớp bộ lọc. Chọn Bỏ bộ lọc để xem toàn bộ lịch sử." /> }}
        pagination={{ current: page, pageSize: 20, total: pagination?.total, onChange: setPage, showSizeChanger: false, showTotal: (total) => `${total} lượt khách` }}
      />

      <Modal
        title={guestToCheckIn ? 'Đối chiếu và ghi nhận khách vào' : 'Ghi nhận khách vãng lai'}
        open={walkInOpen}
        onCancel={() => !(walking || checkingIn) && setWalkInOpen(false)}
        onOk={() => form.submit()}
        okText="Ghi nhận khách vào"
        confirmLoading={walking || checkingIn}
        mask={{ closable: !(walking || checkingIn) }}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ numberOfGuests: 1, idType: 'CCCD' }} onFinish={(v) => {
          const request = guestToCheckIn
            ? checkIn({ id: guestToCheckIn._id, body: { idType: v.idType, idNumber: v.idNumber } })
            : walkIn(v);
          request.catch(() => {});
        }}>
          <Form.Item name="guestName" label="Tên khách" rules={[{ required: true, min: 2, message: 'Bắt buộc nhập tên khách' }]}>
            <Input maxLength={100} disabled={Boolean(guestToCheckIn)} />
          </Form.Item>
          <Form.Item name="apartmentId" label="Căn hộ đến thăm" rules={[{ required: true, message: 'Bắt buộc chọn căn hộ' }]}>
            <ApartmentSelect disabled={Boolean(guestToCheckIn)} />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="guestPhone" label="Số điện thoại" style={{ flex: 1 }}>
              <Input maxLength={15} disabled={Boolean(guestToCheckIn)} />
            </Form.Item>
            <Form.Item name="numberOfGuests" label="Số người" style={{ width: 100 }}>
              <InputNumber min={1} max={50} disabled={Boolean(guestToCheckIn)} style={{ width: '100%' }} />
            </Form.Item>
          </Flex>
          <Form.Item name="idType" label="Loại giấy tờ" rules={[{ required: true, message: 'Chọn loại giấy tờ' }]}>
            <Select options={[{ value: 'CCCD', label: 'CCCD / Căn cước' }, { value: 'CMND', label: 'CMND' }, { value: 'PASSPORT', label: 'Hộ chiếu' }, { value: 'OTHER', label: 'Giấy tờ khác' }]} />
          </Form.Item>
          <Form.Item name="idNumber" label="Số giấy tờ đã đối chiếu" rules={[
            { required: true, message: 'Nhập số giấy tờ' },
            { pattern: /^[A-Za-z0-9-]{6,30}$/, message: 'Nhập từ 6 đến 30 chữ cái, chữ số hoặc dấu gạch ngang' },
          ]}>
            <Input maxLength={30} autoComplete="off" />
          </Form.Item>
          <Alert type="info" title="Số giấy tờ được mã hóa khi lưu và che khi hiển thị trong sổ khách." style={{ marginBottom: 12 }} />
          <Form.Item name="purpose" label="Mục đích">
            <Input maxLength={200} disabled={Boolean(guestToCheckIn)} />
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
          {recipients.error && <Alert type="error" title={recipients.error.message} action={<Button onClick={recipients.reload}>Thử lại</Button>} />}
          {!recipients.loading && !recipients.error && !recipients.data?.length && <Alert type="warning" title="Căn hộ chưa có thành viên đủ điều kiện nhận. Vui lòng liên hệ BQL, không chọn người của căn khác." />}
          <Form.Item name="recipientId" label="Thành viên nhận hàng" rules={[{ required: true }]}><Select onChange={clearSignature} loading={recipients.loading} options={(recipients.data || []).map((p) => ({ value: p._id, label: p.fullName }))} /></Form.Item>
          <Form.Item label="Chữ ký người nhận" validateStatus={signatureError ? 'error' : undefined} help={signatureError || undefined}>
            <canvas ref={canvasRef} width={420} height={180} aria-label="Vùng ký nhận bưu kiện" style={{ width: '100%', height: 180, border: '1px solid #d9d9d9', touchAction: 'none' }}
              onPointerDown={(e) => {
                if (performing || drawingRef.current !== null) return;
                drawingRef.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                const bounds = e.currentTarget.getBoundingClientRect();
                const context = e.currentTarget.getContext('2d');
                context.beginPath();
                context.moveTo((e.clientX - bounds.left) * 420 / bounds.width, (e.clientY - bounds.top) * 180 / bounds.height);
              }}
              onPointerMove={(e) => {
                if (drawingRef.current !== e.pointerId) return;
                const bounds = e.currentTarget.getBoundingClientRect();
                const context = e.currentTarget.getContext('2d');
                context.lineWidth = 2;
                context.lineCap = 'round';
                context.lineTo((e.clientX - bounds.left) * 420 / bounds.width, (e.clientY - bounds.top) * 180 / bounds.height);
                context.stroke();
                signedRef.current = true;
                setSignatureError('');
              }}
              onLostPointerCapture={() => { drawingRef.current = null; }} />
            <Button disabled={performing} onClick={clearSignature}>Ký lại</Button>
          </Form.Item>
        </>}
        {['checkpoint', 'tour'].includes(operation?.kind) && <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>}
        {operation?.kind === 'checkpoint' && <Form.Item name="location" label="Vị trí" rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>}
        {operation?.kind === 'tour' && <>
          {(shifts.error || checkpoints.error) && <Alert type="error" title="Không tải được ca hoặc checkpoint" action={<Button onClick={() => { shifts.reload(); checkpoints.reload(); }}>Thử lại</Button>} />}
          {!shifts.loading && !shifts.error && !shifts.data?.length && <Alert type="info" title="Chưa có ca Bảo vệ trong 7 ngày tới. Xếp ca tại Lịch ca trực trước khi tạo lượt." />}
          {!checkpoints.loading && !checkpoints.error && !checkpoints.data?.some((p) => p.active) && <Alert type="info" title="Chưa có checkpoint hoạt động. Thêm điểm tại tab Checkpoint trước." />}
          <Form.Item name="shiftId" label="Ca Bảo vệ (chính)" rules={[{ required: true }]}><Select onChange={(id) => { const shift = shifts.data.find((s) => s._id === id); opsForm.setFieldsValue({ startAt: dayjs().isAfter(shift.startAt) ? dayjs() : dayjs(shift.startAt), endAt: dayjs(shift.endAt) }); }} loading={shifts.loading} options={(shifts.data || []).filter((s) => !s.isBackup && dayjs(s.endAt).isAfter(dayjs())).map((s) => ({ value: s._id, label: `${s.userId?.fullName} · ${formatDateTime(s.startAt)} – ${formatDateTime(s.endAt)}` }))} /></Form.Item>
          <Form.Item name="startAt" label="Bắt đầu" rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
          <Form.Item name="endAt" label="Kết thúc (trong ca)" dependencies={['startAt', 'shiftId']} rules={[{ required: true }, { validator: (_, end) => { const start = opsForm.getFieldValue('startAt'); const shift = shifts.data?.find((s) => s._id === opsForm.getFieldValue('shiftId')); return !start || !end || !shift || (end.isAfter(start) && end.isAfter(dayjs()) && !start.isBefore(shift.startAt) && !end.isAfter(shift.endAt)) ? Promise.resolve() : Promise.reject(new Error('Khung giờ phải nằm trong ca, kết thúc sau bắt đầu và chưa hết hạn')); } }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
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
    <Modal open={Boolean(detail)} title={{ guest: 'Chi tiết lượt khách', parcel: 'Chi tiết bưu kiện', tour: 'Lộ trình tuần tra' }[detail?.kind]} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>Đóng</Button>} width="min(680px, 94vw)">
      {detail && <Descriptions column={1} bordered size="small" items={detail.kind === 'guest' ? [
        { key: 'name', label: 'Khách', children: detail.record.guestName },
        { key: 'home', label: 'Căn hộ', children: detail.record.apartmentId?.code },
        { key: 'people', label: 'Số người', children: detail.record.numberOfGuests },
        { key: 'phone', label: 'Điện thoại', children: detail.record.guestPhone || '—' },
        { key: 'idType', label: 'Loại giấy tờ', children: detail.record.idType || 'Chưa ghi nhận' },
        { key: 'idNumber', label: 'Số giấy tờ (che)', children: detail.record.idNumber || 'Chưa ghi nhận' },
        { key: 'purpose', label: 'Mục đích', children: detail.record.purpose || '—' },
        { key: 'expected', label: 'Dự kiến', children: formatDateTime(detail.record.expectedTime) },
        { key: 'in', label: 'Vào / Rời', children: `${formatDateTime(detail.record.checkInTime)} / ${formatDateTime(detail.record.checkOutTime)}` },
        { key: 'staff', label: 'Người ghi nhận', children: detail.record.recordedBy?.fullName || '—' },
        { key: 'note', label: 'Ghi chú', children: detail.record.note || '—' },
      ] : detail.kind === 'parcel' ? [
        { key: 'code', label: 'Mã vận đơn', children: detail.record.trackingCode },
        { key: 'carrier', label: 'Vận chuyển', children: detail.record.carrier },
        { key: 'home', label: 'Căn hộ', children: detail.record.apartmentId?.code },
        { key: 'state', label: 'Trạng thái', children: parcelLabels[detail.record.status] },
        { key: 'at', label: 'Nhận tại quầy', children: formatDateTime(detail.record.createdAt) },
        { key: 'recipient', label: 'Người nhận thực tế', children: detail.record.recipientName || 'Chưa bàn giao cho cư dân' },
        { key: 'handover', label: 'Bàn giao / trả', children: formatDateTime(detail.record.handedOverAt) },
      ] : [
        { key: 'tour', label: 'Lượt', children: detail.record.name },
        { key: 'guard', label: 'Bảo vệ', children: detail.record.guardId?.fullName },
        { key: 'window', label: 'Khung giờ', children: `${formatDateTime(detail.record.startAt)} – ${formatDateTime(detail.record.endAt)}` },
      ]} />}
      {detail?.kind === 'tour' && <ol style={{ paddingLeft: 24 }}>{detail.record.checkpoints.map((p) => { const hit = detail.record.scans.find((s) => s.checkpointId === p.checkpointId); return <li key={p.checkpointId} style={{ marginTop: 12 }}><Typography.Text strong>{p.name}</Typography.Text> · {p.location}<div>{hit ? `Đã quét · ${formatDateTime(hit.scannedAt)}` : dayjs().isBefore(detail.record.endAt) ? 'Chưa quét' : 'Bỏ sót'}</div></li>; })}</ol>}
    </Modal>
    <QrScanModal open={Boolean(scanTour)} title="Quét checkpoint tuần tra" instruction="Quét QR dán tại checkpoint của lượt tuần tra đang chọn. GPS chỉ ghi kèm, không chặn khi thiếu tín hiệu." placeholder="CP1.…" onClose={() => setScanTour(null)} onResult={async (code) => { if (scanBusy.current) return; scanBusy.current = true; try { await scan(code); } catch { /* useAction đã hiển thị lỗi; giữ scanner để thử lại. */ } finally { scanBusy.current = false; } }} />
  </>
  );
}

// Mỗi tab có vòng đời riêng: dữ liệu tab cũ không được render bằng cột của tab mới khi API còn đang tải.
export default function GuestBookPage() {
  const [params] = useSearchParams();
  return <GuestOperations key={params.get('tab') || 'guests'} />;
}
