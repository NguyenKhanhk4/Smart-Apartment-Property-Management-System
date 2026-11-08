import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Result, Skeleton } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, EnvironmentOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi, bookingApi } from '../../api/moduleD.api';
import AmenityIcon from '../../components/resident/AmenityIcon';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { AMENITY_ACCESS_MODES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatDate, formatMoney } from '../../utils/format';
import { holdLabel } from './bookingHelpers';
import { payBooking } from './payBooking';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DEFAULT_ADVANCE_DAYS = 14;

const slotFee = (slot) => (slot.fee > 0 ? formatMoney(slot.fee) : 'Miễn phí');

function Hero({ amenity }) {
  return amenity.imageUrl ? (
    <img src={amenity.imageUrl} alt={amenity.name} className="w-full h-40 md:h-48 object-cover rounded-xl block" />
  ) : (
    <div className="w-full h-28 md:h-36 rounded-xl bg-r-ok-bg border border-r-border text-r-navy flex items-center justify-center">
      <AmenityIcon name={amenity.name} size={44} />
    </div>
  );
}

function InfoLine({ icon, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-r-muted">
      <span className="text-base leading-snug text-r-navy">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function PriceRow({ label, value, hint }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-2.5 border-b border-r-divider last:border-b-0">
      <span className="text-sm text-r-muted">{label}</span>
      <span className="text-sm font-semibold text-right">
        {value}
        {hint && <span className="block text-xs font-normal text-r-muted">{hint}</span>}
      </span>
    </div>
  );
}

/** Bảng giá theo kiểu tiện ích */
function PriceTable({ a }) {
  return (
    <div>
      {a.accessMode === 'FREE' && <PriceRow label="Sử dụng" value="Miễn phí" />}
      {a.accessMode === 'BOOKING' && (
        <PriceRow
          label="Phí đặt chỗ"
          value={a.feePerBooking > 0 ? `${formatMoney(a.feePerBooking)}/lượt đặt` : 'Miễn phí'}
          hint={a.slotDurationMinutes ? `Mỗi lượt ${a.slotDurationMinutes} phút` : null}
        />
      )}
    </div>
  );
}

const chipBase = 'border-0 cursor-pointer rounded-[10px] text-sm';

/** Đặt chỗ theo khung giờ (chỉ tiện ích BOOKING): chọn ngày → chọn giờ → xác nhận (tự xác nhận, BR-O12) */
function BookingPanel({ amenity, apartmentId }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [picked, setPicked] = useState(null); // slotStart đang chọn
  const [booking, setBooking] = useState(false);
  const [payMethod, setPayMethod] = useState(null); // tiện ích có phí: ONLINE (trả ngay) | INVOICE (cộng phí tháng)

  const { data: info, loading, reload } = useApi(
    () => amenityApi.slots(amenity._id, { date, apartmentId }),
    [amenity._id, date, apartmentId],
    { enabled: Boolean(apartmentId) },
  );
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
      const options = info?.rules.paymentOptions ?? ['INVOICE'];
      const method = slot?.fee > 0 ? (payMethod && options.includes(payMethod) ? payMethod : options[0]) : undefined;
      const { data: booking } = await bookingApi.create({ apartmentId, amenityId: amenity._id, date, slotStart: picked, ...(method && { paymentMethod: method }) });
      // Tiện ích có phí: giữ chỗ chờ thanh toán → sang payOS ngay; lỗi thì vẫn thanh toán lại được từ Lịch sử đặt
      if (booking?.status === 'PENDING_PAYMENT') {
        message.warning(`${holdLabel(booking.holdExpiresAt)}. Đang chuyển sang trang thanh toán…`, 6);
        try {
          await payBooking(booking._id);
          return;
        } catch (e) {
          message.error(e.message);
        }
      } else message.success(booking?.paymentMethod === 'INVOICE' ? `Đặt chỗ thành công. Phí ${formatMoney(booking.fee)} sẽ cộng vào phí dịch vụ tháng.` : 'Đặt chỗ thành công');
      navigate(`/r/amenities?tab=history&apartmentId=${apartmentId}`, { viewTransition: true });
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

  return (
    <SurfaceCard as="section" className="p-4 md:p-6 flex flex-col gap-4" aria-label="Đặt chỗ">
      <div>
        <h2 className="m-0 text-base md:text-[15px] font-semibold">Đặt chỗ</h2>
        <p className="mt-1 mb-0 text-[13px] md:text-sm text-r-muted">
          Chọn ngày và khung giờ còn trống.
        </p>
      </div>

      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-1.5" role="group" aria-label="Chọn ngày">
          {days.map((d) => {
            const value = d.format('YYYY-MM-DD');
            const active = value === date;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setDate(value);
                  setPicked(null);
                }}
                className={`${chipBase} shrink-0 px-3 py-1.5 flex flex-col items-center leading-tight ${active ? 'bg-r-navy text-white' : 'bg-r-bg text-r-text'}`}
              >
                <span className="text-[11px]">{WEEKDAYS[d.day()]}</span>
                <b className="font-semibold">{d.format('DD/MM')}</b>
              </button>
            );
          })}
        </div>
      </div>

      {blockedReason && <Alert type="warning" showIcon title={blockedReason} />}

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(112px,1fr))] min-h-20">
        {loading && !info && <Skeleton active paragraph={{ rows: 2 }} title={false} />}
        {info?.slots.map((s) => {
          const selected = picked === s.slotStart;
          return (
            <button
              key={s.slotStart}
              type="button"
              disabled={!s.available}
              title={s.available ? undefined : s.lockMessage}
              aria-pressed={selected}
              onClick={() => setPicked(s.slotStart)}
              className={`${chipBase} px-1.5 py-2 flex flex-col items-center leading-snug whitespace-normal disabled:cursor-not-allowed ${
                selected ? 'bg-r-navy text-white' : s.available ? 'bg-r-bg text-r-text hover:bg-r-segment' : 'bg-r-neutral-bg text-r-subtle opacity-70'
              }`}
            >
              <b className="font-semibold">
                {s.slotStart}–{s.slotEnd}
              </b>
              <span className="text-[11px]">{s.available ? `Còn ${s.remaining}/${s.capacity}` : s.lockMessage}</span>
              {s.available && <span className="text-[11px]">{slotFee(s)}</span>}
            </button>
          );
        })}
      </div>

      {slot ? (
        <div className="flex flex-col gap-3 border-t border-r-divider pt-4">
          <div className="text-sm">
            <b>{amenity.name}</b> · {formatDate(date)} · {slot.slotStart}–{slot.slotEnd}
          </div>

          {slot.fee === 0 && (
            <div className="text-sm">
              Phí: <b>Miễn phí</b>
            </div>
          )}
          {slot.fee > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="text-sm">
                Phí lượt đặt: <b>{formatMoney(slot.fee)}</b>
              </div>
              {/* Cư dân chọn cách trả: thanh toán ngay (payOS) hoặc cộng vào phí dịch vụ tháng */}
              <div className="text-[13px] font-medium">Cách thanh toán</div>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cách thanh toán">
                {(info.rules.paymentOptions ?? ['INVOICE']).map((m) => {
                  const options = info.rules.paymentOptions ?? ['INVOICE'];
                  const active = (payMethod && options.includes(payMethod) ? payMethod : options[0]) === m;
                  const online = m === 'ONLINE';
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPayMethod(m)}
                      className={`text-left cursor-pointer rounded-xl border px-3.5 py-3 transition-colors ${
                        active ? 'border-r-navy bg-r-ok-bg ring-2 ring-r-navy/15' : 'border-r-border bg-white hover:border-r-border-control'
                      }`}
                    >
                      <span className={`block text-[14px] font-semibold ${active ? 'text-r-navy' : 'text-r-text'}`}>
                        {online ? 'Thanh toán ngay' : 'Cộng vào phí tháng'}
                      </span>
                      <span className="block text-[12.5px] text-r-muted leading-snug">
                        {online
                          ? `Quét QR / chuyển khoản qua payOS. Giữ chỗ ${info.rules.holdMinutes} phút, quá hạn chưa trả thì tự hủy.`
                          : `Xác nhận chỗ ngay, ${formatMoney(slot.fee)} cộng vào thông báo phí dịch vụ của căn hộ.`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!info.rules.payOnline && (
                <div className="text-[12.5px] text-r-subtle">Thanh toán online đang tạm ngưng, phí sẽ cộng vào phí dịch vụ tháng.</div>
              )}
            </div>
          )}

          {chargeBlocked && (
            <Alert
              type="error"
              showIcon
              title="Bạn chưa được chủ hộ cho phép phát sinh phí tiện ích"
              description="Hãy nhờ chủ hộ bật quyền trong mục Căn hộ và gia đình, hoặc chọn khung giờ miễn phí."
            />
          )}

          <p className="m-0 text-xs text-r-muted leading-normal">
            Đặt xong là được xác nhận ngay. Check-in tại lễ tân hoặc bảo vệ từ {info.rules.checkinEarlyMinutes} phút trước giờ bắt đầu (không sớm hơn giờ mở
            quầy {info.rules.receptionOpen}) đến {info.rules.noShowGraceMinutes} phút sau giờ bắt đầu.{' '}
            {amenity.feePerBooking > 0
              ? `Tiện ích có phí: chọn thanh toán ngay hoặc cộng vào phí dịch vụ tháng, hủy không hoàn tiền, được đổi giờ 1 lần trước giờ sử dụng ít nhất ${amenity.changeDeadlineHours ?? 24} giờ.`
              : 'Hủy hoặc đổi giờ miễn phí trước giờ bắt đầu.'}{' '}
            Mỗi căn tối đa {info.rules.maxActivePerApartment} booking chưa dùng.
          </p>

          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={booking || Boolean(blockedReason) || chargeBlocked}
              onClick={submit}
              className="h-11 px-6 rounded-[10px] border-0 bg-r-navy text-white text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {booking ? 'Đang đặt…' : 'Xác nhận đặt'}
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="h-11 px-5 rounded-[10px] border border-r-border-control bg-white text-r-text text-sm font-medium cursor-pointer"
            >
              Chọn lại
            </button>
          </div>
        </div>
      ) : (
        info && <p className="m-0 text-[13px] text-r-muted">Chọn khung giờ còn trống để đặt.</p>
      )}
    </SurfaceCard>
  );
}

// Chi tiết dịch vụ (UC-D05/D06): thông tin, bảng giá; tiện ích BOOKING có thêm phần đặt chỗ theo giờ.
export default function AmenityBookingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { cards, apartmentId, setApartmentId } = useResident();

  // Link có ?apartmentId= → chọn đúng căn
  const wanted = search.get('apartmentId');
  useEffect(() => {
    if (wanted && wanted !== apartmentId && cards.some((c) => c.apartment._id === wanted)) setApartmentId(wanted);
  }, [wanted, apartmentId, cards, setApartmentId]);

  const amenity = useApi(() => amenityApi.get(id), [id]);
  const a = amenity.data;

  const back = () => navigate(`/r/amenities${apartmentId ? `?apartmentId=${apartmentId}` : ''}`, { viewTransition: true });

  if (amenity.error?.status === 404) {
    return (
      <Result
        status="info"
        title="Không tìm thấy dịch vụ"
        extra={
          <button type="button" onClick={back} className="h-10 px-5 rounded-[10px] border border-r-border-control bg-white cursor-pointer">
            Về danh sách dịch vụ
          </button>
        }
      />
    );
  }
  if (!a) return <Skeleton active paragraph={{ rows: 6 }} />;

  const mode = AMENITY_ACCESS_MODES[a.accessMode];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={back} aria-label="Quay lại" className="w-11 h-11 -ml-2.5 border-0 bg-transparent text-r-text text-base cursor-pointer">
          <ArrowLeftOutlined />
        </button>
        <h1 className="m-0 text-[clamp(18px,1.6vw,21px)] font-semibold">{a.name}</h1>
      </div>

      <div className="flex flex-wrap gap-4 md:gap-6 items-start">
        <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
          <SurfaceCard as="section" className="p-4 md:p-5 flex flex-col gap-3.5">
            <Hero amenity={a} />
            <div className="flex items-center gap-2">
              <StatusBadge tone={a.accessMode === 'BOOKING' ? 'info' : 'ok'}>{mode?.label ?? a.accessMode}</StatusBadge>
            </div>
            {a.location && <InfoLine icon={<EnvironmentOutlined />}>{a.location}</InfoLine>}
            <InfoLine icon={<ClockCircleOutlined />}>{a.openTime && a.closeTime ? `Mở cửa ${a.openTime}–${a.closeTime}` : 'Mở cửa tự do'}</InfoLine>
            {a.description && <p className="m-0 text-sm text-r-text leading-relaxed">{a.description}</p>}
            {a.accessMode === 'FREE' && (
              <div className="px-3.5 py-3 rounded-xl bg-r-ok-bg text-r-ok-fg text-[13px]">Không cần đặt, bạn có thể đến sử dụng trong giờ mở cửa.</div>
            )}
          </SurfaceCard>

          <SurfaceCard as="section" className="px-4 md:px-5 py-2 md:py-3" aria-label="Bảng giá">
            <h2 className="m-0 pt-2 text-[14px] font-semibold">Bảng giá</h2>
            <PriceTable a={a} />
          </SurfaceCard>
        </div>

        {a.accessMode === 'BOOKING' && (
          <div className="flex-[2_1_480px] min-w-0">
            <BookingPanel amenity={a} apartmentId={apartmentId} />
          </div>
        )}
      </div>
    </div>
  );
}
