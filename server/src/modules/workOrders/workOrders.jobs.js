import {
  CONFIG_KEYS, FUND_PROPOSAL_STATUS, NOTIFICATION_TYPES, REPAIR_COST_SOURCES, ROLE_TITLES, ROLES, WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_INSPECTING_STATUSES, WORK_ORDER_STATUS, WORK_ORDER_TYPES,
} from '../../constants/enums.js';
import { Asset, FundProposal, User, WorkOrder } from '../../models/index.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfig, getConfigs } from '../../services/systemConfig.service.js';
import { DAY_MS, endOfVnDay, fmtDateVn, startOfVnDay } from '../../utils/time.js';
import { listShifts } from '../dutyShifts/dutyShifts.service.js';

export const WARRANTY_WARNING_DAYS = 30; // BR-E07, MSG-E08

// Thiết bị còn phiếu định kỳ đang làm (kiểm tra hoặc sửa chữa) thì không tạo phiếu mới.
// Phiếu tạm hoãn sửa KHÔNG chặn: thiết bị vẫn được kiểm tra định kỳ (UC10, Q8)
const OPEN_SCHEDULED = {
  type: WORK_ORDER_TYPES.SCHEDULED,
  status: { $in: [...WORK_ORDER_ACTIVE_STATUSES] },
};
// Quá hạn kiểm tra: chỉ phiếu chưa nộp kết quả. Phiếu đang sửa chữa / chờ nghiệm thu là việc của bước khác
const AWAITING_INSPECTION = {
  type: WORK_ORDER_TYPES.SCHEDULED,
  status: { $in: [...WORK_ORDER_INSPECTING_STATUSES] },
  result: null,
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
      // UC07: bản sao mẫu checklist lúc tạo; sửa mẫu sau đó không làm đổi phiếu này
      checklist: (asset.checklist ?? []).map(({ label, unit, minValue, maxValue, required }) => ({ label, unit, minValue, maxValue, required })),
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
    .select('code name nextMaintenanceDate checklist')
    .lean();

  let created = 0;
  const createdAssets = [];
  for (const asset of assets) {
    try {
      if (await createWorkOrderIfDue(asset)) {
        created += 1;
        createdAssets.push(asset);
      }
    } catch (err) {
      console.error(`[UC-D02] Lỗi tạo work order cho tài sản ${asset._id}:`, err);
    }
  }

  // BR-E03, MSG-E09: phiếu vào checklist của ca kỹ thuật trong ngày. Xét CẢ NGÀY (job chạy 01:00, có thể chưa vào ca);
  // cả ngày không có ca kỹ thuật thì báo Trưởng BQL xếp ca. Phiếu vẫn ở danh sách chờ phân công.
  if (createdAssets.length) {
    try {
      const shifts = await listShifts({ from: startOfVnDay(now), to: endOfVnDay(now), roleTitle: ROLE_TITLES.TECHNICIAN });
      const names = createdAssets.map((a) => a.code ?? a.name).join(', ');
      // MSG-E05: báo KTV có ca kỹ thuật trong ngày (job 01:00 nên báo theo ca trong ngày, không theo người đang trực lúc chạy)
      const techIds = [...new Set(shifts.filter((s) => s.userId).map((s) => String(s.userId._id)))];
      if (techIds.length) {
        await notify(techIds, {
          type: NOTIFICATION_TYPES.MAINTENANCE,
          title: 'Có phiếu bảo trì mới trong ca',
          content: `Có ${createdAssets.length} phiếu bảo trì định kỳ mới hôm nay (${names}). Mở Checklist ca để quét QR và kiểm tra.`,
          link: '/app/my-work-orders',
        });
      }
      if (!shifts.length) {
        await notifyRoles(['MANAGER'], {
          type: NOTIFICATION_TYPES.MAINTENANCE,
          title: 'Phiếu bảo trì chưa có ca kỹ thuật',
          content: `Phiếu bảo trì của ${names} chưa có ca kỹ thuật ngày ${fmtDateVn(now)}. Vui lòng xếp ca.`,
          link: '/app/duty-shifts',
        });
      }
    } catch (err) {
      console.error('[UC-D02] Lỗi kiểm tra ca kỹ thuật:', err);
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

/**
 * UC07, BR-E07 — [Cron 07:00] Cảnh báo Trưởng BQL (MSG-E08, chỉ trên Web):
 * phiếu bảo trì định kỳ quá hạn (ngày lên lịch trước hôm nay mà chưa xong) và thiết bị đang theo dõi
 * hết bảo hành trong WARRANTY_WARNING_DAYS (30) ngày tới. Không có gì để báo thì không gửi.
 * Trả về số mục được cảnh báo (affectedCount cho cron_runs).
 */
export async function warnEquipment(now = new Date()) {
  const today = startOfVnDay(now);
  const remindDays = Number(await getConfig(CONFIG_KEYS.REPAIR_ACCEPTANCE_REMIND_DAYS)) || 3;
  const [overdue, expiring, waitingAcceptance] = await Promise.all([
    WorkOrder.countDocuments({ ...AWAITING_INSPECTION, scheduledDate: { $lt: today } }),
    Asset.countDocuments({
      isActive: true,
      warrantyEnd: { $gte: today, $lte: endOfVnDay(new Date(today.getTime() + WARRANTY_WARNING_DAYS * DAY_MS)) },
    }),
    // UC09, BR-X8: biên bản đã tải quá N ngày mà Trưởng BQL chưa nghiệm thu (nhắc, không tự nghiệm thu)
    WorkOrder.countDocuments({
      status: WORK_ORDER_STATUS.AWAITING_ACCEPTANCE,
      'repair.acceptanceUploadedAt': { $lte: new Date(now.getTime() - remindDays * DAY_MS) },
    }),
  ]);
  if (overdue || expiring) {
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Cảnh báo bảo trì thiết bị',
      content: `${overdue} phiếu bảo trì quá hạn; ${expiring} thiết bị hết bảo hành trong ${WARRANTY_WARNING_DAYS} ngày tới.`,
      link: '/app/assets',
    });
  }
  if (waitingAcceptance) {
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.MAINTENANCE,
      title: 'Sửa chữa chờ nghiệm thu',
      content: `${waitingAcceptance} phiếu sửa chữa đã có biên bản của nhà thầu hơn ${remindDays} ngày, đang chờ bạn nghiệm thu.`,
      link: '/app/work-orders',
    });
  }
  return overdue + expiring + waitingAcceptance;
}

// ===== Job REPAIR_FOLLOWUP_REMIND (BR-X8): nhắc, không tự xử lý =====
/**
 * Ghi dấu nhắc có điều kiện (field mốc nhắc cũ) nên 2 lần chạy chồng không nhắc trùng.
 * @returns {Promise<boolean>} true nếu lần này giành được quyền nhắc
 */
async function claim(woId, field, previous, now) {
  const res = await WorkOrder.updateOne({ _id: woId, [field]: previous ?? null }, { $set: { [field]: now } });
  return res.modifiedCount === 1;
}
const label = (wo) => (wo.assetId ? `${wo.assetId.code} – ${wo.assetId.name}` : 'thiết bị');
const boardIds = async () => (await User.find({ role: ROLES.BOARD, isActive: true }).select('_id').lean()).map((m) => m._id);

/**
 * [Cron 07:10]
 * 1. BR-E11: phiếu sửa khẩn cấp quá EMERGENCY_DOSSIER_DAYS ngày chưa có đề xuất chi quỹ (đang xử lý / đã duyệt) → nhắc Trưởng BQL
 *    + Ban quản trị, mỗi ngày 1 lần.
 * 2. BR-E09: chờ Ban quản trị xác nhận nghiệm thu quá BOARD_ACCEPTANCE_REMIND_DAYS ngày → nhắc Ban quản trị, N ngày/lần.
 * 3. Sửa chữa vận hành xong quá OPERATING_EXPENSE_REMIND_DAYS ngày chưa ghi chi → nhắc Kế toán, N ngày/lần.
 * @returns {Promise<number>} số phiếu đã nhắc
 */
export async function remindRepairFollowups(now = new Date()) {
  const K = CONFIG_KEYS;
  const c = await getConfigs([K.EMERGENCY_DOSSIER_DAYS, K.BOARD_ACCEPTANCE_REMIND_DAYS, K.OPERATING_EXPENSE_REMIND_DAYS]);
  const dossierDays = Number(c[K.EMERGENCY_DOSSIER_DAYS]) || 3;
  const boardDays = Number(c[K.BOARD_ACCEPTANCE_REMIND_DAYS]) || 3;
  const expenseDays = Number(c[K.OPERATING_EXPENSE_REMIND_DAYS]) || 3;
  const today = startOfVnDay(now);
  const ago = (days) => new Date(now.getTime() - days * DAY_MS);
  let count = 0;

  // 1. Hồ sơ sửa khẩn cấp
  const emergencies = await WorkOrder.find({
    'repair.isEmergency': true,
    'repair.costSource': REPAIR_COST_SOURCES.FUND,
    'repair.emergencyAt': { $lte: ago(dossierDays) },
    $or: [{ 'repair.dossierRemindedAt': null }, { 'repair.dossierRemindedAt': { $lt: today } }],
  }).populate('assetId', 'code name').lean();
  if (emergencies.length) {
    const covered = new Set((await FundProposal.distinct('workOrderId', {
      workOrderId: { $in: emergencies.map((w) => w._id) },
      $or: [{ isOpen: true }, { status: { $in: [FUND_PROPOSAL_STATUS.APPROVED, FUND_PROPOSAL_STATUS.PAID] } }],
    })).map(String));
    const board = await boardIds();
    for (const wo of emergencies.filter((w) => !covered.has(String(w._id)))) {
      if (!(await claim(wo._id, 'repair.dossierRemindedAt', wo.repair.dossierRemindedAt, now))) continue;
      count += 1;
      const days = Math.floor((now - new Date(wo.repair.emergencyAt)) / DAY_MS);
      const msg = {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: 'Sửa chữa khẩn cấp chưa có hồ sơ chi quỹ',
        content: `Sửa chữa khẩn cấp ${label(wo)} bắt đầu ${days} ngày trước (hạn ${dossierDays} ngày) chưa có đề xuất chi quỹ. Trưởng BQL lập đề xuất ngay.`,
        refId: wo._id,
        link: '/app/fund',
      };
      try {
        await notifyRoles(['MANAGER'], msg);
        await notify(board, msg);
      } catch (err) {
        console.error('[BR-E11] Lỗi nhắc hồ sơ khẩn cấp:', err);
      }
    }
  }

  // 2. Chờ Ban quản trị xác nhận nghiệm thu
  const awaitingBoard = await WorkOrder.find({
    status: WORK_ORDER_STATUS.AWAITING_BOARD_ACCEPTANCE,
    'repair.acceptedAt': { $lte: ago(boardDays) },
    $or: [{ 'repair.boardRemindedAt': null }, { 'repair.boardRemindedAt': { $lte: ago(boardDays) } }],
  }).populate('assetId', 'code name').lean();
  if (awaitingBoard.length) {
    const board = await boardIds();
    for (const wo of awaitingBoard) {
      if (!(await claim(wo._id, 'repair.boardRemindedAt', wo.repair.boardRemindedAt, now))) continue;
      count += 1;
      try {
        await notify(board, {
          type: NOTIFICATION_TYPES.FUND_APPROVAL,
          title: 'Nhắc xác nhận nghiệm thu sửa chữa bằng Quỹ',
          content: `Sửa chữa ${label(wo)} đã được Trưởng BQL nghiệm thu từ ${fmtDateVn(wo.repair.acceptedAt)}, đang chờ Ban quản trị xác nhận. Hệ thống không tự xác nhận.`,
          refId: wo._id,
          link: '/app/fund',
          email: true,
        });
      } catch (err) {
        console.error('[BR-E09] Lỗi nhắc Ban quản trị:', err);
      }
    }
  }

  // 3. Chờ ghi chi vận hành
  const awaitingExpense = await WorkOrder.find({
    status: WORK_ORDER_STATUS.DONE,
    'repair.costSource': REPAIR_COST_SOURCES.OPERATING,
    'repair.expenseRecordedAt': null,
    completedAt: { $lte: ago(expenseDays) },
    $or: [{ 'repair.expenseRemindedAt': null }, { 'repair.expenseRemindedAt': { $lte: ago(expenseDays) } }],
  }).populate('assetId', 'code name').lean();
  for (const wo of awaitingExpense) {
    if (!(await claim(wo._id, 'repair.expenseRemindedAt', wo.repair.expenseRemindedAt, now))) continue;
    count += 1;
    try {
      await notifyRoles(['ACCOUNTANT'], {
        type: NOTIFICATION_TYPES.MAINTENANCE,
        title: 'Sửa chữa chờ ghi chi phí vận hành',
        content: `Sửa chữa ${label(wo)} hoàn thành ${fmtDateVn(wo.completedAt)} chưa được ghi chi phí thực tế. Ghi số tiền và hóa đơn.`,
        refId: wo._id,
        link: '/app/fund',
      });
    } catch (err) {
      console.error('[UC10] Lỗi nhắc Kế toán ghi chi:', err);
    }
  }
  return count;
}
