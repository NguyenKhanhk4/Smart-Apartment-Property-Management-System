import { CopyOutlined, UserOutlined } from '@ant-design/icons';
import StatusBadge from '../../components/resident/StatusBadge';
import { useCopy } from '../../hooks/useCopy';

function Photo({ person, size }) {
  const style = { width: size, height: size };
  return person.avatarUrl ? (
    <img src={person.avatarUrl} alt={`Ảnh đại diện của ${person.fullName}`} style={style} className="rounded-full object-cover shrink-0" />
  ) : (
    <span style={{ ...style, fontSize: size / 2 }} className="rounded-full shrink-0 flex items-center justify-center bg-[#8D93A0] text-white" aria-hidden="true">
      <UserOutlined />
    </span>
  );
}

const apartmentText = (a) => (a ? `Căn ${a.code}${a.building?.name ? ` · ${a.building.name}` : ''}` : '');

/**
 * Thẻ cư dân (UC-D11) — KHÔNG phải QR: mã chữ để đọc cho lễ tân/bảo vệ đối chiếu với ảnh đại diện.
 *   person: { fullName, avatarUrl, code, isHead, apartment }
 *   variant "full" (trang Mã của tôi) | "compact" (cột phải trang chủ web)
 */
export default function ResidentCard({ person, variant = 'full' }) {
  const { copied, copy } = useCopy();
  const role = person.isHead ? <StatusBadge tone="warn" square>Chủ hộ</StatusBadge> : <StatusBadge tone="neutral" square>Thành viên</StatusBadge>;

  if (variant === 'compact') {
    return (
      <section aria-label="Mã của tôi" className="bg-white border border-r-border rounded-2xl overflow-hidden">
        <div className="bg-r-navy text-white px-5 py-3 flex justify-between items-center text-[13px]">
          <span className="font-semibold tracking-[0.04em]">THẺ CƯ DÂN</span>
          <span className="text-[#D5DAE5]">SAPMS</span>
        </div>
        <div className="p-5 flex gap-4 items-center">
          <Photo person={person} size={72} />
          <div className="min-w-0">
            <div className="text-base font-semibold truncate">{person.fullName}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {role}
              <span className="text-[13px] text-r-muted">{apartmentText(person.apartment)}</span>
            </div>
          </div>
        </div>
        <div className="mx-5 mb-4 px-4 py-3 bg-r-bg rounded-xl flex items-center justify-between gap-2">
          <span className="font-mono text-[26px] font-semibold tracking-[0.06em]">{person.code}</span>
          <button
            type="button"
            onClick={() => copy(person.code)}
            aria-label="Sao chép mã"
            className="h-10 px-3 rounded-[10px] border border-r-border-control bg-white text-r-link text-[13px] font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <CopyOutlined />
            {copied ? 'Đã sao chép' : 'Sao chép'}
          </button>
        </div>
        <p className="m-0 px-5 pb-5 text-[13px] leading-normal text-r-muted">
          Đọc mã này cho lễ tân hoặc bảo vệ khi vào tiện ích. Nhân viên sẽ đối chiếu ảnh đại diện với người đến.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Thẻ cư dân" className="bg-white border border-r-border rounded-[20px] overflow-hidden">
      <div className="bg-r-navy text-white px-5 py-3.5 flex justify-between items-center text-[13px]">
        <span className="font-semibold tracking-[0.06em]">THẺ CƯ DÂN</span>
        <span className="text-[#D5DAE5]">SAPMS</span>
      </div>
      <div className="pt-7 px-5 pb-6 flex flex-col items-center gap-2 text-center">
        <div className="rounded-full border-4 border-white outline outline-1 outline-r-border">
          <Photo person={person} size={104} />
        </div>
        <div className="text-xl font-semibold mt-2">{person.fullName}</div>
        {role}
        <div className="text-sm text-r-muted">{apartmentText(person.apartment)}</div>
      </div>
      <div className="mx-5 mb-5 p-4 bg-r-bg rounded-[14px] flex flex-col items-center gap-3">
        <div className="text-xs text-r-muted tracking-[0.04em]">MÃ CƯ DÂN</div>
        <div className="font-mono text-[40px] font-semibold tracking-[0.08em] leading-none max-w-full break-all text-center">{person.code}</div>
        <button
          type="button"
          onClick={() => copy(person.code)}
          aria-label={`Sao chép mã ${person.code}`}
          className="h-11 px-[18px] rounded-[10px] border border-r-border-control bg-white text-r-link text-sm font-medium flex items-center gap-2 cursor-pointer"
        >
          <CopyOutlined />
          {copied ? 'Đã sao chép' : 'Sao chép mã'}
        </button>
      </div>
    </section>
  );
}
