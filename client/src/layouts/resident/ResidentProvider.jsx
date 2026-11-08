import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { memberCodeApi } from '../../api/moduleD.api';
import { residentsApi, vehicleApi } from '../../api/moduleA.api';
import { useApi } from '../../hooks/useApi';
import { ResidentContext } from './ResidentContext';
import { VEHICLE_STATUS } from '../../constants/enums';
import { keysOf } from '../../utils/status';

const VEHICLE = keysOf(VEHICLE_STATUS);

// Xe tính là "đăng ký" khi đang chờ duyệt hoặc đã duyệt
const COUNTED_VEHICLE_STATUS = [VEHICLE.PENDING, VEHICLE.APPROVED];

/**
 * Dữ liệu dùng chung của khu cư dân (header, menu avatar, trang chủ): căn đang chọn + thẻ mã + số thành viên/xe.
 *   apartment     { _id, code, building }  — căn đang chọn (null nếu tài khoản chưa có quyền ở căn nào)
 *   card          thẻ mã của tôi trong căn đó: { code, isHead, avatarUrl, fullName, ... }
 *   cards         mọi căn tôi có quyền (đổi căn bằng setApartmentId)
 *   memberCount, vehicleCount — undefined khi đang tải hoặc tải lỗi
 */
// Nhớ căn đang chọn theo từng tài khoản khi tải lại trang (UC01: "the chosen apartment is kept in the session")
const storageKey = (userId) => `sapms_apartment_${userId}`;
const readPicked = (userId) => {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
};

export function ResidentProvider({ children }) {
  const userId = useAuth().user?.id;
  const { data: cards = [], loading, reload: reloadCards } = useApi(() => memberCodeApi.mine(), []);
  const [pickedId, setPickedId] = useState(() => readPicked(userId));
  const pick = useCallback(
    (id) => {
      setPickedId(id);
      try {
        window.localStorage.setItem(storageKey(userId), id);
      } catch {
        // Không lưu được thì vẫn đổi căn trong phiên hiện tại
      }
    },
    [userId],
  );

  const card = cards.find((c) => c.apartment._id === pickedId) ?? cards[0] ?? null;
  const apartmentId = card?.apartment._id ?? null;

  const enabled = Boolean(apartmentId);
  const { data: members, reload: reloadMembers } = useApi(
    () => residentsApi.listByApartment(apartmentId), [apartmentId], { enabled },
  );
  const reloadResidency = useCallback(async () => {
    const [cardsResult] = await Promise.all([reloadCards(), enabled && reloadMembers()]);
    return cardsResult;
  }, [enabled, reloadCards, reloadMembers]);
  const vehicles = useApi(() => vehicleApi.listMine({ apartmentId }), [apartmentId], { enabled });

  const value = useMemo(
    () => ({
      loading,
      cards,
      card,
      apartment: card?.apartment ?? null,
      apartmentId,
      setApartmentId: pick,
      reloadResidency,
      isHead: Boolean(card?.isHead),
      code: card?.code ?? null,
      memberCount: enabled ? members?.filter((resident) => resident.occupancyRole).length : undefined,
      vehicleCount: enabled
        ? vehicles.data?.filter((v) => COUNTED_VEHICLE_STATUS.includes(v.status)).length
        : undefined,
    }),
    [loading, cards, card, apartmentId, pick, reloadResidency, enabled, members, vehicles.data],
  );

  return <ResidentContext.Provider value={value}>{children}</ResidentContext.Provider>;
}
