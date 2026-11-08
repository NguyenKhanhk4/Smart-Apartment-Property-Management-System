import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Empty, Skeleton } from 'antd';
import dayjs from 'dayjs';
import { amenityApi } from '../../api/moduleD.api';
import AmenityIcon from '../../components/resident/AmenityIcon';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatMoney } from '../../utils/format';

const hours = (a) => (a.openTime && a.closeTime ? `${a.openTime}–${a.closeTime}` : null);

// Giá hiển thị trên thẻ
function priceOf(a) {
  if (a.accessMode === 'FREE') return 'Miễn phí';
  return a.feePerBooking > 0 ? `${formatMoney(a.feePerBooking)}/lượt đặt` : 'Miễn phí đặt chỗ';
}

// Dòng trạng thái dưới tên. slotsLeft: số khung giờ còn đặt được hôm nay (chỉ BOOKING); undefined = đang tải, null = lỗi
function noteOf(a, slotsLeft) {
  if (a.accessMode === 'BOOKING') {
    if (slotsLeft === undefined) return 'Đang tải khung giờ…';
    if (slotsLeft === null) return hours(a) ? `Mở ${hours(a)}` : 'Đặt theo khung giờ';
    return slotsLeft > 0 ? `Còn ${slotsLeft} khung giờ hôm nay` : 'Hôm nay đã hết khung giờ';
  }
  return hours(a) ? `Mở ${hours(a)}` : 'Mở cửa tự do';
}

// Tab "Dịch vụ": lưới tiện ích kèm giá. Bấm vào thẻ để xem chi tiết; đặt chỗ thực hiện ở trang chi tiết.
export default function ServicesTab() {
  const { apartmentId } = useResident();
  const { data: amenities = [], loading } = useApi(() => amenityApi.list({ limit: 100, sort: 'name' }), []);

  // Số khung giờ còn trống hôm nay: gọi lưới slot của từng tiện ích BOOKING (lỗi → null, hiện giờ mở cửa thay thế)
  const bookableIds = useMemo(() => amenities.filter((a) => a.accessMode === 'BOOKING').map((a) => a._id), [amenities]);
  const [slotsLeft, setSlotsLeft] = useState({});
  const idsKey = bookableIds.join(',');
  useEffect(() => {
    if (!apartmentId || !bookableIds.length) return undefined;
    let cancelled = false;
    const date = dayjs().format('YYYY-MM-DD');
    Promise.allSettled(bookableIds.map((id) => amenityApi.slots(id, { date, apartmentId }))).then((results) => {
      if (cancelled) return;
      setSlotsLeft(
        Object.fromEntries(
          results.map((r, i) => [bookableIds[i], r.status === 'fulfilled' ? r.value.data.slots.filter((s) => s.available).length : null]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apartmentId, idsKey]);

  if (loading && !amenities.length) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (!amenities.length) return <Empty description="Chưa có dịch vụ" />;

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      {amenities.map((a) => {
        return (
          <SurfaceCard
            as={Link}
            key={a._id}
            to={`/r/amenities/${a._id}${apartmentId ? `?apartmentId=${apartmentId}` : ''}`}
            viewTransition
            className="flex flex-col gap-2.5 md:gap-3.5 p-4 md:p-5 text-r-text! no-underline hover:border-r-navy"
          >
            <div className="flex justify-between items-start">
              <span className="w-10 h-10 md:w-11 md:h-11 rounded-[10px] md:rounded-xl bg-r-ok-bg border border-r-border text-r-navy flex items-center justify-center">
                <AmenityIcon name={a.name} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="text-[15px] md:text-[17px] font-medium md:font-semibold">{a.name}</div>
              <div className="text-[13px] md:text-sm text-r-muted">{noteOf(a, slotsLeft[a._id])}</div>
              <div className="text-[13px] md:text-sm font-medium mt-1">{priceOf(a)}</div>
            </div>
          </SurfaceCard>
        );
      })}
    </div>
  );
}
