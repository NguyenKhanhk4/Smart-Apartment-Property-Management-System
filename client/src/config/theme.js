// Theme dùng chung cho toàn app (antd design token) — phong cách LUXURY "Midnight & Champagne".
// Màu, font, bo góc, bóng nằm ở theme/tokens.js; ánh xạ sang antd ở theme/antdTheme.js.
// Sáng/Tối do ThemeModeProvider quyết định (contexts/ThemeModeProvider.jsx).
import { getAntdTheme } from '../theme/antdTheme';

export const themeConfig = getAntdTheme(false);
export { getAntdTheme };
