import {
  AUDIT_ACTIONS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  RELATION_TYPES,
  ROLE_TITLES,
  VEHICLE_STATUS,
  VEHICLE_TYPES,
} from '../../constants/enums.js';
import { Resident, Vehicle } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';

/**
 * BR-A6: Chuẩn hóa biển số xe (in hoa, bỏ khoảng trắng và dấu chấm; rỗng -> null).
 * Bắt buộc đối với MOTORBIKE / CAR, xe đạp có thể null.
 */
export function normalizePlate(raw, type) {
  if (type === VEHICLE_TYPES.BICYCLE) {
    if (!raw) return null;
    const cleaned = String(raw).trim().toUpperCase().replace(/[\s.-]/g, '');
    return cleaned || null;
  }

  if (!raw) {
    throw ApiError.badRequest('Biển số xe là bắt buộc đối với xe máy và ô tô', [
      { field: 'plateNumber', message: 'Biển số xe là bắt buộc' },
    ]);
  }

  const cleaned = String(raw).trim().toUpperCase().replace(/[\s.-]/g, '');
  if (!cleaned) {
    throw ApiError.badRequest('Biển số xe là bắt buộc đối với xe máy và ô tô', [
      { field: 'plateNumber', message: 'Biển số xe là bắt buộc' },
    ]);
  }

  return cleaned;
}

/**
 * BR-A6: Kiểm tra sức chứa bãi xe. Xe máy và ô tô đếm số xe APPROVED so với cấu hình.
 * Xe đạp không giới hạn chỗ.
 */
export async function assertCapacity(type) {
  if (type === VEHICLE_TYPES.BICYCLE) {
    return;
  }

  if (type === VEHICLE_TYPES.MOTORBIKE) {
    const capacity = await getConfig(CONFIG_KEYS.PARKING_CAPACITY_MOTORBIKE, 500);
    const count = await Vehicle.countDocuments({ type, status: VEHICLE_STATUS.APPROVED });
    if (count >= capacity) {
      throw new ApiError('VEHICLE_SLOT_FULL', 'Bãi đỗ xe máy đã hết chỗ');
    }
    return;
  }

  if (type === VEHICLE_TYPES.CAR) {
    const capacity = await getConfig(CONFIG_KEYS.PARKING_CAPACITY_CAR, 100);
    const count = await Vehicle.countDocuments({ type, status: VEHICLE_STATUS.APPROVED });
    if (count >= capacity) {
      throw new ApiError('VEHICLE_SLOT_FULL', 'Bãi đỗ ô tô đã hết chỗ');
    }
  }
}

/**
 * UC-A09: Cư dân đăng ký gửi xe.
 * Chỉ chủ sở hữu (OWNER) hoặc người thuê (TENANT) đang hoạt động của căn hộ mới được đăng ký.
 */
export async function register(body, viewer) {
  const userId = viewer?.id || viewer?._id;
  const apartment = await resolveResidentApartment(userId, body.apartmentId);

  const resident = await Resident.findOne({
    userId,
    apartmentId: apartment._id,
    isActive: true,
  }).lean();

  if (!resident || resident.relationType === RELATION_TYPES.FAMILY_MEMBER) {
    throw ApiError.forbidden('Chỉ chủ sở hữu hoặc người thuê được đăng ký xe');
  }

  const plateNumber = normalizePlate(body.plateNumber, body.type);

  // BR-A6: Kiểm tra sức chứa trước khi đăng ký
  await assertCapacity(body.type);

  if (plateNumber) {
    const existing = await Vehicle.findOne({
      plateNumber,
      status: { $in: [VEHICLE_STATUS.PENDING, VEHICLE_STATUS.APPROVED] },
    }).lean();

    if (existing) {
      throw ApiError.badRequest('Biển số xe đã được đăng ký hoặc đang chờ duyệt', [
        { field: 'plateNumber', message: 'Biển số xe đã được đăng ký hoặc đang chờ duyệt' },
      ]);
    }
  }

  try {
    const vehicle = await Vehicle.create({
      apartmentId: apartment._id,
      registeredBy: userId,
      type: body.type,
      plateNumber,
      brand: body.brand?.trim() || undefined,
      color: body.color?.trim() || undefined,
      status: VEHICLE_STATUS.PENDING,
    });

    await notifyRoles([`STAFF:${ROLE_TITLES.RECEPTIONIST}`], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Yêu cầu đăng ký phương tiện mới',
      content: `Căn hộ ${apartment.code} gửi yêu cầu đăng ký phương tiện loại ${body.type}${plateNumber ? ` (${plateNumber})` : ''}`,
      link: '/app/vehicle-requests',
      refId: vehicle._id,
    }).catch((err) => console.error('[module-a] notifyRoles error:', err.message));

    return vehicle;
  } catch (err) {
    if (err.code === 11000) {
      throw ApiError.badRequest('Biển số xe đã được đăng ký hoặc đang chờ duyệt', [
        { field: 'plateNumber', message: 'Biển số xe đã được đăng ký hoặc đang chờ duyệt' },
      ]);
    }
    throw err;
  }
}

/**
 * UC-A09: Danh sách phương tiện của căn hộ cư dân đang ở
 */
export async function listMine(viewer, query = {}) {
  const userId = viewer?.id || viewer?._id;

  if (query.apartmentId) {
    const apartment = await resolveResidentApartment(userId, query.apartmentId);
    const filter = { apartmentId: apartment._id };
    if (query.status) filter.status = query.status;
    return Vehicle.find(filter)
      .populate('apartmentId', 'code floor')
      .populate('registeredBy', 'fullName email phone')
      .sort({ createdAt: -1 })
      .lean();
  }

  const aptIds = await getActiveApartmentIds(userId);
  if (!aptIds.length) return [];

  const filter = { apartmentId: { $in: aptIds } };
  if (query.status) filter.status = query.status;

  return Vehicle.find(filter)
    .populate('apartmentId', 'code floor')
    .populate('registeredBy', 'fullName email phone')
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * UC-A09: Cư dân hủy vé hoặc yêu cầu hủy vé gửi xe.
 * - PENDING: Hủy ngay thành CANCELLED + cancelledAt.
 * - APPROVED: Đặt cancelRequestedAt, chờ Lễ tân xác nhận.
 * - Trạng thái khác hoặc đã yêu cầu: STATUS_CONFLICT.
 */
export async function requestCancel(vehicleId, viewer) {
  const userId = viewer?.id || viewer?._id;
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  const aptIds = await getActiveApartmentIds(userId);
  if (!aptIds.includes(String(vehicle.apartmentId))) {
    throw ApiError.forbidden('Bạn không thuộc căn hộ của phương tiện này');
  }

  if (vehicle.status === VEHICLE_STATUS.PENDING) {
    vehicle.status = VEHICLE_STATUS.CANCELLED;
    vehicle.cancelledAt = new Date();
    await vehicle.save();
    return vehicle.toObject();
  }

  if (vehicle.status === VEHICLE_STATUS.APPROVED) {
    if (vehicle.cancelRequestedAt) {
      throw new ApiError('STATUS_CONFLICT', 'Yêu cầu hủy đã được gửi trước đó và đang chờ xử lý');
    }
    vehicle.cancelRequestedAt = new Date();
    await vehicle.save();

    await notifyRoles([`STAFF:${ROLE_TITLES.RECEPTIONIST}`], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Yêu cầu hủy vé gửi xe',
      content: `Cư dân yêu cầu hủy vé cho phương tiện ${vehicle.plateNumber || vehicle.type}`,
      link: '/app/vehicle-requests',
      refId: vehicle._id,
    }).catch((err) => console.error('[module-a] notifyRoles error:', err.message));

    return vehicle.toObject();
  }

  throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
}

/**
 * UC-A10: Danh sách yêu cầu gửi xe cho Ban quản lý (Lễ tân / Trưởng BQL)
 */
export async function listForStaff(query = {}) {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
  }
  if (query.type) {
    filter.type = query.type;
  }
  if (query.apartmentId) {
    filter.apartmentId = query.apartmentId;
  }
  if (query.cancelRequested === true || query.cancelRequested === 'true') {
    filter.cancelRequestedAt = { $ne: null };
  } else if (query.cancelRequested === false || query.cancelRequested === 'false') {
    filter.cancelRequestedAt = null;
  }
  if (query.q) {
    filter.plateNumber = { $regex: escapeRegex(query.q.trim()), $options: 'i' };
  }

  const queryWithSort = { ...query };
  if (query.status === VEHICLE_STATUS.PENDING && (!query.sort || query.sort === '-createdAt')) {
    queryWithSort.sort = 'createdAt'; // PENDING sắp cũ nhất trước
  }

  return paginate(Vehicle, filter, queryWithSort, {
    populate: [
      {
        path: 'apartmentId',
        select: 'code floor buildingId',
        populate: { path: 'buildingId', select: 'code name' },
      },
      { path: 'registeredBy', select: 'fullName email phone' },
      { path: 'reviewedBy', select: 'fullName email' },
    ],
  });
}

/**
 * UC-A10: Lễ tân duyệt yêu cầu đăng ký gửi xe
 */
export async function approve(vehicleId, staffUser) {
  const staffId = staffUser?.id || staffUser?._id;
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  if (vehicle.status !== VEHICLE_STATUS.PENDING) {
    throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể duyệt phương tiện ở trạng thái chờ duyệt');
  }

  await assertCapacity(vehicle.type);

  if (vehicle.plateNumber) {
    const existing = await Vehicle.findOne({
      _id: { $ne: vehicle._id },
      plateNumber: vehicle.plateNumber,
      status: { $in: [VEHICLE_STATUS.PENDING, VEHICLE_STATUS.APPROVED] },
    }).lean();

    if (existing) {
      throw ApiError.badRequest('Biển số xe đã được duyệt cho phương tiện khác');
    }
  }

  const updated = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id, status: VEHICLE_STATUS.PENDING },
    {
      $set: {
        status: VEHICLE_STATUS.APPROVED,
        approvedAt: new Date(),
        reviewedBy: staffId,
      },
    },
    { returnDocument: 'after' },
  )
    .populate('apartmentId', 'code')
    .populate('registeredBy', 'fullName email');

  if (!updated) {
    throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
  }

  await logAudit({
    action: AUDIT_ACTIONS.VEHICLE_APPROVED,
    user: staffUser,
    targetType: 'vehicles',
    targetId: updated._id,
    metadata: {
      plateNumber: updated.plateNumber,
      type: updated.type,
      apartmentId: updated.apartmentId?._id,
    },
  });

  if (updated.registeredBy) {
    await notify(updated.registeredBy._id || updated.registeredBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đăng ký xe đã được duyệt',
      content: `Phương tiện ${updated.plateNumber || updated.type} của bạn đã được duyệt. Phí gửi xe tính từ hóa đơn tháng sau.`,
      link: '/r/my-vehicles',
      refId: updated._id,
    }).catch((err) => console.error('[module-a] notify error:', err.message));
  }

  return updated;
}

/**
 * UC-A10: Lễ tân từ chối yêu cầu đăng ký gửi xe (bắt buộc lý do)
 */
export async function reject(vehicleId, staffUser, { reason } = {}) {
  const staffId = staffUser?.id || staffUser?._id;

  if (!reason || !reason.trim()) {
    throw ApiError.badRequest('Lý do từ chối là bắt buộc', [
      { field: 'reason', message: 'Lý do từ chối là bắt buộc' },
    ]);
  }

  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  if (vehicle.status !== VEHICLE_STATUS.PENDING) {
    throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể từ chối phương tiện ở trạng thái chờ duyệt');
  }

  const updated = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id, status: VEHICLE_STATUS.PENDING },
    {
      $set: {
        status: VEHICLE_STATUS.REJECTED,
        rejectReason: reason.trim(),
        reviewedBy: staffId,
      },
    },
    { returnDocument: 'after' },
  )
    .populate('apartmentId', 'code')
    .populate('registeredBy', 'fullName email');

  if (!updated) {
    throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
  }

  await logAudit({
    action: AUDIT_ACTIONS.VEHICLE_REJECTED,
    user: staffUser,
    targetType: 'vehicles',
    targetId: updated._id,
    metadata: {
      reason: reason.trim(),
      plateNumber: updated.plateNumber,
      type: updated.type,
    },
  });

  if (updated.registeredBy) {
    await notify(updated.registeredBy._id || updated.registeredBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đăng ký xe bị từ chối',
      content: `Yêu cầu đăng ký phương tiện ${updated.plateNumber || updated.type} bị từ chối. Lý do: ${reason.trim()}`,
      link: '/r/my-vehicles',
      refId: updated._id,
    }).catch((err) => console.error('[module-a] notify error:', err.message));
  }

  return updated;
}

/**
 * UC-A10: Lễ tân xác nhận hủy vé gửi xe cho xe APPROVED có cancelRequestedAt
 */
export async function confirmCancel(vehicleId, staffUser) {
  const staffId = staffUser?.id || staffUser?._id;
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  if (vehicle.status !== VEHICLE_STATUS.APPROVED || !vehicle.cancelRequestedAt) {
    throw new ApiError('STATUS_CONFLICT', 'Phương tiện không ở trạng thái chờ hủy');
  }

  const updated = await Vehicle.findOneAndUpdate(
    {
      _id: vehicle._id,
      status: VEHICLE_STATUS.APPROVED,
      cancelRequestedAt: { $ne: null },
    },
    {
      $set: {
        status: VEHICLE_STATUS.CANCELLED,
        cancelledAt: new Date(),
        reviewedBy: staffId,
      },
    },
    { returnDocument: 'after' },
  )
    .populate('apartmentId', 'code')
    .populate('registeredBy', 'fullName email');

  if (!updated) {
    throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
  }

  await logAudit({
    action: AUDIT_ACTIONS.VEHICLE_CANCELLED,
    user: staffUser,
    targetType: 'vehicles',
    targetId: updated._id,
    metadata: {
      plateNumber: updated.plateNumber,
      type: updated.type,
    },
  });

  if (updated.registeredBy) {
    await notify(updated.registeredBy._id || updated.registeredBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đã xác nhận hủy vé gửi xe',
      content: `Phương tiện ${updated.plateNumber || updated.type} đã được hủy vé gửi xe thành công.`,
      link: '/r/my-vehicles',
      refId: updated._id,
    }).catch((err) => console.error('[module-a] notify error:', err.message));
  }

  return updated;
}
