// Logo SAPMS: khối vuông bo góc nền gradient (xanh dương ở khu quản lý, xanh lá trong .theme-resident — biến
// --logo-from / --logo-to ở index.css), biểu tượng 2 tòa nhà nét trắng, cửa sổ trắng mờ.
// Có view-transition-name "brand-logo" → bay giữa trang đăng nhập và sidebar / header (morph).
export default function BrandLogo({ size = 32 }) {
  const icon = Math.round(size * 0.6);
  return (
    <span
      className="vt-brand-logo inline-flex items-center justify-center shrink-0 text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'linear-gradient(140deg, var(--logo-from), var(--logo-to))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 2px rgba(0,0,0,0.18)',
      }}
      aria-hidden="true"
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M5.5 21V6.8L12.5 3v18" />
        <path d="M12.5 21V9.5l6 2.6V21" />
        <path d="M8.5 8.5h1.5M8.5 12h1.5M8.5 15.5h1.5M15 14.5h1M15 17.5h1" strokeOpacity="0.7" />
      </svg>
    </span>
  );
}
