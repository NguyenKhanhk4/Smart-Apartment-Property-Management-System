import { Resident } from '../../models/index.js';

/** Chỉ thay chỉ mục cũ chặn lịch sử; không thay dữ liệu cư dân hoặc chỉ mục khác. Mặc định xem trước. */
export async function migrateResidentHistoryIndex({ apply = false } = {}) {
  const collection = Resident.collection;
  const indexes = await collection.indexes();
  const old = indexes.filter((index) => index.unique && !index.partialFilterExpression &&
    Object.keys(index.key).length === 2 && index.key.userId === 1 && index.key.apartmentId === 1);
  const duplicateActive = await collection.aggregate([
    { $match: { isActive: true, userId: { $type: 'objectId' } } },
    { $group: { _id: { userId: '$userId', apartmentId: '$apartmentId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'count' },
  ]).toArray();
  const duplicates = duplicateActive[0]?.count ?? 0;
  const plan = { apply, collection: collection.name, duplicateActiveGroups: duplicates,
    create: 'uniq_active_resident', drop: old.map((index) => index.name) };
  if (!apply) return plan;
  if (duplicates) throw new Error('Có nhiều đợt cư trú đang hiệu lực cho cùng tài khoản/căn. Chưa thay đổi chỉ mục.');
  // Tạo ràng buộc mới thành công trước khi bỏ ràng buộc cũ.
  await collection.createIndex({ userId: 1, apartmentId: 1 }, {
    name: 'uniq_active_resident', unique: true,
    partialFilterExpression: { isActive: true, userId: { $type: 'objectId' } },
  });
  for (const index of old) await collection.dropIndex(index.name);
  return plan;
}
