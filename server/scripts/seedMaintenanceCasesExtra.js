// Bổ sung 6 trường hợp luồng bảo trì chưa có dữ liệu sẵn để test trên giao diện (Block C, TB-013 → TB-018).
// Tạo bằng chính các hàm nghiệp vụ; không ghi đè dữ liệu có sẵn.
// Xem kế hoạch:  node scripts/seedMaintenanceCasesExtra.js
// Ghi:           node scripts/seedMaintenanceCasesExtra.js --apply
// Trong lúc chạy: không gửi email, ảnh dùng ảnh mẫu (không upload Cloudinary).
import { pathToFileURL } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Asset, Building, User, WorkOrder } from '../src/models/index.js';
import * as assetsService from '../src/modules/assets/assets.service.js';
import * as decision from '../src/modules/workOrders/workOrders.decision.js';
import * as inspection from '../src/modules/workOrders/workOrders.inspection.js';
import * as repair from '../src/modules/workOrders/workOrders.repair.js';
import * as expense from '../src/modules/workOrders/workOrders.expense.js';
import * as service from '../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../src/utils/time.js';

const CHECK = [
  { label: 'Tiếng ồn, rung bất thường', required: true },
  { label: 'Nhiệt độ vận hành', unit: '°C', minValue: 20, maxValue: 70, required: true },
];
const ASSETS = [
  { code: 'TB-013', name: 'Thang máy số 3 Block C', category: 'ELEVATOR', location: 'Sảnh chính Block C', warrantyDays: -300, cycle: [1, 'MONTH'], lastDays: 40 },
  { code: 'TB-014', name: 'Bơm chữa cháy Block C', category: 'PUMP', location: 'Phòng bơm tầng hầm', warrantyDays: -400, cycle: [7, 'DAY'], lastDays: 20 },
  { code: 'TB-015', name: 'Hệ thống camera hầm Block C', category: 'OTHER', location: 'Hầm B1 Block C', warrantyDays: 90, cycle: [1, 'MONTH'], lastDays: 40 },
  { code: 'TB-016', name: 'Bơm nước sinh hoạt Block C', category: 'PUMP', location: 'Tầng mái Block C', warrantyDays: -200, cycle: [1, 'MONTH'], lastDays: 40 },
  { code: 'TB-017', name: 'Thang máy số 4 Block C', category: 'ELEVATOR', location: 'Sảnh phụ Block C', warrantyDays: -500, cycle: [1, 'MONTH'], lastDays: 40 },
  { code: 'TB-018', name: 'Quạt cấp gió tươi Block C', category: 'OTHER', location: 'Tầng mái Block C', warrantyDays: -100, cycle: [1, 'MONTH'], lastDays: 35 },
];
const CASES = [
  'TB-013: báo hư hỏng 150tr chờ quyết định → test bật "Sự cố khẩn cấp" (hoặc Quỹ thường); Chi phí vận hành bị khóa',
  'TB-014: vận hành 35tr đã xong 12 ngày trước (đã ghi chi) + báo cáo mới 20tr → cộng dồn 55tr, bắt buộc Quỹ',
  'TB-015: còn bảo hành 90 ngày, báo hư hỏng 12tr chờ quyết định → test nguồn Bảo hành / lý do không dùng bảo hành',
  'TB-016: vận hành 8tr hoàn thành 5 ngày trước, chưa ghi chi → Kế toán ghi chi (đã quá hạn nhắc 3 ngày)',
  'TB-017: KTV đã kiểm tra Có sự cố, chưa báo hư hỏng → test KTV "Báo cáo hư hỏng"',
  'TB-018: phiếu đến hạn chưa phân công → test Trưởng BQL phân công, KTV quét QR, nộp kết quả',
];

const PHOTO_URL = 'https://placehold.co/800x600?text=SAPMS';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const photo = (name = 'anh.jpg') => ({ originalname: name, mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length });
const PHOTOS = [photo()];
const as = (u) => ({ id: String(u._id), role: u.role, roleTitle: u.roleTitle ?? null, boardTitle: u.boardTitle ?? null });

function sandbox() {
  const original = cloudinary.uploader.upload_stream;
  const smtp = env.smtp.enabled;
  const cloud = env.cloudinary.enabled;
  let n = 0;
  cloudinary.uploader.upload_stream = (options, callback) => ({ end: () => callback(null, { secure_url: `${PHOTO_URL}+x${(n += 1)}` }) });
  env.smtp.enabled = false;
  env.cloudinary.enabled = true;
  return () => {
    cloudinary.uploader.upload_stream = original;
    env.smtp.enabled = smtp;
    env.cloudinary.enabled = cloud;
  };
}

export async function seedMaintenanceCasesExtra({ apply = false, log = console.log, now = new Date() } = {}) {
  const at = (days, hour = 9) => new Date(startOfVnDay(new Date(now.getTime() - days * DAY_MS)).getTime() + hour * HOUR_MS);
  const [managerDoc, accountantDoc, techDocs, blockC] = await Promise.all([
    User.findOne({ role: 'MANAGER', isActive: true }).lean(),
    User.findOne({ role: 'ACCOUNTANT', isActive: true }).lean(),
    User.find({ role: 'STAFF', roleTitle: 'TECHNICIAN', isActive: true }).sort({ createdAt: 1 }).lean(),
    Building.findOne({ code: 'T3' }).lean(),
  ]);
  const problems = [!managerDoc && 'Trưởng BQL', !accountantDoc && 'Kế toán', !techDocs.length && 'Kỹ thuật viên', !blockC && 'tòa T3 (Block C)'].filter(Boolean);
  if (problems.length) throw new Error(`Thiếu ${problems.join(', ')}.`);
  const taken = await Asset.find({ code: { $in: ASSETS.map((a) => a.code) } }).select('code').lean();
  if (taken.length) throw new Error(`Mã thiết bị đã có: ${taken.map((a) => a.code).join(', ')}. Không tạo lại.`);

  log(`Kế hoạch (${apply ? 'GHI' : 'chỉ xem, thêm --apply để ghi'}) — tòa ${blockC.name}:`);
  CASES.forEach((c) => log(`  + ${c}`));
  if (!apply) return null;

  const manager = as(managerDoc);
  const accountant = as(accountantDoc);
  const [t1, t2 = t1] = techDocs.map(as);
  const restore = sandbox();
  try {
    for (const a of ASSETS) {
      await assetsService.createAsset(manager, {
        buildingId: blockC._id, code: a.code, name: a.name, category: a.category, location: a.location,
        installDate: at(1000), warrantyEnd: new Date(now.getTime() + a.warrantyDays * DAY_MS),
        cycleValue: a.cycle[0], cycleUnit: a.cycle[1], lastMaintenanceDate: at(a.lastDays), checklist: CHECK,
      });
    }
    /** Phiếu định kỳ như job tạo (bản sao checklist). assign=false: để Trưởng BQL tự phân công khi test */
    const open = async (code, { assign = null } = {}) => {
      const asset = await Asset.findOne({ code }).lean();
      const wo = await WorkOrder.create({
        assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: `Bảo trì định kỳ ${asset.name}`,
        scheduledDate: asset.nextMaintenanceDate, checklist: asset.checklist,
      });
      if (assign) await service.assignWorkOrder(manager, wo._id, { assignedTo: assign.id, note: 'Giao theo ca kỹ thuật' });
      return { wo, asset };
    };
    const faulty = async (code, tech, day, note) => {
      const { wo, asset } = await open(code, { assign: tech });
      await inspection.scanWorkOrder(tech, wo._id, asset.qrCode, at(day, 8));
      await inspection.submitInspection(tech, wo._id, { result: 'FAULTY', note, results: [{ ok: false }, { value: 85 }] }, PHOTOS, at(day, 9));
      return wo;
    };
    const report = (tech, wo, day, faultDesc, estimatedCost, vendorName, vendorProposal) =>
      repair.reportFault(tech, wo._id, { faultDesc, vendorName, vendorProposal, estimatedCost }, PHOTOS, at(day, 10));

    // TB-013: chờ quyết định, 150tr (test khẩn cấp)
    {
      const wo = await faulty('TB-013', t1, 1, 'Thang dừng đột ngột giữa tầng 12-13, cửa không mở');
      await report(t1, wo, 1, 'Biến tần báo lỗi quá áp, động cơ kéo nóng bất thường', 150_000_000, 'Công ty Thang máy Thái Bình', 'Thay biến tần, kiểm tra và quấn lại động cơ kéo');
    }
    // TB-014: vận hành 35tr đã xong + ghi chi; phiếu định kỳ kế tiếp báo 20tr → cộng dồn 55tr
    {
      const wo1 = await faulty('TB-014', t2, 13, 'Áp lực bơm giảm, rò nước ở phớt');
      await report(t2, wo1, 13, 'Phớt cơ khí bơm chữa cháy mòn, rò nước, áp lực giảm còn 4 bar', 35_000_000, 'Công ty PCCC Hưng Phát', 'Thay phớt cơ khí và vòng bi');
      await decision.decideRepair(manager, wo1._id, { decision: 'APPROVE', costSource: 'OPERATING', comment: 'Dưới ngưỡng, chi vận hành' }, at(12, 9));
      await repair.uploadAcceptance(t2, wo1._id, { note: 'Đã thay phớt và vòng bi, chạy thử đạt 6 bar' }, PHOTOS, at(10, 15));
      await repair.acceptRepair(manager, wo1._id, at(9, 9));
      await expense.recordOperatingExpense(accountant, wo1._id, { actualCost: 35_000_000, invoiceNo: 'HĐ-0093310', note: 'Chuyển khoản' }, PHOTOS, at(8, 10));
      const wo2 = await faulty('TB-014', t2, 1, 'Bơm khởi động chậm, tủ điều khiển báo lỗi');
      await report(t2, wo2, 1, 'Khởi động từ tủ điều khiển bơm cháy tiếp điểm', 20_000_000, 'Công ty PCCC Hưng Phát', 'Thay khởi động từ và rơ le nhiệt');
    }
    // TB-015: còn bảo hành, chờ quyết định
    {
      const wo = await faulty('TB-015', t1, 2, '4 camera hầm mất tín hiệu');
      await report(t1, wo, 2, 'Đầu ghi hình hỏng nguồn, 4 camera hầm B1 mất tín hiệu', 12_000_000, 'Công ty An ninh Sao Việt', 'Thay bộ nguồn đầu ghi');
    }
    // TB-016: vận hành 8tr hoàn thành 5 ngày trước, chưa ghi chi
    {
      const wo = await faulty('TB-016', t2, 9, 'Bơm kêu to, rung');
      await report(t2, wo, 9, 'Vòng bi động cơ bơm mòn gây rung và kêu to', 8_000_000, 'Công ty Cơ điện Đại Dương', 'Thay vòng bi động cơ');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING' }, at(8, 9));
      await repair.uploadAcceptance(t2, wo._id, { note: 'Đã thay vòng bi' }, PHOTOS, at(6, 15));
      await repair.acceptRepair(manager, wo._id, at(5, 9));
    }
    // TB-017: Có sự cố, chờ KTV báo hư hỏng
    await faulty('TB-017', t2, 0, 'Cửa cabin đóng mở giật, cảm biến hồng ngoại không nhận vật cản');
    // TB-018: đến hạn, chưa phân công
    await open('TB-018');

    const codes = ASSETS.map((a) => a.code);
    const ids = (await Asset.find({ code: { $in: codes } }).select('_id').lean()).map((a) => a._id);
    const total = await WorkOrder.countDocuments({ assetId: { $in: ids } });
    log(`Đã ghi ${codes.length} thiết bị, ${total} phiếu bảo trì.`);
    return total;
  } finally {
    restore();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectDB()
    .then(() => seedMaintenanceCasesExtra({ apply: process.argv.includes('--apply') }))
    .catch((err) => {
      console.error(`[seedMaintenanceCasesExtra] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
