// Mô đun 4 — Quỹ bảo trì 2% (UC33 Kế toán, UC34 Ban quản trị). Hệ thống chỉ theo dõi, quỹ thuộc Ban quản trị.
//   • Kế toán ghi nhận thu quỹ có chứng từ (số dư ban đầu CĐT bàn giao, lãi tiền gửi — M4-7).
//   • Kế toán lập Đề xuất chi (hạng mục, số tiền, báo giá; Kế hoạch bảo trì năm hoặc Đột xuất kèm lý do) → báo Ban quản trị.
//   • Mỗi thành viên Ban quản trị bỏ 1 phiếu kèm ý kiến. Đồng ý > FUND_APPROVAL_RATIO × số thành viên → Đã duyệt;
//     không còn khả năng đạt → Từ chối (báo Trưởng BQL chọn phương án khác — M10-2). Quá N ngày chỉ nhắc, không tự duyệt (X8).
//   • Đã duyệt → Kế toán lập Phiếu chi thực tế kèm hóa đơn, trừ số dư (không cho âm). Sửa chữa lớn: chỉ chi sau khi
//     Trưởng BQL nghiệm thu (M10-3).
//   • UC10: Trưởng BQL duyệt sửa bằng Quỹ → phiếu bảo trì chờ ở "Chờ duyệt sửa". Kế toán lập đề xuất gắn workOrderId (điền sẵn
//     từ báo cáo hư hỏng); kết quả biểu quyết / rút đề xuất báo lại phiếu qua onFundDecision; nghiệm thu làm trên phiếu bảo trì
//     (Q12 → markFundWorkAccepted), sau đó Kế toán mới lập phiếu chi.
import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  FUND_PLAN_TYPES,
  FUND_PROPOSAL_STATUS,
  FUND_TX_TYPES,
  NOTIFICATION_TYPES,
  REPAIR_COST_SOURCES,
  ROLES,
  VOTE_DECISIONS,
  WORK_ORDER_STATUS,
} from '../../constants/enums.js';
import { FundProposal, FundTransaction, MaintenanceFund, User, WorkOrder } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextMonthlyCode, retryOnDuplicate } from '../../utils/codeGenerator.js';
import { paginate } from '../../utils/pagination.js';
import { DAY_MS, fmtDateVn, periodStart, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { formatVnd } from '../amenities/pricing.js';
import { FUND_DECISIONS, assertAwaitingFund, fundPrefill, onFundDecision } from '../workOrders/workOrders.fund.js';

const { PENDING, APPROVED, REJECTED, PAID, CANCELLED } = FUND_PROPOSAL_STATUS;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const proposalLink = (p) => `/app/fund/proposals/${p._id}`;

const audit = (action, user, targetType, targetId, metadata) => logAudit({ action, user, targetType, targetId, metadata });

/** Quỹ chung toàn khu (buildingId null) — tạo nếu chưa có */
export async function getFund(session = null) {
  return MaintenanceFund.findOneAndUpdate(
    { buildingId: null },
    { $setOnInsert: { buildingId: null, name: 'Quỹ bảo trì chung', balance: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session },
  ).lean();
}

/** Thành viên Ban quản trị đang hoạt động (cả Trưởng ban) */
export const boardMembers = () => User.find({ role: ROLES.BOARD, isActive: true }).select('fullName boardTitle email').lean();

/** Tổng số tiền các đề xuất đã duyệt nhưng chưa chi (đã cam kết) */
async function committedAmount(fundId) {
  const [row] = await FundProposal.aggregate([
    { $match: { fundId: oid(fundId), status: APPROVED } },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);
  return row?.amount ?? 0;
}

// ---------------------------------------------------------------------------
// Tổng quan & sổ thu chi
// ---------------------------------------------------------------------------
export async function getOverview({ now = new Date() } = {}) {
  const fund = await getFund();
  const yearStart = periodStart(`${vnPeriod(now).slice(0, 4)}-01`);
  const [totals, committed, pendingCount, threshold] = await Promise.all([
    FundTransaction.aggregate([
      { $match: { fundId: fund._id, occurredAt: { $gte: yearStart } } },
      { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    committedAmount(fund._id),
    FundProposal.countDocuments({ fundId: fund._id, status: PENDING }),
    getConfig(CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD),
  ]);
  const t = Object.fromEntries(totals.map((x) => [x._id, x.amount]));
  return {
    fund,
    balance: fund.balance,
    committed,
    available: fund.balance - committed,
    yearIncome: t[FUND_TX_TYPES.INCOME] ?? 0,
    yearExpense: t[FUND_TX_TYPES.EXPENSE] ?? 0,
    pendingCount,
    lowBalanceThreshold: Number(threshold),
    lowBalance: fund.balance < Number(threshold),
  };
}

export async function listTransactions({ type, from, to, ...query }) {
  const fund = await getFund();
  const filter = { fundId: fund._id };
  if (type) filter.type = type;
  if (from || to) filter.occurredAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  return paginate(FundTransaction, filter, { ...query, sort: query.sort ?? '-occurredAt' }, {
    populate: [
      { path: 'createdBy', select: 'fullName' },
      { path: 'proposalId', select: 'code title' },
    ],
  });
}

/** Thu quỹ có chứng từ. body: { incomeSource, amount, occurredAt?, documentNo, description? } */
export async function recordIncome(user, { incomeSource, amount, occurredAt, documentNo, description }, files = [], { now = new Date() } = {}) {
  const at = occurredAt ? new Date(occurredAt) : now;
  if (at > now) throw ApiError.badRequest('Ngày thu không được ở tương lai');
  const attachmentUrls = await uploadToCloudinary(files, 'fund-documents');
  const fund = await getFund();

  const tx = await retryOnDuplicate(async () => {
    const code = await nextMonthlyCode(FundTransaction, 'PTQ', { date: at });
    return withTransaction(async (session) => {
      const updated = await MaintenanceFund.findOneAndUpdate({ _id: fund._id }, { $inc: { balance: amount } }, { new: true, session }).lean();
      const [doc] = await FundTransaction.create(
        [
          {
            code,
            fundId: fund._id,
            type: FUND_TX_TYPES.INCOME,
            amount,
            balanceAfter: updated.balance,
            incomeSource,
            documentNo,
            description: description || null,
            attachmentUrls,
            occurredAt: at,
            createdBy: user.id,
          },
        ],
        { session },
      );
      return doc.toObject();
    });
  });
  await audit(AUDIT_ACTIONS.FUND_INCOME_RECORDED, user, AUDIT_TARGETS.FUND_TRANSACTION, tx._id, {
    code: tx.code,
    amount,
    incomeSource,
    documentNo,
  });
  return tx;
}

// ---------------------------------------------------------------------------
// Đề xuất chi
// ---------------------------------------------------------------------------
const PROPOSAL_POPULATE = [
  { path: 'proposedBy', select: 'fullName role' },
  { path: 'votes.memberId', select: 'fullName boardTitle' },
  { path: 'finalizedBy', select: 'fullName' },
  { path: 'workAcceptedBy', select: 'fullName' },
  { path: 'expenseTxId', select: 'code amount occurredAt documentNo attachmentUrls description' },
  {
    path: 'workOrderId',
    select: 'status assetId repair.estimatedCost repair.acceptedAt',
    populate: { path: 'assetId', select: 'code name location' },
  },
];

// ---------------------------------------------------------------------------
// UC10 — phiếu bảo trì Trưởng BQL duyệt sửa bằng Quỹ, chờ Kế toán lập đề xuất
// ---------------------------------------------------------------------------
/** Phiếu đang chờ lập đề xuất: Chờ duyệt sửa + nguồn Quỹ + chưa có đề xuất đang chờ biểu quyết. Cũ nhất trước. */
export async function listAwaitingWorkOrders() {
  const wos = await WorkOrder.find({ status: WORK_ORDER_STATUS.AWAITING_REPAIR_APPROVAL, 'repair.costSource': REPAIR_COST_SOURCES.FUND })
    .select('assetId title repair.estimatedCost repair.faultDesc repair.decidedAt repair.decisionNote')
    .populate('assetId', 'code name location')
    .sort({ 'repair.decidedAt': 1 })
    .lean();
  if (!wos.length) return [];
  const pending = new Set(
    (await FundProposal.find({ workOrderId: { $in: wos.map((w) => w._id) }, status: PENDING }).distinct('workOrderId')).map(String),
  );
  return wos.filter((w) => !pending.has(String(w._id)));
}

/** Dữ liệu điền sẵn form đề xuất từ phiếu bảo trì (báo lỗi nếu phiếu không còn chờ đề xuất) */
export async function workOrderPrefill(workOrderId) {
  await assertAwaitingFund(workOrderId);
  return fundPrefill(workOrderId);
}

/** Báo kết quả đề xuất về phiếu bảo trì. Đề xuất đã lưu xong nên lỗi ở đây chỉ ghi log, không làm hỏng thao tác của người dùng. */
async function syncWorkOrder(p, decision, user, now) {
  if (!p.workOrderId) return;
  try {
    await onFundDecision(p.workOrderId, decision, { user, proposalId: p._id, now });
  } catch (err) {
    console.error(`[UC33/UC10] Không cập nhật được phiếu bảo trì ${p.workOrderId} theo đề xuất ${p.code}:`, err);
  }
}

/** body: { title, description, amount, planType, planRef?, urgentReason?, largeRepair?, workOrderId? } + ảnh báo giá */
export async function createProposal(user, body, files = [], { now = new Date() } = {}) {
  const { title, description, amount, planType, planRef = null, urgentReason = null, largeRepair = false, workOrderId = null } = body;
  if (planType === FUND_PLAN_TYPES.UNSCHEDULED && !urgentReason?.trim()) {
    throw ApiError.field('urgentReason', 'Bảo trì đột xuất phải ghi lý do');
  }
  if (planType === FUND_PLAN_TYPES.ANNUAL_PLAN && !planRef?.trim()) {
    throw ApiError.field('planRef', 'Ghi tên / số Kế hoạch bảo trì năm đã được Hội nghị nhà chung cư thông qua');
  }
  const fund = await getFund();
  const available = fund.balance - (await committedAmount(fund._id));
  if (amount > available) {
    throw new ApiError('FUND_INSUFFICIENT_BALANCE', `Số dư quỹ còn có thể chi ${formatVnd(available)} (đã trừ các đề xuất đã duyệt chưa chi)`);
  }
  // UC10: phiếu phải đang chờ đề xuất chi quỹ; ảnh hư hỏng của phiếu đi kèm báo giá
  const linked = workOrderId ? (await assertAwaitingFund(workOrderId), await fundPrefill(workOrderId)) : null;
  const attachmentUrls = [...(linked?.attachmentUrls ?? []), ...(await uploadToCloudinary(files, 'fund-quotations'))];

  const proposal = await retryOnDuplicate(async () =>
    FundProposal.create({
      code: await nextMonthlyCode(FundProposal, 'DXQ', { date: now }),
      fundId: fund._id,
      title,
      description,
      amount,
      planType,
      planRef: planType === FUND_PLAN_TYPES.ANNUAL_PLAN ? planRef : null,
      urgentReason: planType === FUND_PLAN_TYPES.UNSCHEDULED ? urgentReason : null,
      largeRepair: linked ? true : Boolean(largeRepair), // sửa chữa thiết bị luôn là sửa chữa lớn
      workOrderId: linked ? oid(workOrderId) : null,
      attachmentUrls,
      proposedBy: user.id,
    })
      .then((d) => d.toObject())
      .catch((err) => {
        // trùng index "1 đề xuất đang chờ / phiếu" (request song song) → báo lỗi nghiệp vụ, không thử lại
        if (err?.code === 11000 && err.keyPattern?.workOrderId) throw new ApiError('WORKORDER_FUND_PENDING');
        throw err;
      }),
  );
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_CREATED, user, AUDIT_TARGETS.FUND_PROPOSAL, proposal._id, {
    code: proposal.code,
    amount,
    planType,
    ...(linked && { workOrderId: proposal.workOrderId }),
  });

  const members = await boardMembers();
  await notify(
    members.map((m) => m._id),
    {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đề xuất chi quỹ bảo trì chờ biểu quyết: ${title}`,
      content:
        `${proposal.code} — ${title}, số tiền ${formatVnd(amount)} ` +
        `(${planType === FUND_PLAN_TYPES.UNSCHEDULED ? `bảo trì đột xuất: ${urgentReason}` : `theo kế hoạch ${planRef}`}). ` +
        `Số dư quỹ hiện tại ${formatVnd(fund.balance)}. Vui lòng vào hệ thống để Đồng ý hoặc Không đồng ý.`,
      refId: proposal._id,
      link: proposalLink(proposal),
      email: true,
    },
  );
  return proposal;
}

export async function listProposals({ status, ...query }) {
  const filter = {};
  if (status?.length) filter.status = { $in: status };
  return paginate(FundProposal, filter, { ...query, sort: query.sort ?? '-createdAt' }, {
    populate: [{ path: 'proposedBy', select: 'fullName' }],
  });
}

/** Tỷ lệ cần đạt: số phiếu đồng ý tối thiểu = floor(ratio × số thành viên) + 1 (vì phải LỚN HƠN tỷ lệ) */
export const neededAgree = (ratio, size) => Math.floor(ratio * size) + 1;

export async function getProposal(user, id) {
  const p = await FundProposal.findById(id).populate(PROPOSAL_POPULATE).lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  const [members, ratio, fund] = await Promise.all([boardMembers(), getConfig(CONFIG_KEYS.FUND_APPROVAL_RATIO), getFund()]);
  const size = p.status === PENDING ? members.length : (p.boardSize ?? members.length);
  const voted = new Set(p.votes.map((v) => String(v.memberId?._id ?? v.memberId)));
  return {
    ...p,
    tally: {
      boardSize: size,
      ratio: Number(ratio),
      needed: neededAgree(Number(ratio), size),
      agree: p.votes.filter((v) => v.decision === VOTE_DECISIONS.AGREE).length,
      disagree: p.votes.filter((v) => v.decision === VOTE_DECISIONS.DISAGREE).length,
      notVoted: members.filter((m) => !voted.has(String(m._id))).map((m) => ({ _id: m._id, fullName: m.fullName })),
    },
    myVote: p.votes.find((v) => String(v.memberId?._id ?? v.memberId) === user.id) ?? null,
    fundBalance: fund.balance,
  };
}

/** Ban quản trị biểu quyết. body: { decision: AGREE | DISAGREE, comment } — Không đồng ý phải ghi ý kiến */
export async function vote(user, id, { decision, comment = null }, { now = new Date() } = {}) {
  if (decision === VOTE_DECISIONS.DISAGREE && !comment?.trim()) throw ApiError.field('comment', 'Không đồng ý thì ghi rõ ý kiến');
  const current = await FundProposal.findById(id).select('status votes code').lean();
  if (!current) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (current.status !== PENDING) throw new ApiError('PROPOSAL_ALREADY_REVIEWED');
  if (current.votes.some((v) => String(v.memberId) === user.id)) throw new ApiError('PROPOSAL_ALREADY_VOTED');

  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING, 'votes.memberId': { $ne: oid(user.id) } },
    { $push: { votes: { memberId: user.id, decision, comment: comment || null, votedAt: now } } },
    { new: true },
  ).lean();
  if (!p) throw new ApiError('PROPOSAL_ALREADY_VOTED');
  await audit(AUDIT_ACTIONS.FUND_VOTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, decision });

  // Chốt kết quả theo tỷ lệ trên số thành viên đang hoạt động
  const [members, ratioCfg] = await Promise.all([boardMembers(), getConfig(CONFIG_KEYS.FUND_APPROVAL_RATIO)]);
  const ratio = Number(ratioCfg);
  const size = Math.max(members.length, p.votes.length);
  const agree = p.votes.filter((v) => v.decision === VOTE_DECISIONS.AGREE).length;
  const disagree = p.votes.length - agree;
  const need = neededAgree(ratio, size);
  let outcome = null;
  if (agree >= need) outcome = APPROVED;
  else if (agree + (size - agree - disagree) < need) outcome = REJECTED;
  if (!outcome) return { proposal: p, outcome: null };

  const finalNote = `${agree}/${size} thành viên đồng ý (cần > ${Math.round(ratio * 100)}%, tức ít nhất ${need})`;
  const finalized = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING },
    { $set: { status: outcome, finalizedBy: user.id, finalizedAt: now, boardSize: size, finalNote } },
    { new: true },
  ).lean();
  if (!finalized) return { proposal: p, outcome: null }; // lần bỏ phiếu song song đã chốt
  await audit(
    outcome === APPROVED ? AUDIT_ACTIONS.FUND_PROPOSAL_APPROVED : AUDIT_ACTIONS.FUND_PROPOSAL_REJECTED,
    user,
    AUDIT_TARGETS.FUND_PROPOSAL,
    p._id,
    { code: p.code, agree, size },
  );
  // UC10: đề xuất gắn phiếu bảo trì → Duyệt: phiếu sang Đang sửa, báo KTV; Từ chối: bỏ nguồn Quỹ, báo Trưởng BQL quyết định lại
  await syncWorkOrder(p, outcome === APPROVED ? FUND_DECISIONS.APPROVED : FUND_DECISIONS.REJECTED, user, now);

  if (outcome === APPROVED) {
    await notifyRoles(['ACCOUNTANT', 'MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Ban quản trị đã duyệt chi quỹ: ${p.title}`,
      content:
        `${p.code} được duyệt (${finalNote}), số tiền ${formatVnd(p.amount)}. ` +
        (p.workOrderId
          ? 'Phiếu bảo trì đã chuyển Đang sửa. Nhà thầu sửa xong, Trưởng BQL nghiệm thu trên phiếu bảo trì rồi Kế toán mới lập phiếu chi.'
          : p.largeRepair
            ? 'Sửa chữa lớn: Trưởng BQL nghiệm thu xong thì Kế toán mới lập phiếu chi.'
            : 'Kế toán lập phiếu chi thực tế kèm hóa đơn, chứng từ.'),
      refId: p._id,
      link: proposalLink(p),
      email: true,
    });
  } else {
    // Phiếu bảo trì đã tự báo Trưởng BQL quyết định lại (onFundDecision) → ở đây chỉ báo Kế toán
    await notifyRoles(p.workOrderId ? ['ACCOUNTANT'] : ['ACCOUNTANT', 'MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Ban quản trị không duyệt chi quỹ: ${p.title}`,
      content: `${p.code} không đạt tỷ lệ đồng ý (${finalNote}). Trưởng BQL cân nhắc phương án khác.`,
      refId: p._id,
      link: proposalLink(p),
      email: true,
    });
  }
  return { proposal: finalized, outcome };
}

/**
 * Kế toán rút đề xuất đang chờ / đã duyệt chưa chi. Đề xuất gắn phiếu bảo trì đã duyệt thì không rút được (phiếu đã sang
 * Đang sửa, nhà thầu đã được liên hệ); rút lúc đang chờ thì phiếu bỏ nguồn Quỹ, Trưởng BQL quyết định lại.
 */
export async function cancelProposal(user, id, { reason }, { now = new Date() } = {}) {
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, $or: [{ status: PENDING }, { status: APPROVED, workOrderId: null }] },
    { $set: { status: CANCELLED, cancelReason: reason } },
    { new: true },
  ).lean();
  if (!p) {
    const cur = await FundProposal.findById(id).select('status workOrderId').lean();
    if (cur?.status === APPROVED && cur.workOrderId) {
      throw ApiError.badRequest('Đề xuất sửa chữa thiết bị đã duyệt, phiếu bảo trì đang sửa: không rút được. Nghiệm thu xong thì lập phiếu chi.');
    }
    throw ApiError.badRequest('Chỉ rút được đề xuất đang chờ duyệt hoặc đã duyệt chưa chi');
  }
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_CANCELLED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, reason });
  await syncWorkOrder(p, FUND_DECISIONS.CANCELLED, user, now);
  const members = await boardMembers();
  await notify(
    members.map((m) => m._id),
    {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đề xuất chi quỹ ${p.code} đã được rút`,
      content: `Kế toán rút đề xuất "${p.title}": ${reason}`,
      refId: p._id,
      link: proposalLink(p),
    },
  );
  return p;
}

/**
 * Trưởng BQL nghiệm thu hạng mục sửa chữa lớn trước khi chi (M10-3). Đề xuất gắn phiếu bảo trì thì nghiệm thu trên phiếu
 * (Q12, có biên bản nhà thầu) — hệ thống tự đánh dấu ở đây, không nghiệm thu tay.
 */
export async function acceptWork(user, id, { now = new Date() } = {}) {
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: APPROVED, largeRepair: true, workAcceptedAt: null, workOrderId: null },
    { $set: { workAcceptedBy: user.id, workAcceptedAt: now } },
    { new: true },
  ).lean();
  if (!p) {
    const cur = await FundProposal.findById(id).select('workOrderId').lean();
    if (cur?.workOrderId) throw ApiError.badRequest('Đề xuất gắn phiếu bảo trì: nghiệm thu trên phiếu bảo trì khi đã có biên bản của nhà thầu');
    throw ApiError.badRequest('Chỉ nghiệm thu được đề xuất sửa chữa lớn đã duyệt, chưa nghiệm thu');
  }
  await audit(AUDIT_ACTIONS.FUND_WORK_ACCEPTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code });
  await notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đã nghiệm thu ${p.code}, lập phiếu chi`,
    content: `Trưởng BQL đã nghiệm thu "${p.title}". Kế toán lập phiếu chi thực tế kèm hóa đơn.`,
    refId: p._id,
    link: proposalLink(p),
  });
  return p;
}

/**
 * Phiếu chi thực tế cho đề xuất đã duyệt. body: { amount (≤ số được duyệt), occurredAt?, documentNo, description? } + ảnh hóa đơn.
 * Trừ số dư có điều kiện (không bao giờ âm); đề xuất → Đã chi.
 */
export async function recordExpense(user, id, { amount, occurredAt, documentNo, description }, files = [], { now = new Date() } = {}) {
  const p = await FundProposal.findById(id).lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (p.status !== APPROVED) throw ApiError.badRequest('Chỉ lập phiếu chi cho đề xuất đã được Ban quản trị duyệt và chưa chi');
  if (p.largeRepair && !p.workAcceptedAt) throw ApiError.badRequest('Sửa chữa lớn: cần Trưởng BQL nghiệm thu trước khi lập phiếu chi');
  if (amount > p.amount) {
    throw ApiError.field('amount', `Chi thực tế không vượt số được duyệt ${formatVnd(p.amount)}; vượt thì lập đề xuất bổ sung`);
  }
  const at = occurredAt ? new Date(occurredAt) : now;
  if (at > now) throw ApiError.badRequest('Ngày chi không được ở tương lai');
  const attachmentUrls = await uploadToCloudinary(files, 'fund-documents');

  const tx = await retryOnDuplicate(async () => {
    const code = await nextMonthlyCode(FundTransaction, 'PCQ', { date: at });
    return withTransaction(async (session) => {
      const fund = await MaintenanceFund.findOneAndUpdate(
        { _id: p.fundId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { new: true, session },
      ).lean();
      if (!fund) throw new ApiError('FUND_INSUFFICIENT_BALANCE');
      const [doc] = await FundTransaction.create(
        [
          {
            code,
            fundId: p.fundId,
            type: FUND_TX_TYPES.EXPENSE,
            amount,
            balanceAfter: fund.balance,
            description: description || `Chi ${p.title}`,
            documentNo,
            attachmentUrls,
            occurredAt: at,
            proposalId: p._id,
            createdBy: user.id,
          },
        ],
        { session },
      );
      const res = await FundProposal.updateOne(
        { _id: p._id, status: APPROVED },
        { $set: { status: PAID, expenseTxId: doc._id, paidAt: at } },
        { session },
      );
      if (res.modifiedCount !== 1) throw new ApiError('CONCURRENT_UPDATE');
      return doc.toObject();
    });
  });
  await audit(AUDIT_ACTIONS.FUND_EXPENSE_RECORDED, user, AUDIT_TARGETS.FUND_TRANSACTION, tx._id, {
    code: tx.code,
    proposal: p.code,
    amount,
    documentNo,
  });
  const members = await boardMembers();
  await notify(members.map((m) => m._id), {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đã chi quỹ bảo trì ${formatVnd(amount)}`,
    content: `Phiếu chi ${tx.code} cho "${p.title}" (${p.code}), số dư còn ${formatVnd(tx.balanceAfter)}.`,
    refId: p._id,
    link: proposalLink(p),
  });
  return tx;
}

// ---------------------------------------------------------------------------
// Cron FUND_PROPOSAL_REMIND — đề xuất chờ quá N ngày: nhắc thành viên chưa bỏ phiếu + báo Trưởng BQL, N ngày/lần (X8)
// ---------------------------------------------------------------------------
export async function remindProposals(now = new Date()) {
  const days = Number(await getConfig(CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS));
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const due = await FundProposal.find({
    status: PENDING,
    createdAt: { $lte: cutoff },
    $or: [{ lastRemindedAt: null }, { lastRemindedAt: { $lte: cutoff } }],
  }).lean();
  if (!due.length) return 0;
  const members = await boardMembers();

  let count = 0;
  for (const p of due) {
    const res = await FundProposal.updateOne(
      { _id: p._id, status: PENDING, lastRemindedAt: p.lastRemindedAt ?? null },
      { $set: { lastRemindedAt: now } },
    );
    if (!res.modifiedCount) continue;
    count += 1;
    const voted = new Set(p.votes.map((v) => String(v.memberId)));
    const waiting = members.filter((m) => !voted.has(String(m._id)));
    const age = Math.floor((now - new Date(p.createdAt)) / DAY_MS);
    const content = `${p.code} — ${p.title} (${formatVnd(p.amount)}) đã chờ ${age} ngày, còn ${waiting.length} thành viên chưa biểu quyết. Hệ thống không tự duyệt.`;
    await notify(
      waiting.map((m) => m._id),
      { type: NOTIFICATION_TYPES.FUND_APPROVAL, title: `Nhắc biểu quyết chi quỹ: ${p.title}`, content, refId: p._id, link: proposalLink(p), email: true },
    );
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đề xuất chi quỹ chờ quá ${days} ngày: ${p.title}`,
      content: `${content} Lập từ ${fmtDateVn(p.createdAt)}.`,
      refId: p._id,
      link: proposalLink(p),
    });
  }
  return count;
}

