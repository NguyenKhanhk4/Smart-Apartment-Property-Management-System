import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { createSequencer } from './requestSequence';

/**
 * Gọi API khi mount / khi `deps` đổi. Trả về { data, pagination, raw, loading, error, reload }.
 * Lỗi được báo bằng message.error (trừ khi request bị hủy).
 * Chỉ kết quả của request mới nhất được ghi vào state (response về trễ bị bỏ qua);
 * `enabled` chuyển sang false thì xóa dữ liệu cũ.
 * @example const { data, loading, reload } = useApi(() => ticketApi.list(filters), [filters]);
 */
export function useApi(fetcher, deps = [], { enabled = true } = {}) {
  const { message } = App.useApp();
  const [state, setState] = useState({ raw: null, loading: enabled, error: null });
  const fetcherRef = useRef(fetcher);
  const seqRef = useRef(null);
  seqRef.current ??= createSequencer();
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(async () => {
    const id = seqRef.current.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const raw = await fetcherRef.current();
      if (seqRef.current.isLatest(id)) setState({ raw, loading: false, error: null });
      return raw;
    } catch (error) {
      if (!seqRef.current.isLatest(id)) return null;
      if (!error.canceled) message.error(error.message);
      setState((s) => ({ ...s, loading: false, error }));
      return null;
    }
  }, [message]);

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
