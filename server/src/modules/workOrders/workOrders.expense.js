// Kế toán ghi chi phí vận hành thực tế của sửa chữa nguồn OPERATING (sau khi Hoàn thành), kèm số và ảnh hóa đơn.
// Số thực tế thay cho chi phí dự kiến khi cộng dồn 30 ngày (BR-E08). Thực tế từ ngưỡng Quỹ trở lên → báo Ban quản trị hậu kiểm.
import { AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, ROLES, WORK_ORDER_STATUS } from '../../constants/enums.js';
import { Asset, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { repairSettings } from './workOrders.decision.js';

const money = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;
/** Phiếu vận hành đã xong, chưa ghi chi */
export const AWAITING_EXPENSE = Object.freeze({
  status: WORK_ORDER_STATUS.DONE,
  'repair.costSource': REPAIR_COST_SOURCES.OPERATING,
  'repair.expenseRecordedAt': null,
});

/** Danh sách chờ ghi chi, xong sớm nhất trước */
export async function listAwaitingExpense() {
  return WorkOrder.find(AWAITING_EXPENSE)
    .select('assetId title completedAt repair.estimatedCost repair.vendorName repair.faultDesc repair.decidedAt repair.acceptedAt')
    .populate('assetId', 'code name location')
    .sort({ completedAt: 1 })
    .lean();
}

/** body: { actualCost, invoiceNo, note? } + ≥ 1 ảnh hóa đơn. Mỗi phiếu ghi 1 lần. Thực tế ≠ dự kiến → note là lý do chênh lệch (≥ 5 ký tự) */
export async function recordOperatingExpense(user, id, { actualCost, invoiceNo, note = null }, files = [], now = new Date()) {
  const wo = await WorkOrder.findById(id).lean();
  if (!wo) throw ApiError.notFound('Không tìm thấy phiếu bảo trì');
  if (wo.status !== WORK_ORDER_STATUS.DONE || wo.repair?.costSource !== REPAIR_COST_SOURCES.OPERATING) {
    throw new ApiError('WORKORDER_INVALID_STATUS', 'Chỉ ghi chi cho sửa chữa chi phí vận hành đã hoàn thành');
  }
  if (wo.repair.expenseRecordedAt) throw new ApiError('WORKORDER_INVALID_STATUS', 'Phiếu đã được ghi chi');
  if (!files.length) throw ApiError.badRequest('Cần ít nhất 1 ảnh hóa đơn', [{ field: 'images', message: 'Cần ít nhất 1 ảnh hóa đơn' }]);
  const text = note?.trim() || null;
  // Số thực tế khác chi phí dự kiến lúc duyệt → bắt ghi lý do chênh lệch (giống phiếu chi Quỹ), để hậu kiểm được
  const estimated = wo.repair.estimatedCost ?? null;
  if (estimated != null && actualCost !== estimated && (text?.length ?? 0) < 5) {
    const diff = actualCost - estimated;
    throw ApiError.field('note', `Số thực tế ${diff > 0 ? 'cao' : 'thấp'} hơn dự kiến ${money(Math.abs(diff))}, ghi lý do chênh lệch (tối thiểu 5 ký tự)`);
  }
  const invoiceUrls = await uploadToCloudinary(files, 'work-orders');
  const res = await WorkOrder.updateOne(
    { _id: id, ...AWAITING_EXPENSE },
    {
      $set: {
        'repair.actualCost': actualCost,
        'repair.invoiceNo': invoiceNo,
        'repair.invoiceUrls': invoiceUrls,
        'repair.expenseRecordedBy': user.id,
        'repair.expenseRecordedAt': now,
      },
      $push: { 'repair.history': { action: 'EXPENSE_RECORDED', by: user.id, at: now, note: text, cost: actualCost, images: invoiceUrls } },
    },
  );
  if (!res.modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
  await logAudit({
    action: AUDIT_ACTIONS.WORKORDER_EXPENSE_RECORDED, user, targetType: AUDIT_TARGETS.WORK_ORDER, targetId: wo._id,
    after: { actualCost, invoiceNo },
    metadata: { assetId: wo.assetId, estimatedCost: wo.repair.estimatedCost ?? null, financial: true },
  });
  const { fundThreshold } = await repairSettings();
  if (actualCost >= fundThreshold) {
    try {
      const [members, asset] = await Promise.all([
        User.find({ role: ROLES.BOARD, isActive: true }).select('_id').lean(),
        Asset.findById(wo.assetId).select('code name').lean(),
      ]);
      await notify(members.map((m) => m._id), {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: 'Chi phí vận hành vượt ngưỡng Quỹ',
        content: `Sửa chữa ${asset ? `${asset.code} – ${asset.name}` : 'thiết bị'} chi thực tế ${money(actualCost)} (hóa đơn ${invoiceNo}), `
          + `từ ngưỡng ${money(fundThreshold)} trở lên dù đã duyệt bằng chi phí vận hành (dự kiến ${money(wo.repair.estimatedCost)}). Đề nghị hậu kiểm.`,
        refId: wo._id,
        link: '/app/fund',
      });
    } catch (err) {
      console.error('[UC10] Lỗi báo Ban quản trị chi vượt ngưỡng:', err);
    }
  }
  return WorkOrder.findById(id).lean();
}
