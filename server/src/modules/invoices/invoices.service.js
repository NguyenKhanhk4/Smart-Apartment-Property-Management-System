// UC-B02 — Sinh hóa đơn tháng: xem trước, sinh thủ công 1 căn / cả đợt, và phần lõi dùng chung với cron.
// Mỗi căn 1 hóa đơn/kỳ (BR-F2), đơn giá snapshot vào dòng hóa đơn (BR-F3), phí tiện ích gắn invoiceId để không tính 2 lần.
import mongoose from 'mongoose';
import {
  AMENITY_PASS_STATUS,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  BOOKING_BILLABLE_STATUSES,
  CONFIG_KEYS,
  CRON_JOBS,
  CRON_TRIGGERS,
  GENERATED_BY,
  INVOICE_PREVIEW_STATUS as PREVIEW_STATUS,
  INVOICE_STATUS,
  NOTIFICATION_TYPES,
  VISIT_STATUS,
} from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { AmenityPass, AmenityVisit, Apartment, Booking, Invoice, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex } from '../../utils/pagination.js';
import { DAY_MS, fmtDateVn, periodLabel, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';
import { getPriceTable } from '../feeTypes/feeTypes.queries.js';
import { buildInvoiceDraft } from './invoices.builder.js';

const MAX_ATTEMPTS = 3;
const isDuplicateOn = (err, field) => err?.code === 11000 && Boolean(err.keyPattern?.[field] ?? err.keyValue?.[field]);
const ACTIVE_INVOICE = { $ne: INVOICE_STATUS.CANCELLED };

/** Hóa đơn chỉ lập tới kỳ hiện tại: phí tiện ích kỳ trước phải chốt xong mới gộp được */
function assertBillablePeriod(period, now) {
  if (period > vnPeriod(now)) throw ApiError.badRequest(`Chỉ lập hóa đơn tới kỳ hiện tại (${periodLabel(vnPeriod(now))})`);
}

const loadApartments = (filter) =>
  Apartment.find(filter).populate('buildingId', 'code name').sort({ buildingId: 1, code: 1 }).lean();

/** Mã hóa đơn: mã gốc, hoặc thêm hậu tố -R1, -R2... khi kỳ đó từng có hóa đơn đã hủy (code unique toàn cục) */
async function nextInvoiceCode(base) {
  const used = await Invoice.find({ code: { $regex: `^${escapeRegex(base)}(-R\\d+)?$` } })
    .select('code')
    .lean();
  if (!used.length) return base;
  const max = Math.max(0, ...used.map((i) => Number(i.code.match(/-R(\d+)$/)?.[1] ?? 0)));
  return `${base}-R${max + 1}`;
}

/**
 * Lưu bản nháp: gắn invoiceId cho bản ghi tiện ích (chỉ khi còn chưa gộp và còn hiệu lực — cùng điều kiện Module D dùng khi hủy,
 * nên hai bên chỉ một bên thắng) rồi tạo hóa đơn, trong cùng transaction.
 */
async function persistInvoice(draft, { now, dueDate, generatedBy }) {
  const code = await nextInvoiceCode(draft.code);
  const invoiceId = new mongoose.Types.ObjectId();
  const targets = [
    [AmenityPass, draft.charges.passIds, AMENITY_PASS_STATUS.ACTIVE],
    [AmenityVisit, draft.charges.visitIds, VISIT_STATUS.VALID],
    [Booking, draft.charges.bookingIds, { $in: BOOKING_BILLABLE_STATUSES }],
  ].filter(([, ids]) => ids.length);

  return withTransaction(async (session) => {
    const marked = [];
    try {
      for (const [Model, ids, status] of targets) {
        const { modifiedCount } = await Model.updateMany(
          { _id: { $in: ids }, invoiceId: null, status },
          { $set: { invoiceId } },
          { session },
        );
        marked.push(Model);
        // Có bản ghi vừa bị hủy / gộp đồng thời → tính lại căn này
        if (modifiedCount !== ids.length) throw new ApiError('CONCURRENT_UPDATE');
      }
      const [invoice] = await Invoice.create(
        [
          {
            _id: invoiceId,
            code,
            apartmentId: draft.apartmentId,
            buildingId: draft.buildingId,
            payerId: draft.payer.userId,
            period: draft.period,
            items: draft.items,
            totalAmount: draft.totalAmount,
            status: INVOICE_STATUS.UNPAID,
            issuedAt: now,
            dueDate,
            generatedBy,
          },
        ],
        { session },
      );
      return invoice.toObject();
    } catch (err) {
      // MongoDB standalone không rollback được → tự gỡ invoiceId đã gắn để lần thử lại / lần sinh sau gộp được
      if (!session) await Promise.all(marked.map((M) => M.updateMany({ invoiceId }, { $set: { invoiceId: null } })));
      throw err;
    }
  });
}

/** Tính + lưu hóa đơn 1 căn, thử lại khi dữ liệu tiện ích đổi đồng thời hoặc trùng mã hậu tố */
async function generateOne(apartment, period, prices, opts) {
  for (let attempt = 1; ; attempt += 1) {
    const draft = await buildInvoiceDraft(apartment, period, prices);
    if (!draft.payer) return { status: PREVIEW_STATUS.NO_PAYER };
    try {
      return { status: PREVIEW_STATUS.NEW, invoice: await persistInvoice(draft, opts) };
    } catch (err) {
      if (isDuplicateOn(err, 'apartmentId')) return { status: PREVIEW_STATUS.EXISTS }; // instance khác vừa lập (BR-F2)
      const retriable = err.errorCode === 'CONCURRENT_UPDATE' || isDuplicateOn(err, 'code');
      if (!retriable || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

async function notifyPayers(invoices) {
  for (const inv of invoices) {
    await notify(inv.payerId, {
      type: NOTIFICATION_TYPES.INVOICE,
      title: `Hóa đơn tháng ${periodLabel(inv.period)}`,
      content: `Hóa đơn ${inv.code}: ${formatVnd(inv.totalAmount)}. Hạn thanh toán ${fmtDateVn(inv.dueDate)}.`,
      refId: inv._id,
      link: null, // chưa có trang hóa đơn cho cư dân (Module B) — thêm link khi có trang
      email: true,
    }).catch((err) => console.error(`[invoice] gửi thông báo ${inv.code} lỗi:`, err));
  }
}

const auditGenerated = (user, metadata, targetId = null) =>
  logAudit({ action: AUDIT_ACTIONS.INVOICE_GENERATED, user, targetType: AUDIT_TARGETS.INVOICE, targetId, metadata });

async function generationContext(period, now) {
  const [prices, termDays] = await Promise.all([getPriceTable(period), getConfig(CONFIG_KEYS.PAYMENT_TERM_DAYS)]);
  return { prices, opts: { now, dueDate: new Date(now.getTime() + termDays * DAY_MS) } };
}

/**
 * Lõi sinh hóa đơn cả đợt cho kỳ `period` (cron và nút thủ công).
 * Một căn lỗi không làm hỏng cả đợt: gom lỗi vào `failed`, các căn khác vẫn được lập.
 * Chạy lại an toàn: căn đã có hóa đơn kỳ này được bỏ qua.
 */
export async function generateForPeriod({ period = vnPeriod(), now = new Date(), user = null } = {}) {
  const generatedBy = user ? GENERATED_BY.MANUAL : GENERATED_BY.CRON;
  const { prices, opts } = await generationContext(period, now);
  const apartments = await loadApartments({});
  const billed = new Set(
    (await Invoice.find({ period, status: ACTIVE_INVOICE }).select('apartmentId').lean()).map((i) => String(i.apartmentId)),
  );

  const summary = { period, totalApartments: apartments.length, created: 0, existing: 0, noPayer: 0, totalAmount: 0, failed: [] };
  const createdInvoices = [];
  for (const apt of apartments) {
    if (billed.has(String(apt._id))) {
      summary.existing += 1;
      continue;
    }
    try {
      const r = await generateOne(apt, period, prices, { ...opts, generatedBy });
      if (r.status === PREVIEW_STATUS.NO_PAYER) summary.noPayer += 1;
      else if (r.status === PREVIEW_STATUS.EXISTS) summary.existing += 1;
      else {
        summary.created += 1;
        summary.totalAmount += r.invoice.totalAmount;
        createdInvoices.push(r.invoice);
      }
    } catch (err) {
      console.error(`[invoice] lập hóa đơn ${apt.buildingId.code}-${apt.code} kỳ ${period} lỗi:`, err);
      summary.failed.push({ apartmentId: apt._id, apartment: `${apt.buildingId.code}-${apt.code}`, message: err.message });
    }
  }

  if (summary.created || summary.failed.length) {
    await auditGenerated(user, { period, generatedBy, created: summary.created, totalAmount: summary.totalAmount, failed: summary.failed.length });
  }
  await notifyPayers(createdInvoices);
  return summary;
}

/** Có căn lỗi → throw để cron_runs ghi FAILED kèm danh sách căn lỗi (các căn khác vẫn đã có hóa đơn) */
/** Kết quả cho runTrackedJob: số hóa đơn đã lập + căn lỗi (cron_runs ghi FAILED nhưng vẫn giữ số đã lập) */
export const toJobResult = (summary) => ({
  affectedCount: summary.created,
  failed: summary.failed.map((f) => ({ message: `${f.apartment} (${f.message})` })),
});

/** Kế toán bấm sinh cả đợt: chạy như cron (ghi cron_runs, trigger MANUAL), trả kèm thống kê */
export async function generateBatch(user, { period }, { now = new Date() } = {}) {
  assertBillablePeriod(period, now);
  let summary = null;
  const run = await runTrackedJob(
    CRON_JOBS.INVOICE_GENERATE,
    async () => {
      summary = await generateForPeriod({ period, now, user });
      return toJobResult(summary);
    },
    { trigger: CRON_TRIGGERS.MANUAL },
  );
  return { run, summary };
}

/** Sinh hóa đơn 1 căn (căn mới bàn giao giữa kỳ, hoặc lập lại sau khi hóa đơn cũ bị hủy) */
export async function generateForApartment(user, { period, apartmentId }, { now = new Date() } = {}) {
  assertBillablePeriod(period, now);
  const [apt] = await loadApartments({ _id: apartmentId });
  if (!apt) throw ApiError.notFound('Không tìm thấy căn hộ');
  if (await Invoice.exists({ apartmentId, period, status: ACTIVE_INVOICE })) throw new ApiError('INVOICE_ALREADY_EXISTS');

  const { prices, opts } = await generationContext(period, now);
  const r = await generateOne(apt, period, prices, { ...opts, generatedBy: GENERATED_BY.MANUAL });
  if (r.status === PREVIEW_STATUS.EXISTS) throw new ApiError('INVOICE_ALREADY_EXISTS');
  if (r.status === PREVIEW_STATUS.NO_PAYER) {
    throw ApiError.badRequest(`Căn ${apt.code} chưa có hợp đồng mua bán hiệu lực đầu kỳ ${periodLabel(period)}, không lập được hóa đơn`);
  }

  await auditGenerated(
    user,
    { period, generatedBy: GENERATED_BY.MANUAL, code: r.invoice.code, apartmentId, totalAmount: r.invoice.totalAmount },
    r.invoice._id,
  );
  await notifyPayers([r.invoice]);
  return r.invoice;
}

/**
 * Tính thử hóa đơn kỳ `period` (không ghi gì). Có apartmentId → 1 căn; có buildingId → 1 tòa; không có → toàn bộ.
 * Mỗi dòng: trạng thái NEW / EXISTS / NO_PAYER / ERROR, các dòng phí dự kiến, người trả.
 */
export async function previewInvoices({ period, apartmentId, buildingId }) {
  const filter = {};
  if (apartmentId) filter._id = apartmentId;
  if (buildingId) filter.buildingId = buildingId;
  const [apartments, prices, existingInvoices] = await Promise.all([
    loadApartments(filter),
    getPriceTable(period),
    Invoice.find({ period, status: ACTIVE_INVOICE, ...(apartmentId && { apartmentId }), ...(buildingId && { buildingId }) })
      .select('code apartmentId status totalAmount generatedBy issuedAt')
      .lean(),
  ]);
  if (apartmentId && !apartments.length) throw ApiError.notFound('Không tìm thấy căn hộ');
  const existing = new Map(existingInvoices.map((i) => [String(i.apartmentId), i]));

  const rows = [];
  for (const apt of apartments) {
    const base = {
      apartmentId: apt._id,
      apartmentCode: apt.code,
      buildingId: apt.buildingId._id,
      buildingCode: apt.buildingId.code,
      buildingName: apt.buildingId.name,
      area: apt.area,
    };
    const inv = existing.get(String(apt._id));
    if (inv) {
      rows.push({ ...base, status: PREVIEW_STATUS.EXISTS, code: inv.code, invoice: inv, items: [], totalAmount: inv.totalAmount });
      continue;
    }
    try {
      const d = await buildInvoiceDraft(apt, period, prices);
      rows.push({
        ...base,
        status: d.payer ? PREVIEW_STATUS.NEW : PREVIEW_STATUS.NO_PAYER,
        code: d.code,
        payer: d.payer && { userId: d.payer.userId, source: d.payer.source },
        items: d.items,
        totalAmount: d.totalAmount,
      });
    } catch (err) {
      rows.push({ ...base, status: PREVIEW_STATUS.ERROR, error: err.message, items: [], totalAmount: 0 });
    }
  }

  // Tên người trả: 1 truy vấn cho cả danh sách
  const payerIds = [...new Set(rows.map((r) => r.payer?.userId).filter(Boolean).map(String))];
  const names = new Map(
    (await User.find({ _id: { $in: payerIds } }).select('fullName').lean()).map((u) => [String(u._id), u.fullName]),
  );
  for (const r of rows) if (r.payer) r.payer.fullName = names.get(String(r.payer.userId)) ?? null;

  const count = (s) => rows.filter((r) => r.status === s).length;
  const fresh = rows.filter((r) => r.status === PREVIEW_STATUS.NEW);
  return {
    period,
    prices: [...prices.values()].map(({ _id, code, name, feeCategory, calcMethod, vehicleType, unitPrice }) => ({
      _id,
      code,
      name,
      feeCategory,
      calcMethod,
      vehicleType,
      unitPrice,
    })),
    summary: {
      totalApartments: rows.length,
      new: fresh.length,
      existing: count(PREVIEW_STATUS.EXISTS),
      noPayer: count(PREVIEW_STATUS.NO_PAYER),
      error: count(PREVIEW_STATUS.ERROR),
      totalAmount: fresh.reduce((s, r) => s + r.totalAmount, 0),
    },
    rows,
  };
}
