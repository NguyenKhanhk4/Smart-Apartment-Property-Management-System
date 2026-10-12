import { useRef, useState } from 'react';
import { amenityPassApi } from '../../api/moduleD.api';
import { useApi } from '../../hooks/useApi';
import PurchasePassModal from './PurchasePassModal';

/**
 * Luồng mua / gia hạn gói tháng (chỉ chủ hộ) dùng chung cho trang chi tiết dịch vụ và tab Quản lý.
 *   open({ memberId, amenityId, month? }) mở modal; `element` đặt ở cuối JSX của trang.
 *   info = amenityPassApi.options (undefined khi không phải chủ hộ / đang tải lần đầu)
 */
export function usePurchasePass({ apartmentId, enabled, onDone }) {
  const [monthPick, setMonthPick] = useState(null); // null = tháng này (server mặc định)
  const [modal, setModal] = useState(null); // { memberId, amenityId, key, open }
  const seq = useRef(0); // key mới mỗi lần mở để modal khởi tạo lại lựa chọn

  const options = useApi(() => amenityPassApi.options({ apartmentId, month: monthPick ?? undefined }), [apartmentId, monthPick], {
    enabled: Boolean(enabled && apartmentId),
  });
  const info = options.data;

  const open = ({ memberId, amenityId, month }) => {
    if (month) setMonthPick(month);
    setModal({ memberId, amenityId, key: ++seq.current, open: true });
  };
  const close = () => {
    setModal((m) => m && { ...m, open: false });
    setMonthPick(null);
  };
  const done = async () => {
    await options.reload();
    await onDone?.();
  };

  const element =
    modal && info ? (
      <PurchasePassModal
        key={modal.key}
        open={modal.open}
        onClose={close}
        info={info}
        loading={options.loading}
        apartmentId={apartmentId}
        initial={{ memberId: modal.memberId, amenityId: modal.amenityId }}
        onMonthChange={setMonthPick}
        onDone={done}
      />
    ) : null;

  return { info, open, element, reload: options.reload };
}
