// UC07 – Quản lý thiết bị và lịch bảo trì (BR-E01, BR-E02, BR-O17..O19)
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, CYCLE_UNITS, WORK_ORDER_ACTIVE_STATUSES, WORK_ORDER_OPEN_STATUSES as OPEN_WO_STATUSES, WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { Asset, Building, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { DAY_MS, VN_OFFSET_MS, endOfVnDay, startOfVnDay } from '../../utils/time.js';

const LIST_POPULATE = [{ path: 'buildingId', select: 'code name' }];

/**
 * Đúng hạn = kiểm tra (UC08: inspectedAt; phiếu cũ: completedAt) không muộn hơn 1 ngày sau ngày lên lịch (khớp báo cáo UC-E12).
 * Đo theo lúc kiểm tra để phiếu có sự cố phải chờ sửa lâu không bị tính trễ hạn kiểm tra.
 */
export const isOnTime = (wo) => {
  const at = wo.inspectedAt ?? wo.completedAt;
  return Boolean(at) && new Date(at).getTime() <= new Date(wo.scheduledDate ?? wo.createdAt).getTime() + DAY_MS;
};

const MONTHS_OF = { [CYCLE_UNITS.MONTH]: 1, [CYCLE_UNITS.QUARTER]: 3 };

/**
 * BR-O18, BR-E02: ngày bảo trì tiếp theo = ngày gần nhất (hoặc `fallback`) + chu kỳ, theo lịch giờ Việt Nam.
 * Chu kỳ tháng / quý giữ ngày trong tháng; tháng đích ngắn hơn thì lùi về ngày cuối tháng (31/01 + 1 tháng = 28/02).
 * @param cycle { cycleValue, cycleUnit }
 */
export function computeNextMaintenance(lastMaintenanceDate, { cycleValue, cycleUnit }, fallback = new Date()) {
  const base = startOfVnDay(lastMaintenanceDate ?? fallback);
  const months = MONTHS_OF[cycleUnit];
  if (!months) return new Date(base.getTime() + cycleValue * DAY_MS);
  const vn = new Date(base.getTime() + VN_OFFSET_MS); // đọc ngày / tháng / năm theo giờ VN bằng getUTC*
  const target = vn.getUTCMonth() + cycleValue * months;
  const year = vn.getUTCFullYear() + Math.floor(target / 12);
  const month = target % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(vn.getUTCDate(), lastDay)) - VN_OFFSET_MS);
}

const cycleOf = (asset) => ({ cycleValue: asset.cycleValue, cycleUnit: asset.cycleUnit });

/** BR-E02: mẫu checklist có ít nhất 1 mục, không trùng tên mục; mục đo có khoảng cho phép thì min ≤ max */
function assertValidChecklist(checklist) {
  if (!Array.isArray(checklist) || !checklist.length) {
    throw ApiError.field('checklist', 'Mẫu checklist cần ít nhất 1 mục');
  }
  const seen = new Set();
  checklist.forEach((item, i) => {
    const key = item.label.trim().toLowerCase();
    if (seen.has(key)) throw ApiError.field(`checklist.${i}.label`, `Trùng mục "${item.label}"`);
    seen.add(key);
    if (item.minValue != null && item.maxValue != null && item.minValue > item.maxValue) {
      throw ApiError.field(`checklist.${i}.minValue`, `"${item.label}": giá trị nhỏ nhất lớn hơn giá trị lớn nhất`);
    }
  });
}

/** Ngày hết bảo hành không trước ngày lắp đặt */
function assertDates(installDate, warrantyEnd) {
  if (installDate && warrantyEnd && new Date(warrantyEnd) < new Date(installDate)) {
    throw ApiError.field('warrantyEnd', 'Ngày hết bảo hành phải sau ngày lắp đặt');
  }
}

async function findAssetOr404(id) {
  const asset = await Asset.findById(id);
  if (!asset) throw ApiError.notFound('Không tìm thấy thiết bị');
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

const codeExists = () => new ApiError('ASSET_CODE_EXISTS', undefined, { details: [{ field: 'code', message: 'Mã thiết bị đã tồn tại' }] });

/**
 * Lưu thiết bị, chặn trùng mã (MSG-E01). Kiểm tra trước khi lưu, không chỉ chờ index uniq_asset_code:
 * DB chưa chạy migrate (thiết bị cũ chưa có mã) thì chưa có index này. Index vẫn chặn khi 2 request lưu cùng lúc.
 */
async function saveAsset(asset) {
  if (asset.isModified('code') && (await Asset.exists({ code: asset.code, _id: { $ne: asset._id } }))) throw codeExists();
  try {
    return await asset.save();
  } catch (err) {
    if (err?.code === 11000 && (err.keyPattern?.code || /uniq_asset_code/.test(err.message))) throw codeExists();
    throw err;
  }
}

// ===== Nhật ký: giá trị cũ / mới của các trường thay đổi =====
const AUDITED_FIELDS = [
  'code', 'name', 'category', 'location', 'buildingId', 'manufacturer', 'installDate', 'warrantyEnd', 'vendorName',
  'vendorPhone', 'cycleValue', 'cycleUnit', 'lastMaintenanceDate', 'nextMaintenanceDate', 'note',
];
const plain = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v.toHexString === 'function') return v.toHexString();
  return v ?? null;
};
export function assetDiff(before, after) {
  const changed = AUDITED_FIELDS.filter((k) => JSON.stringify(plain(before[k])) !== JSON.stringify(plain(after[k])));
  const diff = {
    before: Object.fromEntries(changed.map((k) => [k, plain(before[k])])),
    after: Object.fromEntries(changed.map((k) => [k, plain(after[k])])),
  };
  const checklistOf = (a) => JSON.stringify((a.checklist ?? []).map((i) => ({ ...i })));
  if (checklistOf(before) !== checklistOf(after)) {
    diff.before.checklist = `${(before.checklist ?? []).length} mục`;
    diff.after.checklist = `${(after.checklist ?? []).length} mục`;
  }
  return diff;
}
const snapshot = (asset) => {
  const o = asset.toObject();
  o.checklist = (o.checklist ?? []).map((i) => ({ ...i }));
  return o;
};

// ===== UC07 bước 1: danh sách thiết bị =====
export async function listAssets(query) {
  const filter = {};
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.category) filter.category = { $in: query.category };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.dueWithinDays !== undefined) {
    // "Đến hạn" chỉ có nghĩa với thiết bị đang theo dõi, trừ khi người dùng lọc rõ isActive
    filter.isActive = query.isActive ?? true;
    filter.nextMaintenanceDate = { $lte: endOfVnDay(new Date(Date.now() + query.dueWithinDays * DAY_MS)) };
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: re }, { code: re }];
  }

  const result = await paginate(Asset, filter, query, { populate: LIST_POPULATE });
  const openWos = await WorkOrder.find({
    assetId: { $in: result.items.map((a) => a._id) },
    status: { $in: OPEN_WO_STATUSES },
  })
    .select('assetId status assignedTo scheduledDate repair.reviewDate')
    .populate('assignedTo', 'fullName')
    .lean();
  const byAsset = {};
  const postponed = {};
  for (const w of openWos) {
    if (w.status === WORK_ORDER_STATUS.REPAIR_POSTPONED) postponed[String(w.assetId)] = { _id: w._id, reviewDate: w.repair?.reviewDate ?? null };
    else byAsset[String(w.assetId)] = w;
  }
  const today = startOfVnDay();
  result.items = result.items.map((a) => ({
    ...a,
    openWorkOrder: byAsset[String(a._id)] ?? null,
    postponedRepair: postponed[String(a._id)] ?? null, // UC10: đang tạm hoãn sửa
    isDue: a.isActive && a.nextMaintenanceDate <= endOfVnDay(today),
  }));
  return result;
}

// ===== UC07 bước 5: chi tiết + work order đang mở =====
export async function getAsset(id) {
  const asset = await Asset.findById(id)
    .populate(LIST_POPULATE)
    .populate('createdBy', 'fullName')
    .lean();
  if (!asset) throw ApiError.notFound('Không tìm thấy thiết bị');
  const [openWorkOrder, postponedRepair, doneCount] = await Promise.all([
    WorkOrder.findOne({ assetId: id, status: { $in: WORK_ORDER_ACTIVE_STATUSES } })
      .populate('assignedTo', 'fullName phone')
      .lean(),
    WorkOrder.findOne({ assetId: id, status: WORK_ORDER_STATUS.REPAIR_POSTPONED }).populate('assignedTo', 'fullName').lean(), // UC10
    WorkOrder.countDocuments({ assetId: id, status: WORK_ORDER_STATUS.DONE }),
  ]);
  return {
    ...asset,
    openWorkOrder,
    postponedRepair,
    doneCount,
    isDue: asset.isActive && asset.nextMaintenanceDate <= endOfVnDay(),
  };
}

// ===== UC07 bước 5: lịch sử bảo trì (work order DONE, mới nhất trước, đúng hạn/trễ hạn) =====
export async function getAssetHistory(id, query) {
  if (!(await Asset.exists({ _id: id }))) throw ApiError.notFound('Không tìm thấy thiết bị');
  const result = await paginate(
    WorkOrder,
    { assetId: id, status: { $in: [WORK_ORDER_STATUS.DONE, WORK_ORDER_STATUS.CLOSED] } }, // CLOSED: ngừng sử dụng (UC10)
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

// ===== UC07 bước 2–4: thêm thiết bị — tính ngày bảo trì kế tiếp, sinh mã QR (MSG-E02) =====
export async function createAsset(user, body, { ip } = {}) {
  await assertBuildingExists(body.buildingId);
  assertNotFuture(body.lastMaintenanceDate);
  assertValidChecklist(body.checklist);
  assertDates(body.installDate, body.warrantyEnd);
  const lastMaintenanceDate = body.lastMaintenanceDate ? startOfVnDay(body.lastMaintenanceDate) : null;
  const asset = new Asset({
    ...body,
    lastMaintenanceDate,
    nextMaintenanceDate: computeNextMaintenance(lastMaintenanceDate, cycleOf(body)),
    isActive: true,
    createdBy: user.id,
  });
  const saved = await saveAsset(asset);
  await logAudit({
    action: AUDIT_ACTIONS.ASSET_CREATED,
    user,
    targetType: AUDIT_TARGETS.ASSET,
    targetId: saved._id,
    after: { code: saved.code, name: saved.name, cycleValue: saved.cycleValue, cycleUnit: saved.cycleUnit, checklist: `${saved.checklist.length} mục` },
    ip,
  });
  return saved;
}

const sameDay = (a, b) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

// ===== UC07 bước 6: sửa thiết bị — đổi chu kỳ / ngày gần nhất thì tính lại ngày kế tiếp (BR-O18) =====
// Chỉ tính lại khi giá trị THỰC SỰ đổi: sửa tên / vị trí / ghi chú không làm lùi hay dời lịch bảo trì.
// Thiết bị chưa từng bảo trì: mốc là ngày tạo, không phải ngày sửa, để việc sửa thông tin không vô tình hoãn
// một thiết bị đang đến hạn. Mã QR không bao giờ đổi (BR-E01). Đổi checklist không ảnh hưởng phiếu đã tạo.
export async function updateAsset(id, body, { user, ip } = {}) {
  const asset = await findAssetOr404(id);
  const before = snapshot(asset);
  if (body.buildingId && String(body.buildingId) !== String(asset.buildingId)) {
    await assertBuildingExists(body.buildingId);
  }
  if (body.checklist !== undefined) assertValidChecklist(body.checklist);
  assertDates(body.installDate !== undefined ? body.installDate : asset.installDate, body.warrantyEnd !== undefined ? body.warrantyEnd : asset.warrantyEnd);
  let lastChanged = false;
  if ('lastMaintenanceDate' in body) {
    assertNotFuture(body.lastMaintenanceDate);
    body.lastMaintenanceDate = body.lastMaintenanceDate ? startOfVnDay(body.lastMaintenanceDate) : null;
    lastChanged = !sameDay(body.lastMaintenanceDate, asset.lastMaintenanceDate);
  }
  const cycleChanged =
    (body.cycleValue !== undefined && body.cycleValue !== asset.cycleValue) ||
    (body.cycleUnit !== undefined && body.cycleUnit !== asset.cycleUnit);
  asset.set(body);
  if (lastChanged || cycleChanged) {
    asset.nextMaintenanceDate = computeNextMaintenance(asset.lastMaintenanceDate, cycleOf(asset), asset.createdAt);
  }
  const saved = await saveAsset(asset);
  const diff = assetDiff(before, snapshot(saved));
  if (Object.keys(diff.after).length) {
    await logAudit({ action: AUDIT_ACTIONS.ASSET_UPDATED, user, targetType: AUDIT_TARGETS.ASSET, targetId: saved._id, ...diff, ip });
  }
  return saved;
}

// ===== UC07 bước 6: ngừng theo dõi / kích hoạt lại (BR-O19) =====
export async function setAssetStatus(id, isActive, { user, ip } = {}) {
  const asset = await findAssetOr404(id);
  const wasActive = asset.isActive;
  if (!isActive && (await WorkOrder.exists({ assetId: id, status: { $in: OPEN_WO_STATUSES } }))) {
    throw new ApiError('ASSET_HAS_OPEN_WORKORDER');
  }
  asset.isActive = isActive;
  await asset.save();
  // Job tạo phiếu có thể vừa tạo work order xen giữa lúc kiểm tra và lúc ghi → kiểm tra lại sau khi ghi.
  // Job cũng đọc lại isActive sau khi tạo, nên ít nhất một bên thấy bên kia (không còn thiết bị ngừng mà có WO mở).
  if (!isActive && (await WorkOrder.exists({ assetId: id, status: { $in: OPEN_WO_STATUSES } }))) {
    await Asset.updateOne({ _id: id }, { isActive: true });
    throw new ApiError('ASSET_HAS_OPEN_WORKORDER');
  }
  if (wasActive !== isActive) {
    await logAudit({
      action: isActive ? AUDIT_ACTIONS.ASSET_REACTIVATED : AUDIT_ACTIONS.ASSET_DEACTIVATED,
      user,
      targetType: AUDIT_TARGETS.ASSET,
      targetId: asset._id,
      before: { isActive: wasActive },
      after: { isActive },
      ip,
    });
  }
  return asset;
}
