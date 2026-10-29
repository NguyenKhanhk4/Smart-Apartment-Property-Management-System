/**
 * Script migrate mã hóa CCCD (idNumber plaintext -> idNumberEnc + idNumberHash) trên collection residents.
 * Hỗ trợ chế độ --dry-run (chỉ thống kê, không ghi DB).
 *
 * Cách dùng:
 *   node scripts/migrateResidentIdNumbers.js --dry-run
 *   node scripts/migrateResidentIdNumbers.js
 */
import { pathToFileURL } from 'node:url';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Resident } from '../src/models/index.js';
import { buildIdNumberFields, maskIdNumber } from '../src/modules/residents/idCrypto.js';

export async function runMigrateResidentIdNumbers({ dryRun = true } = {}) {
  await connectDB();

  try {
    const candidates = await Resident.find({
      idNumber: { $exists: true, $nin: [null, ''] },
    }).lean();

    console.log(
      `[migrateResidentIdNumbers] Chế độ: ${dryRun ? 'DRY-RUN (không ghi DB)' : 'COMMIT (ghi DB)'}`,
    );
    console.log(`[migrateResidentIdNumbers] Tìm thấy ${candidates.length} bản ghi cần mã hóa.`);

    let migratedCount = 0;

    for (const doc of candidates) {
      const plain = String(doc.idNumber || '').trim();
      if (!plain) continue;

      const fields = buildIdNumberFields(plain);
      console.log(
        `  - Resident ${doc._id}: CCCD ${maskIdNumber(plain)} -> idNumberEnc (${fields.idNumberEnc?.slice(0, 16)}...)`,
      );

      if (!dryRun) {
        await Resident.updateOne(
          { _id: doc._id },
          {
            $set: {
              idNumber: null,
              idNumberEnc: fields.idNumberEnc,
              idNumberHash: fields.idNumberHash,
            },
          },
        );
      }

      migratedCount += 1;
    }

    console.log(
      `[migrateResidentIdNumbers] Hoàn tất: ${migratedCount} bản ghi ${dryRun ? 'sẽ được' : 'đã được'} mã hóa.`,
    );
    return migratedCount;
  } finally {
    await disconnectDB();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const dryRun = process.argv.includes('--dry-run');
  await runMigrateResidentIdNumbers({ dryRun });
}
