import { useCallback, useEffect, useRef, useState } from 'react';

/** Sao chép văn bản; `copied` bật true ~2 giây sau khi thành công. Có dự phòng khi trình duyệt chặn Clipboard API (http) */
export function useCopy(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text) => {
      let done;
      try {
        await navigator.clipboard.writeText(text);
        done = true;
      } catch {
        const area = Object.assign(document.createElement('textarea'), { value: text });
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
          done = document.execCommand('copy');
        } catch {
          done = false;
        }
        area.remove();
      }
      if (done) {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      }
      return done;
    },
    [resetMs],
  );
  return { copied, copy };
}
