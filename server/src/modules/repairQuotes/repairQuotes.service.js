// Mô đun 5 (phần Người 3) — UC48 Báo giá sửa chữa trong căn hộ, UC40 Người nộp phí đồng ý / từ chối.
//   • Kỹ thuật viên được giao phiếu sự cố trong căn gửi báo giá (hạng mục + chi phí dự kiến) → phiếu Chờ đồng ý phí,
//     báo Người nộp phí (Web + Email). Người nộp phí quyết định qua PATCH /tickets/:id/quote-decision (Người 4).
//   • Đang xử lý mà phát sinh thêm: gửi báo giá lại. Không vượt QUOTE_REAPPROVAL_PERCENT% số đã đồng ý → tự áp dụng, chỉ báo
//     cho Người nộp phí; vượt → phiếu quay lại Chờ đồng ý phí để duyệt lại (M5-3).
//   • Không phản hồi: nhắc sau QUOTE_REMIND_DAYS ngày, tự đóng phiếu (Từ chối) sau QUOTE_AUTO_CLOSE_DAYS ngày (X8).
//   • Phiếu Đã nghiệm thu (CLOSED) → bản ACCEPTED được tính vào thông báo phí kỳ sau (invoices.builder → collectRepairCharges).
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  NOTIFICATION_TYPES,
  QUOTE_STATUS,
  ROLES,
  TICKET_FINAL_STATUSES,
  TICKET_HISTORY_ACTIONS as ACT,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums.js';
import { isRole } from '../../middlewares/authorize.js';
import { RepairQuote, Ticket } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyApartment } from '../../services/notification.service.js';
import { getActiveApartmentIds } from '../../services/residency.service.js';
import { getConfig, getConfigs } from '../../services/systemConfig.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextMonthlyCode, retryOnDuplicate } from '../../utils/codeGenerator.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS, HOUR_MS } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { applySlaTransition, quoteResumeStatus } from '../tickets/ticket.rules.js';

const { ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS, REJECTED } = TICKET_STATUS;
const { PENDING, ACCEPTED, DECLINED, EXPIRED, SUPERSEDED } = QUOTE_STATUS;

const partsPauseMs = async () => Number(await getConfig(CONFIG_KEYS.TICKET_PARTS_PAUSE_HOURS)) * HOUR_MS;

const residentLink = (ticket) => `/r/tickets/${ticket._id}`;
const staffLink = (ticket) => `/app/tickets/${ticket._id}`;

/** Báo cho Người nộp phí; căn chưa có hợp đồng (payerId null) thì báo cư dân đang ở căn (giống quy tắc quyết định của Người 4) */
const notifyPayer = (quote, payload) =>
  quote.payerId ? notify(quote.payerId, payload) : notifyApartment(quote.apartmentId, payload);

const summaryOf = (items) => items.map((i) => `• ${i.description}: ${formatVnd(i.amount)}`).join('\n');

const toItems = (items) =>
  items.map((i) => ({
    description: i.description.trim(),
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    amount: Math.round(i.quantity * i.unitPrice),
  }));

// ---------------------------------------------------------------------------
// Kỹ thuật viên gửi báo giá / báo giá lại
// ---------------------------------------------------------------------------
/**
 * body: { ticketId, items: [{ description, quantity, unitPrice }], note? }.
 * Phiếu Đã nhận → gửi báo giá đầu tiên. Đang chờ đồng ý → thay bản đang chờ (đếm lại thời hạn).
 * Đang xử lý / Chờ linh kiện (đã đồng ý trước đó) → báo giá lại theo ngưỡng %.
 * Trả về { quote, ticketStatus, needsApproval }.
 */
export async function submitQuote(user, { ticketId, items, note = null }, { now = new Date() } = {}) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Không tìm thấy phiếu sự cố');
  if (String(ticket.assignedTo) !== user.id) throw ApiError.forbidden('Phiếu sự cố không được giao cho bạn');
  if (ticket.type !== TICKET_TYPES.INCIDENT || ticket.scope !== TICKET_SCOPES.IN_APARTMENT) {
    throw ApiError.badRequest('Chỉ sự cố trong căn hộ mới cần báo giá cho Người nộp phí');
  }
  if (TICKET_FINAL_STATUSES.includes(ticket.status)) throw new ApiError('TICKET_ALREADY_CLOSED');
  if (![ASSIGNED, WAITING_QUOTE_APPROVAL, IN_PROGRESS, WAITING_PARTS].includes(ticket.status)) {
    throw ApiError.badRequest('Phiếu đang ở trạng thái không gửi báo giá được');
  }

  const lines = toItems(items);
  const totalAmount = lines.reduce((s, i) => s + i.amount, 0);
  if (totalAmount <= 0) throw ApiError.badRequest('Tổng chi phí báo giá phải lớn hơn 0');

  const [accepted, last, payer, percent, partsMs] = await Promise.all([
    RepairQuote.findOne({ ticketId, status: ACCEPTED }).sort({ version: -1 }).lean(),
    RepairQuote.findOne({ ticketId }).sort({ version: -1 }).select('version').lean(),
    getPayer(ticket.apartmentId, now),
    getConfig(CONFIG_KEYS.QUOTE_REAPPROVAL_PERCENT),
    partsPauseMs(),
  ]);

  // Đang làm mà chưa có báo giá đã đồng ý nào (dữ liệu cũ) → coi như báo giá mới, cần đồng ý
  const revising = [IN_PROGRESS, WAITING_PARTS].includes(ticket.status);
  const limit = accepted ? Math.floor(accepted.totalAmount * (1 + Number(percent) / 100)) : 0;
  const withinLimit = revising && accepted && totalAmount <= limit;
  const needsApproval = !withinLimit;

  const fromStatus = ticket.status;
  const quote = await retryOnDuplicate(async () => {
    const code = await nextMonthlyCode(RepairQuote, 'BG', { date: now });
    return withTransaction(async (session) => {
      // Bản đang chờ (nếu có) bị thay bằng bản mới
      await RepairQuote.updateMany({ ticketId, status: PENDING }, { $set: { status: SUPERSEDED } }, { session });
      if (withinLimit) {
        await RepairQuote.updateOne({ _id: accepted._id, status: ACCEPTED }, { $set: { status: SUPERSEDED } }, { session });
      }
      const [doc] = await RepairQuote.create(
        [
          {
            code,
            ticketId,
            version: (last?.version ?? 0) + 1,
            apartmentId: ticket.apartmentId,
            buildingId: ticket.buildingId ?? null,
            payerId: payer?.userId ?? null,
            items: lines,
            totalAmount,
            note,
            previousAmount: accepted?.totalAmount ?? null,
            status: withinLimit ? ACCEPTED : PENDING,
            autoAccepted: Boolean(withinLimit),
            createdBy: user.id,
            sentAt: now,
            ...(withinLimit && { decidedAt: now }),
          },
        ],
        { session },
      );

      if (needsApproval && ticket.status !== WAITING_QUOTE_APPROVAL) {
        applySlaTransition(ticket, WAITING_QUOTE_APPROVAL, now, partsMs); // M5-2: SLA dừng khi chờ cư dân đồng ý phí
        ticket.status = WAITING_QUOTE_APPROVAL;
      }
      ticket.history.push({
        at: now,
        by: user.id,
        action: withinLimit ? ACT.QUOTE_REVISED : ACT.QUOTE_REQUESTED,
        fromStatus,
        toStatus: ticket.status,
        note: `Báo giá ${code}: ${formatVnd(totalAmount)}${
          accepted && revising ? ` (đã đồng ý ${formatVnd(accepted.totalAmount)}${withinLimit ? `, trong ngưỡng ${percent}%` : `, vượt ${percent}% cần duyệt lại`})` : ''
        }`,
      });
      await ticket.save({ session });
      return doc.toObject();
    });
  });

  await logAudit({
    action: AUDIT_ACTIONS.REPAIR_QUOTE_SUBMITTED,
    user,
    targetType: AUDIT_TARGETS.REPAIR_QUOTE,
    targetId: quote._id,
    metadata: { code: quote.code, ticket: ticket.code, totalAmount, version: quote.version, autoAccepted: quote.autoAccepted },
  });

  const content = needsApproval
    ? `Kỹ thuật viên gửi báo giá sửa chữa "${ticket.title}" (${ticket.code}), tổng ${formatVnd(totalAmount)}:\n${summaryOf(lines)}\n` +
      'Người nộp phí vui lòng vào chi tiết sự cố để Đồng ý hoặc Từ chối. Chi phí được tính vào thông báo phí kỳ sau khi nghiệm thu.'
    : `Chi phí sửa chữa "${ticket.title}" (${ticket.code}) cập nhật từ ${formatVnd(accepted.totalAmount)} thành ${formatVnd(totalAmount)} ` +
      `(trong mức ${percent}% đã đồng ý, không cần duyệt lại):\n${summaryOf(lines)}`;
  await notifyPayer(quote, {
    type: NOTIFICATION_TYPES.TICKET,
    title: needsApproval ? `Báo giá sửa chữa ${ticket.code}: ${formatVnd(totalAmount)}` : `Cập nhật chi phí sửa chữa ${ticket.code}`,
    content,
    refId: ticket._id,
    link: residentLink(ticket),
    email: true,
  });
  return { quote, ticketStatus: ticket.status, needsApproval };
}

// ---------------------------------------------------------------------------
// Quyết định của Người nộp phí — gọi từ tickets.service.decideQuote (Người 4), trong cùng lần lưu phiếu
// ---------------------------------------------------------------------------
/** Ghi quyết định lên báo giá đang chờ; đồng ý thì bản đã đồng ý trước đó (nếu có) bị thay thế. Trả về báo giá đã cập nhật */
export async function recordQuoteDecision(ticketId, { accepted, note = null, userId, now = new Date() }) {
  const pending = await RepairQuote.findOneAndUpdate(
    { ticketId, status: PENDING },
    { $set: { status: accepted ? ACCEPTED : DECLINED, decidedAt: now, decidedBy: userId, decisionNote: note } },
    { new: true },
  ).lean();
  if (pending && accepted) {
    await RepairQuote.updateMany(
      { ticketId, status: ACCEPTED, _id: { $ne: pending._id } },
      { $set: { status: SUPERSEDED } },
    );
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Xem
// ---------------------------------------------------------------------------
const DISPATCH = ['MANAGER', 'STAFF:RECEPTIONIST', 'ACCOUNTANT'];

/** Các phiên bản báo giá của 1 phiếu (mới nhất trước). Quyền xem giống phiếu: điều phối, Kế toán, KTV được giao, cư dân của căn */
export async function listTicketQuotes(user, ticketId) {
  const ticket = await Ticket.findById(ticketId).select('apartmentId assignedTo').lean();
  if (!ticket) throw ApiError.notFound('Không tìm thấy phiếu sự cố');
  let allowed = isRole(user, ...DISPATCH) || (isRole(user, 'STAFF:TECHNICIAN') && String(ticket.assignedTo) === user.id);
  if (!allowed && user.role === ROLES.RESIDENT) {
    allowed = (await getActiveApartmentIds(user.id)).includes(String(ticket.apartmentId));
  }
  if (!allowed) throw ApiError.forbidden('Bạn không có quyền xem báo giá của phiếu này');

  const [items, cfg] = await Promise.all([
    RepairQuote.find({ ticketId })
      .sort({ version: -1 })
      .populate([
        { path: 'createdBy', select: 'fullName' },
        { path: 'decidedBy', select: 'fullName' },
        { path: 'payerId', select: 'fullName' },
        { path: 'invoiceId', select: 'code period status' },
      ])
      .lean(),
    getConfigs([CONFIG_KEYS.QUOTE_REAPPROVAL_PERCENT, CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS]),
  ]);
  const autoCloseDays = Number(cfg[CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS]);
  return {
    items: items.map((q) => ({
      ...q,
      expiresAt: q.status === PENDING ? new Date(new Date(q.sentAt).getTime() + autoCloseDays * DAY_MS) : null,
    })),
    reapprovalPercent: Number(cfg[CONFIG_KEYS.QUOTE_REAPPROVAL_PERCENT]),
  };
}

/** Kế toán / Trưởng BQL: danh sách báo giá; billed=false + status=ACCEPTED = chi phí sửa chữa chưa vào thông báo phí */
export async function listQuotes({ status, billed, apartmentId, ...query }) {
  const filter = {};
  if (status?.length) filter.status = { $in: status };
  if (billed === true) filter.invoiceId = { $ne: null };
  if (billed === false) filter.invoiceId = null;
  if (apartmentId) filter.apartmentId = apartmentId;
  return paginate(RepairQuote, filter, { ...query, sort: query.sort ?? '-sentAt' }, {
    populate: [
      { path: 'ticketId', select: 'code title status closedAt' },
      { path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code' } },
      { path: 'payerId', select: 'fullName' },
      { path: 'createdBy', select: 'fullName' },
      { path: 'invoiceId', select: 'code period status' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Cron QUOTE_REMIND — nhắc sau N ngày, tự đóng phiếu sau M ngày (X8)
// ---------------------------------------------------------------------------
async function expireQuote(quote, now, days) {
  const res = await RepairQuote.updateOne({ _id: quote._id, status: PENDING }, { $set: { status: EXPIRED, decidedAt: now } });
  if (!res.modifiedCount) return 0;

  const ticket = await Ticket.findById(quote.ticketId);
  // Bản báo giá lại (đã đồng ý bản trước, M5-3) quá hạn → coi như không đồng ý phần phát sinh, KTV làm tiếp theo báo giá cũ
  if (ticket && ticket.status === WAITING_QUOTE_APPROVAL && ticket.quoteDecision?.accepted === true) {
    const reason = `Quá ${days} ngày Người nộp phí không phản hồi báo giá lại ${quote.code} — tiếp tục theo báo giá đã đồng ý`;
    const to = quoteResumeStatus(ticket);
    applySlaTransition(ticket, to, now, await partsPauseMs());
    ticket.status = to;
    ticket.history.push({ at: now, by: null, action: ACT.QUOTE_EXPIRED, fromStatus: WAITING_QUOTE_APPROVAL, toStatus: to, note: reason });
    await ticket.save();
    await notify(ticket.assignedTo, {
      type: NOTIFICATION_TYPES.TICKET,
      title: `Báo giá lại ${quote.code} hết hạn`,
      content: reason,
      refId: ticket._id,
      link: staffLink(ticket),
    });
  } else if (ticket && ticket.status === WAITING_QUOTE_APPROVAL) {
    const reason = `Quá ${days} ngày Người nộp phí không phản hồi báo giá ${quote.code}`;
    applySlaTransition(ticket, REJECTED, now, 0);
    ticket.status = REJECTED;
    ticket.rejectReason = reason;
    ticket.closedAt = now;
    ticket.quoteDecision = { accepted: false, at: now, by: null, note: reason };
    ticket.history.push({ at: now, by: null, action: ACT.QUOTE_EXPIRED, fromStatus: WAITING_QUOTE_APPROVAL, toStatus: REJECTED, note: reason });
    await ticket.save();
    await Promise.all([
      notifyPayer(quote, {
        type: NOTIFICATION_TYPES.TICKET,
        title: `Sự cố ${ticket.code} đã đóng do không phản hồi báo giá`,
        content: `${reason}. Nếu vẫn cần sửa, vui lòng gửi yêu cầu mới.`,
        refId: ticket._id,
        link: residentLink(ticket),
        email: true,
      }),
      notify(ticket.assignedTo, {
        type: NOTIFICATION_TYPES.TICKET,
        title: `Sự cố ${ticket.code} tự đóng`,
        content: reason,
        refId: ticket._id,
        link: staffLink(ticket),
      }),
    ]);
  }
  return 1;
}

export async function remindQuotes(now = new Date()) {
  const cfg = await getConfigs([CONFIG_KEYS.QUOTE_REMIND_DAYS, CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS]);
  const remindDays = Number(cfg[CONFIG_KEYS.QUOTE_REMIND_DAYS]);
  const closeDays = Number(cfg[CONFIG_KEYS.QUOTE_AUTO_CLOSE_DAYS]);
  const before = (days) => new Date(now.getTime() - days * DAY_MS);

  let affectedCount = 0;
  const failed = [];
  const expiring = await RepairQuote.find({ status: PENDING, sentAt: { $lte: before(closeDays) } }).lean();
  for (const q of expiring) {
    try {
      affectedCount += await expireQuote(q, now, closeDays);
    } catch (err) {
      failed.push({ message: `${q.code}: ${err.message}` });
    }
  }

  const due = await RepairQuote.find({ status: PENDING, remindedAt: null, sentAt: { $lte: before(remindDays) } })
    .populate('ticketId', 'code title')
    .lean();
  for (const q of due) {
    try {
      const res = await RepairQuote.updateOne({ _id: q._id, status: PENDING, remindedAt: null }, { $set: { remindedAt: now } });
      if (!res.modifiedCount) continue;
      affectedCount += 1;
      const deadline = new Date(new Date(q.sentAt).getTime() + closeDays * DAY_MS);
      await notifyPayer(q, {
        type: NOTIFICATION_TYPES.TICKET,
        title: `Nhắc: báo giá sửa chữa ${q.ticketId?.code ?? q.code} đang chờ bạn đồng ý`,
        content:
          `Báo giá ${q.code} cho "${q.ticketId?.title ?? 'sự cố trong căn'}" tổng ${formatVnd(q.totalAmount)} chưa được phản hồi. ` +
          `Nếu không phản hồi trước ${deadline.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}, phiếu sẽ tự đóng.`,
        refId: q.ticketId?._id ?? q.ticketId,
        link: `/r/tickets/${q.ticketId?._id ?? q.ticketId}`,
        email: true,
      });
    } catch (err) {
      failed.push({ message: `${q.code}: ${err.message}` });
    }
  }
  return { affectedCount, failed };
}
