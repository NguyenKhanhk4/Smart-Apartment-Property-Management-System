import mongoose from 'mongoose';
import { Apartment, Building, AuditLog, Announcement } from '../../models/index.js';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { apartmentAreaView } from '../apartments/managementArea.js';

const conflict = (message) => new ApiError('STATUS_CONFLICT', message);

/** Cùng khóa phiên bản cho thêm/xóa/điều chỉnh căn và xác nhận danh mục. */
export async function touchInventory(building, session = null) {
  const revision = building.inventoryRevision ?? 0;
  const filter = { _id: building._id, ...(revision === 0
    ? { $or: [{ inventoryRevision: 0 }, { inventoryRevision: { $exists: false } }] }
    : { inventoryRevision: revision }) };
  const changed = await Building.updateOne(filter, { $inc: { inventoryRevision: 1 } }, { session });
  if (!changed.matchedCount) throw conflict('Danh mục vừa thay đổi. Vui lòng tải lại và đối chiếu trước khi lưu.');
}

/** Bao gồm cả hồ sơ lịch sử; tra các quan hệ Mongoose để bảo vệ dữ liệu dùng chung. */
export async function linkedRecords(target, id, session = null) {
  const links = [];
  for (const Model of Object.values(mongoose.models)) {
    const paths = [];
    Model.schema.eachPath((path, schemaType) => {
      if (schemaType.options?.ref === target) paths.push(path);
    });
    if (paths.length && await Model.exists({ $or: paths.map((path) => ({ [path]: id })) }).session(session)) {
      links.push(Model.modelName);
    }
  }
  const scope = target === 'Building' ? 'BUILDING' : 'APARTMENT';
  if (await Announcement.exists({ targetScope: scope, targetId: id }).session(session)) links.push('Announcement');
  return links;
}

export function validateInventory({ totalFloors, floors, apartments }) {
  if (!Number.isInteger(totalFloors) || totalFloors < 1 || totalFloors > 200) {
    throw ApiError.field('totalFloors', 'Tổng số tầng phải từ 1 đến 200');
  }
  if (!floors?.length || !apartments?.length) {
    throw ApiError.badRequest('Cần khai báo tầng có căn hộ và danh sách căn theo hồ sơ');
  }
  const counts = new Map();
  for (const row of floors) {
    if (!Number.isInteger(row.floor) || row.floor < 1 || row.floor > totalFloors || counts.has(row.floor)
      || !Number.isInteger(row.expectedCount) || row.expectedCount < 1) {
      throw ApiError.badRequest('Tầng khai báo bị trùng, vượt tổng số tầng hoặc có số căn không hợp lệ');
    }
    counts.set(row.floor, { expected: row.expectedCount, actual: 0 });
  }
  const codes = new Set();
  const ids = new Set();
  for (const row of apartments) {
    const code = row.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{1,20}$/.test(code) || codes.has(code)) {
      throw ApiError.badRequest(`Mã căn không hợp lệ hoặc trùng: ${code || '(trống)'}`);
    }
    codes.add(code);
    if (row.id && ids.has(String(row.id))) throw ApiError.badRequest('Một căn hộ bị khai báo nhiều lần');
    if (row.id) ids.add(String(row.id));
    if (!counts.has(row.floor)) throw ApiError.badRequest(`Căn ${code} thuộc tầng chưa khai báo có căn hộ`);
    if (!Number.isFinite(row.managementArea) || row.managementArea < 1) {
      throw ApiError.badRequest(`Cần diện tích tính phí quản lý hợp lệ cho căn ${code}`);
    }
    counts.get(row.floor).actual += 1;
  }
  for (const [floor, count] of counts) {
    if (count.expected !== count.actual) {
      throw ApiError.badRequest(`Tầng ${floor}: hồ sơ có ${count.expected} căn, danh sách đang có ${count.actual} căn`);
    }
  }
}

const newApartment = (row, buildingId) => ({
  buildingId, code: row.code.trim().toUpperCase(), floor: row.floor,
  area: row.managementArea, netArea: row.managementArea, type: 'RESIDENTIAL',
  status: 'VACANT', occupancyStatus: 'NOT_HANDED_OVER',
});

export async function createInventory(data, actor, ip) {
  const { code, name, address, totalFloors, sourceReference, floors, apartments } = data;
  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = name.trim();
  return withTransaction(async (session) => {
    if (await Building.exists({ code: normalizedCode }).session(session)) {
      throw new ApiError('DUPLICATE_VALUE', 'Mã tòa nhà đã tồn tại');
    }
    if (await Building.exists({ name: normalizedName }).session(session)) {
      throw new ApiError('DUPLICATE_VALUE', 'Tên tòa nhà đã tồn tại');
    }
    if (!sourceReference?.trim()) throw ApiError.field('sourceReference', 'Cần tài liệu đối chiếu danh mục');
    validateInventory(data);
    if (apartments.some((row) => row.id)) throw ApiError.badRequest('Tòa mới không được nhận mã định danh căn có sẵn');
    const [building] = await Building.create([{
      code: normalizedCode, name: normalizedName, address: address?.trim(), totalFloors,
      inventorySource: sourceReference.trim(), floorInventory: floors,
      inventoryConfirmedAt: new Date(), inventoryConfirmedBy: actor.id ?? actor._id, inventoryRevision: 1,
    }], { session });
    await Apartment.insertMany(apartments.map((row) => newApartment(row, building._id)), { session });
    await logAudit({ action: AUDIT_ACTIONS.BUILDING_CHANGED, user: actor,
      targetType: AUDIT_TARGETS.BUILDING, targetId: building._id, ip,
      metadata: { action: 'INVENTORY_CREATED', sourceReference, floors, apartments, totalFloors } }, { session });
    return { ...building.toObject(), apartmentCount: apartments.length };
  });
}

export async function getInventory(id) {
  const building = await Building.findById(id).populate('inventoryConfirmedBy', 'fullName').lean();
  if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
  const apartments = await Apartment.find({ buildingId: id }).sort({ floor: 1, code: 1 }).lean();
  return { ...building, inventoryRevision: building.inventoryRevision ?? 0,
    apartments: apartments.map((apartment) => ({ ...apartmentAreaView(apartment), id: String(apartment._id) })) };
}

/** Đối chiếu tại chỗ: giữ nguyên _id, hồ sơ, bàn giao và dữ liệu tài chính cũ. */
export async function confirmInventory(id, data, actor, ip) {
  validateInventory(data);
  return withTransaction(async (session) => {
    const building = await Building.findById(id).session(session);
    if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
    if (data.expectedRevision !== (building.inventoryRevision ?? 0)) {
      throw conflict('Danh mục vừa thay đổi. Vui lòng tải lại trước khi xác nhận.');
    }
    if (!data.sourceReference?.trim()) throw ApiError.field('sourceReference', 'Cần tài liệu đối chiếu');
    if (building.inventoryConfirmedAt && !data.reason?.trim()) {
      throw ApiError.field('reason', 'Cần lý do bổ sung hoặc điều chỉnh danh mục đã xác nhận');
    }
    await touchInventory(building, session);
    const existing = await Apartment.find({ buildingId: id }).session(session).lean();
    const byId = new Map(existing.map((row) => [String(row._id), row]));
    const submitted = new Set();
    const additions = [];
    for (const row of data.apartments) {
      if (!row.id) { additions.push(row); continue; }
      const saved = byId.get(String(row.id));
      if (!saved) throw conflict('Danh sách chứa căn hộ không thuộc tòa nhà');
      const current = apartmentAreaView(saved);
      if (saved.code !== row.code.trim().toUpperCase() || saved.floor !== row.floor
        || current.managementArea !== row.managementArea) {
        throw conflict(`Căn ${saved.code} đã thay đổi hoặc đang được sửa trong danh mục. Hãy dùng Điều chỉnh thông tin căn hộ rồi tải lại.`);
      }
      submitted.add(String(row.id));
    }
    if (submitted.size !== existing.length) throw conflict('Danh sách thiếu căn đang có. Không được xóa căn bằng việc bỏ dòng khỏi danh mục.');
    if (additions.length) await Apartment.insertMany(additions.map((row) => newApartment(row, building._id)), { session });
    const previous = { totalFloors: building.totalFloors, floors: building.floorInventory,
      sourceReference: building.inventorySource, confirmedAt: building.inventoryConfirmedAt };
    await Building.updateOne({ _id: id }, { $set: {
      totalFloors: data.totalFloors, floorInventory: data.floors, inventorySource: data.sourceReference.trim(),
      inventoryConfirmedAt: new Date(), inventoryConfirmedBy: actor.id ?? actor._id,
    } }, { session, runValidators: true });
    await logAudit({ action: AUDIT_ACTIONS.BUILDING_CHANGED, user: actor,
      targetType: AUDIT_TARGETS.BUILDING, targetId: id, ip,
      metadata: { action: building.inventoryConfirmedAt ? 'INVENTORY_REVISED' : 'INVENTORY_CONFIRMED',
        reason: data.reason, sourceReference: data.sourceReference, from: previous,
        to: { totalFloors: data.totalFloors, floors: data.floors }, addedApartments: additions } }, { session });
    return { message: 'Đã đối chiếu và xác nhận danh mục', addedCount: additions.length };
  });
}

export async function inventoryHistory(id) {
  const apartments = await Apartment.find({ buildingId: id }).select('_id').lean();
  return AuditLog.find({ $or: [
    { targetType: AUDIT_TARGETS.BUILDING, targetId: id },
    { targetType: AUDIT_TARGETS.APARTMENT, targetId: { $in: apartments.map((row) => row._id) } },
    { targetType: AUDIT_TARGETS.APARTMENT, 'metadata.buildingId': new mongoose.Types.ObjectId(id) },
  ] }).sort({ createdAt: -1, _id: -1 }).limit(100).populate('performedBy', 'fullName').lean();
}
