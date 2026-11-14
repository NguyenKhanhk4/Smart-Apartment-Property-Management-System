import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { Apartment, Building } from '../../models/index.js';
import { createInventory, linkedRecords, touchInventory } from './inventory.service.js';
import { withTransaction } from '../../utils/transaction.js';

/**
 * Danh sách toàn bộ tòa nhà kèm số lượng căn hộ mỗi tòa (UC-A05)
 */
export async function listBuildings() {
  const [buildings, counts] = await Promise.all([
    Building.find().sort({ code: 1 }).lean(),
    Apartment.aggregate([
      { $group: { _id: '$buildingId', count: { $sum: 1 } } },
    ]),
  ]);

  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  return buildings.map((b) => ({
    ...b,
    apartmentCount: countMap.get(String(b._id)) || 0,
  }));
}

/**
 * Lấy chi tiết tòa nhà theo ID
 */
export async function getBuildingById(id) {
  const building = await Building.findById(id).lean();
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }
  const apartmentCount = await Apartment.countDocuments({ buildingId: id });
  return { ...building, apartmentCount };
}

export async function getFloorPlan(buildingId, { floor, blockId }) {
  const building = await Building.findById(buildingId).select('totalFloors blocks').lean();
  if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
  if (floor > building.totalFloors) {
    throw ApiError.field('floor', 'Tầng không thuộc tòa nhà');
  }
  if (blockId && !building.blocks?.some((block) => block._id.equals(blockId))) {
    throw ApiError.field('blockId', 'Block không thuộc tòa nhà');
  }
  return Apartment.find({ buildingId, floor, ...(blockId && { blockId }) })
    .select('code blockId occupancyStatus')
    .sort({ code: 1 })
    .lean();
}

export async function saveBlock(buildingId, blockId, { code, name }, managerUser, ip) {
  const building = await Building.findById(buildingId);
  if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
  const existingBlock = blockId ? building.blocks?.id(blockId) : null;
  if (blockId && !existingBlock) throw ApiError.notFound('Block không tồn tại');

  const previous = existingBlock?.toObject();
  if (!building.blocks) building.blocks = [];
  const block = existingBlock ?? building.blocks.create({ code, name });
  const filter = {
    _id: buildingId,
    blocks: { $not: { $elemMatch: { code, _id: { $ne: block._id } } } },
  };
  if (blockId) filter['blocks._id'] = block._id;
  block.set({ code, name });
  const update = blockId
    ? { $set: { 'blocks.$[block].code': code, 'blocks.$[block].name': name } }
    : { $push: { blocks: block.toObject() } };
  const result = await Building.updateOne(filter, update, {
    runValidators: true,
    ...(blockId && { arrayFilters: [{ 'block._id': block._id }] }),
  });
  if (!result.matchedCount) throw new ApiError('DUPLICATE_VALUE', 'Mã block đã tồn tại trong tòa nhà');

  await logAudit({
    action: AUDIT_ACTIONS.BUILDING_CHANGED,
    user: managerUser,
    targetType: AUDIT_TARGETS.BUILDING,
    targetId: buildingId,
    metadata: { action: blockId ? 'UPDATE_BLOCK' : 'CREATE_BLOCK', from: previous, to: block.toObject() },
    ip,
  });
  return block;
}

/**
 * Tạo tòa nhà mới (Trưởng BQL) — BR-A4
 */
export const createBuilding = createInventory;

/**
 * Cập nhật thông tin tòa nhà (Trưởng BQL) — BR-A4
 */
export async function updateBuilding(id, data, managerUser, ip) {
  if (!data.reason?.trim() || !data.sourceReference?.trim()) {
    throw ApiError.badRequest('Cần lý do và tài liệu đối chiếu khi cập nhật tòa nhà');
  }
  return withTransaction(async (session) => {
  const building = await Building.findById(id).session(session);
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }

  await touchInventory(building, session);
  const changes = {};

  // Mã tòa: không được đổi khi tòa đã có căn hộ
  if (data.code !== undefined) {
    const normalizedCode = data.code.trim().toUpperCase();
    if (normalizedCode !== building.code) {
      const links = await linkedRecords('Building', id, session);
      if (links.length > 0) {
        throw new ApiError('STATUS_CONFLICT', 'Không thể đổi mã tòa đã có dữ liệu liên quan');
      }

      const existingCode = await Building.findOne({ code: normalizedCode, _id: { $ne: id } });
      if (existingCode) {
        throw new ApiError('DUPLICATE_VALUE', 'Mã tòa nhà đã tồn tại');
      }
      changes.code = { from: building.code, to: normalizedCode };
      building.code = normalizedCode;
    }
  }

  // Tên tòa: phải là duy nhất
  if (data.name !== undefined) {
    const normalizedName = data.name.trim();
    if (normalizedName !== building.name) {
      const existingName = await Building.findOne({ name: normalizedName, _id: { $ne: id } });
      if (existingName) {
        throw new ApiError('DUPLICATE_VALUE', 'Tên tòa nhà đã tồn tại');
      }
      changes.name = { from: building.name, to: normalizedName };
      building.name = normalizedName;
    }
  }

  // Địa chỉ
  if (data.address !== undefined) {
    const normalizedAddress = data.address?.trim() || '';
    if (normalizedAddress !== building.address) {
      changes.address = { from: building.address, to: normalizedAddress };
      building.address = normalizedAddress;
    }
  }

  // Tổng số tầng: không được giảm xuống dưới tầng cao nhất đang có căn hộ
  if (data.totalFloors !== undefined && data.totalFloors !== building.totalFloors) {
    if (building.inventoryConfirmedAt) {
      throw new ApiError('STATUS_CONFLICT', 'Hãy điều chỉnh số tầng trong bước đối chiếu danh mục');
    }
    const maxFloorApt = await Apartment.findOne({ buildingId: id })
      .sort({ floor: -1 })
      .select('floor')
      .lean();

    if (maxFloorApt && data.totalFloors < maxFloorApt.floor) {
      throw ApiError.badRequest(
        `Không thể giảm số tầng xuống dưới tầng cao nhất đang có căn hộ (tầng ${maxFloorApt.floor})`,
      );
    }
    changes.totalFloors = { from: building.totalFloors, to: data.totalFloors };
    building.totalFloors = data.totalFloors;
  }

  await building.save({ session });

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.BUILDING_CHANGED,
      user: managerUser,
      targetType: AUDIT_TARGETS.BUILDING,
      targetId: building._id,
      metadata: { action: 'UPDATE', changes, reason: data.reason, sourceReference: data.sourceReference },
      ip,
    }, { session });
  }

  return building;
  });
}

/**
 * Xóa tòa nhà (Trưởng BQL) — BR-A4
 */
export async function deleteBuilding(id, managerUser, ip) {
  return withTransaction(async (session) => {
    const building = await Building.findById(id).session(session);
    if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
    await touchInventory(building, session);
    const links = await linkedRecords('Building', id, session);
    if (links.length) throw new ApiError('STATUS_CONFLICT', 'Không thể xóa tòa nhà đã có căn hộ hoặc dữ liệu liên quan');
    await Building.deleteOne({ _id: id }, { session });
    await logAudit({ action: AUDIT_ACTIONS.BUILDING_CHANGED, user: managerUser,
      targetType: AUDIT_TARGETS.BUILDING, targetId: id,
      metadata: { action: 'DELETE', code: building.code, name: building.name }, ip }, { session });
    return { message: 'Đã xóa tòa nhà thành công' };
  });
}
