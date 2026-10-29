import {
  AUDIT_ACTIONS,
  GATE_PASS_DIRECTIONS,
  GATE_PASS_STATUS,
  NOTIFICATION_TYPES,
  PLATE_LOOKUP_RESULTS,
  RELATION_TYPES,
  ROLES,
  VEHICLE_STATUS,
  VEHICLE_TYPES,
} from '../../constants/enums.js';
import { Apartment, GatePass, Resident, Vehicle } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment, notifyRoles } from '../../services/notification.service.js';
import { resolveResidentApartment } from '../../services/residency.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { retryOnDuplicate } from '../../utils/codeGenerator.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { endOfVnDay, startOfVnDay } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { normalizePlate } from '../vehicles/vehicles.service.js';
import { getApartmentDebt } from './debtProvider.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnDateDigits(date = new Date()) {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function nextGatePassCode(date = new Date()) {
  const base = `GP-${vnDateDigits(date)}-`;
  const last = await GatePass.findOne({ code: { $regex: `^${base}` } })
    .sort({ code: -1 })
    .select('code')
    .lean();
  const seq = last ? Number.parseInt(last.code.slice(base.length), 10) + 1 : 1;
  return `${base}${String(seq).padStart(3, '0')}`;
}

export function parseTimeMinutes(timeStr, fieldName = 'timeSlot') {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeStr || '').trim());
  if (!match) {
    throw ApiError.badRequest(`Giờ không hợp lệ (${fieldName}), định dạng chuẩn HH:mm`);
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

export function computeSlotStart(scheduledDate, fromTimeStr) {
  const dayStart = startOfVnDay(new Date(scheduledDate));
  const minutes = parseTimeMinutes(fromTimeStr, 'timeSlot.from');
  return new Date(dayStart.getTime() + minutes * 60 * 1000);
}

/**
 * UC52: Cư dân tạo đơn chuyển đồ (Gate Pass)
 */
export async function createGatePass(viewer, body, ip) {
  const userId = viewer?.id || viewer?._id;
  const apartment = await resolveResidentApartment(userId, body.apartmentId);

  const resident = await Resident.findOne({
    userId,
    apartmentId: apartment._id,
    isActive: true,
  }).lean();

  if (!resident) {
    throw ApiError.forbidden('Chỉ cư dân đang hoạt động của căn hộ mới được tạo đơn chuyển đồ');
  }

  const fromMin = parseTimeMinutes(body.timeSlot?.from, 'timeSlot.from');
  const toMin = parseTimeMinutes(body.timeSlot?.to, 'timeSlot.to');
  if (toMin <= fromMin) {
    throw ApiError.badRequest('Giờ kết thúc phải lớn hơn giờ bắt đầu');
  }

  const scheduledDay = startOfVnDay(new Date(body.scheduledDate));
  const slotStart = new Date(scheduledDay.getTime() + fromMin * 60 * 1000);
  if (slotStart <= new Date()) {
    throw ApiError.badRequest('Thời điểm bắt đầu chuyển đồ phải ở tương lai');
  }

  if (!Array.isArray(body.items) || body.items.length < 1) {
    throw ApiError.badRequest('Danh sách đồ đạc phải có ít nhất 1 mục');
  }

  const truckPlate = normalizePlate(body.truckPlate, VEHICLE_TYPES.CAR);
  const isTenant = resident.relationType === RELATION_TYPES.TENANT;
  const initialStatus = isTenant ? GATE_PASS_STATUS.AWAITING_OWNER : GATE_PASS_STATUS.PENDING;

  const created = await retryOnDuplicate(async () =>
    withTransaction(async (session) => {
      const code = await nextGatePassCode(scheduledDay);
      const [doc] = await GatePass.create(
        [
          {
            code,
            apartmentId: apartment._id,
            createdBy: userId,
            creatorRelation: resident.relationType,
            direction: body.direction,
            scheduledDate: scheduledDay,
            timeSlot: {
              from: body.timeSlot.from.trim(),
              to: body.timeSlot.to.trim(),
            },
            items: body.items.map((it) => ({
              name: it.name.trim(),
              quantity: Number(it.quantity),
            })),
            truckPlate,
            driverPhone: body.driverPhone?.trim() || null,
            status: initialStatus,
          },
        ],
        { session },
      );

      await logAudit(
        {
          action: AUDIT_ACTIONS.GATEPASS_CREATED,
          user: viewer,
          targetType: 'GatePass',
          targetId: doc._id,
          metadata: {
            code: doc.code,
            apartmentId: apartment._id,
            direction: doc.direction,
            status: doc.status,
            truckPlate,
          },
          ip,
        },
        { session },
      );

      return doc;
    }),
  );

  if (isTenant) {
    const ownerResident = await Resident.findOne({
      apartmentId: apartment._id,
      relationType: RELATION_TYPES.OWNER,
      isActive: true,
    }).lean();

    if (ownerResident?.userId) {
      await notify(ownerResident.userId, {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: 'Yêu cầu xác nhận đơn chuyển đồ',
        content: `Khách thuê căn hộ ${apartment.code} vừa tạo đơn chuyển đồ ${created.code}, vui lòng xác nhận.`,
        refId: created._id,
        link: '/r/gate-passes',
      }).catch((err) => console.error('[gate-passes] notify owner error:', err.message));
    }
  } else {
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đơn chuyển đồ mới chờ duyệt',
      content: `Căn hộ ${apartment.code} gửi đơn chuyển đồ ${created.code} (${created.direction}).`,
      refId: created._id,
      link: '/app/gate-passes',
    }).catch((err) => console.error('[gate-passes] notify manager error:', err.message));
  }

  return created;
}

/**
 * Danh sách Gate Pass (Cư dân xem đơn của căn mình; Nội bộ lọc theo trạng thái/ngày/căn)
 */
export async function listGatePasses(viewer, query = {}) {
  const userId = viewer?.id || viewer?._id;
  const filter = {};
  let ownerApartmentIdSet = new Set();

  if (viewer.role === ROLES.RESIDENT) {
    const myResidencies = await Resident.find({ userId, isActive: true }).lean();
    const myAptIds = myResidencies.map((r) => String(r.apartmentId));
    ownerApartmentIdSet = new Set(
      myResidencies
        .filter((r) => r.relationType === RELATION_TYPES.OWNER)
        .map((r) => String(r.apartmentId)),
    );

    if (query.apartmentId) {
      if (!myAptIds.includes(String(query.apartmentId))) {
        throw ApiError.forbidden('Bạn không thuộc căn hộ này');
      }
      filter.apartmentId = query.apartmentId;
    } else {
      filter.apartmentId = { $in: myAptIds };
    }
  } else {
    if (query.apartmentId) {
      filter.apartmentId = query.apartmentId;
    } else if (query.buildingId) {
      const apts = await Apartment.find({ buildingId: query.buildingId }).select('_id').lean();
      filter.apartmentId = { $in: apts.map((a) => a._id) };
    }
  }

  if (query.status) {
    filter.status = query.status;
  }
  if (query.direction) {
    filter.direction = query.direction;
  }

  if (query.today === true || query.today === 'true') {
    const now = new Date();
    filter.scheduledDate = { $gte: startOfVnDay(now), $lte: endOfVnDay(now) };
  } else if (query.date) {
    const d = new Date(query.date);
    filter.scheduledDate = { $gte: startOfVnDay(d), $lte: endOfVnDay(d) };
  }

  if (query.search) {
    const reg = new RegExp(escapeRegex(query.search.trim()), 'i');
    filter.$or = [{ code: reg }, { truckPlate: reg }];
  }

  const result = await paginate(GatePass, filter, {
    page: query.page,
    limit: query.limit,
    sort: { scheduledDate: -1, createdAt: -1 },
    populate: [
      { path: 'apartmentId', select: 'code floor buildingId', populate: { path: 'buildingId', select: 'code name' } },
      { path: 'createdBy', select: 'fullName email phone' },
      { path: 'ownerDecision.by', select: 'fullName email phone' },
      { path: 'reviewedBy', select: 'fullName email' },
      { path: 'usedBy', select: 'fullName email' },
    ],
  });

  if (viewer.role === ROLES.RESIDENT) {
    result.data = result.data.map((item) => {
      const aptId = String(item.apartmentId?._id || item.apartmentId);
      return {
        ...item,
        canOwnerConfirm:
          item.status === GATE_PASS_STATUS.AWAITING_OWNER && ownerApartmentIdSet.has(aptId),
      };
    });
  }

  return result;
}

/**
 * Chi tiết Gate Pass (kèm công nợ hiện tại nếu là đơn OUT)
 */
export async function getGatePassById(viewer, id) {
  const userId = viewer?.id || viewer?._id;
  const gatePass = await GatePass.findById(id)
    .populate({
      path: 'apartmentId',
      select: 'code floor area status buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    })
    .populate('createdBy', 'fullName email phone')
    .populate('ownerDecision.by', 'fullName email phone')
    .populate('reviewedBy', 'fullName email')
    .populate('usedBy', 'fullName email')
    .lean();

  if (!gatePass) {
    throw ApiError.notFound('Không tìm thấy đơn chuyển đồ');
  }

  const aptId = gatePass.apartmentId?._id || gatePass.apartmentId;

  if (viewer.role === ROLES.RESIDENT) {
    const member = await Resident.findOne({
      userId,
      apartmentId: aptId,
      isActive: true,
    }).lean();
    if (!member) {
      throw ApiError.forbidden('Bạn không thuộc căn hộ của đơn chuyển đồ này');
    }
    gatePass.canOwnerConfirm =
      gatePass.status === GATE_PASS_STATUS.AWAITING_OWNER &&
      member.relationType === RELATION_TYPES.OWNER;
  }

  if (gatePass.direction === GATE_PASS_DIRECTIONS.OUT) {
    gatePass.currentDebt = await getApartmentDebt(aptId);
  }

  return gatePass;
}

/**
 * UC52: Chủ hộ xác nhận hoặc từ chối đơn AWAITING_OWNER của khách thuê
 */
export async function ownerDecision(viewer, id, { approved, rejectReason }, ip) {
  const userId = viewer?.id || viewer?._id;
  let updated = null;
  let apartmentCode = '';

  await withTransaction(async (session) => {
    const gatePass = await GatePass.findById(id).session(session);
    if (!gatePass) {
      throw ApiError.notFound('Không tìm thấy đơn chuyển đồ');
    }

    const ownerResident = await Resident.findOne({
      userId,
      apartmentId: gatePass.apartmentId,
      relationType: RELATION_TYPES.OWNER,
      isActive: true,
    }).session(session);

    if (!ownerResident) {
      throw ApiError.forbidden('Chỉ chủ sở hữu đang hoạt động của căn hộ mới được xác nhận đơn');
    }

    if (gatePass.status !== GATE_PASS_STATUS.AWAITING_OWNER) {
      throw new ApiError('STATUS_CONFLICT', 'Đơn chuyển đồ không còn ở trạng thái chờ chủ hộ xác nhận');
    }

    const slotStart = computeSlotStart(gatePass.scheduledDate, gatePass.timeSlot.from);
    if (slotStart <= new Date()) {
      throw ApiError.badRequest('Đơn chuyển đồ đã qua giờ bắt đầu, không thể xác nhận');
    }

    const apt = await Apartment.findById(gatePass.apartmentId).select('code').session(session);
    apartmentCode = apt?.code || '';

    const now = new Date();
    gatePass.ownerDecision = {
      by: userId,
      at: now,
      approved: Boolean(approved),
    };

    if (approved) {
      gatePass.status = GATE_PASS_STATUS.PENDING;
    } else {
      gatePass.status = GATE_PASS_STATUS.REJECTED;
      gatePass.rejectReason = rejectReason?.trim() || 'Chủ hộ từ chối xác nhận';
    }

    await gatePass.save({ session });
    updated = gatePass.toObject();

    await logAudit(
      {
        action: approved
          ? AUDIT_ACTIONS.GATEPASS_OWNER_APPROVED
          : AUDIT_ACTIONS.GATEPASS_OWNER_REJECTED,
        user: viewer,
        targetType: 'GatePass',
        targetId: gatePass._id,
        metadata: {
          code: gatePass.code,
          apartmentId: gatePass.apartmentId,
          approved: Boolean(approved),
          rejectReason: gatePass.rejectReason,
        },
        ip,
      },
      { session },
    );
  });

  if (approved) {
    await notify(updated.createdBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Chủ hộ đã xác nhận đơn chuyển đồ',
      content: `Đơn chuyển đồ ${updated.code} của bạn đã được chủ hộ xác nhận và chuyển lên BQL duyệt.`,
      refId: updated._id,
      link: '/r/gate-passes',
    }).catch((err) => console.error('[gate-passes] notify tenant error:', err.message));

    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Đơn chuyển đồ chờ duyệt',
      content: `Đơn chuyển đồ ${updated.code} của căn hộ ${apartmentCode} đã được chủ hộ xác nhận, chờ BQL duyệt.`,
      refId: updated._id,
      link: '/app/gate-passes',
    }).catch((err) => console.error('[gate-passes] notify manager error:', err.message));
  } else {
    await notify(updated.createdBy, {
      type: NOTIFICATION_TYPES.SYSTEM,
      title: 'Chủ hộ từ chối đơn chuyển đồ',
      content: `Đơn chuyển đồ ${updated.code} đã bị chủ hộ từ chối. Lý do: ${updated.rejectReason}`,
      refId: updated._id,
      link: '/r/gate-passes',
    }).catch((err) => console.error('[gate-passes] notify tenant error:', err.message));
  }

  return updated;
}

/**
 * UC53: Trưởng BQL duyệt hoặc từ chối đơn PENDING
 */
export async function reviewGatePass(managerUser, id, { approved, rejectReason }, ip) {
  const userId = managerUser?.id || managerUser?._id;
  if (!approved && !rejectReason?.trim()) {
    throw ApiError.badRequest('Vui lòng nhập lý do từ chối', [
      { field: 'rejectReason', message: 'Lý do từ chối là bắt buộc' },
    ]);
  }

  let updated = null;

  await withTransaction(async (session) => {
    const gatePass = await GatePass.findById(id).session(session);
    if (!gatePass) {
      throw ApiError.notFound('Không tìm thấy đơn chuyển đồ');
    }

    if (gatePass.status !== GATE_PASS_STATUS.PENDING) {
      throw new ApiError('STATUS_CONFLICT', 'Chỉ có thể duyệt hoặc từ chối đơn đang chờ BQL duyệt');
    }

    const now = new Date();

    if (approved) {
      const slotStart = computeSlotStart(gatePass.scheduledDate, gatePass.timeSlot.from);
      if (slotStart <= now) {
        throw ApiError.badRequest('Đơn chuyển đồ đã qua giờ bắt đầu, không thể duyệt');
      }

      if (gatePass.direction === GATE_PASS_DIRECTIONS.OUT) {
        const debt = await getApartmentDebt(gatePass.apartmentId);
        gatePass.debtSnapshot = {
          amount: debt?.amount ?? 0,
          at: now,
        };
      }

      gatePass.status = GATE_PASS_STATUS.APPROVED;
      gatePass.rejectReason = null;
    } else {
      gatePass.status = GATE_PASS_STATUS.REJECTED;
      gatePass.rejectReason = rejectReason.trim();
    }

    gatePass.reviewedBy = userId;
    gatePass.reviewedAt = now;
    await gatePass.save({ session });
    updated = gatePass.toObject();

    await logAudit(
      {
        action: approved ? AUDIT_ACTIONS.GATEPASS_APPROVED : AUDIT_ACTIONS.GATEPASS_REJECTED,
        user: managerUser,
        targetType: 'GatePass',
        targetId: gatePass._id,
        metadata: {
          code: gatePass.code,
          apartmentId: gatePass.apartmentId,
          approved: Boolean(approved),
          rejectReason: gatePass.rejectReason,
          debtSnapshot: gatePass.debtSnapshot,
        },
        ip,
      },
      { session },
    );
  });

  await notifyApartment(updated.apartmentId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: approved ? 'Đơn chuyển đồ đã được duyệt' : 'Đơn chuyển đồ bị từ chối',
    content: approved
      ? `Đơn chuyển đồ ${updated.code} đã được Trưởng BQL phê duyệt.`
      : `Đơn chuyển đồ ${updated.code} bị từ chối. Lý do: ${updated.rejectReason}`,
    refId: updated._id,
    link: '/r/gate-passes',
  }).catch((err) => console.error('[gate-passes] notifyApartment error:', err.message));

  return updated;
}

/**
 * UC54: Bảo vệ xem danh sách Gate Pass đã duyệt trong ngày hôm nay (giờ VN)
 */
export async function listTodayGatePassesForSecurity(query = {}) {
  const now = new Date();
  const filter = {
    scheduledDate: { $gte: startOfVnDay(now), $lte: endOfVnDay(now) },
    status:
      query.includeUsed === 'true' || query.includeUsed === true
        ? { $in: [GATE_PASS_STATUS.APPROVED, GATE_PASS_STATUS.USED] }
        : GATE_PASS_STATUS.APPROVED,
  };

  if (query.search) {
    const reg = new RegExp(escapeRegex(query.search.trim()), 'i');
    filter.$or = [{ code: reg }, { truckPlate: reg }];
  }

  const rows = await GatePass.find(filter)
    .populate({
      path: 'apartmentId',
      select: 'code floor buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    })
    .populate('createdBy', 'fullName phone')
    .populate('usedBy', 'fullName')
    .sort({ 'timeSlot.from': 1, createdAt: 1 })
    .lean();

  return rows;
}

/**
 * UC54: Bảo vệ đánh dấu Gate Pass đã sử dụng (Used)
 */
export async function markGatePassUsed(securityUser, id, ip) {
  const userId = securityUser?.id || securityUser?._id;
  const now = new Date();
  const todayStart = startOfVnDay(now);
  const todayEnd = endOfVnDay(now);

  let updated = null;

  await withTransaction(async (session) => {
    const gatePass = await GatePass.findById(id).session(session);
    if (!gatePass) {
      throw ApiError.notFound('Không tìm thấy đơn chuyển đồ');
    }

    if (gatePass.status !== GATE_PASS_STATUS.APPROVED) {
      throw new ApiError('STATUS_CONFLICT', 'Chỉ đơn chuyển đồ ở trạng thái Đã duyệt mới được đánh dấu đã sử dụng');
    }

    if (gatePass.scheduledDate < todayStart || gatePass.scheduledDate > todayEnd) {
      throw ApiError.badRequest('Chỉ được đánh dấu sử dụng cho đơn chuyển đồ có ngày thực hiện là hôm nay');
    }

    gatePass.status = GATE_PASS_STATUS.USED;
    gatePass.usedBy = userId;
    gatePass.usedAt = now;
    await gatePass.save({ session });
    updated = gatePass.toObject();

    await logAudit(
      {
        action: AUDIT_ACTIONS.GATEPASS_USED,
        user: securityUser,
        targetType: 'GatePass',
        targetId: gatePass._id,
        metadata: {
          code: gatePass.code,
          apartmentId: gatePass.apartmentId,
          truckPlate: gatePass.truckPlate,
        },
        ip,
      },
      { session },
    );
  });

  await notifyApartment(updated.apartmentId, {
    type: NOTIFICATION_TYPES.SYSTEM,
    title: 'Đơn chuyển đồ đã hoàn tất qua cổng',
    content: `Đơn chuyển đồ ${updated.code} đã được Bảo vệ xác nhận qua cổng.`,
    refId: updated._id,
    link: '/r/gate-passes',
  }).catch((err) => console.error('[gate-passes] notifyApartment error:', err.message));

  return updated;
}

/**
 * UC62: Tra cứu biển số tại cổng bảo vệ
 */
export async function lookupPlate(rawPlate) {
  const plateNumber = normalizePlate(rawPlate, VEHICLE_TYPES.CAR);

  const residentVehicle = await Vehicle.findOne({
    plateNumber,
    status: VEHICLE_STATUS.APPROVED,
  })
    .populate({
      path: 'apartmentId',
      select: 'code floor buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    })
    .populate('registeredBy', 'fullName phone')
    .lean();

  if (residentVehicle) {
    return {
      result: PLATE_LOOKUP_RESULTS.REGISTERED_VEHICLE,
      plateNumber,
      vehicle: residentVehicle,
      apartment: residentVehicle.apartmentId,
    };
  }

  const now = new Date();
  const gatePass = await GatePass.findOne({
    truckPlate: plateNumber,
    status: GATE_PASS_STATUS.APPROVED,
    scheduledDate: { $gte: startOfVnDay(now), $lte: endOfVnDay(now) },
  })
    .populate({
      path: 'apartmentId',
      select: 'code floor buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    })
    .populate('createdBy', 'fullName phone')
    .sort({ createdAt: -1 })
    .lean();

  if (gatePass) {
    return {
      result: PLATE_LOOKUP_RESULTS.MATCHES_GATE_PASS,
      plateNumber,
      gatePass,
      apartment: gatePass.apartmentId,
    };
  }

  return {
    result: PLATE_LOOKUP_RESULTS.UNKNOWN,
    plateNumber,
  };
}
