import { Apartment, Building, Invoice } from '../../models/index.js';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { periodStart, shiftPeriod, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { linkedRecords, touchInventory } from '../buildings/inventory.service.js';
import { apartmentAreaView, managementAreaAt } from './managementArea.js';

export async function correctApartment(id, data, actor, ip) {
  if (!data.reason?.trim() || !data.sourceReference?.trim()) {
    throw ApiError.badRequest('Cần lý do và tài liệu đối chiếu khi điều chỉnh căn hộ');
  }
  return withTransaction(async (session) => {
    const apartment = await Apartment.findById(id).session(session);
    if (!apartment) throw ApiError.notFound('Căn hộ không tồn tại');
    if (data.expectedUpdatedAt !== apartment.updatedAt.toISOString()) {
      throw new ApiError('STATUS_CONFLICT', 'Căn hộ vừa thay đổi. Vui lòng tải lại trước khi điều chỉnh.');
    }
    const building = await Building.findById(apartment.buildingId).session(session);
    if (!building) throw ApiError.notFound('Tòa nhà không tồn tại');
    await touchInventory(building, session);
    const changes = {};
    if (data.code !== undefined && data.code.trim().toUpperCase() !== apartment.code) {
      if ((await linkedRecords('Apartment', id, session)).length) {
        throw new ApiError('STATUS_CONFLICT', 'Không thể đổi mã căn đã có hồ sơ liên quan');
      }
      const code = data.code.trim().toUpperCase();
      if (await Apartment.exists({ buildingId: building._id, code, _id: { $ne: id } }).session(session)) {
        throw new ApiError('DUPLICATE_VALUE', 'Mã căn đã tồn tại trong tòa');
      }
      changes.code = { from: apartment.code, to: code };
      apartment.code = code;
    }
    if (data.floor !== undefined && data.floor !== apartment.floor) {
      if (data.floor < 1 || data.floor > building.totalFloors
        || (building.inventoryConfirmedAt && !building.floorInventory.some((row) => row.floor === data.floor))) {
        throw ApiError.field('floor', 'Tầng phải thuộc danh mục tầng có căn hộ của tòa');
      }
      if (building.inventoryConfirmedAt) {
        const fromFloor = building.floorInventory.find((row) => row.floor === apartment.floor);
        const toFloor = building.floorInventory.find((row) => row.floor === data.floor);
        if (fromFloor) fromFloor.expectedCount -= 1;
        toFloor.expectedCount += 1;
        // Tầng hết căn được loại khỏi danh mục tầng có căn hộ.
        const floors = building.floorInventory.filter((row) => row.expectedCount > 0).map((row) => row.toObject());
        await Building.updateOne({ _id: building._id }, { $set: { floorInventory: floors } }, { session });
      }
      changes.floor = { from: apartment.floor, to: data.floor };
      apartment.floor = data.floor;
    }
    if (data.managementArea !== undefined) {
      const area = data.managementArea;
      const latest = [...apartment.managementAreaHistory].sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
      const comparison = latest?.area ?? managementAreaAt(apartment) ?? apartment.area;
      if (area !== comparison) {
        const nextPeriod = shiftPeriod(vnPeriod(), 1);
        if (!data.effectivePeriod || data.effectivePeriod < nextPeriod) {
          throw ApiError.field('effectivePeriod', `Diện tích mới áp dụng từ kỳ ${nextPeriod} trở đi`);
        }
        if (latest && data.effectivePeriod <= vnPeriod(latest.effectiveFrom)) {
          throw ApiError.field('effectivePeriod', 'Kỳ áp dụng phải sau lần điều chỉnh diện tích đã ghi nhận gần nhất');
        }
        const invoice = await Invoice.findOne({ apartmentId: id, period: { $gte: data.effectivePeriod }, status: { $ne: 'CANCELLED' } })
          .select('period').session(session).lean();
        if (invoice) throw new ApiError('STATUS_CONFLICT', `Kỳ ${invoice.period} đã có thông báo phí. Chọn kỳ sau các thông báo đã lập.`);
        changes.managementArea = { from: comparison, to: area, effectivePeriod: data.effectivePeriod };
        apartment.managementAreaHistory.push({ area, effectiveFrom: periodStart(data.effectivePeriod),
          reason: data.reason.trim(), sourceReference: data.sourceReference.trim(),
          changedBy: actor.id ?? actor._id, changedAt: new Date() });
      }
    }
    if (!Object.keys(changes).length) throw ApiError.badRequest('Chưa có thay đổi cần ghi nhận');
    await apartment.save({ session });
    await logAudit({ action: AUDIT_ACTIONS.APARTMENT_CHANGED, user: actor,
      targetType: AUDIT_TARGETS.APARTMENT, targetId: id, ip,
      metadata: { action: 'CATALOG_CORRECTED', buildingId: building._id,
        reason: data.reason.trim(), sourceReference: data.sourceReference.trim(), changes } }, { session });
    return apartmentAreaView(apartment);
  });
}
