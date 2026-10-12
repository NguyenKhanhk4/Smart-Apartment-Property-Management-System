import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { Empty } from 'antd';
import SegmentedTabs from '../../components/resident/SegmentedTabs';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useResident } from '../../hooks/useResident';
import ServicesTab from './ServicesTab';
import HistoryTab from './HistoryTab';
import PassesTab from './PassesTab';

const TABS = [
  { value: 'book', label: 'Dịch vụ' },
  { value: 'plan', label: 'Quản lý' },
  { value: 'history', label: 'Lịch sử đặt' },
];

// Trang Tiện ích (UC-D05/D06/D09) gồm 3 tab: Dịch vụ · Quản lý (gói tháng của cả nhà) · Lịch sử đặt. Tab nằm trên URL (?tab=)
// nên link cũ (/amenities/bookings, /my-code/passes) chỉ cần chuyển hướng về đây.
export default function UtilitiesPage() {
  const wide = useMediaQuery('(min-width: 768px)');
  const [search, setSearch] = useSearchParams();
  const { cards, card, apartmentId, setApartmentId, loading } = useResident();

  const tab = TABS.some((t) => t.value === search.get('tab')) ? search.get('tab') : 'book';
  const setTab = (value) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', value);
        return next;
      },
      { replace: true },
    );

  // Link có ?apartmentId= (từ thông báo, trang đặt chỗ) → chọn đúng căn
  const wanted = search.get('apartmentId');
  useEffect(() => {
    if (wanted && wanted !== apartmentId && cards.some((c) => c.apartment._id === wanted)) setApartmentId(wanted);
  }, [wanted, apartmentId, cards, setApartmentId]);

  const tabs = <SegmentedTabs label="Tiện ích" options={TABS} value={tab} onChange={setTab} className={wide ? '' : 'mb-5'} />;

  return (
    <div className="flex flex-col gap-6">
      {wide ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[28px] font-semibold">Tiện ích</h1>
            <p className="mt-1 mb-0 text-[15px] text-r-muted">Xem dịch vụ, quản lý gói tháng và lịch sử đặt ở một nơi</p>
          </div>
          {tabs}
        </div>
      ) : (
        tabs
      )}

      {!loading && !card ? (
        <Empty description="Tài khoản chưa có quyền sử dụng tiện ích trong căn hộ nào. Liên hệ Lễ tân để được hỗ trợ." />
      ) : (
        <div role="tabpanel" aria-labelledby={`tab-${tab}`} className={wide ? '' : '-mt-1'}>
          {/* key theo căn: đổi căn thì các tab khởi tạo lại (trang, bộ lọc) */}
          {tab === 'book' && <ServicesTab key={apartmentId} />}
          {tab === 'history' && <HistoryTab key={apartmentId} wide={wide} />}
          {tab === 'plan' && <PassesTab key={apartmentId} wide={wide} />}
        </div>
      )}
    </div>
  );
}
