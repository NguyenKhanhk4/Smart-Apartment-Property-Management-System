// Dữ liệu mẫu tối thiểu cho test service (dùng với helpers/db.js). Thêm hàm mới ở đây thay vì tạo dữ liệu tay trong từng test.
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

export const createResidentUser = (extra) => createUser('RESIDENT', extra);
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

/** Gán user vào căn (residents.isActive = true) */
export function linkResident(user, apartment, extra = {}) {
  return Resident.create({
    userId: user._id,
    apartmentId: apartment._id,
    relationType: 'FAMILY_MEMBER',
    isActive: true,
    ...extra,
  });
}

/** Chủ hộ + căn hộ đã gán: { user, apartment, building } */
export async function createHousehold({ relationType = 'OWNER' } = {}) {
  const building = await createBuilding();
  const apartment = await createApartment(building);
  const user = await createResidentUser();
  await linkResident(user, apartment, { relationType });
  return { user, apartment, building };
}

export function createCategory(extra = {}) {
  return ComplaintCategory.create({ name: `Loại ${next()}`, defaultPriority: 'MEDIUM', slaHours: 72, ...extra });
}

/** Ticket ghi thẳng vào DB ở trạng thái bất kỳ (bỏ qua service) */
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
