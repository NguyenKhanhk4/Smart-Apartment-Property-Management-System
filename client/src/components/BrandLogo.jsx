// Logo SAPMS (biểu tượng tòa nhà nét mảnh, viền vàng champagne).
// Có view-transition-name "brand-logo" → bay giữa trang đăng nhập và sidebar (morph).
export default function BrandLogo({ size = 32 }) {
  const icon = Math.round(size * 0.56);
  return (
    <span
      className="vt-brand-logo inline-flex items-center justify-center shrink-0 rounded-md bg-navy border border-gold/50 text-gold shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 9h1M9 13h1M9 17h1M15 13h1M15 17h1" strokeLinecap="round" />
      </svg>
    </span>
  );
}
