/**
 * @file tokens.js
 * @description Design tokens của SAPMS, 2 hệ giao diện:
 *  - A "Gọn sáng" (khu quản lý /app, trang đăng nhập): Inter, xám kẽm trung tính, viền mảnh, xanh dương chỉ ở hành động chính.
 *  - B "Tòa nhà xanh" (khu cư dân /r): Mulish, nền trắng ngả xanh lá nhẹ, xanh lá đậm làm màu chính, bóng rất mềm.
 * Chữ thường 13–14px, nhãn 500, tiêu đề tối đa 600 (không dùng 700).
 * Giá trị Tailwind tương ứng nằm ở src/index.css (@theme và lớp .theme-resident) — sửa màu thì sửa cả hai nơi.
 */

// ===== A — khu quản lý =====
export const colors = {
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primaryActive: '#1E40AF',
  primaryBg: '#EFF4FF',
  primaryBorder: '#BFD3FE',

  ink: '#18181B',
  inkSecondary: '#52525B',
  inkMuted: '#71717A',
  inkInverse: '#FFFFFF',

  bg: '#F4F4F6',
  surface: '#FFFFFF',
  surfaceAlt: '#F4F4F5',
  border: '#E0E0E5',
  borderStrong: '#CDCDD3',
  divider: '#EFEFF1',

  tableHeaderBg: '#F4F4F5',
  tableRowHover: '#F8F8F9',

  success: '#15803D',
  successLight: '#ECFDF3',
  successBorder: '#BBE5CB',
  warning: '#B45309',
  warningLight: '#FFF7ED',
  warningBorder: '#F8D9B5',
  error: '#B91C1C',
  errorLight: '#FEF2F2',
  errorBorder: '#F5C2C2',
  info: '#1D4ED8',
  infoLight: '#EFF4FF',
  infoBorder: '#BFD3FE',

  // Giữ key cũ cho chỗ còn dùng; A không có màu vàng trang trí, điểm nhấn là xanh dương
  gold: '#2563EB',
  goldText: '#1D4ED8',

  dark: {
    bg: '#09090B',
    surface: '#18181B',
    surfaceAlt: '#27272A',
    border: '#2E2E33',
    borderStrong: '#3F3F46',
    ink: '#FAFAFA',
    inkSecondary: '#A1A1AA',
    inkMuted: '#8B8B94',
    primary: '#60A5FA',
    gold: '#60A5FA',
    sidebarBg: '#111113',
    tableHeaderBg: '#1F1F23',
    tableRowHover: '#232327',
  },
};

// ===== B — khu cư dân =====
export const residentColors = {
  primary: '#15803D',
  primaryHover: '#166534',
  primaryActive: '#14532D',
  primaryBg: '#E8F3EB',
  ink: '#14231A',
  inkSecondary: '#4B5B51',
  inkMuted: '#6B7A70',
  bg: '#EDF3EF',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F6F2',
  border: '#D3DFD7',
  borderStrong: '#B5C7BB',
  success: '#15803D',
  successLight: '#E8F3EB',
  warning: '#A16207',
  warningLight: '#FEF8E7',
  error: '#B42318',
  errorLight: '#FDEEEC',
  info: '#0F766E',
  infoLight: '#E6F5F3',
};

export const typography = {
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontResident: "'Mulish', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  // Không còn font serif trang trí — giữ key để code cũ không vỡ
  fontSerif: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSizes: {
    xs: '11px',
    sm: '12px',
    base: '13px',
    md: '14px',
    lg: '16px',
    xl: '18px',
    xxl: '22px',
  },
};

export const radius = {
  sm: 6,
  md: 8,
  card: 8,
  modal: 12,
  full: 9999,
};

export const residentRadius = {
  sm: 8,
  md: 10,
  card: 12,
  modal: 16,
};
