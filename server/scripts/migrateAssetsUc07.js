/**
 * UC07: chuyển thiết bị cũ sang mẫu mới. Chạy lại không đổi gì (idempotent).
 *   - Chưa có mã → đặt TB-001, TB-002... theo thứ tự tạo (bỏ qua mã đã dùng)
 *   - Chưa có mã QR → sinh mới (cố định từ đây)
 *   - maintenanceCycleDays → cycleValue + cycleUnit = DAY, rồi bỏ trường cũ
 *   - Chưa có checklist → [] (Trưởng BQL bổ sung trên giao diện)
 *   - Index: bỏ uniq_building_asset_name (trùng tên trong tòa), tạo uniq_asset_code, uniq_asset_qr
 *
 * Xem trước:  node scripts/migrateAssetsUc07.js
 * Áp dụng:    node scripts/migrateAssetsUc07.js --apply
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Asset, newQrCode } from '../src/models/Asset.js';

const OLD_INDEX = 'uniq_building_asset_name';

/** Trả kế hoạch (và kết quả nếu apply). Dùng được khi đã có kết nối DB, vd trong test */
export async function migrateAssetsUc07({ apply = false } = {}) {
  const col = Asset.collection; // driver gốc: dữ liệu cũ thiếu trường bắt buộc của schema mới
  const docs = await col.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const used = new Set(docs.map((d) => d.code).filter(Boolean));
  let n = 0;
  const nextCode = () => {
    let code;
    do code = `TB-${String((n += 1)).padStart(3, '0')}`;
    while (used.has(code));
    used.add(code);
    return code;
  };

  const updates = [];
  for (const d of docs) {
    const $set = {};
    const $unset = {};
    if (!d.code) $set.code = nextCode();
    if (!d.qrCode) $set.qrCode = newQrCode();
    if (d.cycleValue == null) {
      $set.cycleValue = d.maintenanceCycleDays ?? 30;
      $set.cycleUnit = 'DAY';
    }
    if (d.maintenanceCycleDays !== undefined) $unset.maintenanceCycleDays = '';
    if (!Array.isArray(d.checklist)) $set.checklist = [];
    if (Object.keys($set).length || Object.keys($unset).length) {
      updates.push({ _id: d._id, name: d.name, $set, $unset });
    }
  }
  const indexes = await col.indexes();
  const plan = {
    apply,
    assets: docs.length,
    toUpdate: updates.map((u) => ({ name: u.name, ...u.$set, ...(Object.keys(u.$unset).length && { remove: Object.keys(u.$unset) }) })),
    dropIndex: indexes.some((i) => i.name === OLD_INDEX) ? OLD_INDEX : null,
  };
  if (!apply) return plan;

  for (const u of updates) {
    const op = { ...(Object.keys(u.$set).length && { $set: u.$set }), ...(Object.keys(u.$unset).length && { $unset: u.$unset }) };
    await col.updateOne({ _id: u._id }, op);
  }
  if (plan.dropIndex) await col.dropIndex(OLD_INDEX);
  await Asset.createIndexes(); // tạo uniq_asset_code, uniq_asset_qr... sau khi mọi thiết bị đã có mã
  return { ...plan, updated: updates.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--apply')) throw new Error('Chỉ hỗ trợ tùy chọn --apply; mặc định chỉ xem trước.');
  try {
    // Không để autoIndex tự tạo index unique trước khi dữ liệu cũ có mã
    await mongoose.connect(env.mongodbUri, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
    console.log(JSON.stringify(await migrateAssetsUc07({ apply: args.includes('--apply') }), null, 2));
  } finally {
    await mongoose.disconnect();
  }
}
