// Số việc chờ trên menu bên trái (sidebar chung, không phải sidebar Lễ tân).
// Mỗi nguồn gắn với 1 `key` của adminMenu; chỉ gọi API khi mục đó đang hiện với người dùng.
// Lỗi (mất quyền, mạng) thì ẩn số, không báo lỗi: sidebar hiện trên mọi trang.
import { workOrderApi } from '../api/equipment.api';
import { fundApi } from '../api/moduleB.api';
import { systemConfigApi } from '../api/moduleE.api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';

const silent = (fetcher) => () => fetcher().catch(() => ({}));
const badge = (parts) => {
  const shown = parts.filter(([n]) => n > 0);
  if (!shown.length) return null;
  return { count: shown.reduce((s, [n]) => s + n, 0), title: shown.map(([n, label]) => `${n} ${label}`).join(', ') };
};

/** UC10: phiếu cần Trưởng BQL quyết định (trừ phiếu có đề xuất chi quỹ đang chờ Ban quản trị biểu quyết) + phiếu hoãn đến hạn xem lại */
function useRepairApprovalBadge(enabled) {
  const res = useApi(silent(() => workOrderApi.repairs({ tab: 'pending', limit: 1 })), [], { enabled });
  const c = res.raw?.counts;
  if (!c) return null;
  return badge([
    [Math.max(0, (c.pending ?? 0) - (c.awaitingFund ?? 0)), 'chờ quyết định'],
    [c.reviewDue ?? 0, 'đến hạn xem lại'],
  ]);
}

/**
 * Quỹ bảo trì, theo vai trò:
 *   Kế toán: đề xuất chờ xác nhận + đề xuất chờ lập phiếu chi + sửa chữa vận hành chờ ghi chi.
 *   Ban quản trị: đề xuất chờ biểu quyết + chờ xác nhận nghiệm thu + thay đổi tham số chờ xác nhận.
 *   Trưởng BQL: phiếu bảo trì chờ lập đề xuất.
 */
function useFundBadge(enabled) {
  const { hasRole } = useAuth();
  const accountant = enabled && hasRole('ACCOUNTANT');
  const board = enabled && hasRole('BOARD');
  const manager = enabled && hasRole('MANAGER');
  const overview = useApi(silent(() => fundApi.overview()), [], { enabled });
  const expenses = useApi(silent(() => workOrderApi.expenses()), [], { enabled: accountant });
  const acceptances = useApi(silent(() => fundApi.acceptances()), [], { enabled: board });
  const configs = useApi(silent(() => systemConfigApi.pending()), [], { enabled: board });
  const awaiting = useApi(silent(() => fundApi.awaitingWorkOrders()), [], { enabled: manager });
  const o = overview.data;
  if (!o) return null;
  if (accountant) {
    return badge([
      [o.readyToPayCount ?? 0, 'đề xuất chờ lập phiếu chi'],
      [expenses.data?.length ?? 0, 'sửa chữa chờ ghi chi'],
    ]);
  }
  if (board) {
    const a = acceptances.data;
    return badge([
      [o.pendingCount ?? 0, 'đề xuất chờ biểu quyết'],
      [a?.readyCount ?? 0, 'chờ xác nhận nghiệm thu'],
      [configs.data?.length ?? 0, 'thay đổi tham số chờ xác nhận'],
    ]);
  }
  if (manager) return badge([[awaiting.data?.length ?? 0, 'phiếu chờ lập đề xuất']]);
  return null;
}

/**
 * @param {Set<string>} visibleKeys key các mục menu đang hiện
 * @returns {Record<string, { count: number, title: string }>} key mục menu → số việc chờ
 */
export function useMenuBadges(visibleKeys) {
  const repairs = useRepairApprovalBadge(visibleKeys.has('repair-approvals'));
  const fund = useFundBadge(visibleKeys.has('fund'));
  return {
    ...(repairs && { 'repair-approvals': repairs }),
    ...(fund && { fund }),
  };
}
