// Icon tiện ích: Amenity không có field icon nên đoán theo từ khóa trong tên (đường nét lấy từ bản thiết kế)
const PATHS = {
  pool: 'M2 19c2 0 2-1.5 4-1.5S8 19 10 19s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 15V5a2 2 0 0 1 4 0M16 15V5a2 2 0 0 0-4 0M8 9h8M8 12h8',
  gym: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  court: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8',
  bbq: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 3 2 0-2-1-4 0-6z',
  room: 'M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6',
  other: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
};

const RULES = [
  [/\b(boi|ho boi|pool)\b/, 'pool'],
  [/(gym|the hinh|fitness|yoga)/, 'gym'],
  [/(tennis|cau long|bong|san )/, 'court'],
  [/(bbq|nuong)/, 'bbq'],
  [/(sinh hoat|phong|hoi truong|cafe)/, 'room'],
];

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

export default function AmenityIcon({ name, size = 22 }) {
  const text = plain(name);
  const key = RULES.find(([re]) => re.test(text))?.[1] ?? 'other';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[key]} />
    </svg>
  );
}
