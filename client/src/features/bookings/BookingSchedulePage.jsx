import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Avatar, Button, Card, DatePicker, Flex, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography } from 'antd';
import { LoginOutlined, PlusOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { bookingApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { BOOKING_STATUS } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatMoney } from '../../utils/format';
import CounterBookingModal from './CounterBookingModal';

const AUTO_REFRESH_MS = 60 * 1000;
const CLOCK_TICK_MS = 15 * 1000;
const hhmm = (d) => (d ? dayjs(d).format('HH:mm') : '');

/** Nhãn thời gian check-in, tính theo giờ máy chủ (nowMs) chứ không theo đồng hồ máy người dùng */
function checkInTag(b, nowMs) {
  if (b.status === 'CHECKED_IN') return <Tag color="processing">Check-in lúc {hhmm(b.checkedInAt)}</Tag>;
  if (b.status !== 'APPROVED') return null;
  const opens = Date.parse(b.checkIn.opensAt);
  const closes = Date.parse(b.checkIn.closesAt);
  if (nowMs < opens) return <Tag>Mở check-in lúc {hhmm(opens)}</Tag>;
  if (nowMs <= closes) return <Tag color="green">Đang mở check-in · hạn {hhmm(closes)}</Tag>;
  return <Tag color="red">Quá hạn check-in</Tag>;
}

const inWindow = (b, nowMs) => b.status === 'APPROVED' && nowMs >= Date.parse(b.checkIn.opensAt) && nowMs <= Date.parse(b.checkIn.closesAt);

// UC-D07 — Lịch đặt tiện ích trong ngày. Lễ tân: check-in, hủy kèm lý do, đặt hộ; Bảo vệ: chỉ check-in; Trưởng BQL: chỉ xem.
export default function BookingSchedulePage() {
  const { hasRole } = useAuth();
  const isReception = hasRole('STAFF:RECEPTIONIST');
  const canCheckIn = hasRole('STAFF:RECEPTIONIST', 'STAFF:SECURITY');
  const [date, setDate] = useState(() => dayjs());
  const [amenityId, setAmenityId] = useState();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || undefined); // từ trang chủ lễ tân (tra mã cư dân)
  const [silent, setSilent] = useState(false); // tự làm mới: không hiện vòng xoay trên bảng
  const [clock, setClock] = useState(0);
  const [checkingIn, setCheckingIn] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [cancelForm] = Form.useForm();
  const [checkInForm] = Form.useForm();

  const dateText = date.format('YYYY-MM-DD');
  const { raw, loading, reload } = useApi(async () => {
    const res = await bookingApi.schedule({ date: dateText, amenityId, q });
    return { ...res, receivedAt: Date.now() };
  }, [dateText, amenityId, q]);
  const data = raw?.data;

  // Giờ máy chủ hiện tại = serverTime lúc tải + thời gian đã trôi kể từ lúc nhận
  const nowMs = data ? Date.parse(data.serverTime) + Math.max(0, clock - raw.receivedAt) : 0;

  const refreshSilently = useCallback(() => {
    setSilent(true);
    reload().finally(() => setSilent(false));
  }, [reload]);

  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
    const refresh = setInterval(() => {
      if (!document.hidden) refreshSilently();
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [refreshSilently]);

  const [checkIn, checkingIn$] = useAction((v) => bookingApi.checkIn(checkingIn._id, v.code?.trim()), {
    success: 'Đã check-in',
    onDone: () => {
      setCheckingIn(null);
      checkInForm.resetFields();
      refreshSilently();
    },
  });
  const [cancel, cancelling$] = useAction((v) => bookingApi.cancel(cancelling._id, v.reason), {
    success: 'Đã hủy booking, cư dân được thông báo không bị tính phí',
    onDone: () => {
      setCancelling(null);
      cancelForm.resetFields();
      refreshSilently();
    },
  });

  const columns = [
    {
      title: 'Giờ',
      width: 110,
      fixed: 'left',
      render: (_, b) => (
        <Typography.Text strong>
          {b.slotStart}–{b.slotEnd}
        </Typography.Text>
      ),
    },
    { title: 'Tiện ích', dataIndex: ['amenity', 'name'], width: 160 },
    {
      title: 'Căn hộ',
      dataIndex: 'apartment',
      width: 140,
      render: (a) => (a ? `${a.code} · ${a.building?.name ?? ''}` : '—'),
    },
    {
      title: 'Người đặt',
      dataIndex: 'bookedBy',
      width: 240,
      render: (u, b) =>
        u ? (
          <Flex gap={8} align="center">
            <Avatar size={36} src={u.avatarUrl} icon={<UserOutlined />} />
            <Flex vertical>
              <Typography.Text strong>{u.fullName}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace' }}>{u.memberCode ?? '—'}</span>
                {u.phone && ` · ${u.phone}`}
              </Typography.Text>
              {b.createdByStaff && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Lễ tân đặt hộ: {b.createdByStaff.fullName}
                </Typography.Text>
              )}
            </Flex>
          </Flex>
        ) : (
          '—'
        ),
    },
    {
      title: 'Phí',
      dataIndex: 'fee',
      width: 120,
      align: 'right',
      render: (v, b) => (b.usesPass ? <Tag color="cyan">Gói tháng</Tag> : v > 0 ? formatMoney(v) : 'Miễn phí'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 230,
      render: (v, b) => (
        <Flex gap={4} wrap>
          <EnumTag map={BOOKING_STATUS} value={v} />
          {checkInTag(b, nowMs)}
          {b.cancelReason && (
            <Tooltip title={b.cancelReason}>
              <Tag color="orange">Lý do hủy</Tag>
            </Tooltip>
          )}
        </Flex>
      ),
    },
    ...(canCheckIn
      ? [
          {
            title: '',
            width: isReception ? 170 : 110,
            fixed: 'right',
            render: (_, b) =>
              b.status === 'APPROVED' && (
                <Flex gap={6}>
                  <Tooltip title={inWindow(b, nowMs) ? null : 'Ngoài khung check-in'}>
                    <Button size="small" type="primary" icon={<LoginOutlined />} disabled={!inWindow(b, nowMs)} onClick={() => setCheckingIn(b)}>
                      Check-in
                    </Button>
                  </Tooltip>
                  {isReception && (
                    <Button size="small" danger onClick={() => setCancelling(b)}>
                      Hủy
                    </Button>
                  )}
                </Flex>
              ),
          },
        ]
      : []),
  ];

  const rules = data?.rules;
  const describe = (b) => (b ? `${b.amenity?.name} · ${b.slotStart}–${b.slotEnd} · căn ${b.apartment?.code} · ${b.bookedBy?.fullName ?? ''}` : '');

  return (
    <>
      <PageHeader
        title="Lịch đặt tiện ích"
        subtitle={
          rules
            ? `Check-in mở trước giờ bắt đầu ${rules.checkinEarlyMinutes} phút (không sớm hơn ${rules.receptionOpen} — giờ lễ tân mở cửa), hạn chót ${rules.noShowGraceMinutes} phút sau giờ bắt đầu. Tự làm mới mỗi phút.`
            : 'Lịch đặt tiện ích theo ngày.'
        }
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Lịch đặt tiện ích' }]}
        extra={
          <>
            <Button icon={<ReloadOutlined />} onClick={() => reload()}>
              Làm mới
            </Button>
            {isReception && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCounterOpen(true)}>
                Đặt hộ
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <DatePicker allowClear={false} format="DD/MM/YYYY" value={date} onChange={setDate} />
          <Button onClick={() => setDate(dayjs())}>Hôm nay</Button>
          <Select
            allowClear
            placeholder="Tất cả tiện ích"
            style={{ width: 200 }}
            value={amenityId}
            onChange={setAmenityId}
            options={(data?.amenities ?? []).map((a) => ({ value: a._id, label: a.name }))}
          />
          <Input.Search placeholder="Mã căn / mã cư dân / tên / SĐT" allowClear defaultValue={q} style={{ width: 280 }} onSearch={(v) => setQ(v.trim() || undefined)} />
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading && !silent}
          dataSource={data?.bookings ?? []}
          columns={columns}
          scroll={{ x: 1200 }}
          pagination={false}
          locale={{ emptyText: 'Không có lượt đặt nào trong ngày' }}
        />
      </Card>

      <Modal
        title="Check-in booking"
        open={Boolean(checkingIn)}
        onCancel={() => setCheckingIn(null)}
        onOk={() => checkInForm.submit()}
        okText="Check-in"
        cancelText="Đóng"
        confirmLoading={checkingIn$}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{describe(checkingIn)}</Typography.Paragraph>
        <Form form={checkInForm} layout="vertical" preserve={false} onFinish={(v) => checkIn(v).catch(() => {})}>
          <Form.Item name="code" label="Mã cư dân của người đến (không bắt buộc)" extra="Nhập để kiểm tra người đến thuộc đúng căn đã đặt.">
            <Input placeholder="Ví dụ A-0501-01" maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Hủy booking"
        open={Boolean(cancelling)}
        onCancel={() => setCancelling(null)}
        onOk={() => cancelForm.submit()}
        okText="Hủy booking"
        okButtonProps={{ danger: true }}
        cancelText="Đóng"
        confirmLoading={cancelling$}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {describe(cancelling)}. Người đặt sẽ được thông báo và không bị tính phí; thao tác được ghi nhật ký.
        </Typography.Paragraph>
        <Form form={cancelForm} layout="vertical" preserve={false} onFinish={(v) => cancel(v).catch(() => {})}>
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, whitespace: true, min: 5, max: 500, message: 'Nhập lý do 5–500 ký tự' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {counterOpen && <CounterBookingModal initialDate={date.isBefore(dayjs(), 'day') ? dayjs() : date} onClose={() => setCounterOpen(false)} onDone={refreshSilently} />}
    </>
  );
}
