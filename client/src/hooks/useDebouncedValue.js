import { useEffect, useState } from 'react';

/** Giá trị trễ `ms` sau lần đổi cuối — ô tìm kiếm không gọi API theo từng phím gõ */
export function useDebouncedValue(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
