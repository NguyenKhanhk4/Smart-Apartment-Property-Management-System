import { givenName } from '../../utils/format';

// Ảnh đại diện tròn; chưa có ảnh thì hiện 2 chữ đầu của tên gọi trên nền info
export default function ResidentAvatar({ fullName, avatarUrl, size = 36, className = '' }) {
  const box = { width: size, height: size };
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" style={box} className={`rounded-full object-cover shrink-0 ${className}`} />;
  }
  return (
    <span
      style={{ ...box, fontSize: Math.round(size * 0.39) }}
      className={`rounded-full shrink-0 flex items-center justify-center bg-r-info-bg text-r-info-fg font-semibold ${className}`}
      aria-hidden="true"
    >
      {givenName(fullName).slice(0, 2)}
    </span>
  );
}
