import { APARTMENT_OCCUPANCY, APARTMENT_STATUS, AUDIT_ACTIONS, AUDIT_TARGETS, CONTRACT_STATUS, CONTRACT_TYPES, VEHICLE_STATUS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { startOfVnDay, toVnYmd, vnDayStart } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { Apartment, Building, Contract, Resident, Vehicle } from '../../models/index.js';

function validateProperties(building, { blockId, grossArea, netArea }) {
  if (blockId && !building?.blocks?.id(blockId)) {
    throw ApiError.field('blockId', 'Block phải thuộc tòa nhà của căn hộ');
  }
  if (grossArea != null && netArea != null && netArea > grossArea) {
    throw ApiError.field('netArea', 'Diện tích thông thủy không được lớn hơn diện tích tim tường');
  }
}

function parseHandoverDate(value) {
  if (!value) return null;
  const date = vnDayStart(value);
  if (toVnYmd(date) !== value || value > toVnYmd(new Date())) {
    throw ApiError.field('handoverDate', 'Ngày bàn giao phải là ngày hợp lệ và không được ở tương lai');
  }
  return date;
}

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
  if (query.occupancyStatus) {
    filter.occupancyStatus = query.occupancyStatus;
  }
  if (query.q) {
    filter.code = new RegExp(escapeRegex(query.q.trim()), 'i');
  }

  return paginate(Apartment, filter, query, {
    populate: { path: 'buildingId', select: 'code name totalFloors blocks' },
  });
}

/**
 * Chi tiết căn hộ kèm hợp đồng ACTIVE, số cư dân và số xe APPROVED (UC-A05)
 */
export async function getApartmentById(id) {
  const apartment = await Apartment.findById(id)
    .populate('buildingId', 'code name address totalFloors blocks')
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
 * Tạo căn hộ mới (Trưởng BQL) — BR-A4
 */
export async function createApartment(data, managerUser, ip) {
  const { buildingId, code, floor, blockId, type, grossArea, netArea, technicalShaft } = data;
  const area = data.area ?? netArea;
  const handoverDate = parseHandoverDate(data.handoverDate);
  const building = await Building.findById(buildingId);
  if (!building) {
    throw ApiError.notFound('Tòa nhà không tồn tại');
  }

  validateProperties(building, data);
  const normalizedCode = code.trim().toUpperCase();

  // BR-A4: 1 <= floor <= totalFloors
  if (floor < 1 || floor > building.totalFloors) {
    throw ApiError.badRequest(
      `Tầng căn hộ phải nằm trong khoảng từ 1 đến ${building.totalFloors} (số tầng tòa ${building.name})`,
    );
  }

  // BR-A4: area > 0
  if (!Number.isFinite(area) || area < 1) {
    throw ApiError.badRequest('Diện tích dùng để tính phí phải từ 1 m² trở lên');
  }

  // BR-A4: Mã căn duy nhất trong tòa
  const existingApt = await Apartment.findOne({ buildingId, code: normalizedCode });
  if (existingApt) {
    throw new ApiError('DUPLICATE_VALUE', `Mã căn hộ ${normalizedCode} đã tồn tại trong tòa nhà này`);
  }

  // Giữ trạng thái hợp đồng độc lập với trạng thái vận hành trên sơ đồ.
  const apartment = await Apartment.create({
    buildingId,
    code: normalizedCode,
    floor,
    area,
    blockId,
    type,
    grossArea,
    netArea,
    technicalShaft,
    handoverDate,
    occupancyStatus: handoverDate ? APARTMENT_OCCUPANCY.VACANT : APARTMENT_OCCUPANCY.NOT_HANDED_OVER,
    status: APARTMENT_STATUS.VACANT,
  });

  await logAudit({
    action: AUDIT_ACTIONS.APARTMENT_CHANGED,
    user: managerUser,
    targetType: AUDIT_TARGETS.APARTMENT,
    targetId: apartment._id,
    metadata: {
      action: 'CREATE',
      code: apartment.code,
      buildingId,
      floor,
      area,
      blockId,
      handoverDate,
      occupancyStatus: apartment.occupancyStatus,
    },
    ip,
  });

  return apartment;
}

/**
 * Cập nhật căn hộ (Trưởng BQL) — BR-A4
 */
export async function updateApartment(id, data, managerUser, ip) {
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
  validateProperties(building, {
    blockId: data.blockId === undefined ? apartment.blockId : data.blockId,
    grossArea: data.grossArea ?? apartment.grossArea,
    netArea: data.netArea ?? apartment.netArea,
  });

  if (data.code !== undefined) {
    const normalizedCode = data.code.trim().toUpperCase();
    if (normalizedCode !== apartment.code) {
      const existing = await Apartment.findOne({
        buildingId: apartment.buildingId,
        code: normalizedCode,
        _id: { $ne: id },
      });
      if (existing) {
        throw new ApiError('DUPLICATE_VALUE', `Mã căn hộ ${normalizedCode} đã tồn tại trong tòa nhà này`);
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
    if (data.area < 1) {
      throw ApiError.badRequest('Diện tích dùng để tính phí phải từ 1 m² trở lên');
    }
    changes.area = { from: apartment.area, to: data.area };
    apartment.area = data.area;
  }

  for (const field of ['blockId', 'type', 'grossArea', 'netArea', 'technicalShaft']) {
    if (data[field] === undefined || String(data[field]) === String(apartment[field])) continue;
    changes[field] = { from: apartment[field], to: data[field] };
    apartment[field] = data[field];
  }

  if (data.handoverDate !== undefined) {
    const date = parseHandoverDate(data.handoverDate);
    if (!date && apartment.handoverDate) {
      throw ApiError.field('handoverDate', 'Không thể xóa ngày bàn giao đã ghi nhận');
    }
    if (date && date.getTime() !== apartment.handoverDate?.getTime()) {
      changes.handoverDate = { from: apartment.handoverDate, to: date };
      if (!apartment.handoverDate) {
        const activeLease = await Contract.exists({
          apartmentId: id,
          type: CONTRACT_TYPES.LEASE,
          status: CONTRACT_STATUS.ACTIVE,
          startDate: { $lte: new Date() },
          endDate: { $gte: startOfVnDay() },
        });
        const status = activeLease ? APARTMENT_OCCUPANCY.RENTED : APARTMENT_OCCUPANCY.VACANT;
        changes.occupancyStatus = { from: apartment.occupancyStatus, to: status };
        apartment.occupancyStatus = status;
      }
      apartment.handoverDate = date;
    }
  }

  await apartment.save();

  if (Object.keys(changes).length > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.APARTMENT_CHANGED,
      user: managerUser,
      targetType: AUDIT_TARGETS.APARTMENT,
      targetId: apartment._id,
      metadata: { action: 'UPDATE', changes },
      ip,
    });
  }

  return apartment;
}

async function changeOccupancy(id, resolveChange, actor, ip) {
  return withTransaction(async (session) => {
    const apartment = await Apartment.findById(id).session(session);
    if (!apartment) throw ApiError.notFound('Căn hộ không tồn tại');
    if (!apartment.handoverDate) {
      throw new ApiError('STATUS_CONFLICT', 'Cần xác nhận ngày bàn giao trước khi cập nhật cư trú');
    }
    const { status, ...metadata } = await resolveChange(session);
    const previousStatus = apartment.occupancyStatus;
    if (previousStatus === status) return apartment;

    apartment.occupancyStatus = status;
    await apartment.save({ session });
    await logAudit({
      action: AUDIT_ACTIONS.APARTMENT_CHANGED,
      user: actor,
      targetType: AUDIT_TARGETS.APARTMENT,
      targetId: apartment._id,
      metadata: { ...metadata, changes: { occupancyStatus: { from: previousStatus, to: status } } },
      ip,
    }, { session });
    return apartment;
  });
}

export function setOccupancyStatus(id, { status, reason }, managerUser, ip) {
  return changeOccupancy(id, () => ({ status, reason, action: 'SET_OCCUPANCY_STATUS' }), managerUser, ip);
}

export function confirmMoveIn(id, receptionist, ip) {
  return changeOccupancy(id, async (session) => {
    const today = startOfVnDay();
    const contracts = await Contract.find({
      apartmentId: id,
      status: CONTRACT_STATUS.ACTIVE,
      startDate: { $lte: today },
    }).select('type endDate').session(session).lean();
    const owner = contracts.find((contract) => contract.type === CONTRACT_TYPES.SALE);
    if (!owner) {
      throw new ApiError('STATUS_CONFLICT', 'Cần hợp đồng mua bán đang hiệu lực để xác nhận vào ở');
    }
    const lease = contracts.find((contract) => contract.type === CONTRACT_TYPES.LEASE && contract.endDate >= today);
    return {
      action: 'CONFIRM_MOVE_IN',
      status: lease ? APARTMENT_OCCUPANCY.RENTED : APARTMENT_OCCUPANCY.OWNER_OCCUPIED,
      contractId: (lease ?? owner)._id,
    };
  }, receptionist, ip);
}

/**
 * Xóa căn hộ (Trưởng BQL) — BR-A4
 */
export async function deleteApartment(id, managerUser, ip) {
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
    throw new ApiError('STATUS_CONFLICT', 'Không thể xóa căn hộ đã có hợp đồng, cư dân hoặc phương tiện liên kết');
  }

  await Apartment.findByIdAndDelete(id);

  await logAudit({
    action: AUDIT_ACTIONS.APARTMENT_CHANGED,
    user: managerUser,
    targetType: AUDIT_TARGETS.APARTMENT,
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
