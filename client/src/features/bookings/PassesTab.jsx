import { Link } from 'react-router';
import { App, Popconfirm, Skeleton } from 'antd';
import dayjs from 'dayjs';
import { amenityPassApi } from '../../api/moduleD.api';
import ResidentAvatar from '../../components/resident/ResidentAvatar';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatMoney } from '../../utils/format';
import { usePurchasePass } from '../amenityPasses/usePurchasePass';
import { monthLabel, passSpan } from './passUtils';

// Tab "Quản lý": gói tháng đã đăng ký của tôi và của các thành viên trong nhà (chủ hộ thấy cả hộ, thành viên thấy gói của mình).
// Gói tháng là tháng lịch (1 → cuối tháng), không tự gia hạn, mua cho từng thành viên:
//  - "Hết hạn / còn N ngày / thanh tiến độ" tính trên tháng đó; "Gia hạn" = mua gói tháng sau (chỉ chủ hộ)
//  - Đăng ký gói mới thực hiện ở trang chi tiết của từng dịch vụ.
export default function PassesTab({ wide }) {
  const { message } = App.useApp();
  const { apartmentId, card, isHead } = useResident();
  const passes = useApi(() => amenityPassApi.mine({ apartmentId }), [apartmentId], { enabled: Boolean(apartmentId) });
  const purchase = usePurchasePass({ apartmentId, enabled: isHead, onDone: () => passes.reload() });

  const thisMonth = dayjs().format('YYYY-MM');
  const rows = passes.data ?? [];

  // Gom theo thành viên: tôi trước, rồi theo tên
  const groups = [];
  for (const p of rows) {
    if (p.month < thisMonth) continue; // gói đã hết hạn không hiện
    const uid = String(p.userId);
    let g = groups.find((x) => x.userId === uid);
    if (!g) {
      g = { userId: uid, member: p.member, code: p.memberCode, passes: [] };
      groups.push(g);
    }
    g.passes.push(p);
  }
  const mineId = String(card?.userId);
  groups.sort((a, b) => Number(b.userId === mineId) - Number(a.userId === mineId) || (a.member?.fullName ?? '').localeCompare(b.member?.fullName ?? '', 'vi'));

  const hasNext = (p) => rows.some((u) => u.month > thisMonth && String(u.userId) === String(p.userId) && String(u.amenityId) === String(p.amenityId));

  const cancel = async (p) => {
    try {
      await amenityPassApi.cancel(p._id);
      message.success('Đã hủy gói tháng');
    } catch (e) {
      message.error(e.message);
    }
    passes.reload();
  };

  if (passes.loading && !rows.length) return <Skeleton active paragraph={{ rows: 4 }} />;

  const renew = (p) => {
    if (!isHead) return null;
    if (hasNext(p)) return <div className="text-[13px] text-r-ok-fg text-center">Đã gia hạn tháng sau</div>;
    return (
      <button
        type="button"
        disabled={!purchase.info}
        onClick={() => purchase.open({ memberId: String(p.userId), amenityId: String(p.amenityId), month: purchase.info.months[1] })}
        className="h-11 rounded-[10px] border border-r-navy bg-white text-r-navy text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Gia hạn
      </button>
    );
  };

  const currentCard = (p) => {
    const span = passSpan(p.month);
    return (
      <SurfaceCard key={p._id} as="section" className="p-4 md:p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[15px] md:text-base font-semibold truncate">{p.amenity?.name} · gói tháng</h3>
          <StatusBadge tone="ok">Đang dùng</StatusBadge>
        </div>
        <div className="h-2 rounded bg-r-segment overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={span.percent} aria-label="Thời hạn gói đã dùng">
          <div className="h-full bg-r-ok-fg" style={{ width: `${span.percent}%` }} />
        </div>
        <div className="flex justify-between text-[13px] md:text-sm text-r-muted">
          <span>Hết hạn {span.expiry}</span>
          <span>Còn {span.daysLeft} ngày</span>
        </div>
        {renew(p)}
      </SurfaceCard>
    );
  };

  const nextCard = (p) => (
    <SurfaceCard key={p._id} className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-medium truncate">{p.amenity?.name} · tháng {monthLabel(p.month)}</div>
        <div className="text-[13px] text-r-muted">Gói tháng sau · {formatMoney(p.fee)}</div>
      </div>
      {p.canCancel && (
        <Popconfirm
          title="Hủy gói tháng sau?"
          description="Gói chưa bắt đầu nên được hủy miễn phí."
          okText="Hủy gói"
          cancelText="Giữ lại"
          okButtonProps={{ danger: true }}
          onConfirm={() => cancel(p)}
        >
          <button type="button" className="p-0 border-0 bg-transparent text-sm font-medium text-r-link cursor-pointer">Hủy</button>
        </Popconfirm>
      )}
    </SurfaceCard>
  );

  if (!groups.length) {
    return (
      <SurfaceCard className="p-5 md:p-6 flex flex-col gap-3 items-start">
        <div className="text-[15px] font-medium">Chưa có gói tháng nào</div>
        <p className="m-0 text-sm text-r-muted">
          {isHead
            ? 'Mở một dịch vụ có bán gói tháng (sân, phòng tập…) rồi chọn "Đăng ký gói tháng" để đăng ký cho bạn hoặc thành viên trong nhà.'
            : 'Chủ hộ sẽ đăng ký gói tháng cho bạn tại trang chi tiết của dịch vụ.'}
        </p>
        <Link to="/r/amenities?tab=book" viewTransition className="text-sm font-medium text-r-link no-underline">Xem dịch vụ</Link>
      </SurfaceCard>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {groups.map((g) => {
          const isMe = g.userId === mineId;
          const current = g.passes.filter((p) => p.isCurrent);
          const next = g.passes.filter((p) => p.month > thisMonth);
          return (
            <section key={g.userId} className="flex flex-col gap-3" aria-label={g.member?.fullName}>
              <div className="flex items-center gap-3">
                <ResidentAvatar fullName={g.member?.fullName} avatarUrl={g.member?.avatarUrl} size={36} />
                <div className="min-w-0">
                  <h2 className="m-0 text-[15px] md:text-base font-semibold truncate">
                    {isMe ? 'Gói của tôi' : g.member?.fullName}
                  </h2>
                  <div className="text-[13px] text-r-muted truncate">
                    {isMe ? g.member?.fullName : 'Thành viên trong nhà'}
                    {g.code && <span className="font-mono"> · {g.code}</span>}
                  </div>
                </div>
              </div>
              <div className={wide ? 'grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]' : 'flex flex-col gap-3'}>
                {current.map(currentCard)}
                {next.map(nextCard)}
              </div>
            </section>
          );
        })}
      </div>
      {purchase.element}
    </>
  );
}
