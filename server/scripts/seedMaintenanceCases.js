// 10 trường hợp luồng bảo trì – sửa chữa hướng mới, tạo bằng chính các hàm nghiệp vụ (đúng trạng thái, lịch sử, nhật ký,
// thông báo, số dư quỹ). Mốc thời gian rải trong 3 tuần qua. Không ghi đè dữ liệu có sẵn.
// Xem kế hoạch:  node scripts/seedMaintenanceCases.js
// Ghi:           node scripts/seedMaintenanceCases.js --apply
// Trong lúc chạy: không gửi email (env.smtp tắt), ảnh dùng ảnh mẫu (không upload Cloudinary).
import { pathToFileURL } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Asset, Building, User, WorkOrder } from '../src/models/index.js';
import * as assetsService from '../src/modules/assets/assets.service.js';
import * as fund from '../src/modules/fund/fund.service.js';
import * as board from '../src/modules/workOrders/workOrders.board.js';
import * as decision from '../src/modules/workOrders/workOrders.decision.js';
import * as expense from '../src/modules/workOrders/workOrders.expense.js';
import * as inspection from '../src/modules/workOrders/workOrders.inspection.js';
import * as repair from '../src/modules/workOrders/workOrders.repair.js';
import * as service from '../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../src/utils/time.js';

const EXISTING = ['TB-001', 'TB-002', 'TB-004', 'TB-005', 'TB-006', 'TB-008'];
const NEW_ASSETS = [
  { code: 'TB-009', name: 'Máy phát điện dự phòng Block A', category: 'OTHER', building: 'A', location: 'Phòng kỹ thuật tầng hầm', warrantyDays: 180, manufacturer: 'Cummins' },
  { code: 'TB-010', name: 'Máy phát điện Block B', category: 'OTHER', building: 'B', location: 'Phòng kỹ thuật tầng hầm', warrantyDays: -200, manufacturer: 'Denyo' },
  { code: 'TB-011', name: 'Quạt hút khói hầm B2', category: 'OTHER', building: 'B', location: 'Hầm B2', warrantyDays: -900, manufacturer: 'Kruger' },
  { code: 'TB-012', name: 'Bơm tăng áp Block C', category: 'PUMP', building: 'T3', location: 'Tầng mái', warrantyDays: -60, manufacturer: 'Grundfos' },
];
const CASES = [
  '1. TB-001: Quỹ 180tr — Kế toán trả lại → gửi lại → xác nhận → 2/2 đồng ý → nghiệm thu 2 lớp → chi 175tr (lý do chênh lệch)',
  '2. TB-002: Quỹ 95tr đã duyệt, sửa xong, Trưởng BQL nghiệm thu kỹ thuật → chờ Ban quản trị xác nhận',
  '3. TB-004: Quỹ 65tr, Kế toán trả lại (thiếu báo giá) → Trưởng BQL cần sửa, gửi lại',
  '4. TB-005: Sửa khẩn cấp (kẹt người) → Đang sửa; đề xuất 120tr lập sau, chờ Kế toán',
  '5. TB-006: Vận hành 40tr đã xong + ghi chi; phản ánh mới 15tr → cộng dồn 55tr, bắt buộc Quỹ (chờ quyết định)',
  '6. TB-008: Quỹ 85tr bị Ban quản trị từ chối → Trưởng BQL tạm hoãn 20 ngày',
  '7. TB-009 (mới, còn bảo hành): nguồn Bảo hành, KTV đã tải biên bản → chờ nghiệm thu',
  '8. TB-010 (mới, hết bảo hành): Quỹ 70tr, Kế toán xác nhận, 1 thành viên đồng ý → đang chờ biểu quyết',
  '9. TB-011 (mới): hỏng nặng → ngừng sử dụng, phiếu đóng',
  '10. TB-012 (mới): kiểm tra định kỳ Đạt → hoàn thành',
];

const PHOTO_URL = 'https://placehold.co/800x600?text=SAPMS';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const photo = (name = 'anh.jpg') => ({ originalname: name, mimetype: 'image/jpeg', buffer: JPEG, size: JPEG.length });
const PHOTOS = [photo()];
const DOCS = { images: [photo('bien-ban.jpg')], certificates: [photo('kiem-dinh.jpg')] };

const as = (u) => ({ id: String(u._id), role: u.role, roleTitle: u.roleTitle ?? null, boardTitle: u.boardTitle ?? null });

/** Không upload thật, không gửi mail thật trong lúc chạy; trả hàm khôi phục */
function sandbox() {
  const original = cloudinary.uploader.upload_stream;
  const smtp = env.smtp.enabled;
  const cloud = env.cloudinary.enabled;
  let n = 0;
  cloudinary.uploader.upload_stream = (options, callback) => ({ end: () => callback(null, { secure_url: `${PHOTO_URL}+${(n += 1)}` }) });
  env.smtp.enabled = false;
  env.cloudinary.enabled = true;
  return () => {
    cloudinary.uploader.upload_stream = original;
    env.smtp.enabled = smtp;
    env.cloudinary.enabled = cloud;
  };
}

export async function seedMaintenanceCases({ apply = false, log = console.log, now = new Date() } = {}) {
  const at = (days, hour = 9) => new Date(startOfVnDay(new Date(now.getTime() - days * DAY_MS)).getTime() + hour * HOUR_MS);
  const [managerDoc, accountantDoc, techDocs, boardDocs, buildings, existing] = await Promise.all([
    User.findOne({ role: 'MANAGER', isActive: true }).lean(),
    User.findOne({ role: 'ACCOUNTANT', isActive: true }).lean(),
    User.find({ role: 'STAFF', roleTitle: 'TECHNICIAN', isActive: true }).sort({ createdAt: 1 }).lean(),
    User.find({ role: 'BOARD', isActive: true }).sort({ createdAt: 1 }).lean(),
    Building.find({ code: { $in: ['A', 'B', 'T3'] } }).lean(),
    Asset.find({ code: { $in: EXISTING } }).lean(),
  ]);
  const problems = [
    !managerDoc && 'Trưởng BQL', !accountantDoc && 'Kế toán', !techDocs.length && 'Kỹ thuật viên', boardDocs.length < 2 && '≥ 2 thành viên Ban quản trị',
    buildings.length < 3 && 'tòa A, B, T3', existing.length < EXISTING.length && `thiết bị ${EXISTING.filter((c) => !existing.some((a) => a.code === c)).join(', ')}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`Thiếu ${problems.join(', ')}.`);
  const inactive = existing.filter((a) => !a.isActive).map((a) => a.code);
  if (inactive.length) throw new Error(`Thiết bị đang ngừng theo dõi: ${inactive.join(', ')}.`);
  const busy = await WorkOrder.countDocuments({ assetId: { $in: existing.map((a) => a._id) } });
  if (busy) throw new Error(`Thiết bị ${EXISTING.join(', ')} đã có ${busy} phiếu bảo trì. Không tạo chồng.`);
  const taken = await Asset.find({ code: { $in: NEW_ASSETS.map((a) => a.code) } }).select('code').lean();
  if (taken.length) throw new Error(`Mã thiết bị đã có: ${taken.map((a) => a.code).join(', ')}.`);

  const manager = as(managerDoc);
  const accountant = as(accountantDoc);
  const [t1, t2 = t1] = techDocs.map(as);
  const members = boardDocs.map(as);
  log(`Kế hoạch (${apply ? 'GHI' : 'chỉ xem, thêm --apply để ghi'}):`);
  CASES.forEach((c) => log(`  ${c}`));
  log(`Người thực hiện: Trưởng BQL ${managerDoc.fullName}, Kế toán ${accountantDoc.fullName}, KTV ${techDocs.map((t) => t.fullName).join(' / ')}, `
    + `Ban quản trị ${boardDocs.map((b) => b.fullName).join(', ')} (cần ${fund.neededAgree(0.5, boardDocs.length)}/${boardDocs.length} đồng ý)`);
  if (!apply) return null;

  const restore = sandbox();
  try {
    const byCode = Object.fromEntries(existing.map((a) => [a.code, a]));
    const bld = Object.fromEntries(buildings.map((b) => [b.code, b]));
    // Thiết bị mới qua UC07: lần bảo trì gần nhất 40 ngày trước, chu kỳ 1 tháng → đã đến hạn
    for (const a of NEW_ASSETS) {
      byCode[a.code] = await assetsService.createAsset(manager, {
        buildingId: bld[a.building]._id, code: a.code, name: a.name, category: a.category, location: a.location, manufacturer: a.manufacturer,
        installDate: at(1000), warrantyEnd: new Date(now.getTime() + a.warrantyDays * DAY_MS), cycleValue: 1, cycleUnit: 'MONTH',
        lastMaintenanceDate: at(40), checklist: [
          { label: 'Kiểm tra tiếng ồn, rung bất thường', required: true },
          { label: 'Nhiệt độ vận hành', unit: '°C', minValue: 20, maxValue: 70, required: true },
        ],
      });
    }

    /** Phiếu định kỳ như job tạo (bản sao checklist), Trưởng BQL giao KTV, KTV quét QR và nộp kết quả */
    const inspect = async (code, tech, day, { result = 'FAULTY', note = 'Phát hiện sự cố khi kiểm tra định kỳ', type = 'SCHEDULED', title } = {}) => {
      const asset = await Asset.findOne({ code }).lean();
      const wo = await WorkOrder.create({
        assetId: asset._id, type, status: 'PENDING', title: title ?? `Bảo trì định kỳ ${asset.name}`,
        scheduledDate: type === 'SCHEDULED' ? asset.nextMaintenanceDate : at(day), checklist: asset.checklist ?? [],
      });
      await service.assignWorkOrder(manager, wo._id, { assignedTo: tech.id, note: 'Giao theo ca kỹ thuật' });
      await inspection.scanWorkOrder(tech, wo._id, asset.qrCode, at(day, 8));
      const results = (asset.checklist ?? []).map((c) => (c.unit ? { value: result === 'PASSED' ? 45 : 85 } : { ok: result === 'PASSED' }));
      await inspection.submitInspection(tech, wo._id, { result, note, results }, PHOTOS, at(day, 9));
      return { wo, asset };
    };
    const report = (tech, wo, day, faultDesc, estimatedCost, vendorName, vendorProposal) =>
      repair.reportFault(tech, wo._id, { faultDesc, vendorName, vendorProposal, estimatedCost }, PHOTOS, at(day, 10));
    const propose = (wo, day, extra) => fund.createProposal(manager, {
      planType: 'UNSCHEDULED', urgentReason: 'Hư hỏng phát hiện khi kiểm tra định kỳ, ảnh hưởng an toàn cư dân', workOrderId: String(wo._id), ...extra,
    }, PHOTOS, { now: at(day, 14) });
    const prefillOf = async (wo) => fund.workOrderPrefill(wo._id);

    // 1. TB-001: đủ luồng Quỹ, đã chi
    {
      const { wo } = await inspect('TB-001', t1, 16, { note: 'Cáp tải mòn, phanh cabin trượt khi dừng tầng' });
      await report(t1, wo, 16, 'Cáp tải mòn 3 sợi, phanh cabin trượt 5 cm khi dừng tầng', 180_000_000, 'Công ty Thang máy Thái Bình', 'Thay bộ cáp tải và má phanh cabin');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND', comment: 'Chi phí lớn, sửa bằng Quỹ' }, at(15, 9));
      const pre = await prefillOf(wo);
      const p = await propose(wo, 15, { title: pre.title, description: pre.description, amount: 180_000_000, contractNo: 'BG-TB-2611' });
      await fund.returnProposal(accountant, p._id, { reason: 'Thiếu báo giá đối chứng của nhà thầu thứ 2' }, { now: at(14, 10) });
      await fund.resubmitProposal(manager, p._id, { note: 'Bổ sung báo giá Công ty Thang máy Sài Gòn (185tr)' }, PHOTOS, { now: at(14, 15) });
      await fund.verifyProposal(accountant, p._id, { note: 'Đã so 2 báo giá, chọn giá thấp hơn; số dư khả dụng đủ' }, { now: at(13, 9) });
      for (const m of members) await fund.vote(m, p._id, { decision: 'AGREE', comment: 'Đồng ý, ưu tiên an toàn' }, { now: at(12, 10) });
      await repair.uploadAcceptance(t1, wo._id, { note: 'Nhà thầu đã thay cáp và má phanh, chạy thử 50 chuyến' }, DOCS, at(5, 16));
      await repair.acceptRepair(manager, wo._id, at(4, 9));
      await board.boardAccept(members[0], wo._id, { note: 'Đã xem biên bản kiểm định an toàn' }, at(3, 10));
      await fund.recordExpense(accountant, p._id, {
        amount: 175_000_000, documentNo: 'HĐ-0098765', occurredAt: at(2, 10), varianceReason: 'Nhà thầu giảm 5 triệu sau thương lượng',
      }, PHOTOS, { now: at(2, 11) });
    }

    // 2. TB-002: đã duyệt, Trưởng BQL nghiệm thu kỹ thuật, chờ Ban quản trị xác nhận
    {
      const { wo } = await inspect('TB-002', t2, 11, { note: 'Cửa tầng 7 đóng chậm, cảm biến cửa báo lỗi' });
      await report(t2, wo, 11, 'Bo điều khiển cửa tầng hỏng, cảm biến cửa lỗi chập chờn', 95_000_000, 'Công ty Thang máy Thái Bình', 'Thay bo điều khiển cửa và cảm biến');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' }, at(10, 9));
      const pre = await prefillOf(wo);
      const p = await propose(wo, 10, { title: pre.title, description: pre.description, amount: 95_000_000 });
      await fund.verifyProposal(accountant, p._id, { note: 'Báo giá hợp lệ' }, { now: at(9, 9) });
      for (const m of members) await fund.vote(m, p._id, { decision: 'AGREE' }, { now: at(8, 10) });
      await repair.uploadAcceptance(t2, wo._id, { note: 'Đã thay bo cửa, kiểm tra 20 lần đóng mở' }, DOCS, at(2, 15));
      await repair.acceptRepair(manager, wo._id, at(1, 9));
    }

    // 3. TB-004: Kế toán trả lại
    {
      const { wo } = await inspect('TB-004', t1, 6, { note: 'Bơm chữa cháy không đạt áp lực' });
      await report(t1, wo, 6, 'Bơm chữa cháy chính không đạt áp lực 6 bar, gioăng rò rỉ', 65_000_000, 'Công ty PCCC Hưng Phát', 'Đại tu bơm, thay gioăng và van một chiều');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' }, at(5, 9));
      const pre = await prefillOf(wo);
      const p = await propose(wo, 5, { title: pre.title, description: pre.description, amount: 65_000_000 });
      await fund.returnProposal(accountant, p._id, { reason: 'Báo giá chưa có dấu công ty, đề nghị bổ sung bản có dấu' }, { now: at(4, 10) });
    }

    // 4. TB-005: sửa khẩn cấp, đề xuất lập sau
    {
      const { wo } = await inspect('TB-005', t2, 3, { note: 'Thang dừng giữa tầng 9-10, kẹt người' });
      await report(t2, wo, 3, 'Thang dừng giữa tầng 9-10, biến tần báo lỗi quá dòng', 120_000_000, 'Công ty Thang máy Thái Bình', 'Thay biến tần và kiểm tra động cơ kéo');
      await decision.decideRepair(manager, wo._id, {
        decision: 'APPROVE', costSource: 'FUND', emergency: true, emergencyReason: 'Thang kẹt người, Block B chỉ còn 1 thang hoạt động',
      }, at(3, 11));
      const pre = await prefillOf(wo);
      await propose(wo, 2, { title: pre.title, description: pre.description, amount: 120_000_000, urgentReason: pre.urgentReason });
    }

    // 5. TB-006: vận hành 40tr đã xong + ghi chi; phản ánh mới 15tr → cộng dồn bắt buộc Quỹ
    {
      const { wo } = await inspect('TB-006', t1, 20, { note: 'Động cơ cửa cabin kêu to' });
      await report(t1, wo, 20, 'Động cơ cửa cabin mòn bạc đạn, kêu to khi đóng mở', 40_000_000, 'Công ty Thang máy Sài Gòn', 'Thay động cơ cửa cabin');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'OPERATING', comment: 'Dưới ngưỡng, chi vận hành' }, at(19, 9));
      await repair.uploadAcceptance(t1, wo._id, { note: 'Đã thay động cơ cửa' }, DOCS, at(17, 15));
      await repair.acceptRepair(manager, wo._id, at(16, 9));
      await expense.recordOperatingExpense(accountant, wo._id, { actualCost: 40_000_000, invoiceNo: 'HĐ-0091234', note: 'Thanh toán chuyển khoản' }, PHOTOS, at(15, 10));
      const again = await inspect('TB-006', t2, 1, { note: 'Cabin rung lắc khi chạy qua tầng 5', type: 'TICKET_LINKED', title: 'Kiểm tra thang máy 2 Block B theo phản ánh cư dân' });
      await report(t2, again.wo, 1, 'Ray dẫn hướng lệch, guốc dẫn hướng mòn gây rung lắc', 15_000_000, 'Công ty Thang máy Sài Gòn', 'Căn chỉnh ray, thay guốc dẫn hướng');
    }

    // 6. TB-008: Ban quản trị từ chối → tạm hoãn
    {
      const { wo } = await inspect('TB-008', t2, 9, { note: 'Tủ báo cháy trung tâm báo lỗi 3 zone' });
      await report(t2, wo, 9, 'Tủ báo cháy trung tâm lỗi 3 zone, đầu báo khói tầng hầm không phản hồi', 85_000_000, 'Công ty PCCC Hưng Phát', 'Thay tủ trung tâm đời mới');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' }, at(8, 9));
      const pre = await prefillOf(wo);
      const p = await propose(wo, 8, { title: pre.title, description: pre.description, amount: 85_000_000 });
      await fund.verifyProposal(accountant, p._id, { note: 'Số dư đủ' }, { now: at(7, 9) });
      await fund.vote(members[0], p._id, { decision: 'DISAGREE', comment: 'Chỉ cần thay 3 zone lỗi, không thay cả tủ' }, { now: at(7, 15) });
      await decision.decideRepair(manager, wo._id, {
        decision: 'POSTPONE', comment: 'Chờ nhà thầu báo giá lại phương án thay 3 zone', reviewDate: at(-14, 0),
      }, at(6, 9));
    }

    // 7. TB-009: bảo hành
    {
      const { wo } = await inspect('TB-009', t1, 7, { note: 'Máy phát không tự khởi động khi cắt điện thử' });
      await report(t1, wo, 7, 'Bộ ATS không chuyển nguồn, máy phát không tự khởi động', 18_000_000, 'Cummins Việt Nam', 'Bảo hành thay bộ ATS');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'WARRANTY', comment: 'Còn bảo hành, gọi hãng' }, at(6, 10));
      await repair.uploadAcceptance(t1, wo._id, { note: 'Hãng đã thay bộ ATS theo bảo hành' }, PHOTOS, at(1, 16));
    }

    // 8. TB-010: đang chờ biểu quyết
    {
      const { wo } = await inspect('TB-010', t2, 5, { note: 'Máy phát rò dầu, nhiệt độ cao' });
      await report(t2, wo, 5, 'Gioăng nắp máy hỏng gây rò dầu, két nước tản nhiệt kém', 70_000_000, 'Công ty Cơ điện Đại Dương', 'Đại tu đầu máy, thay két nước');
      await decision.decideRepair(manager, wo._id, { decision: 'APPROVE', costSource: 'FUND' }, at(4, 9));
      const pre = await prefillOf(wo);
      const p = await propose(wo, 4, { title: pre.title, description: pre.description, amount: 70_000_000 });
      await fund.verifyProposal(accountant, p._id, { note: 'Báo giá hợp lệ, số dư đủ' }, { now: at(3, 9) });
      await fund.vote(members[0], p._id, { decision: 'AGREE', comment: 'Đồng ý' }, { now: at(2, 10) });
    }

    // 9. TB-011: ngừng sử dụng
    {
      const { wo } = await inspect('TB-011', t1, 10, { note: 'Quạt cháy động cơ, cánh quạt nứt' });
      await report(t1, wo, 10, 'Động cơ quạt cháy cuộn dây, cánh quạt nứt, vỏ gỉ sét nặng', 30_000_000, 'Công ty Cơ điện Đại Dương', 'Thay động cơ và cánh quạt');
      await decision.decideRepair(manager, wo._id, { decision: 'RETIRE', comment: 'Thiết bị quá cũ, sẽ lắp quạt mới trong kế hoạch năm' }, at(9, 9));
    }

    // 10. TB-012: kiểm tra Đạt
    await inspect('TB-012', t2, 2, { result: 'PASSED', note: 'Vận hành ổn định' });

    const total = await WorkOrder.countDocuments({ assetId: { $in: Object.values(byCode).map((a) => a._id) } });
    log(`Đã ghi ${total} phiếu bảo trì cho 10 trường hợp.`);
    return total;
  } finally {
    restore();
  }
}

// Chạy trực tiếp: node scripts/seedMaintenanceCases.js [--apply]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectDB()
    .then(() => seedMaintenanceCases({ apply: process.argv.includes('--apply') }))
    .catch((err) => {
      console.error(`[seedMaintenanceCases] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
