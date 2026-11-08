// UC07: script chuyển thiết bị cũ (chưa có mã, mã QR, đơn vị chu kỳ) sang mẫu mới; xem trước không ghi gì, chạy lại không đổi gì
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Asset } from '../../src/models/index.js';
import { migrateAssetsUc07 } from '../../scripts/migrateAssetsUc07.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';

before(connectTestDB);
after(async () => {
  await clearTestDB();
  await closeTestDB();
});

test('xem trước không ghi; áp dụng: đặt mã TB-xxx (bỏ qua mã đã dùng), sinh QR, đổi chu kỳ ngày, bỏ index trùng tên; chạy lại không đổi gì', async () => {
  const col = Asset.collection;
  await col.dropIndexes().catch(() => {});
  // Đúng tình trạng dữ liệu cũ trên Atlas: còn index trùng tên trong tòa, chưa có index mã
  await col.createIndex({ buildingId: 1, name: 1 }, { name: 'uniq_building_asset_name', unique: true });
  const buildingId = new mongoose.Types.ObjectId();
  const at = (d) => new Date(`2026-10-0${d}T00:00:00Z`);
  await col.insertMany([
    { buildingId, name: 'Thang máy 1', category: 'ELEVATOR', maintenanceCycleDays: 30, nextMaintenanceDate: at(9), isActive: true, createdAt: at(1) },
    { buildingId, name: 'Máy bơm', category: 'PUMP', maintenanceCycleDays: 90, nextMaintenanceDate: at(9), isActive: true, createdAt: at(2) },
    { buildingId, name: 'Đã có mã', code: 'TB-002', qrCode: 'EQ-CO-SAN', cycleValue: 1, cycleUnit: 'MONTH', checklist: [], nextMaintenanceDate: at(9), isActive: true, createdAt: at(3) },
  ]);

  const plan = await migrateAssetsUc07();
  assert.equal(plan.apply, false);
  assert.equal(plan.toUpdate.length, 2);
  assert.equal(plan.dropIndex, 'uniq_building_asset_name');
  assert.equal(await col.countDocuments({ code: { $exists: true } }), 1); // xem trước: chưa ghi

  const result = await migrateAssetsUc07({ apply: true });
  assert.equal(result.updated, 2);
  const rows = await col.find().sort({ createdAt: 1 }).toArray();
  assert.deepEqual(rows.map((r) => r.code), ['TB-001', 'TB-003', 'TB-002']); // TB-002 đã dùng → nhảy sang TB-003
  assert.deepEqual(rows.map((r) => [r.cycleValue, r.cycleUnit]), [[30, 'DAY'], [90, 'DAY'], [1, 'MONTH']]);
  assert.ok(rows.every((r) => r.qrCode && Array.isArray(r.checklist) && r.maintenanceCycleDays === undefined));
  assert.equal(rows[2].qrCode, 'EQ-CO-SAN'); // mã QR có sẵn không đổi

  const names = (await col.indexes()).map((i) => i.name);
  assert.ok(!names.includes('uniq_building_asset_name'));
  assert.ok(names.includes('uniq_asset_code') && names.includes('uniq_asset_qr'));
  await col.insertOne({ buildingId, name: 'Thang máy 1', code: 'TB-009', qrCode: 'EQ-X', cycleValue: 1, cycleUnit: 'DAY', checklist: [], nextMaintenanceDate: at(9) }); // trùng tên được

  const again = await migrateAssetsUc07({ apply: true });
  assert.equal(again.updated, 0);
  assert.equal(again.dropIndex, null);
});
