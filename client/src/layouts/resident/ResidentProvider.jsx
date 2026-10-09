import { useMemo, useState } from 'react';
import { memberCodeApi } from '../../api/moduleD.api';
import { residentsApi, vehicleApi } from '../../api/moduleA.api';
import { useApi } from '../../hooks/useApi';
import { ResidentContext } from './ResidentContext';

// Xe tính là "đăng ký" khi đang chờ duyệt hoặc đã duyệt
const COUNTED_VEHICLE_STATUS = ['PENDING', 'APPROVED'];

/**
 * Dữ liệu dùng chung của khu cư dân (header, menu avatar, trang chủ): căn đang chọn + thẻ mã + số thành viên/xe.
 *   apartment     { _id, code, building }  — căn đang chọn (null nếu tài khoản chưa có quyền ở căn nào)
 *   card          thẻ mã của tôi trong căn đó: { code, isHead, avatarUrl, fullName, ... }
 *   cards         mọi căn tôi có quyền (đổi căn bằng setApartmentId)
 *   memberCount, vehicleCount — undefined khi đang tải hoặc tải lỗi
 */
export function ResidentProvider({ children }) {
  const { data: cards = [], loading } = useApi(() => memberCodeApi.mine(), []);
  const [pickedId, setPickedId] = useState(null);

  const card = cards.find((c) => c.apartment._id === pickedId) ?? cards[0] ?? null;
  const apartmentId = card?.apartment._id ?? null;

  const enabled = Boolean(apartmentId);
  const members = useApi(() => residentsApi.listByApartment(apartmentId), [apartmentId], { enabled });
  const vehicles = useApi(() => vehicleApi.listMine({ apartmentId }), [apartmentId], { enabled });

  const value = useMemo(
    () => ({
      loading,
      cards,
      card,
      apartment: card?.apartment ?? null,
      apartmentId,
      setApartmentId: setPickedId,
      isHead: Boolean(card?.isHead),
      code: card?.code ?? null,
      memberCount: enabled ? members.data?.length : undefined,
      vehicleCount: enabled
        ? vehicles.data?.filter((v) => COUNTED_VEHICLE_STATUS.includes(v.status)).length
        : undefined,
    }),
    [loading, cards, card, apartmentId, enabled, members.data, vehicles.data],
  );

  return <ResidentContext.Provider value={value}>{children}</ResidentContext.Provider>;
}
