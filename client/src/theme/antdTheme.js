/**
 * @file antdTheme.js
 * @description Ánh xạ design tokens vào Ant Design ConfigProvider.
 *  - getAntdTheme(isDark): hệ A "Gọn sáng" cho khu quản lý (có bản tối).
 *  - getResidentAntdTheme(): hệ B "Tòa nhà xanh" cho khu cư dân (chỉ bản sáng).
 */

import { theme as antdThemeAlgorithm } from 'antd';
import { colors, radius, residentColors, residentRadius, typography } from './tokens.js';

// Cỡ chữ gọn: chữ thường 13px, tiêu đề tối đa 22px, đậm tối đa 600
const COMPACT_TYPE = {
  fontSize: 13,
  fontSizeSM: 12,
  fontSizeLG: 14,
  fontSizeHeading1: 22,
  fontSizeHeading2: 20,
  fontSizeHeading3: 18,
  fontSizeHeading4: 16,
  fontSizeHeading5: 14,
  fontWeightStrong: 600,
  lineHeight: 1.5,
  controlHeight: 32,
  controlHeightLG: 38,
  controlHeightSM: 26,
};

export const getAntdTheme = (isDark = false) => {
  if (isDark) {
    return {
      algorithm: antdThemeAlgorithm.darkAlgorithm,
      token: {
        ...COMPACT_TYPE,
        fontFamily: typography.fontSans,
        colorPrimary: colors.dark.primary,
        colorTextLightSolid: colors.dark.bg, // chữ trên nút chính (nền xanh nhạt) phải tối để đọc được
        colorSuccess: '#4ADE80',
        colorWarning: '#FBBF24',
        colorError: '#F87171',
        colorInfo: colors.dark.primary,
        colorBgBase: colors.dark.bg,
        colorBgLayout: colors.dark.bg,
        colorBgContainer: colors.dark.surface,
        colorBgElevated: colors.dark.surfaceAlt,
        colorTextBase: colors.dark.ink,
        colorTextSecondary: colors.dark.inkSecondary,
        colorBorder: colors.dark.border,
        colorBorderSecondary: colors.dark.border,
        borderRadius: radius.sm,
      },
      components: {
        Card: { borderRadiusLG: radius.card, colorBorderSecondary: colors.dark.border, boxShadowCard: 'none' },
        Button: { borderRadius: radius.sm, fontWeight: 500 },
        Table: {
          headerBg: colors.dark.tableHeaderBg,
          headerColor: colors.dark.inkSecondary,
          rowHoverBg: colors.dark.tableRowHover,
          borderRadius: radius.card,
          borderColor: colors.dark.border,
          cellPaddingBlock: 9,
          cellPaddingInline: 12,
        },
        Modal: { borderRadiusLG: radius.modal },
        Drawer: { borderRadiusLG: radius.modal },
      },
    };
  }

  return {
    algorithm: antdThemeAlgorithm.defaultAlgorithm,
    token: {
      ...COMPACT_TYPE,
      fontFamily: typography.fontSans,
      colorPrimary: colors.primary,
      colorPrimaryHover: colors.primaryHover,
      colorPrimaryActive: colors.primaryActive,
      colorPrimaryBg: colors.primaryBg,
      colorSuccess: colors.success,
      colorSuccessBg: colors.successLight,
      colorWarning: colors.warning,
      colorWarningBg: colors.warningLight,
      colorError: colors.error,
      colorErrorBg: colors.errorLight,
      colorInfo: colors.info,
      colorInfoBg: colors.infoLight,
      colorBgBase: colors.surface,
      colorBgLayout: colors.bg,
      colorBgContainer: colors.surface,
      colorBgElevated: colors.surface,
      colorTextBase: colors.ink,
      colorTextSecondary: colors.inkSecondary,
      colorTextDescription: colors.inkSecondary, // chữ phụ (Form extra, Steps…) đạt tương phản AA
      colorTextPlaceholder: colors.inkMuted,
      colorBorder: colors.border,
      colorBorderSecondary: colors.border,
      borderRadius: radius.sm,
    },
    components: {
      Card: {
        borderRadiusLG: radius.card,
        colorBorderSecondary: colors.border,
        boxShadowCard: 'none',
        headerFontSize: 14,
      },
      Button: { borderRadius: radius.sm, fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
      Input: { borderRadius: radius.sm, colorBorder: colors.border, hoverBorderColor: colors.borderStrong, activeBorderColor: colors.primary },
      Select: { borderRadius: radius.sm },
      Table: {
        headerBg: colors.tableHeaderBg,
        headerColor: colors.inkSecondary,
        headerSplitColor: 'transparent',
        rowHoverBg: colors.tableRowHover,
        borderRadius: radius.card,
        borderColor: colors.border,
        cellPaddingBlock: 9,
        cellPaddingInline: 12,
        cellFontSize: 13,
      },
      Modal: { borderRadiusLG: radius.modal },
      Drawer: { borderRadiusLG: radius.modal },
      Tag: { borderRadiusSM: 999, defaultBg: colors.surfaceAlt, defaultColor: colors.inkSecondary },
      Steps: { colorTextDescription: colors.inkSecondary },
    },
  };
};

/** Hệ B "Tòa nhà xanh" cho khu cư dân — chữ 14px cho dễ đọc, nút vẫn ≥ 40px trên điện thoại */
export const getResidentAntdTheme = () => {
  const c = residentColors;
  return {
    algorithm: antdThemeAlgorithm.defaultAlgorithm,
    inherit: false,
    token: {
      ...COMPACT_TYPE,
      fontSize: 14,
      fontSizeLG: 15,
      controlHeight: 40,
      controlHeightLG: 44,
      controlHeightSM: 30,
      fontFamily: typography.fontResident,
      colorPrimary: c.primary,
      colorPrimaryHover: c.primaryHover,
      colorPrimaryActive: c.primaryActive,
      colorPrimaryBg: c.primaryBg,
      colorSuccess: c.success,
      colorSuccessBg: c.successLight,
      colorWarning: c.warning,
      colorWarningBg: c.warningLight,
      colorError: c.error,
      colorErrorBg: c.errorLight,
      colorInfo: c.info,
      colorInfoBg: c.infoLight,
      colorLink: c.primary,
      colorBgBase: c.surface,
      colorBgLayout: c.bg,
      colorBgContainer: c.surface,
      colorBgElevated: c.surface,
      colorTextBase: c.ink,
      colorTextSecondary: c.inkSecondary,
      colorTextDescription: c.inkSecondary,
      colorTextPlaceholder: c.inkMuted,
      colorBorder: c.border,
      colorBorderSecondary: c.border,
      borderRadius: residentRadius.sm,
    },
    components: {
      Card: {
        borderRadiusLG: residentRadius.card,
        colorBorderSecondary: c.border,
        boxShadowCard: '0 1px 2px rgba(20,35,26,.04), 0 4px 14px rgba(20,35,26,.05)',
      },
      Button: { borderRadius: residentRadius.sm, fontWeight: 600, primaryShadow: 'none' },
      Input: { borderRadius: residentRadius.sm, activeBorderColor: c.primary, hoverBorderColor: c.borderStrong },
      Select: { borderRadius: residentRadius.sm },
      Table: { headerBg: c.surfaceAlt, headerColor: c.inkSecondary, borderColor: c.border, borderRadius: residentRadius.card },
      Modal: { borderRadiusLG: residentRadius.modal },
      Drawer: { borderRadiusLG: residentRadius.modal },
      Tag: { borderRadiusSM: 999, defaultBg: c.surfaceAlt, defaultColor: c.inkSecondary },
      Steps: { colorTextDescription: c.inkSecondary },
    },
  };
};
