// Card trắng, viền + bóng mềm để tách khỏi nền: bo 14px (mobile) / 16px (web). `as` cho phép dùng làm <a>/<section>...
// Dùng làm link (as={Link}) thì nổi lên khi rê chuột / focus để biết bấm được.
export default function SurfaceCard({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag
      className={`bg-white border border-r-border rounded-[14px] md:rounded-2xl shadow-[0_1px_2px_rgba(20,35,26,0.06),0_2px_10px_rgba(20,35,26,0.05)] ${
        Tag === 'div' || Tag === 'section' ? '' : 'transition-[box-shadow,border-color,transform] hover:shadow-[0_6px_20px_rgba(20,35,26,0.10)] hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-r-navy'
      } ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
