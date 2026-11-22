// Mô đun 4 — Quỹ bảo trì 2% (UC33, UC34). Hệ thống chỉ theo dõi, quỹ thuộc Ban quản trị.
//   • Kế toán ghi nhận thu quỹ có chứng từ (số dư ban đầu CĐT bàn giao, lãi tiền gửi — M4-7).
//   • Trưởng BQL lập Đề xuất chi (hạng mục, số tiền, báo giá; Kế hoạch bảo trì năm hoặc Đột xuất kèm lý do)
//     → Chờ Kế toán xác nhận tài chính. Kế toán kiểm số dư khả dụng, chứng từ: Xác nhận → Chờ Ban quản trị biểu quyết;
//     Trả lại (lý do) → Trưởng BQL sửa và gửi lại. Người lập không tự xác nhận.
//   • Mỗi thành viên Ban quản trị bỏ 1 phiếu kèm ý kiến. Đồng ý > FUND_APPROVAL_RATIO × số thành viên → Đã duyệt nếu số dư
//     khả dụng còn đủ (BR-F16, kiểm lại lúc chốt; không đủ thì giữ chờ, báo Kế toán + Trưởng BQL); không còn khả năng đạt
//     → Từ chối (báo Trưởng BQL chọn phương án khác — M10-2). Quá N ngày chỉ nhắc, không tự duyệt (X8).
//   • Đã duyệt → Kế toán lập Phiếu chi thực tế kèm hóa đơn, trừ số dư (không cho âm, không vượt số duyệt; thấp hơn phải ghi lý
//     do — BR-F17). Sửa chữa lớn: chỉ chi sau khi Trưởng BQL nghiệm thu và Ban quản trị xác nhận nghiệm thu (BR-E09).
//   • UC10: Trưởng BQL duyệt sửa bằng Quỹ → lập đề xuất gắn workOrderId (điền sẵn từ báo cáo hư hỏng); kết quả trả lại /
//     biểu quyết / rút báo lại phiếu qua onFundDecision; nghiệm thu làm trên phiếu bảo trì (workOrders.repair.js, .board.js).
import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONFIG_KEYS,
  FUND_PLAN_TYPES,
  FUND_PROPOSAL_OPEN_STATUSES,
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

const { PENDING_VERIFY, RETURNED, PENDING, APPROVED, REJECTED, PAID, CANCELLED } = FUND_PROPOSAL_STATUS;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const proposalLink = (p) => `/app/fund/proposals/${p._id}`;
const sameId = (a, b) => a != null && b != null && String(a?._id ?? a) === String(b?._id ?? b);

/** Đổi status luôn đi kèm cờ isOpen (index "mỗi phiếu bảo trì 1 đề xuất đang xử lý" dựa vào cờ này) */
export const statusSet = (status) => ({ status, isOpen: FUND_PROPOSAL_OPEN_STATUSES.includes(status) });
const hist = (action, user, now, note = null) => ({ action, by: user?.id ?? null, at: now, note });

const audit = (action, user, targetType, targetId, metadata) => logAudit({ action, user, targetType, targetId, metadata });
const safely = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.error('[UC33] Lỗi gửi thông báo:', err);
  }
};

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

/** Tổng số tiền các đề xuất đã duyệt nhưng chưa chi (đã cam kết), bỏ qua excludeId */
async function committedAmount(fundId, { excludeId = null, session = null } = {}) {
  const [row] = await FundProposal.aggregate([
    { $match: { fundId: oid(fundId), status: APPROVED, ...(excludeId && { _id: { $ne: oid(excludeId) } }) } },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]).session(session);
  return row?.amount ?? 0;
}

/**
 * BR-F16: số dư khả dụng = số dư − các đề xuất đã duyệt chưa chi (bỏ qua excludeId). Đọc số dư trong cùng session để lúc chốt
 * duyệt (transaction) thấy đúng số dư và các khoản vừa cam kết.
 */
export async function availableBalance(fundId, { excludeId = null, session = null } = {}) {
  const fund = await MaintenanceFund.findById(fundId).select('balance').session(session).lean();
  return (fund?.balance ?? 0) - (await committedAmount(fundId, { excludeId, session }));
}

const insufficient = (available) =>
  new ApiError('FUND_INSUFFICIENT_BALANCE', `Số dư quỹ còn có thể chi ${formatVnd(available)} (đã trừ các đề xuất đã duyệt chưa chi)`);

// ---------------------------------------------------------------------------
// Tổng quan & sổ thu chi
// ---------------------------------------------------------------------------
export async function getOverview({ now = new Date() } = {}) {
  const fund = await getFund();
  const yearStart = periodStart(`${vnPeriod(now).slice(0, 4)}-01`);
  const [totals, committed, byStatus, threshold, readyToPayCount, emergencyCount] = await Promise.all([
    FundTransaction.aggregate([
      { $match: { fundId: fund._id, occurredAt: { $gte: yearStart } } },
      { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    committedAmount(fund._id),
    FundProposal.aggregate([
      { $match: { fundId: fund._id, status: { $in: [PENDING_VERIFY, RETURNED, PENDING] } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    getConfig(CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD),
    FundProposal.countDocuments({
      fundId: fund._id, status: APPROVED,
      $or: [{ largeRepair: false }, { workAcceptedAt: { $ne: null }, boardAcceptedAt: { $ne: null } }],
    }),
    WorkOrder.countDocuments({ 'repair.isEmergency': true, 'repair.emergencyAt': { $gte: yearStart } }),
  ]);
  const t = Object.fromEntries(totals.map((x) => [x._id, x.amount]));
  const c = Object.fromEntries(byStatus.map((x) => [x._id, x.n]));
  return {
    fund,
    balance: fund.balance,
    committed,
    available: fund.balance - committed,
    yearIncome: t[FUND_TX_TYPES.INCOME] ?? 0,
    yearExpense: t[FUND_TX_TYPES.EXPENSE] ?? 0,
    pendingCount: c[PENDING] ?? 0, // chờ Ban quản trị biểu quyết
    readyToPayCount, // đã duyệt, đủ nghiệm thu, chờ Kế toán lập phiếu chi
    emergencyCount, // phiếu sửa khẩn cấp bằng Quỹ từ đầu năm (theo dõi lạm dụng nhánh khẩn cấp)
    verifyCount: c[PENDING_VERIFY] ?? 0, // chờ Kế toán xác nhận
    returnedCount: c[RETURNED] ?? 0, // bị trả lại, chờ Trưởng BQL sửa
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
  // Số dư tăng: đề xuất đủ phiếu nhưng bị chặn vì thiếu số dư có thể chốt được rồi
  await retryBlockedApprovals(`ghi thu quỹ ${tx.code}`, now);
  return tx;
}

// ---------------------------------------------------------------------------
// Đề xuất chi
// ---------------------------------------------------------------------------
const PROPOSAL_POPULATE = [
  { path: 'proposedBy', select: 'fullName role' },
  { path: 'verifiedBy', select: 'fullName' },
  { path: 'votes.memberId', select: 'fullName boardTitle' },
  { path: 'finalizedBy', select: 'fullName' },
  { path: 'workAcceptedBy', select: 'fullName' },
  { path: 'boardAcceptedBy', select: 'fullName' },
  { path: 'history.by', select: 'fullName role' },
  { path: 'expenseTxId', select: 'code amount occurredAt documentNo attachmentUrls description varianceReason' },
  {
    path: 'workOrderId',
    select: 'status assetId repair.estimatedCost repair.acceptedAt repair.boardAcceptedAt repair.isEmergency repair.emergencyReason repair.acceptanceImages repair.inspectionCertUrls repair.acceptanceNote',
    populate: { path: 'assetId', select: 'code name location category' },
  },
];

// ---------------------------------------------------------------------------
// UC10 — phiếu bảo trì Trưởng BQL duyệt sửa bằng Quỹ, chờ Trưởng BQL lập đề xuất
// ---------------------------------------------------------------------------
/**
 * Phiếu chờ lập đề xuất: nguồn Quỹ, Chờ duyệt sửa (hoặc khẩn cấp đang sửa / chờ nghiệm thu), chưa có đề xuất đang xử lý
 * (phiếu khẩn cấp: cũng chưa có đề xuất đã duyệt). Cũ nhất trước.
 */
export async function listAwaitingWorkOrders() {
  const S = WORK_ORDER_STATUS;
  const wos = await WorkOrder.find({
    'repair.costSource': REPAIR_COST_SOURCES.FUND,
    $or: [
      { status: S.AWAITING_REPAIR_APPROVAL },
      { 'repair.isEmergency': true, status: { $in: [S.UNDER_REPAIR, S.AWAITING_ACCEPTANCE, S.AWAITING_BOARD_ACCEPTANCE] } },
    ],
  })
    .select('assetId title status repair.estimatedCost repair.faultDesc repair.decidedAt repair.decisionNote repair.isEmergency repair.emergencyReason repair.emergencyAt')
    .populate('assetId', 'code name location')
    .sort({ 'repair.decidedAt': 1 })
    .lean();
  if (!wos.length) return [];
  const busy = new Set(
    (await FundProposal.find({
      workOrderId: { $in: wos.map((w) => w._id) },
      $or: [{ isOpen: true }, { status: { $in: [APPROVED, PAID] } }],
    }).distinct('workOrderId')).map(String),
  );
  return wos.filter((w) => !busy.has(String(w._id)));
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

function assertPlan({ planType, planRef, urgentReason }) {
  if (planType === FUND_PLAN_TYPES.UNSCHEDULED && !urgentReason?.trim()) {
    throw ApiError.field('urgentReason', 'Bảo trì đột xuất phải ghi lý do');
  }
  if (planType === FUND_PLAN_TYPES.ANNUAL_PLAN && !planRef?.trim()) {
    throw ApiError.field('planRef', 'Ghi tên / số Kế hoạch bảo trì năm đã được Hội nghị nhà chung cư thông qua');
  }
}

const planText = (p) => (p.planType === FUND_PLAN_TYPES.UNSCHEDULED ? `bảo trì đột xuất: ${p.urgentReason}` : `theo kế hoạch ${p.planRef}`);

/**
 * Trưởng BQL lập đề xuất. body: { title, description, amount, planType, planRef?, urgentReason?, largeRepair?, workOrderId?, contractNo? }
 * + ảnh báo giá. Đề xuất → Chờ Kế toán xác nhận; báo Kế toán (Ban quản trị chỉ nhận sau khi Kế toán xác nhận).
 */
export async function createProposal(user, body, files = [], { now = new Date() } = {}) {
  const { title, description, amount, planType, planRef = null, urgentReason = null, largeRepair = false, workOrderId = null, contractNo = null } = body;
  assertPlan({ planType, planRef, urgentReason });
  const fund = await getFund();
  const available = await availableBalance(fund._id);
  if (amount > available) throw insufficient(available);
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
      contractNo: contractNo?.trim() || null,
      attachmentUrls,
      proposedBy: user.id,
      status: PENDING_VERIFY,
      submittedAt: now,
      createdAt: now, // Ngày lập = lúc gửi (seed / test truyền now lùi ngày thì lịch sử không bị trước ngày lập)
      history: [hist('SUBMITTED', user, now)],
    })
      .then((d) => d.toObject())
      .catch((err) => {
        // trùng index "1 đề xuất đang xử lý / phiếu" (request song song) → báo lỗi nghiệp vụ, không thử lại
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
  await safely(() => notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất chi quỹ cần xác nhận tài chính: ${title}`,
    content:
      `${proposal.code} — ${title}, số tiền ${formatVnd(amount)} (${planText(proposal)}). `
      + `Số dư khả dụng hiện tại ${formatVnd(available)}. Kiểm chứng từ, báo giá rồi Xác nhận hoặc Trả lại.`,
    refId: proposal._id,
    link: proposalLink(proposal),
    email: true,
  }));
  return proposal;
}

/** Kế toán xác nhận tài chính: Chờ xác nhận → Chờ Ban quản trị biểu quyết; báo Ban quản trị kèm nhận xét và số dư lúc xác nhận */
export async function verifyProposal(user, id, { note = null } = {}, { now = new Date() } = {}) {
  const cur = await FundProposal.findById(id).lean();
  if (!cur) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (cur.status !== PENDING_VERIFY) throw new ApiError('PROPOSAL_NOT_AWAITING_VERIFY');
  if (sameId(cur.proposedBy, user.id)) throw ApiError.forbidden('Người lập đề xuất không tự xác nhận được');
  const fund = await getFund();
  const available = await availableBalance(fund._id);
  if (cur.amount > available) {
    throw new ApiError('FUND_INSUFFICIENT_BALANCE', `Số dư khả dụng ${formatVnd(available)} không đủ cho ${formatVnd(cur.amount)}. Dùng "Trả lại" kèm lý do.`);
  }
  const verifyNote = note?.trim() || null;
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING_VERIFY },
    {
      $set: { ...statusSet(PENDING), verifiedBy: user.id, verifiedAt: now, verifyNote, balanceAtVerify: available, lastRemindedAt: null },
      $push: { history: hist('VERIFIED', user, now, verifyNote) },
    },
    { new: true },
  ).lean();
  if (!p) throw new ApiError('CONCURRENT_UPDATE');
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_VERIFIED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, amount: p.amount, available });

  const members = await boardMembers();
  await safely(() => notify(members.map((m) => m._id), {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất chi quỹ bảo trì chờ biểu quyết: ${p.title}`,
    content:
      `${p.code} — ${p.title}, số tiền ${formatVnd(p.amount)} (${planText(p)}). `
      + `Kế toán đã xác nhận: số dư khả dụng ${formatVnd(available)}${verifyNote ? `, nhận xét: ${verifyNote}` : ''}. `
      + 'Vui lòng vào hệ thống để Đồng ý hoặc Không đồng ý.',
    refId: p._id,
    link: proposalLink(p),
    email: true,
  }));
  return p;
}

/** Kế toán trả lại (lý do ≥ 5 ký tự): Chờ xác nhận → Bị trả lại; báo Trưởng BQL sửa và gửi lại */
export async function returnProposal(user, id, { reason }, { now = new Date() } = {}) {
  const text = reason?.trim() || '';
  if (text.length < 5) throw ApiError.field('reason', 'Ghi lý do trả lại tối thiểu 5 ký tự');
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING_VERIFY },
    {
      $set: { ...statusSet(RETURNED), returnReason: text, returnedAt: now, lastRemindedAt: null },
      $inc: { returnCount: 1 },
      $push: { history: hist('RETURNED', user, now, text) },
    },
    { new: true },
  ).lean();
  if (!p) {
    if (!(await FundProposal.exists({ _id: id }))) throw ApiError.notFound('Không tìm thấy đề xuất chi');
    throw new ApiError('PROPOSAL_NOT_AWAITING_VERIFY');
  }
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_RETURNED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, reason: text });
  await syncWorkOrder(p, FUND_DECISIONS.RETURNED, user, now);
  await safely(() => notify(p.proposedBy, {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Kế toán trả lại đề xuất ${p.code}`,
    content: `Đề xuất "${p.title}" bị trả lại: ${text}. Sửa và gửi lại, hoặc rút đề xuất.`,
    refId: p._id,
    link: proposalLink(p),
    email: true,
  }));
  return p;
}

/**
 * Trưởng BQL sửa đề xuất bị trả lại và gửi lại: Bị trả lại → Chờ Kế toán xác nhận. Được sửa hạng mục, mô tả, số tiền,
 * loại kế hoạch, số hợp đồng; ảnh báo giá mới thêm vào ảnh cũ.
 */
export async function resubmitProposal(user, id, body, files = [], { now = new Date() } = {}) {
  const cur = await FundProposal.findById(id).lean();
  if (!cur) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (cur.status !== RETURNED) throw new ApiError('PROPOSAL_NOT_RETURNED');
  // Kế toán cần biết đã sửa gì so với lần bị trả lại
  if ((body.note?.trim().length ?? 0) < 5) throw ApiError.field('note', 'Ghi rõ đã sửa gì (tối thiểu 5 ký tự)');
  const next = {
    title: body.title ?? cur.title,
    description: body.description ?? cur.description,
    amount: body.amount ?? cur.amount,
    planType: body.planType ?? cur.planType,
    planRef: body.planRef !== undefined ? body.planRef : cur.planRef,
    urgentReason: body.urgentReason !== undefined ? body.urgentReason : cur.urgentReason,
    contractNo: body.contractNo !== undefined ? body.contractNo?.trim() || null : cur.contractNo,
  };
  assertPlan(next);
  const fund = await getFund();
  const available = await availableBalance(fund._id);
  if (next.amount > available) throw insufficient(available);
  const images = await uploadToCloudinary(files, 'fund-quotations');
  const note = body.note?.trim() || null;
  // 1 lần ghi: sửa nội dung + đổi trạng thái + ghi lịch sử (+ thêm ảnh báo giá mới)
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: RETURNED },
    {
      $set: {
        ...next,
        planRef: next.planType === FUND_PLAN_TYPES.ANNUAL_PLAN ? next.planRef : null,
        urgentReason: next.planType === FUND_PLAN_TYPES.UNSCHEDULED ? next.urgentReason : null,
        ...statusSet(PENDING_VERIFY),
        submittedAt: now,
        lastRemindedAt: null,
      },
      $push: {
        history: hist('RESUBMITTED', user, now, note),
        ...(images.length && { attachmentUrls: { $each: images } }),
      },
    },
    { new: true },
  ).lean();
  if (!p) throw new ApiError('CONCURRENT_UPDATE');
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_RESUBMITTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, {
    code: p.code, before: { amount: cur.amount }, after: { amount: p.amount },
  });
  await safely(() => notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất ${p.code} đã được gửi lại`,
    content: `Trưởng BQL đã sửa "${p.title}" (${formatVnd(p.amount)})${note ? `: ${note}` : ''}. Vui lòng xác nhận lại.`,
    refId: p._id,
    link: proposalLink(p),
  }));
  return p;
}

/** readyToPay: đề xuất Kế toán lập phiếu chi được ngay (đã duyệt; sửa chữa lớn thì đã qua nghiệm thu 2 lớp) */
export async function listProposals({ status, readyToPay, ...query }) {
  const filter = {};
  if (status?.length) filter.status = { $in: status };
  if (readyToPay) {
    Object.assign(filter, {
      status: APPROVED,
      $or: [{ largeRepair: false }, { workAcceptedAt: { $ne: null }, boardAcceptedAt: { $ne: null } }],
    });
  }
  return paginate(FundProposal, filter, { ...query, sort: query.sort ?? '-createdAt' }, {
    populate: [{ path: 'proposedBy', select: 'fullName' }],
  });
}

/** Đề xuất tối thiểu để route biết có gắn phiếu bảo trì không */
export async function getProposalLink(id) {
  const p = await FundProposal.findById(id).select('workOrderId status code').lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  return p;
}

/** Tỷ lệ cần đạt: số phiếu đồng ý tối thiểu = floor(ratio × số thành viên) + 1 (vì phải LỚN HƠN tỷ lệ) */
export const neededAgree = (ratio, size) => Math.floor(ratio * size) + 1;

export async function getProposal(user, id) {
  const p = await FundProposal.findById(id).populate(PROPOSAL_POPULATE).lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  const [members, ratio, fund] = await Promise.all([boardMembers(), getConfig(CONFIG_KEYS.FUND_APPROVAL_RATIO), getFund()]);
  const size = p.isOpen ? members.length : (p.boardSize ?? members.length);
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
    available: await availableBalance(fund._id, { excludeId: p.status === APPROVED ? p._id : null }),
  };
}

/** Kết quả biểu quyết theo tỷ lệ trên số thành viên đang hoạt động */
async function tallyOf(p) {
  const [members, ratioCfg] = await Promise.all([boardMembers(), getConfig(CONFIG_KEYS.FUND_APPROVAL_RATIO)]);
  const ratio = Number(ratioCfg);
  const size = Math.max(members.length, p.votes.length);
  const agree = p.votes.filter((v) => v.decision === VOTE_DECISIONS.AGREE).length;
  const disagree = p.votes.length - agree;
  const need = neededAgree(ratio, size);
  let outcome = null;
  if (agree >= need) outcome = APPROVED;
  else if (agree + (size - agree - disagree) < need) outcome = REJECTED;
  return { outcome, ratio, size, agree, need, finalNote: `${agree}/${size} thành viên đồng ý (cần > ${Math.round(ratio * 100)}%, tức ít nhất ${need})` };
}

/**
 * Chốt kết quả. Đã duyệt: trong 1 transaction đọc lại số dư khả dụng và tăng approvalSeq của quỹ (2 lần chốt song song ghi
 * cùng 1 bản ghi quỹ nên 1 bên phải chạy lại và thấy khoản bên kia đã cam kết). Không đủ → giữ Chờ biểu quyết, đánh dấu
 * approvalBlockedAt, trả 'BLOCKED_BALANCE'.
 */
async function finalize(p, user, now, t) {
  if (t.outcome === REJECTED) {
    const done = await FundProposal.findOneAndUpdate(
      { _id: p._id, status: PENDING },
      {
        $set: { ...statusSet(REJECTED), finalizedBy: user.id, finalizedAt: now, boardSize: t.size, finalNote: t.finalNote, approvalBlockedAt: null },
        $push: { history: hist('REJECTED', user, now, t.finalNote) },
      },
      { new: true },
    ).lean();
    return done ? { proposal: done, outcome: REJECTED } : null;
  }
  const result = await withTransaction(async (session) => {
    await MaintenanceFund.updateOne({ _id: p.fundId }, { $inc: { approvalSeq: 1 } }, { session });
    const available = await availableBalance(p.fundId, { session });
    if (p.amount > available) return { blocked: true, available };
    const done = await FundProposal.findOneAndUpdate(
      { _id: p._id, status: PENDING },
      {
        $set: { ...statusSet(APPROVED), finalizedBy: user.id, finalizedAt: now, boardSize: t.size, finalNote: t.finalNote, approvalBlockedAt: null },
        $push: { history: hist('APPROVED', user, now, t.finalNote) },
      },
      { new: true, session },
    ).lean();
    return { done };
  });
  if (result.blocked) {
    const first = await FundProposal.findOneAndUpdate(
      { _id: p._id, status: PENDING, approvalBlockedAt: null },
      { $set: { approvalBlockedAt: now }, $push: { history: hist('APPROVAL_BLOCKED_BALANCE', user, now, `Số dư khả dụng ${formatVnd(result.available)}`) } },
      { new: true },
    ).lean();
    if (first) {
      await safely(() => notifyRoles(['ACCOUNTANT', 'MANAGER'], {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: `Đề xuất ${p.code} đủ phiếu nhưng số dư khả dụng không đủ`,
        content: `${p.title} (${formatVnd(p.amount)}) đã đủ tỷ lệ đồng ý (${t.finalNote}) nhưng số dư khả dụng chỉ còn ${formatVnd(result.available)}. `
          + 'Đề xuất giữ ở Chờ biểu quyết; khi số dư đủ (thu thêm, rút đề xuất khác) hệ thống tự chốt.',
        refId: p._id,
        link: proposalLink(p),
        email: true,
      }));
    }
    return { proposal: await FundProposal.findById(p._id).lean(), outcome: 'BLOCKED_BALANCE' };
  }
  return result.done ? { proposal: result.done, outcome: APPROVED } : null;
}

async function afterFinalized(p, user, now, outcome, finalNote) {
  await audit(
    outcome === APPROVED ? AUDIT_ACTIONS.FUND_PROPOSAL_APPROVED : AUDIT_ACTIONS.FUND_PROPOSAL_REJECTED,
    user,
    AUDIT_TARGETS.FUND_PROPOSAL,
    p._id,
    { code: p.code, note: finalNote },
  );
  // UC10: đề xuất gắn phiếu bảo trì → Duyệt: phiếu sang Đang sửa, báo KTV; Từ chối: bỏ nguồn Quỹ, báo Trưởng BQL quyết định lại
  await syncWorkOrder(p, outcome === APPROVED ? FUND_DECISIONS.APPROVED : FUND_DECISIONS.REJECTED, user, now);
  if (outcome === APPROVED) {
    await safely(() => notifyRoles(['ACCOUNTANT', 'MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Ban quản trị đã duyệt chi quỹ: ${p.title}`,
      content:
        `${p.code} được duyệt (${finalNote}), số tiền ${formatVnd(p.amount)}. `
        + (p.workOrderId
          ? 'Nhà thầu sửa xong: Trưởng BQL nghiệm thu kỹ thuật trên phiếu bảo trì, Ban quản trị xác nhận nghiệm thu, rồi Kế toán lập phiếu chi.'
          : p.largeRepair
            ? 'Sửa chữa lớn: Trưởng BQL nghiệm thu và Ban quản trị xác nhận xong thì Kế toán mới lập phiếu chi.'
            : 'Kế toán lập phiếu chi thực tế kèm hóa đơn, chứng từ.'),
      refId: p._id,
      link: proposalLink(p),
      email: true,
    }));
  } else {
    // Phiếu bảo trì đã tự báo Trưởng BQL quyết định lại (onFundDecision) → ở đây chỉ báo Kế toán
    await safely(() => notifyRoles(p.workOrderId ? ['ACCOUNTANT'] : ['ACCOUNTANT', 'MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Ban quản trị không duyệt chi quỹ: ${p.title}`,
      content: `${p.code} không đạt tỷ lệ đồng ý (${finalNote}). Trưởng BQL cân nhắc phương án khác.`,
      refId: p._id,
      link: proposalLink(p),
      email: true,
    }));
  }
}

/** Ban quản trị biểu quyết. body: { decision: AGREE | DISAGREE, comment } — Không đồng ý phải ghi ý kiến */
export async function vote(user, id, { decision, comment = null }, { now = new Date() } = {}) {
  if (decision === VOTE_DECISIONS.DISAGREE && !comment?.trim()) throw ApiError.field('comment', 'Không đồng ý thì ghi rõ ý kiến');
  const current = await FundProposal.findById(id).select('status votes code').lean();
  if (!current) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (current.status === PENDING_VERIFY || current.status === RETURNED) {
    throw new ApiError('PROPOSAL_ALREADY_REVIEWED', 'Đề xuất chưa được Kế toán xác nhận tài chính, chưa biểu quyết được');
  }
  if (current.status !== PENDING) throw new ApiError('PROPOSAL_ALREADY_REVIEWED');
  if (current.votes.some((v) => String(v.memberId) === user.id)) throw new ApiError('PROPOSAL_ALREADY_VOTED');

  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING, 'votes.memberId': { $ne: oid(user.id) } },
    { $push: { votes: { memberId: user.id, decision, comment: comment || null, votedAt: now } } },
    { new: true },
  ).lean();
  if (!p) throw new ApiError('PROPOSAL_ALREADY_VOTED');
  await audit(AUDIT_ACTIONS.FUND_VOTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, decision });

  const t = await tallyOf(p);
  if (!t.outcome) return { proposal: p, outcome: null };
  const r = await finalize(p, user, now, t);
  if (!r) return { proposal: p, outcome: null }; // lần bỏ phiếu song song đã chốt
  if (r.outcome === 'BLOCKED_BALANCE') return r;
  await afterFinalized(p, user, now, r.outcome, t.finalNote);
  return r;
}

/**
 * BR-F16: số dư tăng / cam kết giảm → thử chốt lại các đề xuất đủ phiếu nhưng từng bị chặn vì thiếu số dư (cũ nhất trước).
 * Kết quả là của Ban quản trị: người chốt = thành viên bỏ phiếu cuối; nhật ký ghi hệ thống tự chốt (không ghi người làm
 * thao tác kích hoạt như Kế toán ghi thu), metadata.trigger cho biết lý do.
 */
export async function retryBlockedApprovals(trigger, now = new Date()) {
  const blocked = await FundProposal.find({ status: PENDING, approvalBlockedAt: { $ne: null } }).sort({ approvalBlockedAt: 1 }).lean();
  let approved = 0;
  for (const p of blocked) {
    try {
      const t = await tallyOf(p);
      if (t.outcome !== APPROVED) continue;
      const lastVoter = { id: String(p.votes.at(-1)?.memberId ?? '') || null };
      const r = await finalize(p, lastVoter, now, t);
      if (r?.outcome === APPROVED) {
        approved += 1;
        await afterFinalized(p, null, now, APPROVED, `${t.finalNote}; tự chốt khi số dư khả dụng đủ (${trigger})`);
      }
    } catch (err) {
      console.error(`[UC34] Lỗi chốt lại đề xuất ${p.code}:`, err);
    }
  }
  return approved;
}

/**
 * Trưởng BQL rút đề xuất đang xử lý (chờ Kế toán / bị trả lại / chờ biểu quyết) hoặc đã duyệt chưa chi (không gắn phiếu).
 * Đề xuất gắn phiếu bảo trì đã duyệt thì không rút được (phiếu đã sang Đang sửa, nhà thầu đã được liên hệ); rút lúc đang xử lý
 * thì phiếu bỏ nguồn Quỹ, Trưởng BQL quyết định lại.
 */
export async function cancelProposal(user, id, { reason }, { now = new Date() } = {}) {
  const before = await FundProposal.findOneAndUpdate(
    { _id: id, $or: [{ status: { $in: [PENDING_VERIFY, RETURNED, PENDING] } }, { status: APPROVED, workOrderId: null }] },
    { $set: { ...statusSet(CANCELLED), cancelReason: reason, approvalBlockedAt: null }, $push: { history: hist('CANCELLED', user, now, reason) } },
    { new: false },
  ).lean();
  if (!before) {
    const cur = await FundProposal.findById(id).select('status workOrderId').lean();
    if (!cur) throw ApiError.notFound('Không tìm thấy đề xuất chi');
    if (cur.status === APPROVED && cur.workOrderId) {
      throw ApiError.badRequest('Đề xuất sửa chữa thiết bị đã duyệt, phiếu bảo trì đang sửa: không rút được. Nghiệm thu xong thì lập phiếu chi.');
    }
    throw ApiError.badRequest('Chỉ rút được đề xuất đang xử lý hoặc đã duyệt chưa chi');
  }
  const p = { ...before, status: CANCELLED, cancelReason: reason };
  await audit(AUDIT_ACTIONS.FUND_PROPOSAL_CANCELLED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code, reason, from: before.status });
  await syncWorkOrder(p, FUND_DECISIONS.CANCELLED, user, now);
  // Ai đã biết đề xuất thì báo: Kế toán luôn biết; Ban quản trị chỉ biết từ khi Kế toán xác nhận
  const msg = {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất chi quỹ ${p.code} đã được rút`,
    content: `Trưởng BQL rút đề xuất "${p.title}": ${reason}`,
    refId: p._id,
    link: proposalLink(p),
  };
  await safely(async () => {
    await notifyRoles(['ACCOUNTANT'], msg);
    if ([PENDING, APPROVED].includes(before.status)) {
      const members = await boardMembers();
      await notify(members.map((m) => m._id), msg);
    }
  });
  if (before.status === APPROVED) await retryBlockedApprovals(`rút đề xuất ${p.code}`, now); // khoản cam kết được giải phóng
  return p;
}

/**
 * Trưởng BQL nghiệm thu kỹ thuật hạng mục sửa chữa lớn KHÔNG gắn phiếu bảo trì (M10-3). Đề xuất gắn phiếu thì nghiệm thu trên
 * phiếu (có biên bản nhà thầu) — hệ thống tự đánh dấu, không nghiệm thu tay. Sau đó Ban quản trị xác nhận (boardAcceptProposal).
 */
export async function acceptWork(user, id, { now = new Date() } = {}) {
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: APPROVED, largeRepair: true, workAcceptedAt: null, workOrderId: null },
    { $set: { workAcceptedBy: user.id, workAcceptedAt: now }, $push: { history: hist('WORK_ACCEPTED', user, now) } },
    { new: true },
  ).lean();
  if (!p) {
    const cur = await FundProposal.findById(id).select('workOrderId').lean();
    if (cur?.workOrderId) throw ApiError.badRequest('Đề xuất gắn phiếu bảo trì: nghiệm thu trên phiếu bảo trì khi đã có biên bản của nhà thầu');
    throw ApiError.badRequest('Chỉ nghiệm thu được đề xuất sửa chữa lớn đã duyệt, chưa nghiệm thu');
  }
  await audit(AUDIT_ACTIONS.FUND_WORK_ACCEPTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code });
  const members = await boardMembers();
  await safely(() => notify(members.map((m) => m._id), {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Chờ xác nhận nghiệm thu ${p.code}`,
    content: `Trưởng BQL đã nghiệm thu "${p.title}". Ban quản trị xác nhận nghiệm thu để Kế toán lập phiếu chi.`,
    refId: p._id,
    link: proposalLink(p),
    email: true,
  }));
  return p;
}

/** BR-E09: Ban quản trị xác nhận nghiệm thu đề xuất sửa chữa lớn KHÔNG gắn phiếu, sau khi Trưởng BQL nghiệm thu */
export async function boardAcceptProposal(user, id, { note = null } = {}, { now = new Date() } = {}) {
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: APPROVED, largeRepair: true, workOrderId: null, workAcceptedAt: { $ne: null }, boardAcceptedAt: null },
    { $set: { boardAcceptedBy: user.id, boardAcceptedAt: now }, $push: { history: hist('BOARD_ACCEPTED', user, now, note?.trim() || null) } },
    { new: true },
  ).lean();
  if (!p) throw ApiError.badRequest('Chỉ xác nhận được đề xuất sửa chữa lớn đã duyệt, Trưởng BQL đã nghiệm thu và chưa xác nhận');
  await audit(AUDIT_ACTIONS.FUND_BOARD_ACCEPTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, { code: p.code });
  await safely(() => notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đã xác nhận nghiệm thu ${p.code}, lập phiếu chi`,
    content: `Ban quản trị đã xác nhận nghiệm thu "${p.title}". Kế toán lập phiếu chi thực tế kèm hóa đơn.`,
    refId: p._id,
    link: proposalLink(p),
  }));
  return p;
}

/**
 * Phiếu chi thực tế cho đề xuất đã duyệt. body: { amount (≤ số được duyệt), occurredAt?, documentNo, description?, varianceReason? }
 * + ảnh hóa đơn. Thấp hơn số duyệt phải ghi lý do (BR-F17). Trừ số dư có điều kiện (không bao giờ âm); đề xuất → Đã chi.
 */
export async function recordExpense(user, id, { amount, occurredAt, documentNo, description, varianceReason }, files = [], { now = new Date() } = {}) {
  const p = await FundProposal.findById(id).lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (p.status !== APPROVED) throw ApiError.badRequest('Chỉ lập phiếu chi cho đề xuất đã được Ban quản trị duyệt và chưa chi');
  if (p.largeRepair && !p.workAcceptedAt) throw ApiError.badRequest('Sửa chữa lớn: cần Trưởng BQL nghiệm thu trước khi lập phiếu chi');
  if (p.largeRepair && !p.boardAcceptedAt) throw ApiError.badRequest('Sửa chữa lớn: cần Ban quản trị xác nhận nghiệm thu trước khi lập phiếu chi');
  if (amount > p.amount) {
    throw ApiError.field('amount', `Chi thực tế không vượt số được duyệt ${formatVnd(p.amount)}; vượt thì lập đề xuất bổ sung`);
  }
  const variance = varianceReason?.trim() || null;
  if (amount < p.amount && (!variance || variance.length < 5)) {
    throw new ApiError('EXPENSE_VARIANCE_REASON_REQUIRED', `Chi thực tế ${formatVnd(amount)} thấp hơn số đã duyệt ${formatVnd(p.amount)}, ghi lý do chênh lệch (tối thiểu 5 ký tự)`, {
      details: [{ field: 'varianceReason', message: 'Ghi lý do chênh lệch' }],
    });
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
            varianceReason: amount < p.amount ? variance : null,
            createdBy: user.id,
          },
        ],
        { session },
      );
      const res = await FundProposal.updateOne(
        { _id: p._id, status: APPROVED },
        { $set: { ...statusSet(PAID), expenseTxId: doc._id, paidAt: at }, $push: { history: hist('PAID', user, now, variance) } },
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
    approved: p.amount,
    documentNo,
    ...(tx.varianceReason && { varianceReason: tx.varianceReason }),
  });
  const members = await boardMembers();
  await safely(() => notify(members.map((m) => m._id), {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đã chi quỹ bảo trì ${formatVnd(amount)}`,
    content: `Phiếu chi ${tx.code} cho "${p.title}" (${p.code}), số dư còn ${formatVnd(tx.balanceAfter)}.`
      + (tx.varianceReason ? ` Thấp hơn số duyệt ${formatVnd(p.amount)}: ${tx.varianceReason}.` : ''),
    refId: p._id,
    link: proposalLink(p),
  }));
  // Chi thấp hơn số duyệt: phần chênh lệch không còn bị cam kết → số dư khả dụng tăng
  if (amount < p.amount) await retryBlockedApprovals(`chi ${p.code} thấp hơn số duyệt`, now);
  return tx;
}

// ---------------------------------------------------------------------------
// Cron FUND_PROPOSAL_REMIND (X8), N ngày/lần, không tự duyệt:
//   • Chờ Kế toán xác nhận quá FUND_VERIFY_REMIND_DAYS → nhắc Kế toán + báo Trưởng BQL.
//   • Chờ biểu quyết quá FUND_APPROVAL_REMIND_DAYS (tính từ lúc Kế toán xác nhận) → nhắc thành viên chưa bỏ phiếu + báo Trưởng BQL.
// ---------------------------------------------------------------------------
async function remindDue(status, days, since, now) {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return FundProposal.find({
    status,
    [since]: { $lte: cutoff },
    $or: [{ lastRemindedAt: null }, { lastRemindedAt: { $lte: cutoff } }],
  }).lean();
}

async function claimReminder(p, now) {
  const res = await FundProposal.updateOne(
    { _id: p._id, status: p.status, lastRemindedAt: p.lastRemindedAt ?? null },
    { $set: { lastRemindedAt: now } },
  );
  return res.modifiedCount === 1;
}

export async function remindProposals(now = new Date()) {
  const [voteDays, verifyDays] = (await Promise.all([
    getConfig(CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS),
    getConfig(CONFIG_KEYS.FUND_VERIFY_REMIND_DAYS),
  ])).map(Number);
  let count = 0;

  for (const p of await remindDue(PENDING_VERIFY, verifyDays || 3, 'submittedAt', now)) {
    if (!(await claimReminder(p, now))) continue;
    count += 1;
    const age = Math.floor((now - new Date(p.submittedAt)) / DAY_MS);
    const content = `${p.code} — ${p.title} (${formatVnd(p.amount)}) đã chờ Kế toán xác nhận ${age} ngày.`;
    await safely(async () => {
      await notifyRoles(['ACCOUNTANT'], {
        type: NOTIFICATION_TYPES.FUND_APPROVAL, title: `Nhắc xác nhận đề xuất chi quỹ: ${p.title}`, content, refId: p._id, link: proposalLink(p), email: true,
      });
      await notifyRoles(['MANAGER'], {
        type: NOTIFICATION_TYPES.FUND_APPROVAL, title: `Đề xuất chờ Kế toán quá ${verifyDays} ngày: ${p.title}`, content, refId: p._id, link: proposalLink(p),
      });
    });
  }

  const due = await remindDue(PENDING, voteDays || 3, 'verifiedAt', now);
  // Dữ liệu cũ (trước bước xác nhận) không có verifiedAt → tính từ lúc tạo
  const legacy = await FundProposal.find({
    status: PENDING, verifiedAt: null, createdAt: { $lte: new Date(now.getTime() - (voteDays || 3) * DAY_MS) },
    $or: [{ lastRemindedAt: null }, { lastRemindedAt: { $lte: new Date(now.getTime() - (voteDays || 3) * DAY_MS) } }],
  }).lean();
  const members = due.length || legacy.length ? await boardMembers() : [];
  for (const p of [...due, ...legacy]) {
    if (!(await claimReminder(p, now))) continue;
    count += 1;
    const voted = new Set(p.votes.map((v) => String(v.memberId)));
    const waiting = members.filter((m) => !voted.has(String(m._id)));
    const age = Math.floor((now - new Date(p.verifiedAt ?? p.createdAt)) / DAY_MS);
    const content = `${p.code} — ${p.title} (${formatVnd(p.amount)}) đã chờ biểu quyết ${age} ngày, còn ${waiting.length} thành viên chưa biểu quyết. Hệ thống không tự duyệt.`;
    await safely(async () => {
      await notify(
        waiting.map((m) => m._id),
        { type: NOTIFICATION_TYPES.FUND_APPROVAL, title: `Nhắc biểu quyết chi quỹ: ${p.title}`, content, refId: p._id, link: proposalLink(p), email: true },
      );
      await notifyRoles(['MANAGER'], {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: `Đề xuất chi quỹ chờ quá ${voteDays} ngày: ${p.title}`,
        content: `${content} Lập từ ${fmtDateVn(p.createdAt)}.`,
        refId: p._id,
        link: proposalLink(p),
      });
    });
  }
  return count;
}
