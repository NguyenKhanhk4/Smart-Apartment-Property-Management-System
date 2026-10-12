// Card trắng viền be: bo 14px (mobile) / 16px (web). `as` cho phép dùng làm <a>/<section>...
export default function SurfaceCard({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag className={`bg-white border border-r-border rounded-[14px] md:rounded-2xl ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
