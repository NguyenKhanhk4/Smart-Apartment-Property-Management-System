import { motion, useReducedMotion } from 'motion/react';
import { pageVariants } from './presets';

/** Nội dung trang hiện ra mượt (fade + dịch 8px); header/sidebar đứng yên. Đặt key = pathname. */
export default function PageTransition({ children, className }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" className={className}>
      {children}
    </motion.div>
  );
}
