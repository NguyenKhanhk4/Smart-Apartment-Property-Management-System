import { APARTMENT_STATUS, AUDIT_ACTIONS, CONTRACT_STATUS, VEHICLE_STATUS } from '../../constants/enums.js';
import { Apartment } from '../../models/Apartment.js';
import { Building } from '../../models/Building.js';
import { Contract } from '../../models/Contract.js';
import { Resident } from '../../models/Resident.js';
import { Vehicle } from '../../models/Vehicle.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';

/**
 * Danh sách căn hộ phân trang, lọc theo tòa/tầng/trạng thái/mã căn (UC-A05)
 */
export async function listApartments(query = {}) {
  const filter = {};

  if (query.buildingId) {
    filter.buildingId = query.buildingId;
  }
  if (query.floor !== undefined) {
    filter.floor = query.floor;
  }
  if (query.status) {
    filter.status = query.status;
  }
  if (query.q) {
    filter.code = new RegExp(escapeRegex(query.q.trim()), 'i');
  }

  return paginate(Apartment, filter, query, {
    populate: { path: 'buildingId', select: 'code name totalFloors' },
  });
}

/**
 * Chi tiết căn hộ kèm hợp đồng ACTIVE, số cư dân và số xe APPROVED (UC-A05)
 */
export async function getApartmentById(id) {
  const apartment = await Apartment.findById(id)
    .populate('buildingId', 'code name address totalFloors')
    .lean();

  if (!apartment) {
    throw ApiError.notFound('Căn hộ không tồn tại');
  }

  const [activeContracts, activeResidentsCount, approvedVehiclesCount] = await Promise.all([
    Contract.find({ apartmentId: id, status: CONTRACT_STATUS.ACTIVE })
      .populate('ownerId', 'fullName email phone')
      .populate('tenantId', 'fullName email phone')
      .lean(),
    Resident.countDocuments({ apartmentId: id, isActive: true }),
    Vehicle.countDocuments({ apartmentId: id, status: VEHICLE_STATUS.APPROVED }),
  ]);

  return {
    ...apartment,
    building: apartment.buildingId,
    activeContracts,
    activeResidentsCount,
    approvedVehiclesCount,
  };
}

/**
 * Tạo căn hộ mới (Admin) — BR-A4
 */
export async function createApartment({ buildingId, code, floor, area }, adminUser, ip) {
  const building = await Building.findById(buildingId);
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }

  const normalizedCode = code.trim().toUpperCase();

  // BR-A4: 1 <= floor <= totalFloors
  if (floor < 1 || floor > building.totalFloors) {
    throw ApiError.badRequest(
      `Tầng căn hộ phải nằm trong khoảng từ 1 đến ${building.totalFloors} (số tầng tòa ${building.name})`,
    );
  }

  // BR-A4: area > 0
  if (area <= 0) {
    throw ApiError.badRequest('Diện tích căn hộ phải lớn hơn 0');
  }

  // BR-A4: Mã căn duy nhất trong tòa
  const existingApt = await Apartment.findOne({ buildingId, code: normalizedCode });
  if (existingApt) {
    throw ApiError.badRequest(`Mã căn hộ ${normalizedCode} đã tồn tại trong tòa nhà này`);
  }

  // BR-A4: tạo với VACANT
  const apartment = await Apartment.create({
    buildingId,
    code: normalizedCode,
    floor,
    area,
    status: APARTMENT_STATUS.VACANT,
  });

  await logAudit({
    action: AUDIT_ACTIONS.APARTMENT_CHANGED,
    user: adminUser,
    targetType: 'Apartment',
    targetId: apartment._id,
    metadata: {
      action: 'CREATE',
      code: apartment.code,
      buildingId,
      floor,
      area,
    },
    ip,
  });

  return apartment;
}

/**
 * Cập nhật căn hộ (Admin) — BR-A4
 */
export async function updateApartment(id, data, adminUser, ip) {
  // BR-A4: Không cho sửa status trực tiếp
  if (data.status !== undefined) {
    throw ApiError.badRequest('Trạng thái căn hộ chỉ do hợp đồng quyết định, không thể sửa trực tiếp');
  }

  const apartment = await Apartment.findById(id);
  if (!apartment) {
    throw ApiError.notFound('Căn hộ không tồn tại');
  }

  const building = await Building.findById(apartment.buildingId);
  const changes = {};

  if (data.code !== undefined) {
    const normalizedCode = data.code.trim().toUpperCase();
    if (normalizedCode !== apartment.code) {
      const existing = await Apartment.findOne({
        buildingId: apartment.buildingId,
        code: normalizedCode,
        _id: { $ne: id },
      });
      if (existing) {
        throw ApiError.badRequest(`Mã căn hộ ${normalizedCode} đã tồn tại trong tòa nhà này`);
      }
      changes.code = { from: apartment.code, to: normalizedCode };
      apartment.code = normalizedCode;
    }
  }

  if (data.floor !== undefined && data.floor !== apartment.floor) {
    if (data.floor < 1 || (building && data.floor > building.totalFloors)) {
      throw ApiError.badRequest(
        `Tầng căn hộ phải nằm trong khoảng từ 1 đến ${building?.totalFloors || 1}`,
      );
    }
    changes.floor = { from: apartment.floor, to: data.floor };
    apartment.floor = data.floor;
  }

  if (data.area !== undefined && data.area !== apartment.area) {
    if (data.area <= 0) {
      throw ApiError.badRequest('Diện tích căn hộ phải lớn hơn 0');
    }
    changes.area = { from: apartment.area, to: data.area };
    apartment.area = data.area;
  }

  await apartment.save();

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.APARTMENT_CHANGED,
      user: adminUser,
      targetType: 'Apartment',
      targetId: apartment._id,
      metadata: { action: 'UPDATE', changes },
      ip,
    });
  }

  return apartment;
}

/**
 * Xóa căn hộ (Admin) — BR-A4
 */
export async function deleteApartment(id, adminUser, ip) {
  const apartment = await Apartment.findById(id);
  if (!apartment) {
    throw ApiError.notFound('Căn hộ không tồn tại');
  }

  // BR-A4: Xóa căn đã có contract/resident/vehicle → VALIDATION_ERROR
  const [contractCount, residentCount, vehicleCount] = await Promise.all([
    Contract.countDocuments({ apartmentId: id }),
    Resident.countDocuments({ apartmentId: id }),
    Vehicle.countDocuments({ apartmentId: id }),
  ]);

  if (contractCount > 0 || residentCount > 0 || vehicleCount > 0) {
    throw ApiError.badRequest('Không thể xóa căn hộ đã có hợp đồng, cư dân hoặc phương tiện liên kết');
  }

  await Apartment.findByIdAndDelete(id);

  await logAudit({
    action: AUDIT_ACTIONS.APARTMENT_CHANGED,
    user: adminUser,
    targetType: 'Apartment',
    targetId: apartment._id,
    metadata: {
      action: 'DELETE',
      code: apartment.code,
      buildingId: apartment.buildingId,
    },
    ip,
  });

  return { message: 'Đã xóa căn hộ thành công' };
}
