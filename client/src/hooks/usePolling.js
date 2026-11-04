import { useEffect, useLayoutEffect, useRef } from 'react';

/** Gọi `fn` mỗi `ms` ms; bỏ qua khi tab đang ẩn (document.hidden) để không tốn request nền */
export function usePolling(fn, ms, { enabled = true } = {}) {
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) fnRef.current();
    }, ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
}
