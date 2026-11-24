// Dữ liệu demo luồng bảo trì – sửa chữa cho 3 ngày 24, 25, 26/11/2026 (Block A, B, C): mỗi ngày đủ các trường hợp của luồng;
// ngày 25 và 26 mỗi ngày 4 thiết bị đến hạn. Tạo bằng chính các hàm nghiệp vụ (trạng thái, lịch sử, nhật ký, thông báo, số dư quỹ).
// Mọi bước đã xử lý có giờ trong ngày 24/11 (phiếu cũ của ca cộng dồn: 17–20/11); không ghi thao tác ở tương lai.
// Ca "đủ phiếu nhưng thiếu số dư" chỉ có 1 (26/11): nhiều đề xuất bị chặn sẽ tranh số dư của nhau khi ghi thu.
// Xem kế hoạch:  node scripts/seedMaintenanceDemo3Days.js [--reset]
// Ghi:           node scripts/seedMaintenanceDemo3Days.js --apply [--reset --backup=đường/dẫn.json]
// Tạo lại 1 nhóm đúng ngày của nó (giờ các bước cùng ngày lên lịch, trước lúc chạy; từ 06:00 của ngày đó):
//   node scripts/seedMaintenanceDemo3Days.js --day=25 [--apply --backup=đường/dẫn.json]
// --day chỉ thay thiết bị TBxx- của ngày đó (phiếu, đề xuất, phiếu chi, thông báo, nhật ký kèm theo; hoàn số đã chi về quỹ, giữ mã QR);
// không đụng nhóm khác, không thêm tiền vào quỹ.
// --reset: sao lưu rồi xóa TOÀN BỘ dữ liệu luồng (thiết bị, phiếu, đề xuất, sổ quỹ, thông báo Bảo trì / Quỹ, nhật ký của luồng),
// giữ nguyên tài khoản và dữ liệu module khác. Trong lúc chạy: không gửi email, ảnh dùng ảnh mẫu.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EJSON } from 'bson';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { BOARD_CONFIRM_CONFIG_KEYS, NOTIFICATION_TYPES } from '../src/constants/enums.js';
import { Asset, Building, FundTransaction, User, WorkOrder } from '../src/models/index.js';
import * as assetsService from '../src/modules/assets/assets.service.js';
import * as fund from '../src/modules/fund/fund.service.js';
import * as board from '../src/modules/workOrders/workOrders.board.js';
import * as decision from '../src/modules/workOrders/workOrders.decision.js';
import * as expense from '../src/modules/workOrders/workOrders.expense.js';
import * as inspection from '../src/modules/workOrders/workOrders.inspection.js';
import * as repair from '../src/modules/workOrders/workOrders.repair.js';
import * as service from '../src/modules/workOrders/workOrders.service.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../src/utils/time.js';

const dayStart = (day) => new Date(`2026-11-${day}T00:00:00+07:00`);
const FIRST_HOUR = 1; // bước sớm nhất: job tạo phiếu 01:00
const LAST_HOUR = 20.5; // bước muộn nhất
const MIN_RUN_HOUR = 6; // --day: chạy từ 06:00 của ngày đó mới đủ chỗ xếp các bước
const INCOME = 2_000_000_000;
const MIL = 1_000_000;
const KINDS = {
  lift: { category: 'ELEVATOR', vendor: ['Công ty Thang máy Thái Bình', '02438551234'], maker: 'Mitsubishi', checklist: [
    { label: 'Cửa cabin, cửa tầng đóng mở êm', required: true },
    { label: 'Chuông cứu hộ và điện thoại nội bộ hoạt động', required: true },
    { label: 'Nhiệt độ động cơ kéo', unit: '°C', minValue: 20, maxValue: 70, required: true }] },
  pump: { category: 'PUMP', vendor: ['Công ty Cơ điện Đại Dương', '02438556677'], maker: 'Ebara', checklist: [
    { label: 'Không rò nước ở phớt, mặt bích', required: true },
    { label: 'Áp lực đầu ra', unit: 'bar', minValue: 2, maxValue: 8, required: true },
    { label: 'Nhiệt độ động cơ', unit: '°C', minValue: 20, maxValue: 70, required: true }] },
  fire: { category: 'FIRE_SYSTEM', vendor: ['Công ty PCCC Hưng Phát', '02438559988'], maker: 'Hochiki', checklist: [
    { label: 'Đèn, còi báo động hoạt động', required: true },
    { label: 'Áp lực đường ống chữa cháy', unit: 'bar', minValue: 5, maxValue: 10, required: true },
    { label: 'Tem kiểm định còn hạn', required: true }] },
  fan: { category: 'OTHER', vendor: ['Công ty Cơ điện Đại Dương', '02438556677'], maker: 'Kruger', checklist: [
    { label: 'Không rung, không có tiếng ồn bất thường', required: true },
    { label: 'Dòng điện động cơ', unit: 'A', minValue: 5, maxValue: 20, required: true }] },
  elec: { category: 'OTHER', vendor: ['Công ty Điện Trường Giang', '02438447788'], maker: 'Schneider', checklist: [
    { label: 'Đầu cốt, thanh cái siết chặt, không cháy xém', required: true },
    { label: 'Điện áp', unit: 'V', minValue: 380, maxValue: 420, required: true },
    { label: 'Nhiệt độ tủ', unit: '°C', minValue: 15, maxValue: 55, required: true }] },
  sec: { category: 'OTHER', vendor: ['Công ty An ninh Sao Việt', '02438334455'], maker: 'Hikvision', checklist: [
    { label: 'Tín hiệu, điều khiển hoạt động ổn định', required: true },
    { label: 'Nhiệt độ tủ thiết bị', unit: '°C', minValue: 10, maxValue: 45, required: true }] },
};
// key: ca; days: ngày có ca đó
const ALL = [24, 25, 26];
const T = [
  { key: 'due1', days: ALL, kind: 'fan', name: 'Quạt hút khói hành lang', loc: 'Tầng 3', text: 'Đến hạn, chưa phân công' },
  { key: 'due2', days: [25, 26], kind: 'pump', name: 'Bơm nước thải', loc: 'Bể gom tầng hầm', text: 'Đến hạn, chưa phân công' },
  { key: 'due3', days: [25, 26], kind: 'fire', name: 'Hệ thống đèn và còi báo cháy', loc: 'Tầng 1', text: 'Đến hạn, chưa phân công' },
  { key: 'due4', days: [25, 26], kind: 'sec', name: 'Cửa cuốn tầng hầm', loc: 'Lối vào hầm', text: 'Đến hạn, đã giao KTV1' },
  { key: 'scan', days: ALL, kind: 'elec', name: 'Tủ điện phân phối tầng', loc: 'Phòng điện tầng 5', text: 'Đang kiểm tra (đã quét QR, chưa nộp)' },
  { key: 'faulty', days: ALL, kind: 'fan', name: 'Quạt cấp gió cầu thang bộ', loc: 'Tầng mái', text: 'Có sự cố, chưa báo hư hỏng' },
  { key: 'passed', days: ALL, kind: 'sec', name: 'Hệ thống chuông cửa có hình', loc: 'Sảnh', text: 'Kiểm tra Đạt, Hoàn thành' },
  { key: 'operating', days: ALL, kind: 'fan', name: 'Quạt thông gió phòng kỹ thuật', loc: 'Phòng kỹ thuật', cost: 16, text: '16tr chờ quyết định (dưới ngưỡng)' },
  { key: 'warranty', days: ALL, kind: 'sec', name: 'Hệ thống kiểm soát ra vào', loc: 'Sảnh', cost: 11, warranty: 150, text: '11tr chờ quyết định, còn bảo hành' },
  { key: 'cumulative', days: ALL, kind: 'pump', name: 'Bơm tuần hoàn bể bơi', loc: 'Phòng bơm bể bơi', cost: 20, text: 'Đã chi vận hành 35tr + báo mới 20tr → bắt buộc Quỹ' },
  { key: 'over', days: ALL, kind: 'lift', name: 'Thang máy khách số 8', loc: 'Sảnh chính', cost: 80, text: '80tr chờ quyết định (bắt buộc Quỹ, bật được khẩn cấp)' },
  { key: 'fundChosen', days: ALL, kind: 'fire', name: 'Bơm chữa cháy dự phòng', loc: 'Phòng bơm chữa cháy', cost: 52, text: 'Đã chọn Quỹ 52tr, chờ lập đề xuất' },
  { key: 'voting', days: ALL, kind: 'lift', name: 'Thang máy chữa cháy', loc: 'Sảnh PCCC', cost: 55, text: 'Quỹ 55tr đang biểu quyết (1/3 đồng ý)' },
  { key: 'rejected', days: ALL, kind: 'elec', name: 'Tủ điện chuyển nguồn ATS', loc: 'Phòng điện tầng hầm', cost: 70, text: 'Quỹ 70tr bị từ chối → quyết định lại' },
  { key: 'underOperating', days: ALL, kind: 'fan', name: 'Quạt tăng áp buồng thang', loc: 'Tầng mái', cost: 15, text: 'Vận hành 15tr, Đang sửa → KTV tải biên bản' },
  { key: 'underWarranty', days: ALL, kind: 'sec', name: 'Đầu ghi camera thang máy', loc: 'Phòng an ninh', cost: 10, warranty: 120, text: 'Bảo hành, Đang sửa → KTV tải biên bản' },
  { key: 'emergency', days: ALL, kind: 'lift', name: 'Thang máy cứu hộ', loc: 'Sảnh phụ', cost: 60, text: 'Sửa khẩn cấp 60tr, đề xuất chưa ai biểu quyết' },
  { key: 'returned', days: ALL, kind: 'fire', name: 'Đầu phun Sprinkler tầng hầm', loc: 'Hầm B1', cost: 52, text: 'Quỹ 52tr, Ban quản trị trả về → Đang sửa lại' },
  { key: 'awaitAccept', days: ALL, kind: 'pump', name: 'Bơm thoát nước mưa', loc: 'Hố thu tầng hầm', cost: 20, text: 'Vận hành 20tr, có biên bản → chờ nghiệm thu' },
  { key: 'awaitBoard', days: ALL, kind: 'lift', name: 'Thang máy vận chuyển', loc: 'Sảnh hàng', cost: 55, text: 'Quỹ 55tr, chờ Ban quản trị xác nhận nghiệm thu' },
  { key: 'toPay', days: ALL, kind: 'fire', name: 'Tủ điều khiển bơm chữa cháy', loc: 'Phòng bơm chữa cháy', cost: 52, text: 'Quỹ 52tr đã nghiệm thu → chờ Kế toán lập phiếu chi' },
  { key: 'paid', days: ALL, kind: 'lift', name: 'Thang máy tham quan', loc: 'Sảnh thương mại', cost: 54, text: 'Quỹ 54tr, đã chi đủ luồng' },
  { key: 'toExpense', days: ALL, kind: 'fan', name: 'Quạt hút mùi phòng rác', loc: 'Phòng rác', cost: 12, text: 'Vận hành 12tr Hoàn thành → chờ Kế toán ghi chi' },
  { key: 'postponed', days: ALL, kind: 'elec', name: 'Máy biến áp khô', loc: 'Trạm điện', cost: 58, text: 'Rút đề xuất rồi tạm hoãn, có ngày xem lại' },
  { key: 'closed', days: ALL, kind: 'sec', name: 'Barie lối ra', loc: 'Cổng ra hầm', cost: 40, text: 'Ngừng sử dụng, phiếu đóng' },
  { key: 'awaitVendor', days: ALL, kind: 'fire', name: 'Hệ thống chữa cháy vách tường', loc: 'Tầng 2', cost: 52, text: 'Quỹ 52tr, chờ Trưởng ban quản trị chọn nhà thầu' },
  { key: 'underFund', days: ALL, kind: 'elec', name: 'Tủ điện tổng MSB', loc: 'Phòng điện tầng hầm', cost: 52, text: 'Quỹ 52tr đã duyệt, Đang sửa → KTV tải biên bản' },
  { key: 'acceptReturned', days: ALL, kind: 'pump', name: 'Bơm lọc hồ cảnh quan', loc: 'Phòng bơm hồ cảnh quan', cost: 14, text: 'Vận hành 14tr, Trưởng BQL yêu cầu sửa lại → Đang sửa' },
  { key: 'expensed', days: ALL, kind: 'sec', name: 'Hệ thống camera hành lang', loc: 'Phòng an ninh', cost: 9, text: 'Vận hành 9tr Hoàn thành, Kế toán đã ghi chi 9,5tr' },
  { key: 'warrantyDone', days: ALL, kind: 'elec', name: 'Bộ lưu điện UPS', loc: 'Phòng an ninh', cost: 13, warranty: 100, text: 'Bảo hành, đã nghiệm thu, Hoàn thành' },
  { key: 'rerequest', days: ALL, kind: 'fan', name: 'Quạt hút hầm gửi xe', loc: 'Hầm B1', cost: 28, text: 'Tạm hoãn rồi KTV gửi yêu cầu sửa lại 30tr → chờ quyết định' },
  { key: 'blocked', days: [26], kind: 'lift', name: 'Cụm 2 thang máy cũ', loc: 'Sảnh phụ', cost: 1300, text: 'Quỹ 1,3 tỷ đủ phiếu nhưng thiếu số dư khả dụng → tự chốt khi ghi thu thêm' },
];
const BUILDING = { 24: ['A', 'Block A'], 25: ['B', 'Block B'], 26: ['T3', 'Block C'] };
const FAULTS = {
  lift: ['Cabin rung lắc, cửa tầng đóng chậm', 'Guốc dẫn hướng và cảm biến cửa mòn, bo điều khiển báo lỗi', 'Thay guốc dẫn hướng, cảm biến và bo cửa'],
  pump: ['Bơm kêu to, áp lực bất thường', 'Vòng bi và phớt cơ khí mòn, rò nước', 'Thay vòng bi và phớt cơ khí'],
  fire: ['Áp lực đường ống bất thường, tín hiệu báo lỗi', 'Van và cụm điều khiển hỏng, áp lực không ổn định', 'Thay cụm van, hiệu chỉnh bộ điều khiển'],
  fan: ['Quạt rung, dòng điện vượt ngưỡng', 'Vòng bi động cơ mòn, cánh quạt lệch tâm', 'Thay vòng bi, cân chỉnh cánh quạt'],
  elec: ['Tủ nóng, có mùi khét', 'Thanh cái và aptomat oxy hóa, tiếp xúc kém', 'Thay aptomat, vệ sinh và thay thanh cái'],
  sec: ['Mất tín hiệu, điều khiển chập chờn', 'Bo điều khiển và bộ nguồn hỏng', 'Thay bo điều khiển và bộ nguồn'],
};
export const PLAN = ALL.flatMap((day) => T.filter((t) => t.days.includes(day)).map((t, n) => ({
  ...t, day, code: `TB${day}-${String(n + 1).padStart(2, '0')}`, fullName: `${t.name} ${BUILDING[day][1]}`,
})));
// Ca chiếm số dư khả dụng trong lúc tạo (đã duyệt hoặc đã chi)
const FUND_KEYS = ['underFund', 'returned', 'awaitBoard', 'toPay', 'paid'];
export const DEMO3_CODES = PLAN.map((p) => p.code);

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
  cloudinary.uploader.upload_stream = (options, callback) => ({ end: () => callback(null, { secure_url: `${PHOTO_URL}+d${(n += 1)}` }) });
  env.smtp.enabled = false;
  env.cloudinary.enabled = true;
  return () => {
    cloudinary.uploader.upload_stream = original;
    env.smtp.enabled = smtp;
    env.cloudinary.enabled = cloud;
  };
}

/** Dữ liệu của luồng trong từng collection. Model AuditLog chặn xóa (BR-S10) nên xóa thẳng trên collection */
const FLOW_FILTERS = {
  work_orders: {},
  fund_proposals: {},
  fund_transactions: {},
  assets: {},
  notifications: { type: { $in: [NOTIFICATION_TYPES.MAINTENANCE, NOTIFICATION_TYPES.FUND_APPROVAL] } },
  audit_logs: {
    $or: [
      { targetType: { $in: ['work_orders', 'fund_proposals', 'fund_transactions', 'maintenance_fund', 'assets'] } },
      { action: /^(WORKORDER_|FUND_|CONFIG_CHANGE_|ASSET_)/ },
    ],
  },
};
/** Xóa toàn bộ dữ liệu luồng, quỹ về 0; giữ tài khoản và dữ liệu module khác. @returns số bản ghi đã xóa / sẽ xóa */
export async function wipeMaintenanceFlow({ apply = false, backupPath = null, log = console.log } = {}) {
  const c = (name) => mongoose.connection.db.collection(name);
  const counts = {};
  for (const [name, filter] of Object.entries(FLOW_FILTERS)) counts[name] = await c(name).countDocuments(filter);
  log(`${apply ? 'Xóa' : 'Sẽ xóa'}: ${Object.entries(counts).map(([n, v]) => `${v} ${n}`).join(', ')}`);
  if (!apply) return counts;
  if (backupPath) {
    const backup = {};
    for (const [name, filter] of Object.entries(FLOW_FILTERS)) backup[name] = await c(name).find(filter).toArray();
    backup.maintenance_fund = await c('maintenance_fund').find().toArray();
    backup.system_configs = await c('system_configs').find({ key: { $in: [...BOARD_CONFIRM_CONFIG_KEYS] } }).toArray();
    fs.writeFileSync(backupPath, EJSON.stringify(backup, null, 1));
    log(`Đã sao lưu ra ${backupPath}`);
  }
  for (const [name, filter] of Object.entries(FLOW_FILTERS)) await c(name).deleteMany(filter);
  await c('maintenance_fund').updateMany({}, { $set: { balance: 0, approvalSeq: 0 } });
  await c('system_configs').updateMany({ key: { $in: [...BOARD_CONFIRM_CONFIG_KEYS] } }, { $set: { pendingValue: null, pendingBy: null, pendingAt: null } });
  return counts;
}

/**
 * Xóa 1 nhóm ngày: thiết bị, phiếu, đề xuất, phiếu chi (hoàn số đã chi về quỹ), thông báo và nhật ký trỏ tới các bản ghi đó.
 * @returns {Promise<{ counts: object, freed: number, qr: Map<string, string> }>} freed: khả dụng tăng thêm sau khi xóa; qr: mã QR cũ
 */
async function wipeDay(day, { apply, backupPath, log }) {
  const c = (name) => mongoose.connection.db.collection(name);
  const assets = await c('assets').find({ code: { $in: PLAN.filter((p) => p.day === day).map((p) => p.code) } }).toArray();
  const wos = await c('work_orders').find({ assetId: { $in: assets.map((x) => x._id) } }).toArray();
  const proposals = await c('fund_proposals').find({ workOrderId: { $in: wos.map((x) => x._id) } }).toArray();
  const txs = await c('fund_transactions').find({ proposalId: { $in: proposals.map((x) => x._id) } }).toArray();
  const ids = [...assets, ...wos, ...proposals, ...txs].map((x) => x._id);
  const notifications = await c('notifications').find({ refId: { $in: ids } }).toArray();
  const audits = await c('audit_logs').find({ targetId: { $in: ids } }).toArray();
  const groups = { assets, work_orders: wos, fund_proposals: proposals, fund_transactions: txs, notifications, audit_logs: audits };
  const counts = Object.fromEntries(Object.entries(groups).map(([n, v]) => [n, v.length]));
  const spent = txs.reduce((sum, t) => sum + t.amount, 0);
  const freed = spent + proposals.filter((p) => p.status === 'APPROVED').reduce((sum, p) => sum + p.amount, 0);
  log(`${apply ? 'Xóa' : 'Sẽ xóa'} nhóm ${day}/11: ${Object.entries(counts).map(([n, v]) => `${v} ${n}`).join(', ')}; hoàn quỹ ${spent.toLocaleString('vi-VN')} đ`);
  const qr = new Map(assets.map((x) => [x.code, x.qrCode]));
  if (!apply) return { counts, freed, qr };
  if (backupPath) {
    fs.writeFileSync(backupPath, EJSON.stringify({ ...groups, maintenance_fund: await c('maintenance_fund').find().toArray() }, null, 1));
    log(`Đã sao lưu ra ${backupPath}`);
  }
  for (const [name, docs] of Object.entries(groups)) await c(name).deleteMany({ _id: { $in: docs.map((x) => x._id) } });
  if (spent) await c('maintenance_fund').updateOne({ buildingId: null }, { $inc: { balance: spent } });
  return { counts, freed, qr };
}

/** Số dư sau giao dịch trên sổ được tính lại theo thứ tự ghi (xóa phiếu chi ở giữa sổ thì các dòng sau lệch) */
async function recomputeLedger() {
  let balance = 0;
  for (const t of await FundTransaction.find().sort({ createdAt: 1, _id: 1 }).lean()) {
    balance += t.type === 'INCOME' ? t.amount : -t.amount;
    if (t.balanceAfter !== balance) await FundTransaction.collection.updateOne({ _id: t._id }, { $set: { balanceAfter: balance } });
  }
}

export async function seedMaintenanceDemo3Days({ apply = false, reset = false, day = null, backupPath = null, log = console.log, now = new Date() } = {}) {
  if (day && reset) throw new Error('Chọn --day (thay 1 nhóm) hoặc --reset (làm lại cả 3 ngày), không dùng cả hai.');
  if (day && !ALL.includes(day)) throw new Error(`--day chỉ nhận ${ALL.join(', ')}.`);
  // Ngày gốc của các bước đã xử lý: chế độ cả 3 ngày là 24/11; --day là chính ngày đó, giờ co lại để mọi bước trước lúc chạy
  const BASE = dayStart(day ?? 24);
  const runHour = (now.getTime() - BASE.getTime()) / HOUR_MS;
  if (day && runHour < MIN_RUN_HOUR) throw new Error(`Nhóm ${day}/11 chạy từ 0${MIN_RUN_HOUR}:00 ngày ${day}/11/2026: không được ghi thao tác ở tương lai.`);
  if (!day && runHour < 21) throw new Error('Chỉ chạy từ 21:00 ngày 24/11/2026: các bước mẫu có giờ tới 20:30, không được ghi thao tác ở tương lai.');
  const limit = Math.min(LAST_HOUR, runHour - 1 / 12);
  const scale = (hour) => Math.round((FIRST_HOUR + ((hour - FIRST_HOUR) * (limit - FIRST_HOUR)) / (LAST_HOUR - FIRST_HOUR)) * 60) / 60; // làm tròn phút
  const at = (hour, days = 0) => new Date(BASE.getTime() - days * DAY_MS + (days === 0 && limit < LAST_HOUR ? scale(hour) : hour) * HOUR_MS);
  const plan = day ? PLAN.filter((p) => p.day === day) : PLAN;
  const [managerDoc, accountantDoc, techDocs, boardDocs, buildings, taken] = await Promise.all([
    User.findOne({ role: 'MANAGER', isActive: true }).lean(),
    User.findOne({ role: 'ACCOUNTANT', isActive: true }).lean(),
    User.find({ role: 'STAFF', roleTitle: 'TECHNICIAN', isActive: true }).sort({ email: 1 }).lean(),
    User.find({ role: 'BOARD', isActive: true }).sort({ boardTitle: 1, email: 1 }).lean(),
    Building.find({ code: { $in: ['A', 'B', 'T3'] } }).lean(),
    Asset.find({ code: { $in: DEMO3_CODES } }).select('code').lean(),
  ]);
  const problems = [
    !managerDoc && 'Trưởng BQL', !accountantDoc && 'Kế toán', techDocs.length < 2 && '2 kỹ thuật viên', (boardDocs.length !== 3 || boardDocs[0].boardTitle !== 'CHAIRMAN') && 'đúng 3 thành viên Ban quản trị gồm Trưởng ban',
    buildings.length < 3 && 'tòa A, B, T3',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Cần ${problems.join(', ')}.`);
  if (taken.length && !reset && !day) throw new Error(`Mã thiết bị đã có: ${taken.map((a) => a.code).join(', ')}. Không tạo lại.`);
  log(`Kế hoạch (${apply ? 'GHI' : 'chỉ xem, thêm --apply để ghi'}): ${plan.length} thiết bị`);
  plan.forEach((p) => log(`  + ${p.day} · ${p.code} ${p.fullName}: ${p.text}`));
  let qrOf = new Map();
  let bigAmount = null;
  if (day) {
    const available = await fund.availableBalance((await fund.getFund())._id);
    const preview = await wipeDay(day, { apply: false, log: () => {} });
    const start = available + preview.freed;
    const commit = plan.filter((p) => FUND_KEYS.includes(p.key)).reduce((sum, p) => sum + p.cost * MIL, 0);
    if (start < commit + 150 * MIL) throw new Error(`Khả dụng ${start.toLocaleString('vi-VN')} đ không đủ tạo nhóm ${day}/11 (cần ${(commit + 150 * MIL).toLocaleString('vi-VN')} đ). Kế toán ghi thu thêm trước.`);
    // Ca thiếu số dư: lớn hơn số còn lại sau khi duyệt các ca Quỹ của nhóm, nhưng lập được lúc đầu
    bigAmount = Math.floor((start - 100 * MIL) / (10 * MIL)) * 10 * MIL;
    ({ qr: qrOf } = await wipeDay(day, { apply, backupPath, log }));
  }
  if (reset) await wipeMaintenanceFlow({ apply, backupPath, log });
  if (!apply) return null;

  const manager = as(managerDoc);
  const accountant = as(accountantDoc);
  const techs = techDocs.slice(0, 2).map(as);
  const [m1, m2, m3] = boardDocs.map(as);
  const bld = Object.fromEntries(buildings.map((b) => [b.code, b]));
  const restore = sandbox();
  try {
    if (day) await recomputeLedger();
    else {
      await fund.recordIncome(accountant, {
        incomeSource: 'INITIAL_HANDOVER', amount: INCOME, documentNo: 'BB-BG-2PCT', occurredAt: at(7), description: 'Kinh phí bảo trì 2% Chủ đầu tư bàn giao',
      }, PHOTOS, { now });
    }
    let bigProposal = null; // ca blocked: lập lúc số dư còn đủ, biểu quyết sau khi các đề xuất khác đã được duyệt
    /** Phiếu định kỳ như job tạo (bản sao checklist); giờ tạo / giao đặt trước giờ KTV kiểm tra */
    const open = async (p, { tech = null, days = 0 } = {}) => {
      const asset = await Asset.findOne({ code: p.code }).lean();
      const wo = await WorkOrder.create({
        assetId: asset._id, type: 'SCHEDULED', status: 'PENDING', title: `Bảo trì định kỳ ${asset.name}`, scheduledDate: asset.nextMaintenanceDate,
        checklist: asset.checklist.map(({ label, unit, minValue, maxValue, required }) => ({ label, unit, minValue, maxValue, required })),
      });
      if (tech) await service.assignWorkOrder(manager, wo._id, { assignedTo: tech.id, note: 'Giao theo ca kỹ thuật' });
      await WorkOrder.collection.updateOne({ _id: wo._id }, { $set: { createdAt: at(1, days), ...(tech && { assignedAt: at(7.5, days) }) } });
      return { wo, asset };
    };
    const inspect = async (p, tech, { result = 'FAULTY', days = 0, hour = 8 } = {}) => {
      const { wo, asset } = await open(p, { tech, days });
      await inspection.scanWorkOrder(tech, wo._id, asset.qrCode, at(hour, days));
      const ok = result === 'PASSED';
      const results = asset.checklist.map((c) => (c.unit ? { value: ok ? (c.minValue + c.maxValue) / 2 : c.maxValue * 1.2 } : { ok }));
      const note = ok ? 'Vận hành ổn định, thông số trong khoảng cho phép' : FAULTS[p.kind][0];
      await inspection.submitInspection(tech, wo._id, { result, note, results }, PHOTOS, at(hour + 0.5, days));
      return wo;
    };
    const fault = async (p, tech, { cost = p.cost, ...opts } = {}) => {
      const wo = await inspect(p, tech, opts);
      await repair.reportFault(tech, wo._id, {
        faultDesc: FAULTS[p.kind][1], vendorProposal: FAULTS[p.kind][2], estimatedCost: cost * MIL,
      }, PHOTOS, at((opts.hour ?? 8) + 1, opts.days ?? 0));
      return { id: wo._id, code: p.code, kind: p.kind, tech, cost: cost * MIL };
    };
    const decide = (f, body, hour, days = 0) => decision.decideRepair(manager, f.id, { decision: 'APPROVE', ...body }, at(hour, days));
    /** Lập đề xuất, 15 phút sau Trưởng ban quản trị chọn nhà thầu (pick: false thì để chờ chọn) */
    const propose = async (f, hour, { pick = true } = {}) => {
      const pre = await fund.workOrderPrefill(f.id);
      const pr = await fund.createProposal(manager, {
        title: pre.title, description: pre.description, amount: f.cost, planType: 'UNSCHEDULED',
        urgentReason: pre.urgentReason ?? 'Hư hỏng phát hiện khi kiểm tra định kỳ, ảnh hưởng an toàn cư dân',
        workOrderId: String(f.id),
      }, [], { now: at(hour) });
      const [name, phone] = KINDS[f.kind].vendor;
      return pick
        ? fund.selectVendor(m1, pr._id, { name, phone, amount: pr.amount, note: 'Giá tốt nhất trong 3 báo giá' }, [photo('bao-gia.jpg')], { now: at(hour + 0.25) })
        : pr;
    };
    const agree = (m, pr, hour) => fund.vote(m, pr._id, { decision: 'AGREE', comment: 'Đồng ý, ưu tiên an toàn cư dân' }, { now: at(hour) });
    const disagree = (m, pr, hour, comment) => fund.vote(m, pr._id, { decision: 'DISAGREE', comment }, { now: at(hour) });
    const upload = (f, hour, days = 0) => repair.uploadAcceptance(f.tech, f.id, { note: 'Nhà thầu đã sửa xong, chạy thử đạt yêu cầu' }, DOCS, at(hour, days));
    const accept = (f, hour, days = 0) => repair.acceptRepair(manager, f.id, at(hour, days));
    /** Quỹ: quyết định → đề xuất → chọn nhà thầu → 2/3 đồng ý (phiếu Đang sửa) */
    const fundApproved = async (p, tech) => {
      const f = await fault(p, tech);
      await decide(f, { costSource: 'FUND', comment: 'Trên ngưỡng, sửa bằng Quỹ' }, 10);
      const pr = await propose(f, 10.5);
      await agree(m1, pr, 11);
      await agree(m2, pr, 11.5);
      return { f, pr };
    };
    /** Như trên, sửa xong và Trưởng BQL đã nghiệm thu kỹ thuật */
    const fundAccepted = async (p, tech) => {
      const r = await fundApproved(p, tech);
      await upload(r.f, 14.5);
      await accept(r.f, 15.5);
      return r;
    };
    const OP = { costSource: 'OPERATING', comment: 'Dưới ngưỡng, chi vận hành' };
    const FUND = { costSource: 'FUND', comment: 'Trên ngưỡng, sửa bằng Quỹ' };
    const RUN = {
      due1: (p) => open(p),
      due2: (p) => open(p),
      due3: (p) => open(p),
      due4: (p) => open(p, { tech: techs[0] }),
      scan: async (p, k) => {
        const { wo, asset } = await open(p, { tech: k });
        await inspection.scanWorkOrder(k, wo._id, asset.qrCode, at(20));
      },
      faulty: (p, k) => inspect(p, k, { hour: 16 }),
      passed: (p, k) => inspect(p, k, { result: 'PASSED' }),
      operating: (p, k) => fault(p, k, { hour: 14 }),
      warranty: (p, k) => fault(p, k, { hour: 14 }),
      over: (p, k) => fault(p, k, { hour: 15 }),
      cumulative: async (p, k) => {
        const days = 7 - Math.round((dayStart(p.day) - BASE) / DAY_MS); // phiếu cũ đúng 7 ngày trước ngày đến hạn lần này
        const old = await fault(p, k, { cost: 35, days });
        await decide(old, OP, 10, days);
        await upload(old, 15, days);
        await accept(old, 16, days);
        await expense.recordOperatingExpense(accountant, old.id, { actualCost: 35 * MIL, invoiceNo: `HĐ-01${p.day}`, note: 'Thanh toán chuyển khoản' }, PHOTOS, at(10, days - 1));
        await fault(p, k, { hour: 14 });
      },
      fundChosen: async (p, k) => decide(await fault(p, k, { hour: 13 }), FUND, 16),
      voting: async (p, k) => {
        const f = await fault(p, k, { hour: 13 });
        await decide(f, FUND, 16);
        await agree(m1, await propose(f, 16.5), 18);
      },
      rejected: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, FUND, 10);
        const pr = await propose(f, 10.5);
        await disagree(m1, pr, 13, 'Báo giá cao, đề nghị lấy thêm báo giá nhà thầu khác');
        await disagree(m3, pr, 13.5, 'Chưa thật cần thay toàn bộ, đề nghị phương án rẻ hơn');
      },
      underOperating: async (p, k) => decide(await fault(p, k), OP, 10),
      underWarranty: async (p, k) => decide(await fault(p, k), { costSource: 'WARRANTY', comment: 'Còn bảo hành, gọi hãng' }, 10),
      emergency: async (p, k) => {
        const f = await fault(p, k, { hour: 14 });
        await decide(f, { costSource: 'FUND', emergency: true, emergencyReason: 'Thang kẹt người, không còn thang dự phòng ở sảnh phụ', comment: 'Sửa khẩn cấp' }, 15.5);
        await propose(f, 17, { pick: false });
      },
      returned: async (p, k) => {
        const { f } = await fundAccepted(p, k);
        await board.boardReturn(m2, f.id, { comment: 'Biên bản kiểm định thiếu chữ ký, đề nghị bổ sung' }, at(18));
      },
      awaitAccept: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, OP, 10);
        await upload(f, 19);
      },
      awaitBoard: (p, k) => fundAccepted(p, k),
      underFund: (p, k) => fundApproved(p, k),
      toPay: async (p, k) => {
        const { f } = await fundAccepted(p, k);
        await board.boardAccept(m2, f.id, { note: 'Đồng ý nghiệm thu' }, at(17));
      },
      paid: async (p, k) => {
        const { f, pr } = await fundAccepted(p, k);
        await board.boardAccept(m1, f.id, { note: 'Đã xem biên bản nghiệm thu và kiểm định' }, at(17));
        await fund.recordExpense(accountant, pr._id, {
          // Ngày 24: chi thấp hơn số duyệt, có lý do chênh lệch; ngày khác chi đúng số duyệt
          ...(p.day === 24 ? { amount: f.cost - 4 * MIL, varianceReason: 'Nhà thầu giảm 4 triệu sau thương lượng' } : { amount: f.cost }),
          documentNo: `HĐ-02${p.day}`, occurredAt: at(17.5), description: `Chi sửa chữa ${p.fullName}`,
        }, PHOTOS, { now: at(18) });
      },
      toExpense: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, OP, 10);
        await upload(f, 14.5);
        await accept(f, 15.5);
      },
      postponed: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, FUND, 10.5);
        await fund.cancelProposal(manager, (await propose(f, 11, { pick: false }))._id, { reason: 'Nhà thầu rút báo giá, chờ báo giá mới' }, { now: at(14) });
        // Nhóm 24: xem lại 25/11; nhóm 25: xem lại 26/11
        await decision.decideRepair(manager, f.id, {
          decision: 'POSTPONE', comment: 'Chờ báo giá mới của nhà thầu', reviewDate: new Date(dayStart(p.day).getTime() + DAY_MS),
        }, at(15));
      },
      awaitVendor: async (p, k) => {
        const f = await fault(p, k, { hour: 13 });
        await decide(f, FUND, 16);
        await propose(f, 16.5, { pick: false });
      },
      acceptReturned: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, OP, 10);
        await upload(f, 15);
        await repair.returnRepair(manager, f.id, { comment: 'Bơm vẫn rung, đề nghị căn chỉnh lại' }, at(17));
      },
      expensed: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, OP, 10);
        await upload(f, 14.5);
        await accept(f, 15.5);
        await expense.recordOperatingExpense(accountant, f.id, { actualCost: 9_500_000, invoiceNo: `HĐ-03${p.day}`, note: 'Phát sinh thêm dây cáp tín hiệu' }, PHOTOS, at(17));
      },
      warrantyDone: async (p, k) => {
        const f = await fault(p, k);
        await decide(f, { costSource: 'WARRANTY', comment: 'Còn bảo hành, gọi hãng' }, 10);
        await upload(f, 14.5);
        await accept(f, 15.5);
      },
      rerequest: async (p, k) => {
        const f = await fault(p, k);
        await decision.decideRepair(manager, f.id, { decision: 'POSTPONE', comment: 'Chờ bố trí kinh phí', reviewDate: new Date(BASE.getTime() + 10 * DAY_MS) }, at(11));
        await decision.requestRepair(k, f.id, { note: 'Quạt rung mạnh hơn, cần sửa sớm', estimatedCost: 30 * MIL }, PHOTOS, at(17));
      },
      blocked: async (p, k) => {
        const f = await fault(p, k, { cost: (bigAmount ?? p.cost * MIL) / MIL });
        await decide(f, FUND, 9.25);
        bigProposal = await propose(f, 9.5);
      },
      closed: async (p, k) => {
        const f = await fault(p, k);
        await decision.decideRepair(manager, f.id, { decision: 'RETIRE', comment: 'Thiết bị quá cũ, sẽ thay mới theo kế hoạch năm' }, at(10));
      },
    };

    const order = [...plan].sort((a, b) => (b.key === 'blocked') - (a.key === 'blocked')); // ca blocked lập đề xuất trước
    for (const [i, p] of order.entries()) {
      const kind = KINDS[p.kind];
      // 1 tháng: lần gần nhất đúng ngày đó tháng 10. Ca cộng dồn: chu kỳ 7 ngày, lần gần nhất trước 14 ngày → phiếu cũ rồi phiếu lần này
      const weekly = p.key === 'cumulative';
      await assetsService.createAsset(manager, {
        buildingId: bld[BUILDING[p.day][0]]._id, code: p.code, name: p.fullName, category: kind.category, location: `${p.loc} ${BUILDING[p.day][1]}`,
        manufacturer: kind.maker, installDate: new Date(BASE.getTime() - 1200 * DAY_MS), warrantyEnd: startOfVnDay(new Date(BASE.getTime() + (p.warranty ?? -200) * DAY_MS)),
        vendorName: kind.vendor[0], vendorPhone: kind.vendor[1], cycleValue: weekly ? 7 : 1, cycleUnit: weekly ? 'DAY' : 'MONTH',
        ...(qrOf.has(p.code) && { qrCode: qrOf.get(p.code) }), // tạo lại nhóm: giữ mã QR đã dán / đã ghi ra
        lastMaintenanceDate: weekly ? new Date(dayStart(p.day).getTime() - 14 * DAY_MS) : new Date(`2026-10-${p.day}T00:00:00+07:00`),
        checklist: kind.checklist, note: `Dữ liệu demo ${p.day}/11/2026`,
      });
      await RUN[p.key](p, techs[i % 2]);
      // Sửa xong sớm trước hạn (nhóm 25, 26): dời lịch sang tháng 12 để job không tạo thêm phiếu cho thiết bị vừa sửa
      if (dayStart(p.day) > BASE && ['toPay', 'paid', 'toExpense', 'expensed', 'warrantyDone'].includes(p.key)) {
        await Asset.updateOne({ code: p.code }, { $set: { nextMaintenanceDate: new Date(`2026-12-${p.day}T00:00:00+07:00`) } });
      }
      log(`  đã ghi ${p.code}`);
    }

    if (bigProposal) {
      await agree(m1, bigProposal, 19);
      const r = await agree(m2, bigProposal, 20);
      if (r.outcome !== 'BLOCKED_BALANCE') throw new Error(`Ca thiếu số dư: mong đợi BLOCKED_BALANCE, nhận ${r.outcome}`);
    }

    const ids = (await Asset.find({ code: { $in: plan.map((p) => p.code) } }).select('_id').lean()).map((a) => a._id);
    const total = await WorkOrder.countDocuments({ assetId: { $in: ids } });
    const fundDoc = await fund.getFund();
    log(`Đã ghi ${ids.length} thiết bị, ${total} phiếu. Quỹ: ${fundDoc.balance.toLocaleString('vi-VN')} đ, khả dụng ${(await fund.availableBalance(fundDoc._id)).toLocaleString('vi-VN')} đ.`);
    return total;
  } finally {
    restore();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectDB()
    .then(() => seedMaintenanceDemo3Days({
      apply: process.argv.includes('--apply'),
      reset: process.argv.includes('--reset'),
      day: Number(process.argv.find((a) => a.startsWith('--day='))?.slice('--day='.length)) || null,
      backupPath: process.argv.find((a) => a.startsWith('--backup='))?.slice('--backup='.length) ?? null,
    }))
    .catch((err) => {
      console.error(`[seedMaintenanceDemo3Days] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}

