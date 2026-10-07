/**
 * @file tokens.js
 * @description Design tokens phong cách LUXURY "Midnight & Champagne" cho SAPMS.
 * Tinh thần: Sảnh khách sạn 5 sao / Tòa nhà hạng A — sang trọng, tiết chế, dễ đọc.
 * Màu vàng champagne (#C9A35B) chỉ là điểm nhấn ≤ 10% diện tích; phần lớn giao diện là nền ngà + chữ đậm.
 */

export const colors = {
  // Midnight (Đêm sâu thẳm - Sảnh hạng A)
  midnight: '#0F1B2D',
  midnightHover: '#162842',
  midnightLight: 'rgba(15, 27, 45, 0.06)',

  // Primary (Xanh biển thẫm quý phái)
  primary: '#1E3A5F',
  primaryHover: '#17304F',
  primaryActive: '#12263F',
  primaryBg: '#E8EEF5',
  primaryBorder: '#C2D3E8',

  // Champagne Gold (Điểm nhấn hoàng gia ≤ 10%)
  gold: '#C9A35B',
  goldHover: '#B89248',
  goldBg: '#F6EEDD',
  goldBorder: '#E6D7BD',
  goldText: '#8A6A2E', // Dùng khi CẦN chữ vàng trên nền sáng để đạt độ tương phản WCAG AA

  // Ink (Hệ chữ)
  ink: '#1A1F2B',
  inkSecondary: '#5E6675',
  inkMuted: '#8C93A0',
  inkInverse: '#FFFFFF',

  // Bề mặt & Viền (Trắng ngà ấm & đá cẩm thạch)
  bg: '#FAF8F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F0EA', // Header bảng, hàng hover, khối phụ
  border: '#E8E2D6',
  borderStrong: '#D6CEBF',
  divider: '#EFEBE2',

  // Bảng dữ liệu
  tableHeaderBg: '#F3F0EA',
  tableRowHover: '#F7F5F0',

  // Trạng thái ngữ nghĩa (kèm nền nhạt ~8%)
  success: '#2E7D5B',
  successLight: '#EBF5F0',
  successBorder: '#BDE3D1',

  warning: '#B45309',
  warningLight: '#FBF2E9',
  warningBorder: '#F5DCBE',

  error: '#B42318',
  errorLight: '#FBEEEE',
  errorBorder: '#F5BDB9',

  info: '#1D5FA8',
  infoLight: '#EBF2FA',
  infoBorder: '#BAD2EE',

  // Sidebar Midnight Luxury
  sidebarBg: '#0F1B2D',
  sidebarText: '#C8D1DE',
  sidebarTextActive: '#FFFFFF',
  sidebarActiveBg: 'rgba(201, 163, 91, 0.12)',
  sidebarIndicator: '#C9A35B',
  sidebarBorder: '#1A293E',

  // Dark Mode Luxury
  dark: {
    bg: '#0B1422',
    surface: '#121E31',
    surfaceAlt: '#18263D',
    border: '#24344D',
    borderStrong: '#364B6B',
    ink: '#EEF1F6',
    inkSecondary: '#A7B0BF',
    inkMuted: '#748194',
    primary: '#7FA6D6',
    gold: '#C9A35B',
    sidebarBg: '#080E18',
    tableHeaderBg: '#18263D',
    tableRowHover: '#1B2C47',
  },
};

export const typography = {
  fontSans: "'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSerif: "'Playfair Display', Georgia, 'Times New Roman', serif",
  fontSizes: {
    xs: '11px',
    sm: '12px',
    base: '14px',
    md: '16px',
    lg: '20px',
    xl: '24px',
    xxl: '32px',
  },
};

export const radius = {
  sm: 6,
  md: 8,
  card: 10,
  modal: 14,
  full: 9999,
};

export const shadows = {
  soft: '0 1px 2px rgba(15, 27, 45, 0.06), 0 1px 1px rgba(15, 27, 45, 0.04)',
  elevated: '0 8px 24px rgba(15, 27, 45, 0.06), 0 2px 6px rgba(15, 27, 45, 0.04)',
  cardHover: '0 10px 28px rgba(15, 27, 45, 0.08), 0 2px 6px rgba(15, 27, 45, 0.04)',
};

export const morphTransition = {
  duration: 0.55,
  ease: [0.65, 0, 0.35, 1], // PowerPoint Morph Easing
};
