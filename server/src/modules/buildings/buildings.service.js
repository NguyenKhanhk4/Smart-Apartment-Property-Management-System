import { AUDIT_ACTIONS } from '../../constants/enums.js';
import { Apartment } from '../../models/Apartment.js';
import { Building } from '../../models/Building.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';

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

/**
 * Tạo tòa nhà mới (Admin) — BR-A4
 */
export async function createBuilding({ code, name, address, totalFloors }, adminUser, ip) {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = name.trim();

  // Kiểm tra trùng mã hoặc tên tòa
  const [existingCode, existingName] = await Promise.all([
    Building.findOne({ code: normalizedCode }),
    Building.findOne({ name: normalizedName }),
  ]);

  if (existingCode) {
    throw ApiError.badRequest('Mã tòa nhà đã tồn tại');
  }
  if (existingName) {
    throw ApiError.badRequest('Tên tòa nhà đã tồn tại');
  }

  const building = await Building.create({
    code: normalizedCode,
    name: normalizedName,
    address: address?.trim() || '',
    totalFloors,
  });

  await logAudit({
    action: AUDIT_ACTIONS.BUILDING_CHANGED,
    user: adminUser,
    targetType: 'Building',
    targetId: building._id,
    metadata: {
      action: 'CREATE',
      code: building.code,
      name: building.name,
      totalFloors: building.totalFloors,
    },
    ip,
  });

  return building;
}

/**
 * Cập nhật thông tin tòa nhà (Admin) — BR-A4
 */
export async function updateBuilding(id, data, adminUser, ip) {
  const building = await Building.findById(id);
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }

  const changes = {};

  // Mã tòa: không được đổi khi tòa đã có căn hộ
  if (data.code !== undefined) {
    const normalizedCode = data.code.trim().toUpperCase();
    if (normalizedCode !== building.code) {
      const aptCount = await Apartment.countDocuments({ buildingId: id });
      if (aptCount > 0) {
        throw ApiError.badRequest('Không thể đổi mã tòa khi tòa đã có căn hộ');
      }

      const existingCode = await Building.findOne({ code: normalizedCode, _id: { $ne: id } });
      if (existingCode) {
        throw ApiError.badRequest('Mã tòa nhà đã tồn tại');
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
        throw ApiError.badRequest('Tên tòa nhà đã tồn tại');
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

  await building.save();

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.BUILDING_CHANGED,
      user: adminUser,
      targetType: 'Building',
      targetId: building._id,
      metadata: { action: 'UPDATE', changes },
      ip,
    });
  }

  return building;
}

/**
 * Xóa tòa nhà (Admin) — BR-A4
 */
export async function deleteBuilding(id, adminUser, ip) {
  const building = await Building.findById(id);
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }

  // BR-A4: Không xóa tòa khi còn căn hộ
  const aptCount = await Apartment.countDocuments({ buildingId: id });
  if (aptCount > 0) {
    throw ApiError.badRequest('Không thể xóa tòa nhà khi vẫn còn căn hộ');
  }

  await Building.findByIdAndDelete(id);

  await logAudit({
    action: AUDIT_ACTIONS.BUILDING_CHANGED,
    user: adminUser,
    targetType: 'Building',
    targetId: building._id,
    metadata: {
      action: 'DELETE',
      code: building.code,
      name: building.name,
    },
    ip,
  });

  return { message: 'Đã xóa tòa nhà thành công' };
}
