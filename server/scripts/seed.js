// Dữ liệu mẫu cho môi trường dev/demo — đủ để chạy thử mọi module và các báo cáo/dashboard.
//   npm run db:seed            → chỉ seed khi DB chưa có user nào
//   npm run db:seed -- --reset → XÓA toàn bộ dữ liệu các collection rồi seed lại (không chạy được ở production)
// Mật khẩu mọi tài khoản mẫu: Sapms@123
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import * as M from '../src/models/index.js';
import { ensureDefaultConfigs } from '../src/services/systemConfig.service.js';
import { DAY_MS, HOUR_MS, periodEnd, periodRange, startOfVnDay, vnPeriod } from '../src/utils/time.js';

const RESET = process.argv.includes('--reset');
const PASSWORD = 'Sapms@123';

// PRNG cố định để dữ liệu mẫu giống nhau mỗi lần seed
let seed = 20261001;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

await connectDB();

if (RESET) {
  if (env.isProd) throw new Error('Không được --reset trên production');
  for (const Model of Object.values(M)) await Model.deleteMany({});
  console.log('🧹 Đã xóa dữ liệu cũ');
} else if (await M.User.exists({})) {
  console.log('DB đã có dữ liệu — bỏ qua. Dùng `npm run db:seed -- --reset` nếu muốn seed lại.');
  await disconnectDB();
  process.exit(0);
}

await ensureDefaultConfigs();
const passwordHash = await bcrypt.hash(PASSWORD, 10);
const now = new Date();
const daysAgo = (n, hour = 9) => new Date(startOfVnDay(new Date(now.getTime() - n * DAY_MS)).getTime() + hour * HOUR_MS);

// ===== Tài khoản =====
const mkUser = (email, fullName, role, extra = {}) => ({
  email,
  fullName,
  role,
  passwordHash,
  phone: `09${between(10000000, 99999999)}`,
  ...extra,
});
const users = await M.User.insertMany([
  mkUser('admin@sapms.vn', 'Quản trị hệ thống', 'ADMIN'),
  mkUser('manager@sapms.vn', 'Nguyễn Văn Quản', 'MANAGER'),
  mkUser('accountant@sapms.vn', 'Trần Thị Kế Toán', 'ACCOUNTANT'),
  mkUser('letan@sapms.vn', 'Lê Thị Lễ Tân', 'STAFF', { roleTitle: 'RECEPTIONIST' }),
  mkUser('baove@sapms.vn', 'Phạm Văn Bảo Vệ', 'STAFF', { roleTitle: 'SECURITY' }),
  mkUser('kythuat1@sapms.vn', 'Hoàng Văn Kỹ', 'STAFF', { roleTitle: 'TECHNICIAN' }),
  mkUser('kythuat2@sapms.vn', 'Đỗ Minh Thuật', 'STAFF', { roleTitle: 'TECHNICIAN' }),
  mkUser('chairman@sapms.vn', 'Vũ Đức Trưởng', 'BOARD', { boardTitle: 'CHAIRMAN' }),
  mkUser('bqt1@sapms.vn', 'Ngô Thị Hội Đồng', 'BOARD', { boardTitle: 'MEMBER' }),
  mkUser('bqt2@sapms.vn', 'Bùi Văn Thành Viên', 'BOARD', { boardTitle: 'MEMBER' }),
  ...['An', 'Bình', 'Cường', 'Dung', 'Giang', 'Hà'].map((n, i) =>
    mkUser(`cudan${i + 1}@sapms.vn`, `Cư dân ${n}`, 'RESIDENT'),
  ),
]);
const U = Object.fromEntries(users.map((u) => [u.email.split('@')[0], u]));
const residentUsers = users.filter((u) => u.role === 'RESIDENT');
const technicians = [U.kythuat1, U.kythuat2];

// ===== Tòa, căn hộ =====
const buildings = await M.Building.insertMany([
  { code: 'A', name: 'Block A', address: '1 Đường Số 1, TP. Thủ Đức', totalFloors: 5 },
  { code: 'B', name: 'Block B', address: '1 Đường Số 1, TP. Thủ Đức', totalFloors: 5 },
]);
const apartmentDocs = [];
for (const b of buildings) {
  const prefix = b.name.slice(-1);
  for (let floor = 1; floor <= 5; floor += 1) {
    for (let unit = 1; unit <= 4; unit += 1) {
      const r = rand();
      apartmentDocs.push({
        buildingId: b._id,
        code: `${prefix}${floor}0${unit}`,
        floor,
        area: pick([55, 68, 75, 82, 96]),
        status: r < 0.6 ? 'OWNED' : r < 0.8 ? 'RENTED' : 'VACANT',
      });
    }
  }
}
// 6 căn đầu luôn có người ở để gán cư dân mẫu
apartmentDocs.slice(0, 6).forEach((a) => (a.status = 'OWNED'));
const apartments = await M.Apartment.insertMany(apartmentDocs);
const occupied = apartments.filter((a) => a.status !== 'VACANT');

// ===== Cư dân, hợp đồng, xe =====
const contracts = await M.Contract.insertMany(
  residentUsers.map((u, i) => ({
    apartmentId: apartments[i]._id,
    type: 'SALE',
    ownerId: u._id,
    startDate: daysAgo(400),
    createdBy: U.letan._id,
  })),
);
await M.Resident.insertMany(
  residentUsers.map((u, i) => ({
    userId: u._id,
    apartmentId: apartments[i]._id,
    relationType: 'OWNER',
    contractId: contracts[i]._id,
    idNumber: `0790${between(10000000, 99999999)}`,
    moveInDate: daysAgo(400),
  })),
);

// ===== Hộ gia đình demo cho thẻ cư dân (UC-D11) — chỉ THÊM, không đổi dữ liệu sẵn có =====
// cudan1 (căn đầu) là chủ hộ có vợ và con nhỏ (chưa có ngày sinh: chủ hộ tự nhập ở mục Gia đình).
// Căn thứ 7 đang cho thuê: chủ sở hữu "không ở" (cusohuu7) không có quyền tiện ích, người thuê (nguoithue7) là chủ hộ.
// Tạo trực tiếp (không qua mkUser) để không tiêu thụ bộ sinh số ngẫu nhiên → dữ liệu demo phía sau giữ nguyên
const demoUser = (email, fullName, phone) => ({ email, fullName, role: 'RESIDENT', passwordHash, phone });
const householdUsers = await M.User.insertMany([
  demoUser('vo.cudan1@sapms.vn', 'Vợ cư dân An', '0900000001'),
  demoUser('con.cudan1@sapms.vn', 'Bé An', '0900000002'),
  demoUser('cusohuu7@sapms.vn', 'Chủ sở hữu căn cho thuê', '0900000003'),
  demoUser('nguoithue7@sapms.vn', 'Người thuê căn 7', '0900000004'),
  // Căn của cudan3 không có hóa đơn quá hạn → dùng để thử mua gói tháng cho con (UC-D09)
  demoUser('con.cudan3@sapms.vn', 'Bé Cường', '0900000005'),
]);
const rentedApartment = apartments[6];
await M.Apartment.updateOne({ _id: rentedApartment._id }, { status: 'RENTED' });

// Hợp đồng căn 7: SALE cho cusohuu7 + LEASE cho nguoithue7 (BR-A5: LEASE cần SALE ACTIVE)
const leaseStartDate = daysAgo(120);
const leaseEndDate = new Date(leaseStartDate.getFullYear() + 1, leaseStartDate.getMonth(), leaseStartDate.getDate(), leaseStartDate.getHours());
const [rentedSaleContract, rentedLeaseContract] = await M.Contract.insertMany([
  {
    apartmentId: rentedApartment._id,
    type: 'SALE',
    ownerId: householdUsers[2]._id,
    startDate: daysAgo(900),
    createdBy: U.letan._id,
  },
  {
    apartmentId: rentedApartment._id,
    type: 'LEASE',
    ownerId: householdUsers[2]._id,
    tenantId: householdUsers[3]._id,
    tenantPaysFees: true,
    startDate: leaseStartDate,
    endDate: leaseEndDate,
    createdBy: U.letan._id,
  },
]);

await M.Resident.insertMany([
  { userId: householdUsers[0]._id, apartmentId: apartments[0]._id, relationType: 'FAMILY_MEMBER', contractId: contracts[0]._id, moveInDate: daysAgo(380) },
  { userId: householdUsers[1]._id, apartmentId: apartments[0]._id, relationType: 'FAMILY_MEMBER', contractId: contracts[0]._id, moveInDate: daysAgo(360) },
  { userId: householdUsers[2]._id, apartmentId: rentedApartment._id, relationType: 'OWNER', contractId: rentedSaleContract._id, moveInDate: daysAgo(900) },
  { userId: householdUsers[3]._id, apartmentId: rentedApartment._id, relationType: 'TENANT', contractId: rentedLeaseContract._id, moveInDate: daysAgo(120) },
  { userId: householdUsers[4]._id, apartmentId: apartments[2]._id, relationType: 'FAMILY_MEMBER', contractId: contracts[2]._id, moveInDate: daysAgo(300) },
]);
const vehicles = await M.Vehicle.insertMany(
  occupied.slice(0, 20).map((a, i) => ({
    apartmentId: a._id,
    registeredBy: residentUsers[i]?._id,
    type: i % 4 === 0 ? 'CAR' : 'MOTORBIKE',
    plateNumber: `${between(50, 79)}${i % 4 === 0 ? 'A' : 'H1'}-${between(10000, 99999)}`,
    status: 'APPROVED',
    approvedAt: daysAgo(300),
    reviewedBy: U.letan._id,
  })),
);

// ===== Phí & hóa đơn 2026-01 → tháng hiện tại =====
const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
await M.FeeType.insertMany([
  { code: 'CLEANING', name: 'Phí vệ sinh', feeCategory: 'CLEANING', calcMethod: 'PER_M2', unitPrice: 7000, effectiveFrom: yearStart, createdBy: U.manager._id },
  { code: 'PARKING_MOTORBIKE', name: 'Vé xe máy', feeCategory: 'PARKING', calcMethod: 'PER_VEHICLE', vehicleType: 'MOTORBIKE', unitPrice: 120000, effectiveFrom: yearStart, createdBy: U.manager._id },
  { code: 'PARKING_CAR', name: 'Vé ô tô', feeCategory: 'PARKING', calcMethod: 'PER_VEHICLE', vehicleType: 'CAR', unitPrice: 1200000, effectiveFrom: yearStart, createdBy: U.manager._id },
  { code: 'PARKING_BICYCLE', name: 'Vé xe đạp', feeCategory: 'PARKING', calcMethod: 'PER_VEHICLE', vehicleType: 'BICYCLE', unitPrice: 30000, effectiveFrom: yearStart, createdBy: U.manager._id },
]);

const currentPeriod = vnPeriod(now);
const periods = periodRange(`${now.getUTCFullYear()}-01`, currentPeriod);
const invoices = [];
const payments = [];
let receiptSeq = 0;
for (const period of periods) {
  const [y, m] = period.split('-').map(Number);
  const issuedAt = new Date(Date.UTC(y, m - 1, 1, 0, 30) - 7 * HOUR_MS);
  const dueDate = new Date(issuedAt.getTime() + 15 * DAY_MS);
  const isCurrent = period === currentPeriod;
  const isPrev = periods.at(-2) === period;

  for (const a of occupied) {
    const items = [
      { feeCategory: 'CLEANING', feeCode: 'CLEANING', description: `Phí vệ sinh ${a.area}m²`, quantity: a.area, unitPrice: 7000, amount: a.area * 7000 },
    ];
    for (const v of vehicles.filter((x) => String(x.apartmentId) === String(a._id))) {
      const price = v.type === 'CAR' ? 1200000 : 120000;
      items.push({ feeCategory: 'PARKING', feeCode: `PARKING_${v.type}`, description: `Vé xe ${v.plateNumber}`, quantity: 1, unitPrice: price, amount: price, refId: v._id });
    }
    if (rand() < 0.25) {
      const fee = pick([50000, 100000, 200000]);
      items.push({ feeCategory: 'AMENITY', feeCode: 'AMENITY', description: 'Phí tiện ích kỳ trước', quantity: 1, unitPrice: fee, amount: fee });
    }
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);

    // Kỳ hiện tại: đa số chưa trả; kỳ trước: 1 phần quá hạn; các kỳ cũ: gần như đã trả hết
    const r = rand();
    let status = 'PAID';
    if (isCurrent) status = r < 0.3 ? 'PAID' : 'UNPAID';
    else if (isPrev) status = r < 0.7 ? 'PAID' : 'OVERDUE';
    else if (r < 0.03) status = 'OVERDUE';
    else if (r < 0.05) status = 'CANCELLED';

    const paidAt = status === 'PAID' ? new Date(issuedAt.getTime() + between(1, 14) * DAY_MS) : null;
    const invoice = {
      _id: new M.Invoice()._id,
      code: `HD-${period.replace('-', '')}-${buildings.find((b) => String(b._id) === String(a.buildingId)).code}-${a.code}`,
      apartmentId: a._id,
      buildingId: a.buildingId,
      payerId: residentUsers[apartments.indexOf(a)]?._id,
      period,
      items,
      totalAmount,
      status,
      issuedAt,
      dueDate,
      paidAt,
      generatedBy: 'CRON',
    };
    invoices.push(invoice);
    if (status === 'PAID') {
      const method = pick(['VNPAY', 'VNPAY', 'CASH', 'BANK_TRANSFER']);
      payments.push({
        invoiceId: invoice._id,
        method,
        amount: totalAmount,
        status: 'SUCCESS',
        paidAt,
        ...(method === 'VNPAY'
          ? { vnpTxnRef: `${invoice.code}-${between(1000, 9999)}`, vnpResponseCode: '00' }
          : {
              receiptNo: `PT-${period.replace('-', '')}-${String((receiptSeq += 1)).padStart(5, '0')}`,
              confirmedBy: U.accountant._id,
            }),
      });
    }
  }
}
await M.Invoice.insertMany(invoices);
await M.Payment.insertMany(payments);

const overdueApartments = [...new Set(invoices.filter((i) => i.status === 'OVERDUE').map((i) => String(i.apartmentId)))];
await M.DebtFollowup.insertMany(
  overdueApartments.slice(0, 3).map((apartmentId) => ({
    apartmentId,
    invoiceIds: invoices.filter((i) => String(i.apartmentId) === apartmentId && i.status === 'OVERDUE').map((i) => i._id),
    assignedTo: U.letan._id,
    assignedBy: U.manager._id,
    activities: [{ at: daysAgo(2), by: U.letan._id, method: 'PHONE', note: 'Đã gọi, hẹn cuối tuần thanh toán', promisedDate: daysAgo(-3) }],
  })),
);

// ===== Quỹ bảo trì =====
const fund = await M.MaintenanceFund.create({ name: 'Quỹ bảo trì chung', balance: 0 });
let balance = 0;
const fundTx = [];
const addTx = (type, amount, occurredAt, description, extra = {}) => {
  balance += type === 'INCOME' ? amount : -amount;
  fundTx.push({ fundId: fund._id, type, amount, balanceAfter: balance, occurredAt, description, createdBy: U.accountant._id, ...extra });
};
addTx('INCOME', 1500000000, daysAgo(270), 'Kinh phí bảo trì 2% bàn giao', { source: 'Kinh phí 2% bàn giao' });
const proposals = await M.FundProposal.insertMany([
  {
    fundId: fund._id, title: 'Thay cáp thang máy Block A', description: 'Cáp tải đã mòn theo biên bản kiểm định', amount: 180000000,
    proposedBy: U.manager._id, status: 'APPROVED', finalizedBy: U.chairman._id, finalizedAt: daysAgo(150), finalNote: 'Đồng ý',
    votes: [U.chairman, U.bqt1, U.bqt2].map((u) => ({ memberId: u._id, decision: 'AGREE', votedAt: daysAgo(152) })),
  },
  {
    fundId: fund._id, title: 'Sơn lại hành lang Block B', description: 'Tường hành lang bong tróc', amount: 95000000,
    proposedBy: U.manager._id, status: 'APPROVED', finalizedBy: U.chairman._id, finalizedAt: daysAgo(60),
    votes: [U.chairman, U.bqt1].map((u) => ({ memberId: u._id, decision: 'AGREE', votedAt: daysAgo(62) })),
  },
  {
    fundId: fund._id, title: 'Nâng cấp hệ thống PCCC', description: 'Thay đầu báo khói tầng 1-5', amount: 120000000,
    proposedBy: U.manager._id, status: 'PENDING', votes: [{ memberId: U.bqt1._id, decision: 'AGREE', votedAt: daysAgo(1) }],
  },
]);
addTx('INCOME', 12500000, daysAgo(180), 'Lãi tiền gửi quý 1', { source: 'Lãi tiền gửi' });
addTx('EXPENSE', 180000000, daysAgo(150), 'Chi thay cáp thang máy Block A', { proposalId: proposals[0]._id, createdBy: U.chairman._id });
addTx('INCOME', 13100000, daysAgo(90), 'Lãi tiền gửi quý 2', { source: 'Lãi tiền gửi' });
addTx('EXPENSE', 95000000, daysAgo(60), 'Chi sơn hành lang Block B', { proposalId: proposals[1]._id, createdBy: U.chairman._id });
addTx('INCOME', 13400000, daysAgo(5), 'Lãi tiền gửi quý 3', { source: 'Lãi tiền gửi' });
await M.FundTransaction.insertMany(fundTx);
fund.balance = balance;
await fund.save();

await M.OperatingExpense.insertMany(
  periods.flatMap((month) => [
    { category: 'SALARY', amount: 85000000, month, description: 'Lương nhân viên BQL', createdBy: U.accountant._id },
    { category: 'COMMON_UTILITY', amount: between(18, 26) * 1000000, month, description: 'Điện nước khu vực chung', createdBy: U.accountant._id },
    { category: 'OUTSOURCED_SERVICE', amount: 30000000, month, description: 'Vệ sinh + bảo vệ thuê ngoài', createdBy: U.accountant._id },
  ]),
);

// ===== Tài sản & work order =====
const assets = await M.Asset.insertMany(
  buildings.flatMap((b) => [
    { buildingId: b._id, name: `Thang máy số 1 ${b.name}`, category: 'ELEVATOR', location: 'Sảnh chính', maintenanceCycleDays: 30, lastMaintenanceDate: daysAgo(26), nextMaintenanceDate: daysAgo(-4) },
    { buildingId: b._id, name: `Thang máy số 2 ${b.name}`, category: 'ELEVATOR', location: 'Sảnh phụ', maintenanceCycleDays: 30, lastMaintenanceDate: daysAgo(31), nextMaintenanceDate: daysAgo(1) },
    { buildingId: b._id, name: `Máy bơm nước ${b.name}`, category: 'PUMP', location: 'Tầng hầm', maintenanceCycleDays: 90, lastMaintenanceDate: daysAgo(40), nextMaintenanceDate: daysAgo(-50) },
    { buildingId: b._id, name: `Hệ thống PCCC ${b.name}`, category: 'FIRE_SYSTEM', location: 'Toàn tòa', maintenanceCycleDays: 180, lastMaintenanceDate: daysAgo(175), nextMaintenanceDate: daysAgo(-5) },
  ]),
);
const workOrders = [];
for (const a of assets) {
  for (let k = 1; k <= 3; k += 1) {
    const scheduledDate = daysAgo(a.maintenanceCycleDays * k);
    if (scheduledDate < yearStart) continue;
    const late = rand() < 0.2;
    workOrders.push({
      assetId: a._id, type: 'SCHEDULED', title: `Bảo trì định kỳ ${a.name}`, assignedTo: pick(technicians)._id, assignedBy: U.manager._id,
      status: 'DONE', scheduledDate, completedAt: new Date(scheduledDate.getTime() + (late ? 3 : 0.3) * DAY_MS), createdAt: scheduledDate,
    });
  }
}
workOrders.push({ assetId: assets[1]._id, type: 'SCHEDULED', title: `Bảo trì định kỳ ${assets[1].name}`, status: 'PENDING', scheduledDate: daysAgo(1), createdAt: daysAgo(1) });
await M.WorkOrder.insertMany(workOrders);

// ===== Danh mục phản ánh & ticket =====
const categories = await M.ComplaintCategory.insertMany([
  { name: 'Điện', description: 'Mất điện, chập điện, đèn hành lang', defaultPriority: 'HIGH', slaHours: 72 },
  { name: 'Nước', description: 'Rò rỉ, mất nước, tắc cống', defaultPriority: 'HIGH', slaHours: 72 },
  { name: 'Thang máy', description: 'Thang máy hỏng, kẹt', defaultPriority: 'URGENT', slaHours: 24 },
  { name: 'Vệ sinh', description: 'Rác, vệ sinh khu vực chung', defaultPriority: 'MEDIUM', slaHours: 168 },
  { name: 'An ninh', description: 'Mất trộm, người lạ', defaultPriority: 'URGENT', slaHours: 24 },
  { name: 'Khác', description: 'Các vấn đề khác', defaultPriority: 'LOW', slaHours: 168 },
]);
const ticketTitles = {
  Điện: ['Đèn hành lang tầng 3 không sáng', 'Ổ cắm phòng khách chập điện'],
  Nước: ['Rò nước trần nhà tắm', 'Nước yếu vào giờ cao điểm'],
  'Thang máy': ['Thang máy số 2 kêu to khi chạy', 'Thang máy dừng sai tầng'],
  'Vệ sinh': ['Rác tầng hầm chưa được thu gom', 'Hành lang bẩn sau khi sửa chữa'],
  'An ninh': ['Người lạ đi lại tầng 5 buổi tối', 'Camera sảnh không hoạt động'],
  Khác: ['Đề nghị lắp thêm ghế sảnh', 'Tiếng ồn từ căn hộ bên cạnh'],
};
const tickets = [];
let seq = {};
const scenarios = [
  ...Array(12).fill('CLOSED'),
  ...Array(3).fill('WAITING_CONFIRM'),
  ...Array(4).fill('IN_PROGRESS'),
  ...Array(3).fill('ASSIGNED'),
  ...Array(3).fill('NEW'),
  'REJECTED',
];
for (const status of scenarios) {
  const cat = pick(categories);
  const aptIdx = between(0, 5);
  const apt = apartments[aptIdx];
  const age = status === 'CLOSED' ? between(10, 250) : status === 'NEW' ? between(0, 5) : between(1, 12);
  const createdAt = daysAgo(age, between(7, 20));
  const p = vnPeriod(createdAt).replace('-', '');
  seq[p] = (seq[p] ?? 0) + 1;
  const tech = pick(technicians);
  const dueDate = new Date(createdAt.getTime() + cat.slaHours * HOUR_MS);
  const t = {
    code: `TK-${p}-${String(seq[p]).padStart(5, '0')}`,
    apartmentId: apt._id,
    buildingId: apt.buildingId,
    createdBy: residentUsers[aptIdx]._id,
    category: cat._id,
    title: pick(ticketTitles[cat.name]),
    description: 'Mô tả chi tiết sự cố do cư dân cung cấp (dữ liệu mẫu).',
    priority: cat.defaultPriority,
    status,
    dueDate,
    createdAt,
    history: [{ at: createdAt, by: residentUsers[aptIdx]._id, action: 'CREATED', toStatus: 'NEW' }],
  };
  if (status !== 'NEW' && status !== 'REJECTED') {
    t.assignedTo = tech._id;
    t.assignedBy = U.letan._id;
    t.assignedAt = new Date(createdAt.getTime() + 2 * HOUR_MS);
    t.history.push({ at: t.assignedAt, by: U.letan._id, action: 'ASSIGNED', fromStatus: 'NEW', toStatus: 'ASSIGNED', note: `Giao cho ${tech.fullName}` });
  }
  if (['WAITING_CONFIRM', 'CLOSED'].includes(status)) {
    const late = rand() < 0.25;
    t.resolvedAt = new Date(createdAt.getTime() + cat.slaHours * HOUR_MS * (late ? 1.4 : 0.5));
    t.history.push({ at: t.resolvedAt, by: tech._id, action: 'RESOLVED', fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_CONFIRM', note: 'Đã xử lý xong' });
  }
  if (status === 'CLOSED') {
    t.closedAt = new Date(t.resolvedAt.getTime() + between(2, 30) * HOUR_MS);
    t.rating = pick([3, 4, 4, 5, 5]);
    t.history.push({ at: t.closedAt, by: t.createdBy, action: 'CONFIRMED', fromStatus: 'WAITING_CONFIRM', toStatus: 'CLOSED', note: `Đánh giá ${t.rating}★` });
  }
  if (status === 'REJECTED') {
    t.rejectReason = 'Không thuộc phạm vi BQL (thiết bị riêng trong căn hộ)';
    t.closedAt = new Date(createdAt.getTime() + 3 * HOUR_MS);
  }
  tickets.push(t);
}
await M.Ticket.insertMany(tickets);

// ===== Tiện ích & booking =====
// 3 kiểu: FREE (chỉ hiển thị) · WALK_IN (gói tháng / vé lẻ, lễ tân tra mã) · BOOKING (đặt slot).
// WALK_IN và BOOKING có giờ mở cửa nằm trong giờ lễ tân 05:00–22:00 (BR-O15). Giá theo nhóm tuổi: người lớn / trẻ em (BR-O24).
const amenities = await M.Amenity.insertMany([
  { name: 'Công viên nội khu', accessMode: 'FREE', location: 'Trung tâm khu căn hộ', openTime: '05:00', closeTime: '22:00', description: 'Thảm cỏ, ghế đá và khu vui chơi ngoài trời cho cư dân.' },
  { name: 'Đường dạo bộ', accessMode: 'FREE', location: 'Vòng quanh khu căn hộ' },
  { name: 'Phòng gym', accessMode: 'WALK_IN', location: 'Tầng 3 khối đế', openTime: '05:00', closeTime: '22:00', perVisitFeeAdult: 50000, perVisitFeeChild: 30000, monthlyPassFeeAdult: 400000, monthlyPassFeeChild: 250000 },
  { name: 'Phòng yoga', accessMode: 'WALK_IN', location: 'Tầng 3 khối đế', openTime: '06:00', closeTime: '21:00', perVisitFeeAdult: 60000, perVisitFeeChild: 40000, monthlyPassFeeAdult: 500000, monthlyPassFeeChild: 300000 },
  { name: 'Hồ bơi', accessMode: 'WALK_IN', location: 'Tầng 5 khối đế', openTime: '05:00', closeTime: '21:00', perVisitFeeAdult: 40000, perVisitFeeChild: 25000, maxConcurrent: 40, monthlyPassFeeAdult: 450000, monthlyPassFeeChild: 280000 },
  { name: 'Sân tennis', accessMode: 'BOOKING', location: 'Sân sau', openTime: '05:00', closeTime: '22:00', slotDurationMinutes: 60, capacityPerSlot: 1, feePerBooking: 100000, monthlyPassFeeAdult: 600000, monthlyPassFeeChild: 350000 },
  { name: 'Sân cầu lông', accessMode: 'BOOKING', location: 'Tầng 2 khối đế', openTime: '05:00', closeTime: '22:00', slotDurationMinutes: 60, capacityPerSlot: 1, feePerBooking: 60000, monthlyPassFeeAdult: 350000, monthlyPassFeeChild: 200000 },
  { name: 'Khu BBQ Block A', accessMode: 'BOOKING', location: 'Sân thượng Block A', buildingId: buildings[0]._id, openTime: '10:00', closeTime: '22:00', slotDurationMinutes: 180, capacityPerSlot: 1, feePerBooking: 150000 },
]);
const bookable = amenities.filter((a) => a.accessMode === 'BOOKING'); // chỉ tiện ích BOOKING mới có booking
const slotsOf = (a) => {
  const [oh, om] = a.openTime.split(':').map(Number);
  const [ch, cm] = a.closeTime.split(':').map(Number);
  const out = [];
  for (let t = oh * 60 + om; t + a.slotDurationMinutes <= ch * 60 + cm; t += a.slotDurationMinutes) {
    const hhmm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    out.push([hhmm(t), hhmm(t + a.slotDurationMinutes)]);
  }
  return out;
};
const bookings = [];
const usedSlots = new Set(); // sức chứa 1 căn/slot: không tạo 2 booking trùng slot
for (let i = 0; i < 160; i += 1) {
  const a = pick(bookable);
  const offset = between(-12, 250); // vài booking tương lai
  const [slotStart, slotEnd] = rand() < 0.5 ? pick(slotsOf(a).slice(-3)) : pick(slotsOf(a));
  const apt = pick(occupied);
  const r = rand();
  const future = offset < 0;
  // Booking tương lai: tự xác nhận APPROVED (BR-O12). Quá khứ: COMPLETED / CANCELLED / NO_SHOW; REJECTED là dữ liệu luồng duyệt cũ
  const status = future ? 'APPROVED' : r < 0.75 ? 'COMPLETED' : r < 0.85 ? 'CANCELLED' : r < 0.95 ? 'NO_SHOW' : 'REJECTED';
  const date = startOfVnDay(new Date(now.getTime() - offset * DAY_MS));
  const slotKey = `${a._id}|${date.getTime()}|${slotStart}`;
  if (usedSlots.has(slotKey)) continue;
  usedSlots.add(slotKey);
  const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  bookings.push({
    amenityId: a._id, apartmentId: apt._id, requestedBy: residentUsers[apartments.indexOf(apt)]?._id, bookedBy: residentUsers[apartments.indexOf(apt)]?._id,
    date, slotStart, slotEnd, fee: a.feePerBooking, status,
    startAt: new Date(date.getTime() + toMin(slotStart) * 60000),
    endAt: new Date(date.getTime() + toMin(slotEnd) * 60000),
    reviewedBy: status === 'REJECTED' ? U.letan._id : undefined,
  });
}
await M.Booking.insertMany(bookings);

// ===== Gói tháng tiện ích demo (UC-D09): chủ hộ cudan1 có gói gym tháng này, vợ có gói tháng sau, cudan2 có gói sân tennis =====
const amenityByName = Object.fromEntries(amenities.map((a) => [a.name, a]));
const thisMonth = vnPeriod(now);
const nextMonth = vnPeriod(periodEnd(thisMonth));
const mkPass = (user, apartment, amenity, month, purchasedBy = user) => ({
  userId: user._id,
  apartmentId: apartment._id,
  amenityId: amenity._id,
  month,
  ageGroup: 'ADULT',
  fee: amenity.monthlyPassFeeAdult,
  purchasedBy: purchasedBy._id,
});
await M.AmenityPass.insertMany([
  mkPass(residentUsers[0], apartments[0], amenityByName['Phòng gym'], thisMonth),
  mkPass(householdUsers[0], apartments[0], amenityByName['Phòng gym'], nextMonth, residentUsers[0]),
  mkPass(residentUsers[1], apartments[1], amenityByName['Sân tennis'], thisMonth),
]);

// ===== Sổ khách, bảng tin, thông báo =====
await M.GuestLog.insertMany([
  { apartmentId: apartments[0]._id, buildingId: apartments[0].buildingId, guestName: 'Nguyễn Thị Khách', guestPhone: '0901234567', expectedTime: new Date(now.getTime() + 3 * HOUR_MS), registeredBy: residentUsers[0]._id },
  { apartmentId: apartments[1]._id, buildingId: apartments[1].buildingId, guestName: 'Trần Văn Thăm', expectedTime: new Date(now.getTime() + 5 * HOUR_MS), registeredBy: residentUsers[1]._id, numberOfGuests: 2 },
  { apartmentId: apartments[2]._id, buildingId: apartments[2].buildingId, guestName: 'Shipper Giao Hàng', status: 'CHECKED_OUT', isWalkIn: true, expectedTime: daysAgo(1, 10), checkInTime: daysAgo(1, 10), checkOutTime: daysAgo(1, 10.2), recordedBy: U.baove._id },
]);
const ann = await M.Announcement.insertMany([
  { title: 'Lịch bảo trì thang máy tháng này', content: 'BQL sẽ bảo trì thang máy số 2 các tòa từ 9h-11h sáng thứ 7. Mong cư dân thông cảm.', targetScope: 'ALL', isPinned: true, createdBy: U.manager._id, recipientCount: users.length },
  { title: 'Cắt nước tạm thời Block A', content: 'Block A tạm ngưng cấp nước 14h-16h ngày mai để vệ sinh bể ngầm.', targetScope: 'BUILDING', targetId: buildings[0]._id, createdBy: U.letan._id, recipientCount: 6 },
]);
await M.Notification.insertMany(
  residentUsers.map((u) => ({ userId: u._id, type: 'ANNOUNCEMENT', title: ann[0].title, content: ann[0].content, refId: ann[0]._id, link: '/announcements' })),
);

console.log(`✅ Seed xong:
  ${users.length} users · ${buildings.length} buildings · ${apartments.length} apartments
  ${invoices.length} invoices · ${payments.length} payments · ${tickets.length} tickets · ${bookings.length} bookings
  ${fundTx.length} fund_transactions · ${workOrders.length} work_orders
  Đăng nhập: manager@sapms.vn / cudan1@sapms.vn / kythuat1@sapms.vn ... mật khẩu ${PASSWORD}`);
await disconnectDB();
