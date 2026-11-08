import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { createSequencer } from './requestSequence';
import { AUTO_REFRESH_MS, STALE_MS, onDataChanged } from './dataSync';

/**
 * Gọi API khi mount / khi `deps` đổi. Trả về { data, pagination, raw, loading, error, reload }.
 * Lỗi được báo bằng message.error (trừ khi request bị hủy).
 * Chỉ kết quả của request mới nhất được ghi vào state (response về trễ bị bỏ qua);
 * `enabled` chuyển sang false thì xóa dữ liệu cũ.
 * Tự đồng bộ (autoRefresh, mặc định bật): tải lại NGẦM (không bật loading, không báo lỗi, dữ liệu không đổi thì không vẽ lại)
 *  - ngay khi có thao tác ghi thành công ở tab này hoặc tab khác cùng trình duyệt (dataSync),
 *  - khi quay lại tab / cửa sổ mà dữ liệu cũ hơn STALE_MS,
 *  - mỗi AUTO_REFRESH_MS khi tab đang hiện (thấy thay đổi của người dùng khác).
 * Tắt bằng { autoRefresh: false } cho dữ liệu không cần đồng bộ (vd danh mục tĩnh trong form đang nhập).
 * @example const { data, loading, reload } = useApi(() => ticketApi.list(filters), [filters]);
 */
export function useApi(fetcher, deps = [], { enabled = true, autoRefresh = true } = {}) {
  const { message } = App.useApp();
  const [state, setState] = useState({ raw: null, loading: enabled, error: null });
  const fetcherRef = useRef(fetcher);
  const seqRef = useRef(null);
  seqRef.current ??= createSequencer();
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  const loadedAtRef = useRef(0);
  const reload = useCallback(
    async ({ silent = false } = {}) => {
      const id = seqRef.current.next();
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const raw = await fetcherRef.current();
        if (seqRef.current.isLatest(id)) {
          loadedAtRef.current = Date.now();
          // Làm mới ngầm mà dữ liệu y hệt thì giữ state cũ (không vẽ lại, không nháy bảng)
          setState((s) => (silent && !s.error && JSON.stringify(s.raw) === JSON.stringify(raw) ? s : { raw, loading: false, error: null }));
        }
        return raw;
      } catch (error) {
        if (!seqRef.current.isLatest(id)) return null;
        if (silent) return null; // lỗi khi làm mới ngầm: giữ dữ liệu đang hiện, không báo
        if (!error.canceled) message.error(error.message);
        setState((s) => ({ ...s, loading: false, error }));
        return null;
      }
    },
    [message],
  );

  useEffect(() => {
    if (enabled) {
      reload();
    } else {
      seqRef.current.invalidate();
      setState({ raw: null, loading: false, error: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reload, ...deps]);

  useEffect(() => () => seqRef.current.invalidate(), []);

  // Đồng bộ ngầm: thao tác ghi ở đâu đó → tải lại (gộp nhiều tín hiệu sát nhau); quay lại tab; định kỳ khi tab đang hiện
  useEffect(() => {
    if (!enabled || !autoRefresh) return undefined;
    let debounce = null;
    const silent = () => reload({ silent: true });
    const offChanged = onDataChanged(() => {
      clearTimeout(debounce);
      debounce = setTimeout(silent, 250);
    });
    const visible = () => document.visibilityState === 'visible';
    const onFocus = () => visible() && Date.now() - loadedAtRef.current > STALE_MS && silent();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => visible() && silent(), AUTO_REFRESH_MS);
    return () => {
      offChanged();
      clearTimeout(debounce);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, autoRefresh, reload]);

  return {
    data: state.raw?.data,
    pagination: state.raw?.pagination,
    raw: state.raw,
    loading: state.loading,
    error: state.error,
    reload,
  };
}

/**
 * Bọc 1 thao tác ghi (POST/PATCH/DELETE): tự bật loading, báo thành công/lỗi.
 * Vẫn ném lỗi ra để nơi gọi xử lý tiếp; gắn vào Form onFinish / Popconfirm onConfirm thì thêm `.catch(() => {})`.
 * @example const [assign, assigning] = useAction((v) => ticketApi.assign(id, v), { success: 'Đã phân công', onDone: reload });
 */
export function useAction(action, { success, onDone } = {}) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const run = useCallback(
    async (...args) => {
      setLoading(true);
      try {
        const res = await action(...args);
        const text = typeof success === 'function' ? success(res) : (success ?? res?.message);
        if (text) message.success(text);
        await onDone?.(res);
        return res;
      } catch (error) {
        message.error(error.message);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [action, success, onDone, message],
  );
  return [run, loading];
}
