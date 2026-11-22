// Dữ liệu demo luồng bảo trì – sửa chữa hướng mới (kế hoạch giai đoạn 11). Không reset, không ghi đè dữ liệu có sẵn.
// Chạy trước để xem kế hoạch:   node scripts/seedMaintenanceDemo.js
// Ghi dữ liệu:                  node scripts/seedMaintenanceDemo.js --apply
//
// Tạo 3 thiết bị và phiếu để demo:
//   A. Thang máy hết bảo hành, phiếu Đang kiểm tra kết quả Có sự cố → KTV báo hư hỏng 180 triệu → bắt buộc Quỹ (WF1-38).
//   B. Máy bơm có phiếu chi phí vận hành 40 triệu đã xong 10 ngày trước + báo cáo mới 15 triệu → cộng dồn 55 triệu ≥ ngưỡng (WF1-23).
//   C. Máy phát còn bảo hành 60 ngày, báo cáo hư hỏng 8 triệu → cảnh báo bảo hành, chọn nguồn Bảo hành (WF1-25).
// Quỹ: nếu số dư dưới 200 triệu thì ghi 1 phiếu thu INITIAL_HANDOVER bù cho đủ (có chứng từ mang mã demo).
// Dùng tài khoản đang có (Trưởng BQL, Kế toán, KTV, ≥ 3 Ban quản trị); thiếu thì báo lỗi, không tự tạo tài khoản.
import { pathToFileURL } from 'node:url';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Asset, Building, MaintenanceFund, User, WorkOrder } from '../src/models/index.js';
import { getFund, recordIncome } from '../src/modules/fund/fund.service.js';
import { DAY_MS, startOfVnDay } from '../src/utils/time.js';

const TAG = 'MAINT-DEMO-20261118';
const FUND_TARGET = 200_000_000;
const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * DAY_MS);
const CHECKLIST = [{ label: 'Điện áp tủ điều khiển', unit: 'V', minValue: 370, maxValue: 400, required: true }];
const PHOTO = 'https://placehold.co/600x400?text=SAPMS+demo';

const assets = [
  {
    code: 'DEMO-TM-A', name: 'Thang máy A (demo)', category: 'ELEVATOR', location: 'Sảnh Block A', warrantyEnd: daysAgo(400),
    describe: 'Thang máy hết bảo hành, phiếu Có sự cố chờ KTV báo hư hỏng (gợi ý chi phí 180.000.000 đ)',
  },
  {
    code: 'DEMO-BOM-B', name: 'Máy bơm B (demo)', category: 'PUMP', location: 'Tầng hầm B1', warrantyEnd: daysAgo(100),
    describe: 'Phiếu vận hành 40.000.000 đ xong 10 ngày trước + báo cáo mới 15.000.000 đ chờ duyệt (cộng dồn 55 triệu)',
  },
  {
    code: 'DEMO-MP-C', name: 'Máy phát C (demo)', category: 'OTHER', location: 'Phòng kỹ thuật', warrantyEnd: new Date(now.getTime() + 60 * DAY_MS),
    describe: 'Còn bảo hành 60 ngày, báo cáo hư hỏng 8.000.000 đ chờ duyệt',
  },
];

const repairOf = (tech, { faultDesc, estimatedCost, at }) => ({
  faultDesc,
  vendorName: 'Công ty Kỹ thuật Demo',
  vendorProposal: 'Thay linh kiện hỏng theo báo giá nhà thầu',
  estimatedCost,
  faultImages: [PHOTO],
  reportedBy: tech._id,
  reportedAt: at,
  history: [{ action: 'REPORTED', by: tech._id, at, note: faultDesc, images: [PHOTO] }],
});

/** Phần thân (test gọi trực tiếp trên DB test). log: hàm in kế hoạch */
export async function seedMaintenanceDemo({ apply = false, log = console.log } = {}) {
  const [manager, accountant, tech, board, building] = await Promise.all([
    User.findOne({ role: 'MANAGER', isActive: true }).lean(),
    User.findOne({ role: 'ACCOUNTANT', isActive: true }).lean(),
    User.findOne({ role: 'STAFF', roleTitle: 'TECHNICIAN', isActive: true }).lean(),
    User.find({ role: 'BOARD', isActive: true }).lean(),
    Building.findOne({}).sort({ createdAt: 1 }).lean(),
  ]);
  const missing = [
    !manager && 'Trưởng BQL', !accountant && 'Kế toán', !tech && 'Kỹ thuật viên', board.length < 3 && `≥ 3 Ban quản trị (đang có ${board.length})`, !building && 'tòa nhà',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Thiếu ${missing.join(', ')}. Không tự tạo thay.`);

  const existing = await Asset.find({ code: { $in: assets.map((a) => a.code) } }).select('code').lean();
  if (existing.length) throw new Error(`Đã có thiết bị demo ${existing.map((a) => a.code).join(', ')}. Không tạo lại (dữ liệu đã seed trước đó).`);
  // Chỉ đọc (getFund sẽ tạo quỹ nếu chưa có — chế độ xem không được ghi gì)
  const balance = (await MaintenanceFund.findOne({ buildingId: null }).select('balance').lean())?.balance ?? 0;
  const topUp = Math.max(0, FUND_TARGET - balance);

  log(`Kế hoạch (${apply ? 'GHI' : 'chỉ xem, thêm --apply để ghi'}) — tòa ${building.code ?? building.name}:`);
  assets.forEach((a) => log(`  + ${a.code}: ${a.describe}`));
  log(topUp ? `  + Phiếu thu quỹ ${topUp.toLocaleString('vi-VN')} đ (chứng từ ${TAG}) cho đủ 200 triệu` : `  = Quỹ đã có ${balance.toLocaleString('vi-VN')} đ, không thu thêm`);
  log('Tài khoản dùng để demo (mật khẩu theo dữ liệu hiện có):');
  for (const [label, u] of [['Trưởng BQL', manager], ['Kế toán', accountant], ['Kỹ thuật viên', tech], ...board.slice(0, 3).map((b, i) => [`Ban quản trị ${i + 1}`, b])]) {
    log(`  ${label.padEnd(15)} ${u.fullName} — ${u.phone ?? u.email ?? u._id}`);
  }
  if (!apply) return;

  const created = {};
  for (const a of assets) {
    created[a.code] = await Asset.create({
      buildingId: building._id, code: a.code, name: a.name, category: a.category, location: a.location, warrantyEnd: a.warrantyEnd,
      cycleValue: 1, cycleUnit: 'MONTH', checklist: CHECKLIST, nextMaintenanceDate: startOfVnDay(daysAgo(1)), note: TAG, createdBy: manager._id,
    });
  }
  const base = (asset, extra) => ({
    assetId: asset._id, type: 'SCHEDULED', title: `Bảo trì ${asset.name}`, scheduledDate: asset.nextMaintenanceDate, checklist: CHECKLIST,
    assignedTo: tech._id, assignedBy: manager._id, assignedAt: daysAgo(1), startedAt: daysAgo(1), note: TAG, ...extra,
  });
  const inspected = (at, value) => ({ scannedAt: at, inspectedAt: at, result: 'FAULTY', results: [{ index: 0, label: CHECKLIST[0].label, value, isOk: false }] });

  // A: Đang kiểm tra, Có sự cố → KTV báo hư hỏng ở Checklist ca
  await WorkOrder.create(base(created['DEMO-TM-A'], { status: 'IN_PROGRESS', ...inspected(daysAgo(0.1), 430) }));

  // B: phiếu cũ vận hành 40 triệu đã xong 10 ngày trước (đã ghi chi) + phiếu mới chờ duyệt 15 triệu
  const b = created['DEMO-BOM-B'];
  await WorkOrder.create(base(b, {
    status: 'DONE', completedAt: daysAgo(8), ...inspected(daysAgo(12), 420),
    repair: {
      ...repairOf(tech, { faultDesc: 'Bơm rò rỉ phớt, áp lực yếu (demo)', estimatedCost: 40_000_000, at: daysAgo(11) }),
      costSource: 'OPERATING', decidedBy: manager._id, decidedAt: daysAgo(10), acceptedBy: manager._id, acceptedAt: daysAgo(8),
      actualCost: 40_000_000, invoiceNo: `${TAG}-HD-B1`, invoiceUrls: [PHOTO], expenseRecordedBy: accountant._id, expenseRecordedAt: daysAgo(7),
    },
  }));
  await WorkOrder.create(base(b, {
    status: 'AWAITING_REPAIR_APPROVAL', ...inspected(daysAgo(0.2), 410),
    repair: repairOf(tech, { faultDesc: 'Bơm số 2 kêu to, rung mạnh (demo)', estimatedCost: 15_000_000, at: daysAgo(0.1) }),
  }));

  // C: còn bảo hành, báo cáo hư hỏng chờ duyệt
  await WorkOrder.create(base(created['DEMO-MP-C'], {
    status: 'AWAITING_REPAIR_APPROVAL', ...inspected(daysAgo(0.2), 360),
    repair: repairOf(tech, { faultDesc: 'Máy phát không tự khởi động khi mất điện (demo)', estimatedCost: 8_000_000, at: daysAgo(0.1) }),
  }));

  // Lịch kế tiếp của thiết bị đã có phiếu: dời 1 tháng để job tạo phiếu không tạo thêm
  await Asset.updateMany({ _id: { $in: Object.values(created).map((x) => x._id) } }, { $set: { nextMaintenanceDate: new Date(now.getTime() + 30 * DAY_MS) } });

  if (topUp) {
    await recordIncome({ id: String(accountant._id), role: 'ACCOUNTANT' }, {
      incomeSource: 'INITIAL_HANDOVER', amount: topUp, documentNo: TAG, description: 'Bù số dư quỹ cho demo luồng bảo trì',
    });
  }
  const after = await getFund();
  log(`Đã ghi. Số dư quỹ: ${after.balance.toLocaleString('vi-VN')} đ.`);
}

// Chạy trực tiếp: node scripts/seedMaintenanceDemo.js [--apply]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectDB()
    .then(() => seedMaintenanceDemo({ apply: process.argv.includes('--apply') }))
    .catch((err) => {
      console.error(`[seedMaintenanceDemo] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
