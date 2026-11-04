/**
 * audit_logs cũ ghi targetType theo tên model ('Contract', 'GatePass'...) → đổi về tên collection (AUDIT_TARGETS)
 * để tra lịch sử theo { targetType, targetId } ra đủ bản ghi. Chạy lại không đổi gì:
 *   node scripts/migrateAuditTargets.js
 */
import { pathToFileURL } from 'node:url';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { AUDIT_TARGETS } from '../src/constants/enums.js';
import { AuditLog } from '../src/models/index.js';

const LEGACY_TARGETS = {
  User: AUDIT_TARGETS.USER,
  Building: AUDIT_TARGETS.BUILDING,
  Apartment: AUDIT_TARGETS.APARTMENT,
  Contract: AUDIT_TARGETS.CONTRACT,
  Resident: AUDIT_TARGETS.RESIDENT,
  Vehicle: AUDIT_TARGETS.VEHICLE,
  GatePass: AUDIT_TARGETS.GATE_PASS,
  ParkingCard: AUDIT_TARGETS.PARKING_CARD,
};

/** Trả về số bản ghi đã đổi (dùng được khi đã có kết nối DB, vd trong test) */
export async function migrateAuditTargets() {
  let updated = 0;
  for (const [legacy, target] of Object.entries(LEGACY_TARGETS)) {
    const res = await AuditLog.updateMany({ targetType: legacy }, { $set: { targetType: target } });
    updated += res.modifiedCount;
  }
  return updated;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDB();
  try {
    console.log(`[migrateAuditTargets] Đã đổi ${await migrateAuditTargets()} bản ghi`);
  } finally {
    await disconnectDB();
  }
}
