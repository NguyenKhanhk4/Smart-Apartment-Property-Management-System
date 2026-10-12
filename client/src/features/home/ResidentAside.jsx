import { Link } from 'react-router';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { useResident } from '../../hooks/useResident';
import ResidentCard from '../memberCodes/ResidentCard';

function Stat({ label, value }) {
  return (
    <div className="bg-r-bg rounded-xl p-3.5">
      <div className="text-[13px] text-r-muted">{label}</div>
      <div className="text-xl font-semibold">{value ?? '—'}</div>
    </div>
  );
}

const linkClass = 'text-sm font-medium text-r-link no-underline';

// Cột phải trang chủ web: thẻ cư dân thu gọn + card căn hộ
export default function ResidentAside() {
  const { card, apartment, isHead, memberCount, vehicleCount } = useResident();
  if (!card) return null;

  return (
    <aside className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
      <ResidentCard variant="compact" person={card} />

      <SurfaceCard as="section" className="p-5 flex flex-col gap-3.5">
        <div className="flex justify-between items-center">
          <h2 className="m-0 text-base font-semibold">Căn hộ {apartment.code}</h2>
          <Link to="/r/my-apartment" viewTransition className={linkClass}>Quản lý</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Thành viên" value={memberCount} />
          <Stat label="Xe đăng ký" value={vehicleCount} />
        </div>
        <div className="flex gap-4">
          {isHead && <Link to={`/r/my-code/family?apartmentId=${apartment._id}`} viewTransition className={linkClass}>Quản lý gia đình</Link>}
          <Link to="/r/my-vehicles" viewTransition className={linkClass}>Đăng ký xe</Link>
        </div>
      </SurfaceCard>
    </aside>
  );
}
