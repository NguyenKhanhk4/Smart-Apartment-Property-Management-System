// Dữ liệu mẫu tối thiểu cho test Module E (dùng với helpers/db.js)
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env.js';
import {
  Apartment,
  Building,
  ComplaintCategory,
  Resident,
  Ticket,
  User,
} from '../../src/models/index.js';

let seq = 0;
const next = () => (seq += 1);

/** req.user như middleware authenticate gắn vào */
export const asUser = (user) => ({
  id: String(user._id),
  role: user.role,
  roleTitle: user.roleTitle ?? null,
  boardTitle: user.boardTitle ?? null,
});

export const tokenFor = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, roleTitle: user.roleTitle ?? null, boardTitle: user.boardTitle ?? null },
    env.jwt.accessSecret,
    { expiresIn: '5m' },
  );

export async function createUser(role, { roleTitle = null, boardTitle = null, ...extra } = {}) {
  const n = next();
  return User.create({
    fullName: `${role} ${n}`,
    email: `user${n}@test.local`,
    passwordHash: 'x',
    role,
    roleTitle,
    boardTitle,
    ...extra,
  });
}

export const createResident = (extra) => createUser('RESIDENT', extra);
export const createManager = (extra) => createUser('MANAGER', extra);
export const createTechnician = (extra) => createUser('STAFF', { roleTitle: 'TECHNICIAN', ...extra });
export const createReceptionist = (extra) => createUser('STAFF', { roleTitle: 'RECEPTIONIST', ...extra });
export const createSecurity = (extra) => createUser('STAFF', { roleTitle: 'SECURITY', ...extra });

export async function createBuilding(extra = {}) {
  const n = next();
  return Building.create({ code: `B${n}`, name: `Block ${n}`, ...extra });
}

export async function createApartment(building, extra = {}) {
  const b = building ?? (await createBuilding());
  return Apartment.create({ buildingId: b._id, code: `A${next()}`, area: 70, status: 'OWNED', ...extra });
}

/** Gán cư dân vào căn (residents.isActive = true) */
export async function linkResident(user, apartment, extra = {}) {
  return Resident.create({
    userId: user._id,
    apartmentId: apartment._id,
    relationType: 'FAMILY_MEMBER',
    isActive: true,
    ...extra,
  });
}

/** Cư dân + căn hộ đã gán, trả về { user, apartment, building } */
export async function createHousehold() {
  const building = await createBuilding();
  const apartment = await createApartment(building);
  const user = await createResident();
  await linkResident(user, apartment);
  return { user, apartment, building };
}

export async function createCategory(extra = {}) {
  return ComplaintCategory.create({
    name: `Loại ${next()}`,
    defaultPriority: 'MEDIUM',
    slaHours: 72,
    ...extra,
  });
}

/** Tạo ticket thẳng vào DB ở trạng thái bất kỳ (bỏ qua service) */
export async function createTicket({ apartment, createdBy, category, ...extra }) {
  const cat = category ?? (await createCategory());
  const n = next();
  return Ticket.create({
    code: `TK-TEST-${String(n).padStart(5, '0')}`,
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    createdBy: createdBy._id,
    category: cat._id,
    title: `Ticket ${n}`,
    description: 'Mô tả đủ dài cho test',
    priority: cat.defaultPriority,
    dueDate: new Date(Date.now() + cat.slaHours * 3600 * 1000),
    status: 'NEW',
    history: [{ by: createdBy._id, action: 'CREATED', toStatus: 'NEW' }],
    ...extra,
  });
}
