import { WORK_ORDER_STATUS } from '../../constants/enums.js';
import { Asset, Building, WorkOrder } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { DAY_MS, endOfVnDay, startOfVnDay } from '../../utils/time.js';

export const OPEN_WO_STATUSES = [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PROGRESS];

const LIST_POPULATE = [{ path: 'buildingId', select: 'code name' }];

/** Work order đúng hạn = hoàn thành không muộn hơn 1 ngày sau ngày lên lịch (khớp báo cáo UC-E12) */
export const isOnTime = (wo) =>
  Boolean(wo.completedAt) &&
  new Date(wo.completedAt).getTime() <= new Date(wo.scheduledDate ?? wo.createdAt).getTime() + DAY_MS;

/** BR-O18: ngày bảo trì tiếp theo = ngày gần nhất (hoặc `fallback`) + chu kỳ */
export function computeNextMaintenance(lastMaintenanceDate, cycleDays, fallback = new Date()) {
  const base = startOfVnDay(lastMaintenanceDate ?? fallback);
  return new Date(base.getTime() + cycleDays * DAY_MS);
}

async function findAssetOr404(id) {
  const asset = await Asset.findById(id);
  if (!asset) throw ApiError.notFound('Không tìm thấy tài sản');
  return asset;
}

async function assertBuildingExists(buildingId) {
  if (!(await Building.exists({ _id: buildingId }))) {
    throw ApiError.badRequest('Tòa nhà không tồn tại', [{ field: 'buildingId', message: 'Không tồn tại' }]);
  }
}

function assertNotFuture(date) {
  if (date && date > endOfVnDay()) {
    throw ApiError.badRequest('Ngày bảo trì gần nhất không được ở tương lai', [
      { field: 'lastMaintenanceDate', message: 'Không được ở tương lai' },
    ]);
  }
}

/** Lưu tài sản, đổi lỗi trùng tên trong tòa (unique index) thành ASSET_NAME_EXISTS (BR-O17) */
async function saveAsset(asset) {
  try {
    return await asset.save();
  } catch (err) {
    if (err?.code === 11000) throw new ApiError('ASSET_NAME_EXISTS');
    throw err;
  }
}

// ===== UC-D01: danh sách tài sản =====
export async function listAssets(query) {
  const filter = {};
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.category) filter.category = { $in: query.category };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.dueWithinDays !== undefined) {
    // "Đến hạn" chỉ có nghĩa với tài sản đang theo dõi, trừ khi người dùng lọc rõ isActive
    filter.isActive = query.isActive ?? true;
    filter.nextMaintenanceDate = { $lte: endOfVnDay(new Date(Date.now() + query.dueWithinDays * DAY_MS)) };
  }
  if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');

  const result = await paginate(Asset, filter, query, { populate: LIST_POPULATE });
  const openWos = await WorkOrder.find({
    assetId: { $in: result.items.map((a) => a._id) },
    status: { $in: OPEN_WO_STATUSES },
  })
    .select('assetId status assignedTo scheduledDate')
    .populate('assignedTo', 'fullName')
    .lean();
  const byAsset = Object.fromEntries(openWos.map((w) => [String(w.assetId), w]));
  const today = startOfVnDay();
  result.items = result.items.map((a) => ({
    ...a,
    openWorkOrder: byAsset[String(a._id)] ?? null,
    isDue: a.isActive && a.nextMaintenanceDate <= endOfVnDay(today),
  }));
  return result;
}

// ===== UC-D01 bước 6: chi tiết + work order đang mở =====
export async function getAsset(id) {
  const asset = await Asset.findById(id)
    .populate(LIST_POPULATE)
    .populate('createdBy', 'fullName')
    .lean();
  if (!asset) throw ApiError.notFound('Không tìm thấy tài sản');
  const [openWorkOrder, doneCount] = await Promise.all([
    WorkOrder.findOne({ assetId: id, status: { $in: OPEN_WO_STATUSES } })
      .populate('assignedTo', 'fullName phone')
      .lean(),
    WorkOrder.countDocuments({ assetId: id, status: WORK_ORDER_STATUS.DONE }),
  ]);
  return {
    ...asset,
    openWorkOrder,
    doneCount,
    isDue: asset.isActive && asset.nextMaintenanceDate <= endOfVnDay(),
  };
}

// ===== UC-D01 bước 6: lịch sử bảo trì (work order DONE, mới nhất trước, đúng hạn/trễ hạn) =====
export async function getAssetHistory(id, query) {
  if (!(await Asset.exists({ _id: id }))) throw ApiError.notFound('Không tìm thấy tài sản');
  const result = await paginate(
    WorkOrder,
    { assetId: id, status: WORK_ORDER_STATUS.DONE },
    { ...query, sort: '-completedAt' },
    {
      populate: [
        { path: 'assignedTo', select: 'fullName' },
        { path: 'assignedBy', select: 'fullName' },
      ],
    },
  );
  result.items = result.items.map((w) => ({ ...w, onTime: isOnTime(w) }));
  return result;
}

// ===== UC-D01: thêm tài sản =====
export async function createAsset(user, body) {
  await assertBuildingExists(body.buildingId);
  assertNotFuture(body.lastMaintenanceDate);
  const lastMaintenanceDate = body.lastMaintenanceDate ? startOfVnDay(body.lastMaintenanceDate) : null;
  const asset = new Asset({
    ...body,
    lastMaintenanceDate,
    nextMaintenanceDate: computeNextMaintenance(lastMaintenanceDate, body.maintenanceCycleDays),
    isActive: true,
    createdBy: user.id,
  });
  return saveAsset(asset);
}

const sameDay = (a, b) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

// ===== UC-D01: sửa tài sản — đổi chu kỳ/ngày gần nhất thì tính lại ngày kế tiếp (BR-O18) =====
// Chỉ tính lại khi giá trị THỰC SỰ đổi: sửa tên/vị trí/ghi chú không làm lùi hay dời lịch bảo trì.
// Tài sản chưa từng bảo trì: mốc là ngày tạo (chính là "hôm nay" lúc thêm, BR-O18), không phải ngày sửa,
// để việc sửa thông tin không vô tình hoãn một tài sản đang đến hạn.
export async function updateAsset(id, body) {
  const asset = await findAssetOr404(id);
  if (body.buildingId && String(body.buildingId) !== String(asset.buildingId)) {
    await assertBuildingExists(body.buildingId);
  }
  let lastChanged = false;
  if ('lastMaintenanceDate' in body) {
    assertNotFuture(body.lastMaintenanceDate);
    body.lastMaintenanceDate = body.lastMaintenanceDate ? startOfVnDay(body.lastMaintenanceDate) : null;
    lastChanged = !sameDay(body.lastMaintenanceDate, asset.lastMaintenanceDate);
  }
  const cycleChanged =
    body.maintenanceCycleDays !== undefined && body.maintenanceCycleDays !== asset.maintenanceCycleDays;
  asset.set(body);
  if (lastChanged || cycleChanged) {
    asset.nextMaintenanceDate = computeNextMaintenance(
      asset.lastMaintenanceDate,
      asset.maintenanceCycleDays,
      asset.createdAt,
    );
  }
  return saveAsset(asset);
}

// ===== UC-D01: ngừng theo dõi / kích hoạt lại (BR-O19) =====
export async function setAssetStatus(id, isActive) {
  const asset = await findAssetOr404(id);
  if (!isActive && (await WorkOrder.exists({ assetId: id, status: { $in: OPEN_WO_STATUSES } }))) {
    throw new ApiError('ASSET_HAS_OPEN_WORKORDER');
  }
  asset.isActive = isActive;
  return asset.save();
}
