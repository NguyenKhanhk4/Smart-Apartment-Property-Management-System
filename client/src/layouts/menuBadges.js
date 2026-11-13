// Số việc chờ trên menu bên trái (sidebar chung, không phải sidebar Lễ tân).
// Mỗi nguồn gắn với 1 `key` của adminMenu; chỉ gọi API khi mục đó đang hiện với người dùng.
// Lỗi (mất quyền, mạng) thì ẩn số, không báo lỗi: sidebar hiện trên mọi trang.
import { workOrderApi } from '../api/equipment.api';
import { useApi } from '../hooks/useApi';

const silent = (fetcher) => () => fetcher().catch(() => ({}));

/** UC10: phiếu cần Trưởng BQL quyết định (trừ phiếu đang chờ Ban quản trị biểu quyết) + phiếu hoãn đến hạn xem lại */
function useRepairApprovalBadge(enabled) {
  const res = useApi(silent(() => workOrderApi.repairs({ tab: 'pending', limit: 1 })), [], { enabled });
  const c = res.raw?.counts;
  if (!c) return null;
  const decide = Math.max(0, (c.pending ?? 0) - (c.awaitingVote ?? 0));
  const review = c.reviewDue ?? 0;
  const parts = [decide && `${decide} chờ quyết định`, review && `${review} đến hạn xem lại`].filter(Boolean);
  return { count: decide + review, title: parts.join(', ') };
}

/**
 * @param {Set<string>} visibleKeys key các mục menu đang hiện
 * @returns {Record<string, { count: number, title: string }>} key mục menu → số việc chờ
 */
export function useMenuBadges(visibleKeys) {
  const repairs = useRepairApprovalBadge(visibleKeys.has('repair-approvals'));
  return {
    ...(repairs && { 'repair-approvals': repairs }),
  };
}
