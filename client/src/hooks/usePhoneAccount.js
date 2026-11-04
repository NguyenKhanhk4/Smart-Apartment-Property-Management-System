import { useState } from 'react';
import { residentsApi } from '../api/moduleA.api';
import { isValidPhone, phoneAccountState } from '../utils/phone';
import { useApi } from './useApi';
import { useDebouncedValue } from './useDebouncedValue';

/** Tra tài khoản theo SĐT đang nhập; lễ tân xác nhận đúng người mới được gắn vào căn hộ (BR-X5) */
export function usePhoneAccount(phone) {
  const debounced = useDebouncedValue(phone, 400);
  const { data, error, loading, reload } = useApi(() => residentsApi.lookupPhone(debounced), [debounced], {
    enabled: isValidPhone(debounced),
  });
  const [confirmedUserId, setConfirmedUserId] = useState(null);

  return {
    ...phoneAccountState({ phone, account: data, error, loading, confirmedUserId }),
    phone,
    account: data,
    confirm: () => setConfirmedUserId(data?.userId ?? null),
    reset: () => setConfirmedUserId(null),
    reload,
  };
}
