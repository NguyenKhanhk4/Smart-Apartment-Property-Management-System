/**
 * Sửa dữ liệu cũ cho khớp schema hiện tại + bổ sung dữ liệu mẫu cho tính năng mới. Chạy lại không đổi gì (idempotent).
 *   1. Hóa đơn thiếu paidAmount: Đã thanh toán → = tổng phí; còn lại → tổng tiền thu thành công (không vượt tổng phí).
 *      Hóa đơn thiếu Người nộp phí (payerId) → chủ hộ của căn (không có thì thành viên đang ở lâu nhất).
 *   2. Thanh toán VNPAY (cổng cũ) → PAYOS, giữ mã giao dịch vào reference; bổ sung allocations từ invoiceId.
 *   3. Hồ sơ nợ mẫu cũ (status OPEN, thiếu payerId / openedAt) → mẫu mới (REMINDING / RESOLVED). Không xác định được
 *      Người nộp phí (hóa đơn đã mất, căn không có cư dân) → xóa (job nhắc nợ tự mở lại hồ sơ từ hóa đơn quá hạn thật).
 *   4. Nhật ký ASSET_STATUS_CHANGED (cũ) → ASSET_DEACTIVATED / ASSET_REACTIVATED theo after.isActive.
 *   5. Mọi model: trường thiếu mà schema có giá trị mặc định cố định (null, 0, false, [], chuỗi) → đặt giá trị đó.
 *   6. Dữ liệu tính năng mới: liên hệ người gửi phiếu (từ tài khoản), cách trả phí của lượt đặt có phí,
 *      lịch ca trực tuần này + tuần sau cho Kỹ thuật / Bảo vệ (3 ca/ngày, ca đêm qua ngày hôm sau) nếu còn trống.
 *   7. Căn đang Có chủ / Cho thuê mà không có cư dân nào (dữ liệu seed thiếu): tạo chủ hộ mẫu (tài khoản cư dân chờ kích hoạt
 *      + hồ sơ cư trú OWNER), rồi gán làm Người nộp phí cho các hóa đơn của căn chưa có người nộp.
 * Nên chạy trước các script của nhóm: db:migrate-walk-in, db:migrate-assets, db:backfill-priority, db:migrate-audit-targets.
 *
 * Xem trước:  node scripts/fixLegacyData.js
 * Áp dụng:    node scripts/fixLegacyData.js --apply
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import * as models from '../src/models/index.js';

const APPLY = process.argv.includes('--apply');
const { Invoice, Payment, DebtFollowup, AuditLog, Ticket, Booking, DutyShift, User, Apartment, Resident } = models;
const plan = [];
const note = (what, n) => n && plan.push(`${what}: ${n}`);

async function bulk(Model, ops, label) {
  note(label, ops.length);
  if (APPLY && ops.length) await Model.collection.bulkWrite(ops, { ordered: false });
}

// ---------- 1. Hóa đơn ----------
async function fixInvoices() {
  const missing = await Invoice.collection.find({ paidAmount: { $exists: false } }).toArray();
  const paidRows = await Payment.collection
    .aggregate([{ $match: { status: 'SUCCESS', invoiceId: { $in: missing.map((i) => i._id) } } }, { $group: { _id: '$invoiceId', amount: { $sum: '$amount' } } }])
    .toArray();
  const paid = new Map(paidRows.map((r) => [String(r._id), r.amount]));
  const ops = missing.map((i) => ({
    updateOne: {
      filter: { _id: i._id, paidAmount: { $exists: false } },
      update: { $set: { paidAmount: i.status === 'PAID' ? i.totalAmount : Math.min(i.totalAmount, paid.get(String(i._id)) ?? 0) } },
    },
  }));
  await bulk(Invoice, ops, 'Hóa đơn bổ sung paidAmount');

  // Người nộp phí: chủ hộ đang ở của căn, không có thì thành viên đang ở lâu nhất
  const noPayer = await Invoice.collection.find({ payerId: { $in: [null, undefined] }, status: { $ne: 'DRAFT' } }).toArray();
  const payerOps = [];
  for (const i of noPayer) {
    const payerId = await payerOf(i.apartmentId);
    if (payerId) payerOps.push({ updateOne: { filter: { _id: i._id, payerId: { $in: [null, undefined] } }, update: { $set: { payerId } } } });
  }
  await bulk(Invoice, payerOps, 'Hóa đơn bổ sung Người nộp phí');
}

const payerCache = new Map();
async function payerOf(apartmentId) {
  const key = String(apartmentId);
  if (!payerCache.has(key)) {
    const members = await Resident.collection.find({ apartmentId, isActive: { $ne: false } }).sort({ moveInDate: 1, createdAt: 1 }).toArray();
    payerCache.set(key, (members.find((m) => m.relationType === 'OWNER') ?? members[0])?.userId ?? null);
  }
  return payerCache.get(key);
}

// ---------- 2. Thanh toán ----------
async function fixPayments() {
  const vnpay = await Payment.collection.find({ method: 'VNPAY' }).toArray();
  await bulk(
    Payment,
    vnpay.map((p) => ({ updateOne: { filter: { _id: p._id, method: 'VNPAY' }, update: { $set: { method: 'PAYOS', reference: p.reference ?? p.vnpTxnRef ?? null } } } })),
    'Thanh toán VNPAY → PAYOS',
  );
  const noAlloc = await Payment.collection.find({ allocations: { $exists: false }, invoiceId: { $ne: null } }).toArray();
  await bulk(
    Payment,
    noAlloc.map((p) => ({
      updateOne: { filter: { _id: p._id, allocations: { $exists: false } }, update: { $set: { allocations: [{ invoiceId: p.invoiceId, amount: p.amount }] } } },
    })),
    'Thanh toán bổ sung allocations',
  );
}

// ---------- 3. Hồ sơ nợ ----------
async function fixDebts() {
  const old = await DebtFollowup.collection.find({ $or: [{ status: 'OPEN' }, { payerId: { $exists: false } }, { openedAt: { $exists: false } }] }).toArray();
  const ops = [];
  for (const d of old) {
    const invoices = await Invoice.collection.find({ _id: { $in: d.invoiceIds ?? [] } }).toArray();
    const payerId = d.payerId ?? invoices.find((i) => i.payerId)?.payerId ?? (await payerOf(d.apartmentId));
    if (!payerId) {
      ops.push({ deleteOne: { filter: { _id: d._id } } });
      continue;
    }
    const apartment = await Apartment.collection.findOne({ _id: d.apartmentId }, { projection: { buildingId: 1 } });
    const stillOwing = invoices.some((i) => ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status));
    ops.push({
      updateOne: {
        filter: { _id: d._id },
        update: {
          $set: {
            payerId,
            openedAt: d.openedAt ?? d.createdAt ?? new Date(),
            buildingId: d.buildingId ?? apartment?.buildingId ?? null,
            status: stillOwing ? 'REMINDING' : 'RESOLVED',
            resolvedAt: stillOwing ? null : (d.resolvedAt ?? new Date()),
            reminderCount: d.reminderCount ?? 0,
            reminders: d.reminders ?? [],
          },
        },
      },
    });
  }
  await bulk(DebtFollowup, ops, 'Hồ sơ nợ mẫu cũ → mẫu mới (hoặc xóa nếu hỏng)');
}

// ---------- 4. Nhật ký ----------
async function fixAudit() {
  const rows = await AuditLog.collection.find({ action: 'ASSET_STATUS_CHANGED' }).toArray();
  await bulk(
    AuditLog,
    rows.map((a) => ({ updateOne: { filter: { _id: a._id }, update: { $set: { action: a.after?.isActive === false ? 'ASSET_DEACTIVATED' : 'ASSET_REACTIVATED' } } } })),
    'Nhật ký ASSET_STATUS_CHANGED',
  );
}

// ---------- 5. Giá trị mặc định cố định ----------
async function fillDefaults() {
  for (const [name, Model] of Object.entries(models)) {
    if (!Model?.schema || typeof Model.collection?.updateMany !== 'function') continue;
    const sets = [];
    Model.schema.eachPath((p, type) => {
      if (p === '_id' || p === '__v' || p.includes('.$') || p.includes('.')) return;
      const def = type.defaultValue;
      if (def === undefined || typeof def === 'function' && !Array.isArray(def)) return;
      const value = Array.isArray(def) ? [] : def;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return;
      sets.push([p, value]);
    });
    // Mảng của schema (type: [x]) có default [] dạng hàm → coi là []
    Model.schema.eachPath((p, type) => {
      if (!p.includes('.') && type.instance === 'Array' && !sets.some(([q]) => q === p)) sets.push([p, []]);
    });
    for (const [p, value] of sets) {
      const filter = { [p]: { $exists: false } };
      const n = await Model.collection.countDocuments(filter);
      note(`${name}.${p} = ${JSON.stringify(value)}`, n);
      if (APPLY && n) await Model.collection.updateMany(filter, { $set: { [p]: value } });
    }
  }
}

// ---------- 6. Dữ liệu tính năng mới ----------
async function featureData() {
  // Liên hệ người gửi phiếu (phiếu cũ): lấy tên + SĐT tài khoản người gửi
  const tickets = await Ticket.collection.find({ 'contact.phone': { $in: [null, undefined] }, createdByStaff: { $in: [null, undefined] } }).toArray();
  const users = new Map(
    (await User.collection.find({ _id: { $in: tickets.map((t) => t.createdBy) } }, { projection: { fullName: 1, phone: 1 } }).toArray()).map((u) => [String(u._id), u]),
  );
  await bulk(
    Ticket,
    tickets
      .filter((t) => users.get(String(t.createdBy)))
      .map((t) => {
        const u = users.get(String(t.createdBy));
        return { updateOne: { filter: { _id: t._id }, update: { $set: { contact: { name: u.fullName ?? null, phone: u.phone ?? null, note: null } } } } };
      }),
    'Phiếu bổ sung liên hệ người gửi',
  );

  // Cách trả phí lượt đặt có phí: đã trả online → ONLINE, còn lại → INVOICE (cộng phí tháng)
  const bookings = await Booking.collection.find({ fee: { $gt: 0 }, paymentMethod: { $in: [null, undefined] } }).toArray();
  await bulk(
    Booking,
    bookings.map((b) => ({ updateOne: { filter: { _id: b._id }, update: { $set: { paymentMethod: b.paidAt || b.status === 'PENDING_PAYMENT' ? 'ONLINE' : 'INVOICE' } } } })),
    'Lượt đặt có phí bổ sung cách trả',
  );

  // Lịch ca trực tuần này + tuần sau (giờ VN): 06–14, 14–22, 22–06 (qua đêm); bỏ qua ca đã có người đó / ca trùng
  const VN = 7 * 3600_000;
  const now = new Date();
  const vnMidnight = (d) => new Date(Math.floor((d.getTime() + VN) / 86400_000) * 86400_000 - VN);
  const today = vnMidnight(now);
  const weekday = (new Date(today.getTime() + VN).getUTCDay() + 6) % 7; // 0 = thứ Hai
  const weekStart = new Date(today.getTime() - weekday * 86400_000);
  const SHIFTS = [
    [6, 14],
    [14, 22],
    [22, 30],
  ];
  const docs = [];
  for (const roleTitle of ['TECHNICIAN', 'SECURITY']) {
    const staff = await User.collection.find({ role: 'STAFF', roleTitle, isActive: { $ne: false } }, { projection: { _id: 1 } }).toArray();
    if (!staff.length) continue;
    let k = 0;
    for (let day = 0; day < 14; day += 1) {
      const base = new Date(weekStart.getTime() + day * 86400_000);
      for (const [from, to] of SHIFTS) {
        const startAt = new Date(base.getTime() + from * 3600_000);
        const endAt = new Date(base.getTime() + to * 3600_000);
        if (endAt <= now) continue; // lịch cũ chỉ để xem, không tạo vào quá khứ
        // Ca ngày đông người (2 người) khi đủ nhân viên, ca đêm 1 người
        const people = from === 22 || staff.length < 2 ? 1 : 2;
        for (let i = 0; i < people; i += 1) {
          const userId = staff[k % staff.length]._id;
          k += 1;
          const clash = await DutyShift.collection.findOne({ userId, startAt: { $lt: endAt }, endAt: { $gt: startAt } });
          if (clash || docs.some((d) => String(d.userId) === String(userId) && d.startAt < endAt && d.endAt > startAt)) continue;
          docs.push({ roleTitle, userId, startAt, endAt, note: from === 22 ? 'Ca đêm' : null, createdBy: null, createdAt: now, updatedAt: now });
        }
      }
    }
  }
  note('Ca trực tạo thêm (tuần này + tuần sau)', docs.length);
  if (APPLY && docs.length) await DutyShift.collection.insertMany(docs);
}

// ---------- 7. Chủ hộ mẫu cho căn có chủ / cho thuê nhưng chưa có cư dân ----------
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ'];
const MIDDLE = ['Văn', 'Thị', 'Minh', 'Thu', 'Quốc', 'Ngọc', 'Hữu', 'Thanh'];
const FIRST = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Lan', 'Long', 'Mai', 'Nam', 'Phúc', 'Quân', 'Thảo', 'Trang', 'Tuấn'];
async function seedOwners() {
  const empty = [];
  for (const a of await Apartment.collection.find({ status: { $in: ['OWNED', 'RENTED'] } }, { projection: { code: 1, handoverDate: 1 } }).toArray()) {
    if (!(await Resident.collection.countDocuments({ apartmentId: a._id }))) empty.push(a);
  }
  note('Căn có chủ / cho thuê chưa có cư dân → tạo chủ hộ mẫu', empty.length);
  if (!APPLY) return;
  for (const [n, a] of empty.entries()) {
    // SĐT / email cố định theo mã căn để chạy lại không tạo trùng
    const digits = String([...String(a.code)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100000000, 7)).padStart(8, '0');
    const phone = `09${digits}`;
    let user = await User.findOne({ phone }).select('_id').lean();
    if (!user) {
      user = await User.create({
        fullName: `${LAST[n % LAST.length]} ${MIDDLE[(n * 3) % MIDDLE.length]} ${FIRST[(n * 7) % FIRST.length]}`,
        phone,
        email: `chuho.${String(a.code).toLowerCase().replace(/[^a-z0-9]/g, '')}@sapms.test`,
        role: 'RESIDENT',
        activatedAt: null, // chờ kích hoạt (UC11)
      });
    }
    await Resident.create({ userId: user._id, apartmentId: a._id, relationType: 'OWNER', moveInDate: a.handoverDate ?? new Date('2025-01-01'), isActive: true });
    payerCache.delete(String(a._id));
    await Invoice.collection.updateMany({ apartmentId: a._id, payerId: { $in: [null, undefined] } }, { $set: { payerId: user._id } });
  }
}

await connectDB();
await seedOwners();
await fixInvoices();
await fixPayments();
await fixDebts();
await fixAudit();
await fillDefaults();
await featureData();
console.log(APPLY ? 'ĐÃ ÁP DỤNG:' : 'KẾ HOẠCH (chưa ghi, thêm --apply để ghi):');
console.log(plan.length ? plan.map((p) => `  - ${p}`).join('\n') : '  Không có gì cần sửa');
await mongoose.disconnect();
