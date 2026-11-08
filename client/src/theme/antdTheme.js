/**
 * @file antdTheme.js
 * @description Ánh xạ tokens LUXURY "Midnight & Champagne" vào Ant Design ConfigProvider.
 */

import { theme as antdThemeAlgorithm } from 'antd';
import { colors, radius, typography } from './tokens.js';

export const getAntdTheme = (isDark = false) => {
  if (isDark) {
    return {
      algorithm: antdThemeAlgorithm.darkAlgorithm,
      token: {
        fontFamily: typography.fontSans,
        colorPrimary: colors.dark.primary,
        colorTextLightSolid: colors.dark.bg, // chữ trên nút chính (nền xanh nhạt) phải tối để đọc được
        colorSuccess: colors.success,
        colorWarning: colors.gold,
        colorError: colors.error,
        colorInfo: colors.info,
        colorBgBase: colors.dark.bg,
        colorBgContainer: colors.dark.surface,
        colorBgElevated: colors.dark.surfaceAlt,
        colorTextBase: colors.dark.ink,
        colorTextSecondary: colors.dark.inkSecondary,
        colorBorder: colors.dark.border,
        borderRadius: radius.sm,
        fontSize: 14,
        lineHeight: 1.5,
      },
      components: {
        Card: {
          borderRadiusLG: radius.card,
          colorBorderSecondary: colors.dark.border,
          boxShadowCard: '0 1px 2px rgba(0,0,0,0.3)',
        },
        Button: {
          borderRadius: radius.sm,
          controlHeight: 36,
          fontWeight: 500,
        },
        Table: {
          headerBg: colors.dark.tableHeaderBg,
          headerColor: colors.dark.inkSecondary,
          rowHoverBg: colors.dark.tableRowHover,
          borderRadius: radius.card,
          borderColor: colors.dark.border,
        },
        Modal: {
          borderRadiusLG: radius.modal,
        },
        Drawer: {
          borderRadiusLG: radius.modal,
        },
      },
    };
  }

  // Light Theme Luxury
  return {
    algorithm: antdThemeAlgorithm.defaultAlgorithm,
    token: {
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
      colorTextPlaceholder: colors.inkMuted,
      colorBorder: colors.border,
      colorBorderSecondary: colors.borderStrong,
      borderRadius: radius.sm,
      fontSize: 14,
      lineHeight: 1.5,
    },
    components: {
      Card: {
        borderRadiusLG: radius.card,
        colorBorderSecondary: colors.border,
        boxShadowCard: '0 1px 2px rgba(15,27,45,.06), 0 1px 1px rgba(15,27,45,.04)',
      },
      Button: {
        borderRadius: radius.sm,
        controlHeight: 36,
        fontWeight: 500,
        primaryShadow: '0 1px 2px rgba(30,58,95,0.2)',
      },
      Input: {
        borderRadius: radius.sm,
        controlHeight: 36,
        colorBorder: colors.border,
        hoverBorderColor: colors.primary,
        activeBorderColor: colors.primary,
      },
      Select: {
        borderRadius: radius.sm,
        controlHeight: 36,
      },
      Table: {
        headerBg: colors.surfaceAlt,
        headerColor: colors.inkSecondary,
        rowHoverBg: colors.tableRowHover,
        borderRadius: radius.card,
        borderColor: colors.border,
      },
      Modal: {
        borderRadiusLG: radius.modal,
      },
      Drawer: {
        borderRadiusLG: radius.modal,
      },
      Tag: {
        borderRadiusSM: 4,
        defaultBg: colors.surfaceAlt,
        defaultColor: colors.inkSecondary,
      },
    },
  };
};
