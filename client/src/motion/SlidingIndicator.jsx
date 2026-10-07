import { motion, useReducedMotion } from 'motion/react';
import { springConfig } from './presets';

/**
 * Thanh/nền chỉ báo mục đang chọn — trượt mượt giữa các vị trí nhờ `layoutId` (menu, tab, bottom nav).
 * @example {isActive && <SlidingIndicator layoutId="sidebar-active" className="absolute inset-0 …" />}
 */
export default function SlidingIndicator({ layoutId, className, style }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className} style={style} aria-hidden="true" />;
  return (
    <motion.span layoutId={layoutId} className={className} style={style} transition={springConfig} aria-hidden="true" />
  );
}
