// Mô đun 4 — UC26 (Trình duyệt), UC27 (Duyệt & Phát hành), UC36 (Trả lại).
//   Kế toán: DRAFT → PENDING_APPROVAL, báo Trưởng BQL.
//   Trưởng BQL: PENDING_APPROVAL → UNPAID (đặt ngày phát hành, hạn đóng, chụp "Nợ các kỳ trước", trừ Số dư trả trước,
//               gửi Email + Web cho Người nộp phí) hoặc → DRAFT kèm lý do, báo Kế toán.
// Chọn theo danh sách id hoặc cả kỳ. Mỗi thông báo cập nhật có điều kiện status nên 2 người bấm cùng lúc không xử lý 2 lần;
// thông báo không đúng trạng thái bị bỏ qua và trả về trong `skipped`.
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  INVOICE_OUTSTANDING_STATUSES,
  INVOICE_STATUS,
  NOTIFICATION_TYPES,
  PREPAID_TX_TYPES,
} from '../../constants/enums.js';
import { Invoice, PrepaidBalance, PrepaidTransaction } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { DAY_MS, fmtDateVn, periodLabel } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';

const { DRAFT, PENDING_APPROVAL, UNPAID, PARTIALLY_PAID, PAID } = INVOICE_STATUS;
const MAX_PREPAID_ATTEMPTS = 3;

const audit = (action, user, invoice, metadata, session = null) =>
  logAudit(
    { action, user, targetType: AUDIT_TARGETS.INVOICE, targetId: invoice._id, metadata: { code: invoice.code, ...metadata } },
    { session },
  );

/** Lấy các thông báo cần xử lý theo id hoặc cả kỳ; id không đúng trạng thái → skipped */
async function selectInvoices({ invoiceIds, period }, status) {
  const filter = invoiceIds ? { _id: { $in: invoiceIds } } : { period, status };
  const found = await Invoice.find(filter).sort({ code: 1 }).lean();
  if (invoiceIds && !found.length) throw ApiError.notFound('Không tìm thấy thông báo phí');
  const skipped = [];
  const targets = [];
  for (const inv of found) {
    if (inv.status === status) targets.push(inv);
    else skipped.push({ invoiceId: inv._id, code: inv.code, status: inv.status });
  }
  return { targets, skipped };
}

const periodsOf = (invoices) => [...new Set(invoices.map((i) => i.period))].sort().map(periodLabel).join(', ');

// ---------------------------------------------------------------------------
// Trình duyệt (Kế toán)
// ---------------------------------------------------------------------------
export async function submitInvoices(user, selector, { now = new Date() } = {}) {
  const { targets, skipped } = await selectInvoices(selector, DRAFT);
  const submitted = [];
  for (const inv of targets) {
    const updated = await Invoice.findOneAndUpdate(
      { _id: inv._id, status: DRAFT },
      { $set: { status: PENDING_APPROVAL, submittedBy: user.id, submittedAt: now } },
      { new: true },
    ).lean();
    if (!updated) {
      skipped.push({ invoiceId: inv._id, code: inv.code, status: 'CHANGED' });
      continue;
    }
    submitted.push(updated);
    await audit(AUDIT_ACTIONS.INVOICE_SUBMITTED, user, inv, { totalAmount: inv.totalAmount });
  }

  if (submitted.length) {
    const total = submitted.reduce((s, i) => s + i.totalAmount, 0);
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.INVOICE_APPROVAL,
      title: `Có ${submitted.length} thông báo phí chờ duyệt`,
      content: `Kế toán trình duyệt ${submitted.length} thông báo phí kỳ ${periodsOf(submitted)}, tổng ${formatVnd(total)}.`,
      link: '/app/invoices?status=PENDING_APPROVAL',
    }).catch((err) => console.error('[invoice] báo Trưởng BQL trình duyệt lỗi:', err));
  }
  return { count: submitted.length, totalAmount: submitted.reduce((s, i) => s + i.totalAmount, 0), skipped };
}

// ---------------------------------------------------------------------------
// Trả lại (Trưởng BQL)
// ---------------------------------------------------------------------------
export async function returnInvoices(user, { reason, ...selector }, { now = new Date() } = {}) {
  const { targets, skipped } = await selectInvoices(selector, PENDING_APPROVAL);
  const returned = [];
  for (const inv of targets) {
    const updated = await Invoice.findOneAndUpdate(
      { _id: inv._id, status: PENDING_APPROVAL },
      { $set: { status: DRAFT, reviewedBy: user.id, returnNote: reason, returnedAt: now } },
      { new: true },
    ).lean();
    if (!updated) {
      skipped.push({ invoiceId: inv._id, code: inv.code, status: 'CHANGED' });
      continue;
    }
    returned.push(updated);
    await audit(AUDIT_ACTIONS.INVOICE_RETURNED, user, inv, { reason });
  }

  if (returned.length) {
    // Báo người đã trình; không rõ người trình thì báo mọi Kế toán
    const submitters = returned.map((i) => i.submittedBy).filter(Boolean);
    const payload = {
      type: NOTIFICATION_TYPES.INVOICE_APPROVAL,
      title: `${returned.length} thông báo phí bị trả lại`,
      content: `Trưởng BQL trả lại ${returned.length} thông báo phí kỳ ${periodsOf(returned)}. Lý do: ${reason}`,
      link: '/app/invoices?status=DRAFT',
    };
    const send = submitters.length ? notify(submitters, payload) : notifyRoles(['ACCOUNTANT'], payload);
    await send.catch((err) => console.error('[invoice] báo Kế toán trả lại lỗi:', err));
  }
  return { count: returned.length, skipped };
}

// ---------------------------------------------------------------------------
// Duyệt & Phát hành (Trưởng BQL)
// ---------------------------------------------------------------------------

/** "Nợ các kỳ trước": tổng còn nợ các thông báo đã phát hành kỳ trước của chính Người nộp phí này tại căn (X1, M4-1) */
async function previousDebtOf(invoice) {
  const [row] = await Invoice.aggregate([
    {
      $match: {
        apartmentId: invoice.apartmentId,
        payerId: invoice.payerId,
        period: { $lt: invoice.period },
        status: { $in: [...INVOICE_OUTSTANDING_STATUSES] },
      },
    },
    { $group: { _id: null, debt: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } } } },
  ]);
  return Math.max(0, row?.debt ?? 0);
}

/** Trừ Số dư trả trước (tối đa `max`), ghi sổ APPLY. Trả về số đã trừ. $inc có điều kiện nên không bao giờ âm. */
async function applyPrepaid(invoice, max, session) {
  if (max <= 0 || !invoice.payerId) return 0;
  for (let attempt = 1; attempt <= MAX_PREPAID_ATTEMPTS; attempt += 1) {
    const bal = await PrepaidBalance.findOne({ apartmentId: invoice.apartmentId, payerId: invoice.payerId })
      .session(session)
      .lean();
    const amount = Math.min(bal?.balance ?? 0, max);
    if (amount <= 0) return 0;
    const updated = await PrepaidBalance.findOneAndUpdate(
      { _id: bal._id, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true, session },
    ).lean();
    if (!updated) continue; // số dư vừa đổi (đang thu tiền / phát hành song song) → đọc lại
    await PrepaidTransaction.create(
      [
        {
          apartmentId: invoice.apartmentId,
          payerId: invoice.payerId,
          type: PREPAID_TX_TYPES.APPLY,
          amount,
          balanceAfter: updated.balance,
          invoiceId: invoice._id,
          note: `Trừ vào thông báo phí ${invoice.code}`,
        },
      ],
      { session },
    );
    return amount;
  }
  return 0; // tranh chấp liên tục: phát hành không trừ, cư dân vẫn còn nguyên số dư cho kỳ sau
}

async function publishOne(user, invoice, { now, dueDate }) {
  const previousDebt = await previousDebtOf(invoice);

  return withTransaction(async (session) => {
    // Giành quyền xử lý trước: ai đổi trạng thái thành công mới được trừ số dư
    const claimed = await Invoice.findOneAndUpdate(
      { _id: invoice._id, status: PENDING_APPROVAL },
      { $set: { status: UNPAID, reviewedBy: user.id, issuedAt: now, dueDate, previousDebt, returnNote: null } },
      { new: true, session },
    ).lean();
    if (!claimed) return null;

    const applied = await applyPrepaid(claimed, claimed.totalAmount - (claimed.paidAmount ?? 0), session);
    const paidAmount = claimed.paidAmount + applied;
    let status = UNPAID;
    if (paidAmount >= claimed.totalAmount) status = PAID;
    else if (paidAmount > 0) status = PARTIALLY_PAID;

    const published = await Invoice.findOneAndUpdate(
      { _id: claimed._id },
      {
        $set: { status, paidAmount, prepaidApplied: claimed.prepaidApplied + applied, ...(status === PAID && { paidAt: now }) },
      },
      { new: true, session },
    ).lean();
    await audit(
      AUDIT_ACTIONS.INVOICE_PUBLISHED,
      user,
      invoice,
      { totalAmount: invoice.totalAmount, prepaidApplied: applied, previousDebt, dueDate },
      session,
    );
    return published;
  });
}

function notifyPayer(inv) {
  const outstanding = inv.totalAmount - (inv.paidAmount ?? 0);
  const lines = [`Thông báo phí ${inv.code}: ${formatVnd(inv.totalAmount)}.`];
  if (inv.prepaidApplied) lines.push(`Đã trừ Số dư trả trước ${formatVnd(inv.prepaidApplied)}.`);
  lines.push(
    outstanding > 0
      ? `Cần thanh toán ${formatVnd(outstanding)}, hạn ${fmtDateVn(inv.dueDate)}.`
      : 'Thông báo đã được thanh toán đủ từ Số dư trả trước.',
  );
  if (inv.previousDebt) lines.push(`Nợ các kỳ trước chưa thanh toán: ${formatVnd(inv.previousDebt)}.`);
  return notify(inv.payerId, {
    type: NOTIFICATION_TYPES.INVOICE,
    title: `Thông báo phí tháng ${periodLabel(inv.period)}`,
    content: lines.join('\n'),
    refId: inv._id,
    link: `/r/invoices/${inv._id}`,
    email: true,
  }).catch((err) => console.error(`[invoice] gửi thông báo ${inv.code} lỗi:`, err));
}

export async function publishInvoices(user, selector, { now = new Date() } = {}) {
  const { targets, skipped } = await selectInvoices(selector, PENDING_APPROVAL);
  const termDays = await getConfig(CONFIG_KEYS.PAYMENT_TERM_DAYS);
  const dueDate = new Date(now.getTime() + termDays * DAY_MS);

  const published = [];
  const failed = [];
  for (const inv of targets) {
    try {
      const done = await publishOne(user, inv, { now, dueDate });
      if (done) published.push(done);
      else skipped.push({ invoiceId: inv._id, code: inv.code, status: 'CHANGED' });
    } catch (err) {
      console.error(`[invoice] phát hành ${inv.code} lỗi:`, err);
      failed.push({ invoiceId: inv._id, code: inv.code, message: err.message });
    }
  }

  // Gửi sau transaction (transaction có thể chạy lại → gửi trùng)
  for (const inv of published) await notifyPayer(inv);

  return {
    count: published.length,
    totalAmount: published.reduce((s, i) => s + i.totalAmount, 0),
    prepaidApplied: published.reduce((s, i) => s + i.prepaidApplied, 0),
    paidByPrepaid: published.filter((i) => i.status === PAID).length,
    dueDate,
    skipped,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Cron (X8): chờ duyệt quá N ngày → nhắc Trưởng BQL mỗi ngày; không tự duyệt
// ---------------------------------------------------------------------------
export async function remindPendingApprovals(now = new Date()) {
  const days = await getConfig(CONFIG_KEYS.INVOICE_APPROVAL_REMIND_DAYS);
  const stale = await Invoice.find({ status: PENDING_APPROVAL, submittedAt: { $lte: new Date(now.getTime() - days * DAY_MS) } })
    .select('period')
    .lean();
  if (!stale.length) return 0;
  return notifyRoles(['MANAGER'], {
    type: NOTIFICATION_TYPES.INVOICE_APPROVAL,
    title: `${stale.length} thông báo phí chờ duyệt quá ${days} ngày`,
    content: `Có ${stale.length} thông báo phí kỳ ${periodsOf(stale)} đã trình duyệt hơn ${days} ngày. Vào danh sách thông báo phí để Duyệt & Phát hành hoặc Trả lại.`,
    link: '/app/invoices?status=PENDING_APPROVAL',
  });
}
