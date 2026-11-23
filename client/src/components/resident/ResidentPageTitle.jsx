/**
 * Tiêu đề trang khu cư dân (máy tính và điện thoại): tiêu đề 20px + mô tả ngắn + nút hành động bên phải, cách nội dung 20px.
 * @example <ResidentPageTitle title="Phản ánh" subtitle="Báo sự cố, theo dõi xử lý" extra={<Button>Gửi phản ánh</Button>} />
 */
export default function ResidentPageTitle({ title, subtitle, extra }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 mb-0 text-[13.5px] text-r-muted max-w-[80ch]">{subtitle}</p>}
      </div>
      {extra && <div className="flex items-center gap-2 shrink-0">{extra}</div>}
    </div>
  );
}
