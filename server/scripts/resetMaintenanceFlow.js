// Làm mới toàn bộ dữ liệu luồng bảo trì – sửa chữa (giữ nguyên tài khoản):
//   1. Sao lưu ra file JSON (nếu truyền --backup=<đường dẫn>).
//   2. Xóa: phiếu bảo trì, đề xuất chi quỹ, sổ thu chi quỹ, thông báo loại Bảo trì / Quỹ, nhật ký của luồng (phiếu, đề xuất, sổ
//      quỹ, quỹ, đổi tham số tài chính, thiết bị bị xóa), thiết bị demo TB-009 → TB-018, TB24/25/26-xx và TEST-UC07; giá trị chờ xác nhận của
//      tham số tài chính.
//   3. Đặt lại: số dư quỹ về 0 rồi ghi 1 phiếu thu bàn giao (mặc định 500 triệu); thiết bị TB-001 → TB-008 về chưa bảo trì,
//      đến hạn từ 25 ngày trước.
//   4. Tạo lại dữ liệu: seedMaintenanceCases (10 trường hợp) + seedMaintenanceCasesExtra (6 trường hợp).
// Xem kế hoạch:  node scripts/resetMaintenanceFlow.js
// Ghi:           node scripts/resetMaintenanceFlow.js --apply [--backup=đường/dẫn.json] [--fund=500000000]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { BOARD_CONFIRM_CONFIG_KEYS, NOTIFICATION_TYPES } from '../src/constants/enums.js';
import { User } from '../src/models/index.js';
import { getFund, recordIncome } from '../src/modules/fund/fund.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../src/utils/time.js';
import { seedMaintenanceCases } from './seedMaintenanceCases.js';
import { seedMaintenanceCasesExtra } from './seedMaintenanceCasesExtra.js';
import { DEMO3_CODES } from './seedMaintenanceDemo3Days.js';

export const KEEP_ASSETS = ['TB-001', 'TB-002', 'TB-003', 'TB-004', 'TB-005', 'TB-006', 'TB-007', 'TB-008'];
export const DEMO_ASSETS = [
  'TB-009', 'TB-010', 'TB-011', 'TB-012', 'TB-013', 'TB-014', 'TB-015', 'TB-016', 'TB-017', 'TB-018', 'TEST-UC07',
  ...DEMO3_CODES, // TB24-xx, TB25-xx, TB26-xx (seedMaintenanceDemo3Days)
];
const FLOW_TARGETS = ['work_orders', 'fund_proposals', 'fund_transactions', 'maintenance_fund'];
const FLOW_ACTIONS = /^(WORKORDER_|FUND_|CONFIG_CHANGE_)/;
const FLOW_NOTIFICATIONS = [NOTIFICATION_TYPES.MAINTENANCE, NOTIFICATION_TYPES.FUND_APPROVAL];

export async function resetMaintenanceFlow({ apply = false, log = console.log, now = new Date(), fundAmount = 500_000_000, backupPath = null } = {}) {
  const db = mongoose.connection.db;
  const c = (name) => db.collection(name);
  const demoAssets = await c('assets').find({ code: { $in: DEMO_ASSETS } }).project({ _id: 1, code: 1 }).toArray();
  const demoIds = demoAssets.map((a) => a._id);
  const filters = {
    work_orders: {},
    fund_proposals: {},
    fund_transactions: {},
    notifications: { type: { $in: FLOW_NOTIFICATIONS } },
    audit_logs: {
      $or: [
        { targetType: { $in: FLOW_TARGETS } },
        { action: FLOW_ACTIONS },
        ...(demoIds.length ? [{ targetType: 'assets', targetId: { $in: demoIds } }] : []),
      ],
    },
    assets: { _id: { $in: demoIds } },
  };
  const counts = {};
  for (const [name, filter] of Object.entries(filters)) counts[name] = await c(name).countDocuments(filter);
  const keep = await c('assets').countDocuments({ code: { $in: KEEP_ASSETS } });
  const accountant = await User.findOne({ role: 'ACCOUNTANT', isActive: true }).lean();
  if (!accountant) throw new Error('Thiếu tài khoản Kế toán để ghi phiếu thu quỹ.');
  if (keep < KEEP_ASSETS.length) throw new Error(`Thiếu thiết bị gốc ${KEEP_ASSETS[0]} → ${KEEP_ASSETS.at(-1)} (có ${keep}/${KEEP_ASSETS.length}), không chạy được. Dữ liệu demo 3 ngày: dùng seedMaintenanceDemo3Days.js --reset.`);

  log(`Kế hoạch (${apply ? 'GHI' : 'chỉ xem, thêm --apply để ghi'}) trên DB ${db.databaseName}:`);
  Object.entries(counts).forEach(([name, n]) => log(`  - xóa ${n} ${name}`));
  log(`  - đặt lại số dư quỹ = 0, ghi phiếu thu bàn giao ${fundAmount.toLocaleString('vi-VN')} đ`);
  log(`  - đặt lại lịch ${keep} thiết bị ${KEEP_ASSETS[0]} → ${KEEP_ASSETS.at(-1)}, xóa giá trị chờ của tham số tài chính`);
  log('  - tạo lại 16 trường hợp (seedMaintenanceCases + seedMaintenanceCasesExtra)');
  if (!apply) return { counts };

  if (backupPath) {
    const backup = {};
    for (const [name, filter] of Object.entries(filters)) backup[name] = await c(name).find(filter).toArray();
    backup.maintenance_fund = await c('maintenance_fund').find().toArray();
    backup.keep_assets = await c('assets').find({ code: { $in: KEEP_ASSETS } }).toArray();
    backup.system_configs = await c('system_configs').find({ key: { $in: [...BOARD_CONFIRM_CONFIG_KEYS] } }).toArray();
    fs.writeFileSync(backupPath, EJSON.stringify(backup, null, 1));
    log(`Đã sao lưu ra ${backupPath}`);
  }

  // Xóa thẳng trên collection: model AuditLog chặn xóa (chỉ ghi thêm, BR-S10) — ở đây là dọn dữ liệu test theo yêu cầu
  for (const [name, filter] of Object.entries(filters)) {
    const r = await c(name).deleteMany(filter);
    log(`  đã xóa ${r.deletedCount} ${name}`);
  }
  const due = startOfVnDay(new Date(now.getTime() - 25 * DAY_MS));
  await c('assets').updateMany(
    { code: { $in: KEEP_ASSETS } },
    { $set: { lastMaintenanceDate: null, nextMaintenanceDate: due, isActive: true } },
  );
  await c('system_configs').updateMany(
    { key: { $in: [...BOARD_CONFIRM_CONFIG_KEYS] } },
    { $set: { pendingValue: null, pendingBy: null, pendingAt: null } },
  );
  const fund = await getFund();
  await c('maintenance_fund').updateOne({ _id: fund._id }, { $set: { balance: 0, approvalSeq: 0 } });

  const smtp = env.smtp.enabled;
  env.smtp.enabled = false; // không gửi email trong lúc dựng dữ liệu
  try {
    const at = new Date(startOfVnDay(new Date(now.getTime() - 30 * DAY_MS)).getTime() + 9 * HOUR_MS);
    await recordIncome(
      { id: String(accountant._id), role: 'ACCOUNTANT' },
      { incomeSource: 'INITIAL_HANDOVER', amount: fundAmount, documentNo: 'BB-BG-2PCT', occurredAt: at, description: 'Kinh phí bảo trì 2% Chủ đầu tư bàn giao' },
      [],
      { now },
    );
  } finally {
    env.smtp.enabled = smtp;
  }
  await seedMaintenanceCases({ apply: true, log, now });
  await seedMaintenanceCasesExtra({ apply: true, log, now });
  const balance = (await getFund()).balance;
  log(`Xong. Số dư quỹ: ${balance.toLocaleString('vi-VN')} đ.`);
  return { counts, balance };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  connectDB()
    .then(() => resetMaintenanceFlow({
      apply: process.argv.includes('--apply'),
      backupPath: arg('backup') ?? null,
      fundAmount: arg('fund') ? Number(arg('fund')) : 500_000_000,
    }))
    .catch((err) => {
      console.error(`[resetMaintenanceFlow] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
