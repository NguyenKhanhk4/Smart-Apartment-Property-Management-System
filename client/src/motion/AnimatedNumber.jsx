import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Số chạy tăng dần (count-up) cho KPI.
 * @example <AnimatedNumber value={1250000} format={(v) => formatMoney(v)} />
 */
export default function AnimatedNumber({ value = 0, duration = 0.6, format, className }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) return undefined;
    const end = Number(value) || 0;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min((t - t0) / (duration * 1000), 1);
      setDisplay(end * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  const shown = reduced ? value : display;
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      {format ? format(shown) : Math.round(shown).toLocaleString('vi-VN')}
    </span>
  );
}
