import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Radio, Result, Skeleton } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, EnvironmentOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi, amenityPassApi, bookingApi } from '../../api/moduleD.api';
import AmenityIcon from '../../components/resident/AmenityIcon';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { AMENITY_ACCESS_MODES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatMoney } from '../../utils/format';
import { usePurchasePass } from '../amenityPasses/usePurchasePass';
import { passSpan } from './passUtils';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DEFAULT_ADVANCE_DAYS = 14;

const slotFee = (slot) => (slot.fee > 0 ? formatMoney(slot.fee) : slot.usesPass ? 'Miễn phí theo gói' : 'Miễn phí');

function Hero({ amenity }) {
  return amenity.imageUrl ? (
    <img src={amenity.imageUrl} alt={amenity.name} className="w-full h-40 md:h-48 object-cover rounded-xl block" />
  ) : (
    <div className="w-full h-28 md:h-36 rounded-xl bg-[#F0ECE4] text-r-navy flex items-center justify-center">
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
  const sellsPass = a.accessMode !== 'FREE' && a.monthlyPassFeeAdult != null;
  return (
    <div>
      {a.accessMode === 'FREE' && <PriceRow label="Sử dụng" value="Miễn phí" />}
      {a.accessMode === 'BOOKING' && (
        <PriceRow
          label="Lẻ lần"
          value={a.feePerBooking > 0 ? `${formatMoney(a.feePerBooking)}/lượt đặt` : 'Miễn phí'}
          hint={a.slotDurationMinutes ? `Mỗi lượt ${a.slotDurationMinutes} phút` : null}
        />
      )}
      {a.accessMode === 'WALK_IN' && (
        <>
          <PriceRow label="Vé lẻ · người lớn" value={a.perVisitFeeAdult > 0 ? `${formatMoney(a.perVisitFeeAdult)}/lượt` : 'Miễn phí'} />
          <PriceRow label="Vé lẻ · trẻ em" value={a.perVisitFeeChild > 0 ? `${formatMoney(a.perVisitFeeChild)}/lượt` : 'Miễn phí'} hint="Trẻ nhỏ được miễn phí" />
        </>
      )}
      {sellsPass && (
        <>
          <PriceRow label="Gói tháng · người lớn" value={`${formatMoney(a.monthlyPassFeeAdult)}/tháng`} />
          <PriceRow label="Gói tháng · trẻ em" value={`${formatMoney(a.monthlyPassFeeChild)}/tháng`} />
        </>
      )}
    </div>
  );
}

const chipBase = 'border-0 cursor-pointer rounded-[10px] text-sm';

/** Đặt chỗ theo khung giờ (chỉ tiện ích BOOKING): chọn ngày → chọn giờ → xác nhận (tự xác nhận, BR-O12) */
function BookingPanel({ amenity, apartmentId, hasPass, sellsPass, refreshKey }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [picked, setPicked] = useState(null); // slotStart đang chọn
  const [booking, setBooking] = useState(false);
  const [payMode, setPayMode] = useState('invoice'); // 'now' đang khóa: chưa có module thanh toán

  const { data: info, loading, reload } = useApi(
    () => amenityApi.slots(amenity._id, { date, apartmentId }),
    [amenity._id, date, apartmentId, refreshKey],
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
      await bookingApi.create({ apartmentId, amenityId: amenity._id, date, slotStart: picked });
      message.success('Đặt chỗ thành công');
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
        <h2 className="m-0 text-base md:text-[17px] font-semibold">Đặt chỗ</h2>
        <p className="mt-1 mb-0 text-[13px] md:text-sm text-r-muted">
          {hasPass
            ? 'Bạn đã có gói tháng: chỉ cần chọn giờ, không mất phí lượt đặt.'
            : sellsPass
              ? 'Chọn giờ để đặt lẻ từng lượt, hoặc đăng ký gói tháng để đặt không mất phí lượt.'
              : 'Chọn ngày và khung giờ còn trống.'}
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
            <b>{amenity.name}</b> · {dayjs(date).format('DD/MM/YYYY')} · {slot.slotStart}–{slot.slotEnd}
          </div>

          {slot.usesPass && <div className="px-3.5 py-3 rounded-xl bg-r-ok-bg text-r-ok-fg text-sm">Miễn phí theo gói tháng của bạn.</div>}
          {!slot.usesPass && slot.fee === 0 && (
            <div className="text-sm">
              Phí: <b>Miễn phí</b>
            </div>
          )}
          {!slot.usesPass && slot.fee > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="text-sm">
                Phí lượt đặt: <b>{formatMoney(slot.fee)}</b>
              </div>
              <Radio.Group value={payMode} onChange={(e) => setPayMode(e.target.value)} className="flex! flex-col gap-2">
                <Radio value="invoice">Cộng vào hóa đơn cuối tháng</Radio>
                <Radio value="now" disabled>
                  Thanh toán ngay <span className="text-xs text-r-muted">· Sắp có</span>
                </Radio>
              </Radio.Group>
              <div className="px-3.5 py-3 rounded-xl bg-r-warn-bg text-r-warn-fg text-[13px] leading-normal">
                Phí {formatMoney(slot.fee)} sẽ được cộng vào hóa đơn cuối tháng của căn hộ.
              </div>
            </div>
          )}

          {chargeBlocked && (
            <Alert
              type="error"
              showIcon
              title="Bạn chưa được chủ hộ cho phép phát sinh phí tiện ích"
              description="Hãy nhờ chủ hộ bật quyền trong mục Căn hộ và gia đình, hoặc chọn khung giờ miễn phí / dùng gói tháng."
            />
          )}

          <p className="m-0 text-xs text-r-muted leading-normal">
            Đặt xong là được xác nhận ngay. Check-in tại lễ tân hoặc bảo vệ từ {info.rules.checkinEarlyMinutes} phút trước giờ bắt đầu (không sớm hơn giờ mở
            quầy {info.rules.receptionOpen}) đến {info.rules.noShowGraceMinutes} phút sau giờ bắt đầu; quá hạn tính là không đến và không thu phí. Hủy miễn phí
            trước giờ bắt đầu. Mỗi căn tối đa {info.rules.maxActivePerApartment} booking chưa dùng.
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

// Chi tiết dịch vụ (UC-D05/D06/D09): thông tin, bảng giá, gói tháng; tiện ích BOOKING có thêm phần đặt chỗ theo giờ.
export default function AmenityBookingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { cards, card, apartmentId, setApartmentId, isHead, code } = useResident();

  // Link có ?apartmentId= → chọn đúng căn
  const wanted = search.get('apartmentId');
  useEffect(() => {
    if (wanted && wanted !== apartmentId && cards.some((c) => c.apartment._id === wanted)) setApartmentId(wanted);
  }, [wanted, apartmentId, cards, setApartmentId]);

  const amenity = useApi(() => amenityApi.get(id), [id]);
  const a = amenity.data;
  const myPasses = useApi(() => amenityPassApi.mine({ apartmentId }), [apartmentId], { enabled: Boolean(apartmentId) });

  const sellsPass = Boolean(a && a.accessMode !== 'FREE' && a.monthlyPassFeeAdult != null);
  const purchase = usePurchasePass({ apartmentId, enabled: isHead && sellsPass, onDone: () => myPasses.reload() });

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

  const passes = (myPasses.data ?? []).filter((p) => p.status === 'ACTIVE' && String(p.amenityId) === String(a._id));
  const mine = passes.filter((p) => String(p.userId) === String(card?.userId));
  const myCurrent = mine.find((p) => p.isCurrent);
  const others = passes.filter((p) => p.isCurrent && String(p.userId) !== String(card?.userId));
  const mode = AMENITY_ACCESS_MODES[a.accessMode];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={back} aria-label="Quay lại" className="w-11 h-11 -ml-2.5 border-0 bg-transparent text-r-text text-base cursor-pointer">
          <ArrowLeftOutlined />
        </button>
        <h1 className="m-0 text-xl md:text-[28px] font-semibold">{a.name}</h1>
      </div>

      <div className="flex flex-wrap gap-4 md:gap-6 items-start">
        <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
          <SurfaceCard as="section" className="p-4 md:p-5 flex flex-col gap-3.5">
            <Hero amenity={a} />
            <div className="flex items-center gap-2">
              <StatusBadge tone={a.accessMode === 'BOOKING' ? 'info' : a.accessMode === 'WALK_IN' ? 'warn' : 'ok'}>{mode?.label ?? a.accessMode}</StatusBadge>
            </div>
            {a.location && <InfoLine icon={<EnvironmentOutlined />}>{a.location}</InfoLine>}
            <InfoLine icon={<ClockCircleOutlined />}>{a.openTime && a.closeTime ? `Mở cửa ${a.openTime}–${a.closeTime}` : 'Mở cửa tự do'}</InfoLine>
            {a.description && <p className="m-0 text-sm text-r-text leading-relaxed">{a.description}</p>}
            {a.accessMode === 'WALK_IN' && (
              <div className="px-3.5 py-3 rounded-xl bg-r-info-bg text-r-info-fg text-[13px] leading-normal">
                Không cần đặt trước. Đến quầy lễ tân, đọc mã cư dân{code ? ` ${code}` : ''} để vào bằng gói tháng hoặc vé lẻ.
              </div>
            )}
            {a.accessMode === 'FREE' && (
              <div className="px-3.5 py-3 rounded-xl bg-r-ok-bg text-r-ok-fg text-[13px]">Không cần đặt, bạn có thể đến sử dụng trong giờ mở cửa.</div>
            )}
          </SurfaceCard>

          <SurfaceCard as="section" className="px-4 md:px-5 py-2 md:py-3" aria-label="Bảng giá">
            <h2 className="m-0 pt-2 text-[15px] font-semibold">Bảng giá</h2>
            <PriceTable a={a} />
          </SurfaceCard>

          {sellsPass && (
            <SurfaceCard as="section" className="p-4 md:p-5 flex flex-col gap-3" aria-label="Gói tháng">
              <h2 className="m-0 text-[15px] font-semibold">Gói tháng</h2>
              {myCurrent ? (
                <div className="px-3.5 py-3 rounded-xl bg-r-ok-bg text-r-ok-fg text-sm leading-normal">
                  Bạn đang có gói tháng, hết hạn {passSpan(myCurrent.month).expiry} (còn {passSpan(myCurrent.month).daysLeft} ngày).
                  {a.accessMode === 'BOOKING' && ' Chỉ cần chọn giờ để đặt chỗ.'}
                </div>
              ) : (
                <p className="m-0 text-sm text-r-muted">Bạn chưa có gói tháng của dịch vụ này.</p>
              )}
              {others.length > 0 && (
                <p className="m-0 text-[13px] text-r-muted">
                  Đã có gói:{' '}
                  {others
                    .map((p) => p.member?.fullName)
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {isHead ? (
                <button
                  type="button"
                  disabled={!purchase.info}
                  onClick={() => purchase.open({ memberId: String(card.userId), amenityId: String(a._id) })}
                  className="h-11 rounded-[10px] border-0 bg-r-navy text-white text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Đăng ký gói tháng
                </button>
              ) : (
                !myCurrent && <p className="m-0 text-[13px] text-r-muted">Chủ hộ đăng ký gói tháng cho bạn.</p>
              )}
            </SurfaceCard>
          )}
        </div>

        {a.accessMode === 'BOOKING' && (
          <div className="flex-[2_1_480px] min-w-0">
            <BookingPanel amenity={a} apartmentId={apartmentId} hasPass={Boolean(myCurrent)} sellsPass={sellsPass} refreshKey={passes.length} />
          </div>
        )}
      </div>
      {purchase.element}
    </div>
  );
}
