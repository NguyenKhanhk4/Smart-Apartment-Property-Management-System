import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Button, Card, Flex, Result, Spin, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi, bookingApi, memberCodeApi } from '../../api/moduleD.api';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';
import { formatMoney } from '../../utils/format';
import { AmenityCover } from './AmenityListPage';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DEFAULT_ADVANCE_DAYS = 14;

const feeText = (slot) => (slot.fee > 0 ? formatMoney(slot.fee) : slot.usesPass ? 'Miễn phí theo gói' : 'Miễn phí');

// UC-D06 — Chọn ngày (tối đa 14 ngày tới) → lưới slot → xác nhận đặt (tự xác nhận, BR-O12)
export default function AmenityBookingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [search] = useSearchParams();
  const { data: mine = [] } = useApi(() => memberCodeApi.mine(), []);
  const apartmentId = search.get('apartmentId') ?? mine[0]?.apartment._id;

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [picked, setPicked] = useState(null); // slotStart đang chọn
  const [booking, setBooking] = useState(false);

  const { data, loading, error, reload } = useApi(() => amenityApi.slots(id, { date, apartmentId }), [id, date, apartmentId], {
    enabled: Boolean(apartmentId),
  });
  const info = data ?? null;
  const viewer = info?.viewer;
  const slot = info?.slots.find((s) => s.slotStart === picked);
  const advance = info?.rules.advanceDays ?? DEFAULT_ADVANCE_DAYS;
  const days = Array.from({ length: advance + 1 }, (_, i) => dayjs().add(i, 'day'));

  const chargeBlocked = Boolean(slot && slot.fee > 0 && viewer && !viewer.canIncurCharges);
  const blockedReason = viewer?.overdue
    ? 'Căn hộ đang có hóa đơn quá hạn nên chưa thể đặt tiện ích. Vui lòng thanh toán trước.'
    : viewer?.limitReached
      ? `Căn hộ đã có ${viewer.activeCount}/${viewer.maxActive} booking chưa dùng. Hủy hoặc dùng xong mới đặt thêm được.`
      : null;

  const submit = async () => {
    setBooking(true);
    try {
      await bookingApi.create({ apartmentId, amenityId: id, date, slotStart: picked });
      message.success('Đặt tiện ích thành công');
      navigate(`/r/amenities/bookings?apartmentId=${apartmentId}`, { viewTransition: true });
    } catch (e) {
      message.error(e.message);
      if (['BOOKING_SLOT_CONFLICT', 'BOOKING_LIMIT_EXCEEDED', 'BOOKING_APARTMENT_OVERDUE'].includes(e.errorCode)) {
        setPicked(null);
        reload(); // tải lại lưới để thấy chỗ trống mới nhất
      }
    } finally {
      setBooking(false);
    }
  };

  const back = () => navigate(`/r/amenities${apartmentId ? `?apartmentId=${apartmentId}` : ''}`, { viewTransition: true });

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8}>
        <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Quay lại" onClick={back} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          {info?.amenity.name ?? 'Đặt tiện ích'}
        </Typography.Title>
      </Flex>

      {info && <AmenityCover amenity={info.amenity} height={160} style={vtName('amenity-img', id)} />}

      {error?.errorCode === 'AMENITY_NOT_BOOKABLE' || error?.status === 404 ? (
        <Result
          status="info"
          title={error.errorCode === 'AMENITY_NOT_BOOKABLE' ? 'Tiện ích này không cần đặt chỗ' : 'Không tìm thấy tiện ích'}
          extra={<Button onClick={back}>Về danh sách tiện ích</Button>}
        />
      ) : (
        <>
          <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
            <Flex gap={6}>
              {days.map((d) => {
                const value = d.format('YYYY-MM-DD');
                const active = value === date;
                return (
                  <Button
                    key={value}
                    type={active ? 'primary' : 'default'}
                    onClick={() => {
                      setDate(value);
                      setPicked(null);
                    }}
                    style={{ height: 'auto', padding: '6px 10px', flex: '0 0 auto' }}
                  >
                    <Flex vertical align="center" style={{ lineHeight: 1.2 }}>
                      <span style={{ fontSize: 11 }}>{WEEKDAYS[d.day()]}</span>
                      <b>{d.format('DD/MM')}</b>
                    </Flex>
                  </Button>
                );
              })}
            </Flex>
          </div>

          {blockedReason && <Alert type="warning" showIcon message={blockedReason} />}

          <Spin spinning={loading}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8, minHeight: 80 }}>
              {info?.slots.map((s) => {
                const cell = (
                  <Button
                    key={s.slotStart}
                    type={picked === s.slotStart ? 'primary' : 'default'}
                    disabled={!s.available}
                    onClick={() => setPicked(s.slotStart)}
                    style={{ height: 'auto', padding: '8px 6px', width: '100%' }}
                  >
                    <Flex vertical align="center" style={{ lineHeight: 1.3, whiteSpace: 'normal' }}>
                      <b>
                        {s.slotStart}–{s.slotEnd}
                      </b>
                      <span style={{ fontSize: 11 }}>{s.available ? `Còn ${s.remaining}/${s.capacity}` : s.lockMessage}</span>
                      {s.available && <span style={{ fontSize: 11 }}>{feeText(s)}</span>}
                    </Flex>
                  </Button>
                );
                return s.available ? cell : (
                  <Tooltip key={s.slotStart} title={s.lockMessage}>
                    <span>{cell}</span>
                  </Tooltip>
                );
              })}
            </div>
          </Spin>

          {slot && (
            <Card size="small" title="Xác nhận đặt chỗ">
              <Flex vertical gap={6}>
                <Typography.Text>
                  <b>{info.amenity.name}</b> · {dayjs(date).format('DD/MM/YYYY')} · {slot.slotStart}–{slot.slotEnd}
                </Typography.Text>
                <Typography.Text>
                  Phí: <b>{feeText(slot)}</b>
                </Typography.Text>
                {chargeBlocked && (
                  <Alert
                    type="error"
                    showIcon
                    message="Bạn chưa được chủ hộ cho phép phát sinh phí tiện ích"
                    description="Hãy nhờ chủ hộ bật quyền trong mục Gia đình, hoặc chọn khung giờ miễn phí / mua gói tháng."
                  />
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Đặt xong là được xác nhận ngay. Check-in tại lễ tân hoặc bảo vệ từ {info.rules.checkinEarlyMinutes} phút trước giờ bắt đầu (không sớm hơn giờ mở
                  quầy {info.rules.receptionOpen}) đến {info.rules.noShowGraceMinutes} phút sau giờ bắt đầu; quá hạn tính là không đến và không thu phí. Hủy miễn phí
                  trước giờ bắt đầu. Mỗi căn tối đa {info.rules.maxActivePerApartment} booking chưa dùng.
                </Typography.Text>
                <Flex gap={8}>
                  <Button type="primary" loading={booking} disabled={Boolean(blockedReason) || chargeBlocked} onClick={submit}>
                    Xác nhận đặt
                  </Button>
                  <Button onClick={() => setPicked(null)}>Chọn lại</Button>
                </Flex>
              </Flex>
            </Card>
          )}
          {info && !slot && <Typography.Text type="secondary">Chọn khung giờ còn trống để đặt.</Typography.Text>}
        </>
      )}
    </Flex>
  );
}
