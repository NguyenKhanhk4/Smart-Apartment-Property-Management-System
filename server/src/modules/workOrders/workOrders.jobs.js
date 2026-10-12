import { NOTIFICATION_TYPES, WORK_ORDER_STATUS, WORK_ORDER_TYPES } from '../../constants/enums.js';
import { Asset, WorkOrder } from '../../models/index.js';
import { notifyRoles } from '../../services/notification.service.js';
import { endOfVnDay } from '../../utils/time.js';

const OPEN_SCHEDULED = {
  type: WORK_ORDER_TYPES.SCHEDULED,
  status: { $in: [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PROGRESS] },
};

/**
 * Tạo work order SCHEDULED cho 1 tài sản đến hạn. Trả về true nếu thực sự tạo mới.
 *
 * - Đã có work order mở → bỏ qua (BR-O6).
 * - 2 lần chạy chồng nhau: unique index uniq_open_scheduled_wo chặn trùng (lỗi 11000) → bỏ qua.
 * - Tranh chấp với "ngừng theo dõi" (BR-O19): setAssetStatus kiểm tra work order mở rồi mới tắt isActive,
 *   còn job tạo work order rồi mới đọc lại isActive. Mỗi bên "ghi trước, đọc sau" nên ít nhất một bên
 *   thấy bên kia: job thấy tài sản đã ngừng → xóa work order vừa tạo và không tính;
 *   nếu không thì setAssetStatus thấy work order và từ chối ngừng.
 */
async function createWorkOrderIfDue(asset) {
  if (await WorkOrder.exists({ assetId: asset._id, ...OPEN_SCHEDULED })) return false;
  if (!(await Asset.exists({ _id: asset._id, isActive: true }))) return false;

  let workOrder;
  try {
    workOrder = await WorkOrder.create({
      assetId: asset._id,
      type: WORK_ORDER_TYPES.SCHEDULED,
      status: WORK_ORDER_STATUS.PENDING,
      title: `Bảo trì định kỳ ${asset.name}`,
      scheduledDate: asset.nextMaintenanceDate,
    });
  } catch (err) {
    if (err?.code === 11000) {
      console.warn(`[WORKORDER_DUPLICATE] tài sản ${asset._id} đã có work order bảo trì định kỳ đang mở`);
      return false;
    }
    throw err;
  }

  if (!(await Asset.exists({ _id: asset._id, isActive: true }))) {
    await WorkOrder.deleteOne({ _id: workOrder._id, status: WORK_ORDER_STATUS.PENDING });
    return false;
  }
  return true;
}

/**
 * UC-D02 — [Cron 02:00] Tài sản đang theo dõi có nextMaintenanceDate ≤ cuối ngày hôm nay (giờ VN)
 * mà chưa có work order SCHEDULED đang mở → tạo work order PENDING (chưa phân công).
 * Xét hết thì gửi 1 thông báo MAINTENANCE cho Trưởng BQL (không có work order mới → không gửi).
 * Lỗi bất ngờ ở 1 tài sản chỉ được log, các tài sản còn lại vẫn xử lý.
 * Trả về số work order đã tạo (affectedCount cho cron_runs). Chạy lại trong ngày không tạo thêm.
 */
export async function generateMaintenanceWorkOrders(now = new Date()) {
  const assets = await Asset.find({
    isActive: true,
    nextMaintenanceDate: { $lte: endOfVnDay(now) },
  })
    .select('name nextMaintenanceDate')
    .lean();

  let created = 0;
  for (const asset of assets) {
    try {
      if (await createWorkOrderIfDue(asset)) created += 1;
    } catch (err) {
      console.error(`[UC-D02] Lỗi tạo work order cho tài sản ${asset._id}:`, err);
    }
  }

  if (created) {
    try {
      await notifyRoles(['MANAGER'], {
        type: NOTIFICATION_TYPES.MAINTENANCE,
        title: 'Có tài sản đến hạn bảo trì',
        content: `Hệ thống vừa tạo ${created} work order bảo trì định kỳ cần phân công kỹ thuật viên.`,
        link: '/app/work-orders',
      });
    } catch (err) {
      console.error('[UC-D02] Lỗi gửi thông báo cho Trưởng BQL:', err);
    }
  }
  return created;
}
