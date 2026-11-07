import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  PARKING_CARD_STATUS,
  RELATION_TYPES,
  ROLE_TITLES,
  VEHICLE_STATUS,
  VEHICLE_TYPES,
} from '../../constants/enums.js';
import { ParkingCard, Resident, Vehicle } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getActiveApartmentIds, resolveResidentApartment } from '../../services/residency.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { withTransaction } from '../../utils/transaction.js';
import { disableActiveCardsByVehicle } from '../parkingCards/parkingCards.service.js';

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

const CAPACITY = {
  [VEHICLE_TYPES.MOTORBIKE]: { key: CONFIG_KEYS.PARKING_CAPACITY_MOTORBIKE, message: 'Bãi đỗ xe máy đã hết chỗ' },
  [VEHICLE_TYPES.CAR]: { key: CONFIG_KEYS.PARKING_CAPACITY_CAR, message: 'Bãi đỗ ô tô đã hết chỗ' },
};

/** Sức chứa còn lại của loại xe (null = không giới hạn, vd xe đạp). `session` để đếm trong transaction duyệt xe. */
async function remainingSlots(type, session = null) {
  const rule = CAPACITY[type];
  if (!rule) return null;
  const capacity = Number(await getConfig(rule.key));
  const used = await Vehicle.countDocuments({ type, status: VEHICLE_STATUS.APPROVED }).session(session);
  return capacity - used;
}

/**
 * BR-A6: Kiểm tra sức chứa bãi xe. Xe máy và ô tô đếm số xe APPROVED so với cấu hình; xe đạp không giới hạn.
 */
async function assertCapacity(type, session = null) {
  const left = await remainingSlots(type, session);
  if (left !== null && left <= 0) throw new ApiError('VEHICLE_SLOT_FULL', CAPACITY[type].message);
}

/**
 * UC-A09: Cư dân đăng ký gửi xe.
 * Chỉ chủ sở hữu (OWNER) hoặc người thuê (TENANT) đang hoạt động của căn hộ mới được đăng ký.
 */
export async function register(body, viewer) {
  const userId = viewer.id;
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
      throw new ApiError('DUPLICATE_VALUE', 'Biển số xe đã được đăng ký hoặc đang chờ duyệt', { details: [
        { field: 'plateNumber', message: 'Biển số xe đã được đăng ký hoặc đang chờ duyệt' },
      ] });
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
      throw new ApiError('DUPLICATE_VALUE', 'Biển số xe đã được đăng ký hoặc đang chờ duyệt', { details: [
        { field: 'plateNumber', message: 'Biển số xe đã được đăng ký hoặc đang chờ duyệt' },
      ] });
    }
    throw err;
  }
}

/**
 * UC-A09: Danh sách phương tiện của căn hộ cư dân đang ở
 */
export async function listMine(viewer, query = {}) {
  const userId = viewer.id;

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
  const vehicle = await Vehicle.findById(vehicleId).lean();
  if (!vehicle) throw ApiError.notFound('Không tìm thấy phương tiện');

  const aptIds = await getActiveApartmentIds(viewer.id);
  if (!aptIds.includes(String(vehicle.apartmentId))) {
    throw ApiError.forbidden('Bạn không thuộc căn hộ của phương tiện này');
  }

  const conflict = (message = 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại') =>
    new ApiError('STATUS_CONFLICT', message);
  const now = new Date();

  // Ghi có điều kiện theo trạng thái vừa đọc: lễ tân duyệt / hủy song song thì request này nhận 409, không ghi đè
  if (vehicle.status === VEHICLE_STATUS.PENDING) {
    const cancelled = await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, status: VEHICLE_STATUS.PENDING },
      { $set: { status: VEHICLE_STATUS.CANCELLED, cancelledAt: now } },
      { returnDocument: 'after' },
    ).lean();
    if (!cancelled) throw conflict();
    return cancelled;
  }

  if (vehicle.status === VEHICLE_STATUS.APPROVED) {
    if (vehicle.cancelRequestedAt) throw conflict('Yêu cầu hủy đã được gửi trước đó và đang chờ xử lý');
    const requested = await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, status: VEHICLE_STATUS.APPROVED, cancelRequestedAt: null },
      { $set: { cancelRequestedAt: now } },
      { returnDocument: 'after' },
    ).lean();
    if (!requested) throw conflict('Yêu cầu hủy đã được gửi trước đó và đang chờ xử lý');

    await notifyRoles([`STAFF:${ROLE_TITLES.RECEPTIONIST}`], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Yêu cầu hủy vé gửi xe',
      content: `Cư dân yêu cầu hủy vé cho phương tiện ${requested.plateNumber || requested.type}`,
      link: '/app/vehicle-requests',
      refId: requested._id,
    }).catch((err) => console.error('[module-a] notifyRoles error:', err.message));
    return requested;
  }

  throw conflict();
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
 * UC-A10 & UC66: Lễ tân duyệt yêu cầu đăng ký gửi xe kèm cấp thẻ gửi xe ACTIVE trong cùng transaction
 */
export async function approve(vehicleId, staffUser, { cardNumber } = {}, ip) {
  const staffId = staffUser.id;
  const normCardNumber = String(cardNumber || '')
    .trim()
    .toUpperCase();

  if (!normCardNumber) {
    throw ApiError.badRequest('Số thẻ gửi xe là bắt buộc khi duyệt phương tiện', [
      { field: 'cardNumber', message: 'Số thẻ gửi xe là bắt buộc' },
    ]);
  }

  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  if (vehicle.status !== VEHICLE_STATUS.PENDING) {
    throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể duyệt phương tiện ở trạng thái chờ duyệt');
  }

  await assertCapacity(vehicle.type);

  let issuedCard = null;

  try {
    await withTransaction(async (session) => {
      const current = await Vehicle.findOne({
        _id: vehicle._id,
        status: VEHICLE_STATUS.PENDING,
      }).session(session);

      if (!current) {
        throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
      }
      // Đếm lại sức chứa trong transaction (BR-A6)
      await assertCapacity(current.type, session);

      if (current.plateNumber) {
        const existing = await Vehicle.findOne({
          _id: { $ne: current._id },
          plateNumber: current.plateNumber,
          status: { $in: [VEHICLE_STATUS.PENDING, VEHICLE_STATUS.APPROVED] },
        })
          .session(session)
          .lean();

        if (existing) {
          throw new ApiError('DUPLICATE_VALUE', 'Biển số xe đã được duyệt cho phương tiện khác');
        }
      }

      const existingCard = await ParkingCard.findOne({
        cardNumber: normCardNumber,
        status: {
          $in: [
            PARKING_CARD_STATUS.ACTIVE,
            PARKING_CARD_STATUS.DISABLED_TO_COLLECT,
            PARKING_CARD_STATUS.LOST,
          ],
        },
      })
        .session(session)
        .lean();

      if (existingCard) {
        throw new ApiError('DUPLICATE_VALUE', 'Số thẻ gửi xe đang được sử dụng hoặc chưa được thu hồi', { details: [
          { field: 'cardNumber', message: 'Số thẻ gửi xe đã tồn tại' },
        ] });
      }

      const now = new Date();
      current.status = VEHICLE_STATUS.APPROVED;
      current.approvedAt = now;
      current.reviewedBy = staffId;
      await current.save({ session });

      [issuedCard] = await ParkingCard.create(
        [
          {
            cardNumber: normCardNumber,
            vehicleId: current._id,
            apartmentId: current.apartmentId,
            status: PARKING_CARD_STATUS.ACTIVE,
            issuedAt: now,
          },
        ],
        { session },
      );

      await logAudit(
        {
          action: AUDIT_ACTIONS.VEHICLE_APPROVED,
          user: staffUser,
          targetType: AUDIT_TARGETS.VEHICLE,
          targetId: current._id,
          metadata: {
            plateNumber: current.plateNumber,
            type: current.type,
            apartmentId: current.apartmentId,
            cardNumber: normCardNumber,
            parkingCardId: issuedCard._id,
          },
          ip,
        },
        { session },
      );

      await logAudit(
        {
          action: AUDIT_ACTIONS.PARKING_CARD_ISSUED,
          user: staffUser,
          targetType: AUDIT_TARGETS.PARKING_CARD,
          targetId: issuedCard._id,
          metadata: {
            cardNumber: normCardNumber,
            vehicleId: current._id,
            apartmentId: current.apartmentId,
          },
          ip,
        },
        { session },
      );
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError('DUPLICATE_VALUE', 'Số thẻ gửi xe hoặc biển số đã được sử dụng');
    }
    throw err;
  }

  // 2 lễ tân duyệt đồng thời có thể cùng thấy còn 1 chỗ (mỗi transaction chỉ thấy dữ liệu của mình).
  // Sau commit đếm lại; vượt sức chứa thì hoàn tác lượt duyệt này (an toàn hơn để bãi vượt chỗ).
  if ((await remainingSlots(vehicle.type)) < 0) {
    await withTransaction(async (session) => {
      await ParkingCard.deleteOne({ _id: issuedCard._id }, { session });
      await Vehicle.updateOne(
        { _id: vehicle._id, status: VEHICLE_STATUS.APPROVED },
        { $set: { status: VEHICLE_STATUS.PENDING, approvedAt: null, reviewedBy: null } },
        { session },
      );
    });
    throw new ApiError('VEHICLE_SLOT_FULL', CAPACITY[vehicle.type].message);
  }

  const updated = await Vehicle.findById(vehicle._id)
    .populate('apartmentId', 'code')
    .populate('registeredBy', 'fullName email')
    .lean();

  if (updated) {
    updated.parkingCard = issuedCard ? issuedCard.toObject() : null;
  }

  if (updated?.registeredBy) {
    await notify(updated.registeredBy._id || updated.registeredBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đăng ký xe đã được duyệt',
      content: `Phương tiện ${updated.plateNumber || updated.type} đã được duyệt (Số thẻ: ${normCardNumber}). Phí gửi xe tính từ hóa đơn tháng sau.`,
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
  const staffId = staffUser.id;

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
    targetType: AUDIT_TARGETS.VEHICLE,
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
 * UC-A10 & UC66: Lễ tân xác nhận hủy vé gửi xe cho xe APPROVED có cancelRequestedAt
 * Đồng thời chuyển thẻ ACTIVE của xe đó sang DISABLED_TO_COLLECT.
 */
export async function confirmCancel(vehicleId, staffUser, ip) {
  const staffId = staffUser.id;
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    throw ApiError.notFound('Không tìm thấy phương tiện');
  }

  if (vehicle.status !== VEHICLE_STATUS.APPROVED || !vehicle.cancelRequestedAt) {
    throw new ApiError('STATUS_CONFLICT', 'Phương tiện không ở trạng thái chờ hủy');
  }

  await withTransaction(async (session) => {
    const current = await Vehicle.findOne({
      _id: vehicle._id,
      status: VEHICLE_STATUS.APPROVED,
      cancelRequestedAt: { $ne: null },
    }).session(session);

    if (!current) {
      throw new ApiError('STATUS_CONFLICT', 'Trạng thái hiện tại không cho phép thao tác này, vui lòng tải lại');
    }

    current.status = VEHICLE_STATUS.CANCELLED;
    current.cancelledAt = new Date();
    current.reviewedBy = staffId;
    await current.save({ session });

    const disabledCount = await disableActiveCardsByVehicle(current._id, session, staffUser);

    await logAudit(
      {
        action: AUDIT_ACTIONS.VEHICLE_CANCELLED,
        user: staffUser,
        targetType: AUDIT_TARGETS.VEHICLE,
        targetId: current._id,
        metadata: {
          plateNumber: current.plateNumber,
          type: current.type,
          disabledCardsCount: disabledCount,
        },
        ip,
      },
      { session },
    );
  });

  const updated = await Vehicle.findById(vehicle._id)
    .populate('apartmentId', 'code')
    .populate('registeredBy', 'fullName email');

  if (updated?.registeredBy) {
    await notify(updated.registeredBy._id || updated.registeredBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đã xác nhận hủy vé gửi xe',
      content: `Phương tiện ${updated.plateNumber || updated.type} đã được hủy vé gửi xe thành công. Vui lòng hoàn trả thẻ gửi xe tại quầy Lễ tân.`,
      link: '/r/my-vehicles',
      refId: updated._id,
    }).catch((err) => console.error('[module-a] notify error:', err.message));
  }

  return updated;
}
