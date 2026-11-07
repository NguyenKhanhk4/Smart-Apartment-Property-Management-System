import {
  APARTMENT_OCCUPANCY, APARTMENT_STATUS, AUDIT_ACTIONS, AUDIT_TARGETS,
  CONTRACT_STATUS, CONTRACT_TYPES, RELATION_TYPES, ROLES,
} from '../../constants/enums.js';
import { Apartment, Contract, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { ensureCodes } from '../memberCodes/memberCodes.service.js';
import { findUserByPhone } from '../users/userLookup.js';
import { findOrCreateResidentUser, inviteNewResident } from './residentAccounts.js';
import { revokeDepartedResidentServices } from './residentExit.service.js';

const activeTenant = (apartmentId) => ({ apartmentId, relationType: RELATION_TYPES.TENANT, isActive: true });
const activeLease = (apartmentId) => ({ apartmentId, type: CONTRACT_TYPES.LEASE, status: CONTRACT_STATUS.ACTIVE });

function legacyLeaseQuery(apartmentId, member, fallbackId) {
  if (member && !member.contractId && typeof member.tenantPaysFees === 'boolean') return null;
  const filter = activeLease(apartmentId);
  if (member?.contractId) filter._id = member.contractId;
  else if (member) filter.tenantId = member.userId?._id ?? member.userId;
  else if (fallbackId) filter._id = fallbackId;
  return Contract.findOne(filter);
}

async function requireOwner(actor, apartmentId, session = null) {
  const owner = await Resident.findOne({
    apartmentId, userId: actor.id, relationType: RELATION_TYPES.OWNER, isActive: true,
  }).select('userId').session(session).populate('userId', 'isActive').lean();
  if (!owner?.userId?.isActive) throw ApiError.forbidden('Chỉ chủ sở hữu được quản lý cho thuê căn hộ này');
}

export async function getTenancy(actor, apartmentId) {
  await requireOwner(actor, apartmentId);
  const tenant = await Resident.findOne(activeTenant(apartmentId))
    .select('userId moveInDate contractId tenantPaysFees').populate('userId', 'fullName phone activatedAt').lean();
  const lease = await legacyLeaseQuery(apartmentId, tenant)?.populate('tenantId', 'fullName phone activatedAt').lean();
  if (tenant) return { ...tenant, tenantPaysFees: lease?.tenantPaysFees ?? Boolean(tenant.tenantPaysFees) };
  if (!lease) return null;
  return { _id: lease._id, userId: lease.tenantId, moveInDate: lease.startDate, tenantPaysFees: lease.tenantPaysFees };
}

export async function lookupTenant(actor, apartmentId, phone) {
  await requireOwner(actor, apartmentId);
  const user = await findUserByPhone(phone).select('fullName phone role').lean();
  if (!user) return { phone, exists: false };
  if (user.role !== ROLES.RESIDENT) return { phone: user.phone, exists: true, isResident: false };
  return { phone: user.phone, exists: true, isResident: true, userId: user._id, fullName: user.fullName };
}

async function setTenancyStatus(apartment, status, occupancyStatus, session) {
  const result = await Apartment.updateOne(
    { _id: apartment._id, status: apartment.status }, { $set: { status, occupancyStatus } }, { session },
  );
  if (!result.matchedCount) throw new ApiError('CONCURRENT_UPDATE');
}

function logTenancy(actor, resident, action, ip, session) {
  return logAudit({
    action, user: actor, targetType: AUDIT_TARGETS.RESIDENT, targetId: resident._id,
    metadata: { apartmentId: resident.apartmentId, userId: resident.userId, relationType: RELATION_TYPES.TENANT },
    ip,
  }, { session });
}

async function syncCodes(apartmentId) {
  try {
    await ensureCodes(apartmentId);
  } catch (error) {
    console.error('[UC17] ensureCodes', apartmentId, error.message);
  }
}

export async function startTenancy(actor, apartmentId, data, ip) {
  const { member, account } = await withTransaction(async (session) => {
    await requireOwner(actor, apartmentId, session);
    const apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
    if (await Resident.exists(activeTenant(apartmentId)).session(session) || await Contract.exists(activeLease(apartmentId)).session(session)) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ đã có lượt thuê đang hiệu lực');
    }
    const now = new Date();
    if (!apartment.handoverDate || apartment.handoverDate > now) {
      throw new ApiError('STATUS_CONFLICT', 'Cần ghi nhận bàn giao căn hộ trước khi cho thuê');
    }
    if (await Resident.exists({ apartmentId, isActive: true, relationType: RELATION_TYPES.FAMILY_MEMBER }).session(session)) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ vẫn còn thành viên gia đình đang ở. Cần cập nhật danh sách cư trú trước khi cho thuê');
    }

    const account = await findOrCreateResidentUser(data, session);
    if (String(account.user._id) === String(actor.id)) throw ApiError.field('phone', 'Khách thuê phải khác chủ sở hữu');
    if (!account.user.isActive) throw new ApiError('STATUS_CONFLICT', 'Tài khoản khách thuê đang bị khóa');
    const [member] = await Resident.create([{
      apartmentId, userId: account.user._id, relationType: RELATION_TYPES.TENANT,
      tenantPaysFees: Boolean(data.tenantPaysFees), moveInDate: now,
    }], { session });
    await setTenancyStatus(apartment, APARTMENT_STATUS.RENTED, APARTMENT_OCCUPANCY.RENTED, session);
    await logTenancy(actor, member, AUDIT_ACTIONS.RESIDENT_ASSIGNED, ip, session);
    return { member, account };
  });

  const activationInviteSent = await inviteNewResident(account);
  await syncCodes(apartmentId);
  return { residentId: member._id, activationInviteSent };
}

export async function endTenancy(actor, apartmentId, residentId, ip) {
  await withTransaction(async (session) => {
    await requireOwner(actor, apartmentId, session);
    const apartment = await Apartment.findById(apartmentId).session(session);
    if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
    const now = new Date();
    const member = await Resident.findOne({ ...activeTenant(apartmentId), _id: residentId }).session(session).lean();
    const lease = await legacyLeaseQuery(apartmentId, member, residentId)?.session(session);
    if (!member && !lease) throw new ApiError('STATUS_CONFLICT', 'Lượt thuê đã kết thúc hoặc không tồn tại');

    const filter = { apartmentId, isActive: true, _id: member?._id };
    if (lease) {
      delete filter._id;
      filter.$or = [{ contractId: lease._id, relationType: { $ne: RELATION_TYPES.OWNER } },
        ...(member ? [{ _id: member._id }] : [])];
      lease.status = CONTRACT_STATUS.TERMINATED;
      lease.terminatedAt = now;
      await lease.save({ session });
      await logAudit({ action: AUDIT_ACTIONS.CONTRACT_TERMINATED, user: actor, targetType: AUDIT_TARGETS.CONTRACT,
        targetId: lease._id, metadata: { apartmentId, reason: 'Chủ sở hữu kết thúc lượt thuê trên UC17' }, ip }, { session });
    }

    const departing = await Resident.find(filter).select('userId').session(session).lean();
    // Lượt cũ được lên lịch nhưng chưa bắt đầu thì chưa có sự kiện vào ở hoặc rời đi.
    await Resident.updateMany({ ...filter, moveInDate: { $gt: now } },
      { $set: { isActive: false }, $unset: { moveInDate: 1, moveOutDate: 1 } }, { session });
    await Resident.updateMany(filter, { $set: { isActive: false, moveOutDate: now } }, { session });

    const remainingTenant = await Resident.exists(activeTenant(apartmentId)).session(session);
    const remainingFamily = await Resident.exists({ apartmentId, isActive: true, relationType: RELATION_TYPES.FAMILY_MEMBER }).session(session);
    let occupancy = APARTMENT_OCCUPANCY.VACANT;
    if (!apartment.handoverDate) occupancy = APARTMENT_OCCUPANCY.NOT_HANDED_OVER;
    else if (remainingTenant) occupancy = APARTMENT_OCCUPANCY.RENTED;
    else if (remainingFamily) occupancy = APARTMENT_OCCUPANCY.OWNER_OCCUPIED;
    await setTenancyStatus(apartment, remainingTenant ? APARTMENT_STATUS.RENTED : APARTMENT_STATUS.OWNED, occupancy, session);
    await revokeDepartedResidentServices({ apartmentId,
      userIds: [...departing.map((row) => row.userId), lease?.tenantId], endedAt: now, session, actor, ip });
    if (member) await logTenancy(actor, member, AUDIT_ACTIONS.RESIDENT_REMOVED, ip, session);
  });
  await syncCodes(apartmentId);
}
