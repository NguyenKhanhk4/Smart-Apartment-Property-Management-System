// Dữ liệu mẫu riêng cho test Module A / Người 2 (Gate Pass, thẻ gửi xe, hợp đồng, xe).
import { Contract, GatePass, ParkingCard, Vehicle } from '../../src/models/index.js';

let seq = 0;
const next = () => (seq += 1);

const pad = (n, w) => String(n).padStart(w, '0');

export function createGatePass({ apartment, createdBy, ...extra }) {
  const n = next();
  return GatePass.create({
    code: `GP-20991231-${pad(n, 3)}`,
    apartmentId: apartment._id,
    createdBy: createdBy._id,
    creatorRelation: 'OWNER',
    direction: 'IN',
    scheduledDate: new Date(Date.now() + 2 * 86_400_000),
    timeSlot: { from: '08:00', to: '10:00' },
    items: [{ name: 'Tủ lạnh', quantity: 1 }],
    truckPlate: `51C${pad(n, 5)}`,
    status: 'PENDING',
    ...extra,
  });
}

export function createVehicle({ apartment, registeredBy, ...extra }) {
  const n = next();
  return Vehicle.create({
    apartmentId: apartment._id,
    registeredBy: registeredBy?._id,
    type: 'MOTORBIKE',
    plateNumber: `59X1${pad(n, 5)}`,
    status: 'PENDING',
    ...extra,
  });
}

export function createParkingCard({ vehicle, ...extra }) {
  return ParkingCard.create({
    cardNumber: `C${pad(next(), 5)}`,
    vehicleId: vehicle._id,
    apartmentId: vehicle.apartmentId,
    status: 'ACTIVE',
    ...extra,
  });
}

export function createContract({ apartment, owner, ...extra }) {
  return Contract.create({
    apartmentId: apartment._id,
    type: 'SALE',
    ownerId: owner._id,
    startDate: new Date('2026-01-01T00:00:00+07:00'),
    status: 'ACTIVE',
    ...extra,
  });
}
