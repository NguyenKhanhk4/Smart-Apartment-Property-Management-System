/**
 * Bỏ gói tháng / vé lẻ (tiện ích kiểu Vào cửa – SRS v4) theo SRS final: chỉ còn FREE và BOOKING.
 *   - Tiện ích WALK_IN → BOOKING: slot 60 phút (rút ngắn nếu giờ mở cửa ít hơn), sức chứa = số người tối đa cùng lúc
 *     (không có thì 10), phí/lượt đặt = giá vé lẻ người lớn.
 *   - Xóa các trường cũ trên amenities (vé lẻ, gói tháng, số người tối đa) và bookings.passId.
 *   - Collection amenity_passes, amenity_visits giữ nguyên để tra cứu (code không còn đọc).
 * Mặc định chỉ in kế hoạch; thêm --apply mới ghi. Chạy lại không đổi gì:
 *   node scripts/migrateWalkInAmenities.js [--apply]
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

const LEGACY_FIELDS = ['perVisitFeeAdult', 'perVisitFeeChild', 'maxConcurrent', 'monthlyPassFeeAdult', 'monthlyPassFeeChild'];
const DEFAULT_SLOT = 60;
const DEFAULT_CAPACITY = 10;

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Giá trị BOOKING cho 1 tiện ích WALK_IN cũ */
export function bookingFieldsOf(a) {
  const open = a.openTime ?? '05:00';
  const close = a.closeTime ?? '22:00';
  return {
    accessMode: 'BOOKING',
    openTime: open,
    closeTime: close,
    slotDurationMinutes: Math.max(15, Math.min(DEFAULT_SLOT, toMinutes(close) - toMinutes(open))),
    capacityPerSlot: a.maxConcurrent ?? DEFAULT_CAPACITY,
    feePerBooking: a.perVisitFeeAdult ?? 0,
    changeDeadlineHours: a.changeDeadlineHours ?? 24,
  };
}

/** Trả về { converted: [{ name, ...fields }], cleaned, bookings }. apply = false chỉ đếm, không ghi */
export async function migrateWalkInAmenities({ apply = false } = {}) {
  const db = mongoose.connection.db;
  const amenities = db.collection('amenities');
  const walkIns = await amenities.find({ accessMode: 'WALK_IN' }).toArray();
  const converted = walkIns.map((a) => ({ _id: a._id, name: a.name, ...bookingFieldsOf(a) }));
  const unset = Object.fromEntries(LEGACY_FIELDS.map((f) => [f, '']));
  const legacyFilter = { $or: LEGACY_FIELDS.map((f) => ({ [f]: { $exists: true } })) };

  if (!apply) {
    return {
      converted,
      cleaned: await amenities.countDocuments(legacyFilter),
      bookings: await db.collection('bookings').countDocuments({ passId: { $exists: true } }),
    };
  }
  for (const a of walkIns) {
    await amenities.updateOne({ _id: a._id, accessMode: 'WALK_IN' }, { $set: bookingFieldsOf(a) });
  }
  const cleaned = (await amenities.updateMany(legacyFilter, { $unset: unset })).modifiedCount;
  const bookings = (await db.collection('bookings').updateMany({ passId: { $exists: true } }, { $unset: { passId: '' } })).modifiedCount;
  return { converted, cleaned, bookings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  await connectDB();
  try {
    const r = await migrateWalkInAmenities({ apply });
    const tag = apply ? 'Đã đổi' : 'Sẽ đổi (chạy lại với --apply để ghi)';
    console.log(`[migrateWalkInAmenities] ${tag}:`);
    for (const c of r.converted) {
      console.log(`  - ${c.name}: BOOKING, slot ${c.slotDurationMinutes} phút, ${c.capacityPerSlot} chỗ/slot, phí ${c.feePerBooking}`);
    }
    console.log(`  - Xóa trường vé lẻ / gói tháng trên ${r.cleaned} tiện ích; xóa passId trên ${r.bookings} booking`);
  } finally {
    await disconnectDB();
  }
}
