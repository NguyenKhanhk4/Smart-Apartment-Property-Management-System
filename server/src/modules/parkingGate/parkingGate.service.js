import { PARKING_CARD_STATUS, VEHICLE_STATUS, VEHICLE_TYPES } from '../../constants/enums.js';
import { ParkingCard } from '../../models/ParkingCard.js';
import { PARKING_KINDS, ParkingSession } from '../../models/ParkingSession.js';
import { Resident } from '../../models/Resident.js';
import { Vehicle } from '../../models/Vehicle.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS, vnDayStart } from '../../utils/time.js';
import { normalizePlate } from '../vehicles/vehicles.service.js';
import { calculateGuestFee } from './parkingFees.js';

async function openSession(data) {
  try {
    return await ParkingSession.create(data);
  } catch (error) {
    if (error.code !== 11000) throw error;
    throw new ApiError('STATUS_CONFLICT', 'Xe hoặc mã thẻ đã có lượt gửi đang mở');
  }
}

async function closeSession(id, fields) {
  const result = await ParkingSession.findOneAndUpdate(
    { _id: id, exitedAt: null },
    { $set: fields },
    { returnDocument: 'after' },
  ).lean();
  if (!result) throw new ApiError('STATUS_CONFLICT', 'Lượt gửi xe đã đóng');
  return result;
}

async function findVehicleForCard(card, rawPlate, vehicleId) {
  const eligible = { apartmentId: card.apartmentId, status: VEHICLE_STATUS.APPROVED };
  if (!card.residentId) {
    const vehicle = await Vehicle.findOne({ ...eligible, _id: card.vehicleId }).lean();
    if (!vehicle || (vehicleId && String(vehicle._id) !== vehicleId)) {
      throw ApiError.badRequest('Thẻ không liên kết với xe đã được duyệt');
    }
    if (normalizePlate(rawPlate, vehicle.type) !== (vehicle.plateNumber ?? null)) {
      throw ApiError.badRequest('Biển số không khớp với thẻ cư dân');
    }
    return vehicle;
  }

  const resident = card.handedOverAt && await Resident.findOne({
    _id: card.residentId, isActive: true, parkingCardId: card._id, apartmentId: card.apartmentId,
  }).select('userId').lean();
  if (!resident?.userId) throw ApiError.badRequest('Thẻ chưa bàn giao hoặc đã mất hiệu lực');

  const plateNumber = normalizePlate(rawPlate, VEHICLE_TYPES.BICYCLE);
  const vehicles = await Vehicle.find({
    ...eligible,
    registeredBy: resident.userId,
    plateNumber,
    ...(plateNumber ? {} : { type: VEHICLE_TYPES.BICYCLE }),
    ...(vehicleId ? { _id: vehicleId } : {}),
  }).select('apartmentId type plateNumber brand color').lean();
  if (vehicles.length === 0) throw ApiError.badRequest('Không có xe đã duyệt khớp với thông tin nhập');
  if (vehicles.length > 1) {
    const candidates = vehicles.map(({ _id, brand, color }) => ({ _id, brand, color }));
    const message = 'Chọn xe đạp cần ghi nhận sau khi đối chiếu tại cổng';
    throw ApiError.badRequest(message, [{ field: 'vehicleId', message, candidates }]);
  }
  return vehicles[0];
}

export async function recordResidentPassage(body, actor, now = new Date()) {
  const card = await ParkingCard.findOne({ cardNumber: body.cardNumber, status: PARKING_CARD_STATUS.ACTIVE }).lean();
  if (!card) throw ApiError.badRequest('Thẻ cư dân đã mất hiệu lực hoặc không tồn tại');

  const vehicle = await findVehicleForCard(card, body.plateNumber, body.vehicleId);
  const plateNumber = vehicle.plateNumber ?? null;

  if (body.direction === 'IN') {
    return openSession({
      kind: PARKING_KINDS.RESIDENT,
      vehicleId: vehicle._id,
      vehicleType: vehicle.type,
      parkingCardId: card._id,
      apartmentId: vehicle.apartmentId,
      cardNumber: card.cardNumber,
      plateNumber,
      enteredAt: now,
      enteredBy: actor.id,
    });
  }

  const open = await ParkingSession.findOne({ kind: PARKING_KINDS.RESIDENT, vehicleId: vehicle._id, exitedAt: null }).select('_id').lean();
  if (!open) throw ApiError.notFound('Xe này chưa có lượt vào đang mở');
  return closeSession(open._id, { exitedAt: now, exitedBy: actor.id });
}

export function admitGuest(body, actor, now = new Date()) {
  return openSession({
    kind: PARKING_KINDS.GUEST,
    vehicleType: body.vehicleType,
    cardNumber: body.cardNumber,
    plateNumber: normalizePlate(body.plateNumber, body.vehicleType),
    enteredAt: now,
    enteredBy: actor.id,
  });
}

function verifyGuestVehicle(session, body) {
  if (!session) throw ApiError.notFound('Không tìm thấy lượt gửi xe khách');
  if (session.exitedAt) throw new ApiError('STATUS_CONFLICT', 'Lượt gửi xe đã đóng');
  if (session.cardNumber !== body.cardNumber || session.plateNumber !== normalizePlate(body.plateNumber, session.vehicleType)) {
    throw ApiError.badRequest('Mã thẻ hoặc biển số không khớp với lượt gửi xe');
  }
}

export async function quoteGuestExit(body, now = new Date()) {
  const session = await ParkingSession.findOne({ kind: PARKING_KINDS.GUEST, cardNumber: body.cardNumber, exitedAt: null }).lean();
  verifyGuestVehicle(session, body);
  return { ...session, feeAmount: calculateGuestFee(session.vehicleType, session.enteredAt, now) };
}

export async function completeGuestExit(id, body, actor, now = new Date()) {
  const session = await ParkingSession.findOne({ _id: id, kind: PARKING_KINDS.GUEST }).lean();
  verifyGuestVehicle(session, body);
  const feeAmount = calculateGuestFee(session.vehicleType, session.enteredAt, now);
  if (feeAmount !== body.expectedFee) throw new ApiError('PARKING_FEE_CHANGED');
  return closeSession(id, { exitedAt: now, exitedBy: actor.id, feeAmount });
}

export async function lookupPlate(rawPlate) {
  const plateNumber = normalizePlate(rawPlate, VEHICLE_TYPES.CAR);
  const [residentVehicle, guestSession] = await Promise.all([
    Vehicle.findOne({ plateNumber, status: VEHICLE_STATUS.APPROVED })
      .select('type plateNumber brand color apartmentId').populate('apartmentId', 'code').lean(),
    ParkingSession.findOne({ kind: PARKING_KINDS.GUEST, plateNumber, exitedAt: null })
      .select('cardNumber vehicleType enteredAt').lean(),
  ]);
  return { plateNumber, residentVehicle, guestSession };
}

export function listSessions(query) {
  const filter = {};
  if (query.plate) filter.plateNumber = normalizePlate(query.plate, VEHICLE_TYPES.CAR);
  if (query.from || query.to) {
    const range = {
      ...(query.from && { $gte: vnDayStart(query.from) }),
      ...(query.to && { $lt: new Date(vnDayStart(query.to).getTime() + DAY_MS) }),
    };
    filter.$or = [{ enteredAt: range }, { exitedAt: range }];
  }
  return paginate(ParkingSession, filter, { ...query, sort: { updatedAt: -1, _id: -1 } }, {
    populate: [{ path: 'exitedBy', select: 'fullName' }],
  });
}
