// Mô đun 4 — Quỹ bảo trì 2% (UC33, UC34). Hệ thống chỉ theo dõi, quỹ thuộc Ban quản trị.
//   • Kế toán ghi nhận thu quỹ có chứng từ (số dư ban đầu CĐT bàn giao, lãi tiền gửi — M4-7).
//   • Trưởng BQL lập Đề xuất chi (hạng mục, số tiền dự kiến; Kế hoạch bảo trì năm hoặc Đột xuất kèm lý do). Trưởng ban quản trị
//     chọn nhà thầu (tên, giá báo, báo giá) → số tiền đề xuất = giá báo, cả ban biểu quyết. Chưa có nhà thầu thì chưa Đồng ý được
//     (vẫn Không đồng ý được); đã có phiếu Đồng ý thì không đổi nhà thầu. Hệ thống tự kiểm số dư khả dụng lúc lập, lúc chọn, lúc chốt.
//   • Mỗi thành viên Ban quản trị bỏ 1 phiếu kèm ý kiến. Đồng ý > FUND_APPROVAL_RATIO × số thành viên → Đã duyệt nếu số dư
//     khả dụng còn đủ (BR-F16, kiểm lại lúc chốt; không đủ thì giữ chờ, báo Kế toán + Trưởng BQL); không còn khả năng đạt
//     → Từ chối (báo Trưởng BQL chọn phương án khác — M10-2). Quá N ngày chỉ nhắc, không tự duyệt (X8).
//   • Đã duyệt → Kế toán lập Phiếu chi thực tế kèm hóa đơn, trừ số dư (không cho âm, không vượt số duyệt; thấp hơn phải ghi lý
//     do — BR-F17). Sửa chữa lớn: chỉ chi sau khi Trưởng BQL nghiệm thu và Ban quản trị xác nhận nghiệm thu (BR-E09).
//   • UC10: Trưởng BQL duyệt sửa bằng Quỹ → lập đề xuất gắn workOrderId (điền sẵn từ báo cáo hư hỏng); kết quả biểu quyết /
//     rút báo lại phiếu qua onFundDecision; nghiệm thu làm trên phiếu bảo trì (workOrders.repair.js, .board.js).
import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  BOARD_TITLES,
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
import { FUND_DECISIONS, assertAwaitingFund, fundPrefill, onFundDecision, onVendorSelected } from '../workOrders/workOrders.fund.js';

const { PENDING, APPROVED, REJECTED, PAID, CANCELLED } = FUND_PROPOSAL_STATUS;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
/** Chờ Trưởng ban chọn nhà thầu. Đề xuất cũ đã có phiếu Đồng ý (trước khi có bước này) thì biểu quyết tiếp bình thường */
const AWAITING_VENDOR = { status: PENDING, vendor: null, votes: { $not: { $elemMatch: { decision: VOTE_DECISIONS.AGREE } } } };
export const isAwaitingVendor = (p) =>
  p.status === PENDING && !p.vendor && !p.votes.some((v) => v.decision === VOTE_DECISIONS.AGREE);
const proposalLink = (p) => `/app/fund/proposals/${p._id}`;

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
  const [totals, committed, pendingCount, threshold, readyToPayCount, emergencyCount, awaitingVendorCount] = await Promise.all([
    FundTransaction.aggregate([
      { $match: { fundId: fund._id, occurredAt: { $gte: yearStart } } },
      { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    committedAmount(fund._id),
    FundProposal.countDocuments({ fundId: fund._id, status: PENDING }),
    getConfig(CONFIG_KEYS.FUND_LOW_BALANCE_THRESHOLD),
    FundProposal.countDocuments({
      fundId: fund._id, status: APPROVED,
      $or: [{ largeRepair: false }, { workAcceptedAt: { $ne: null }, boardAcceptedAt: { $ne: null } }],
    }),
    WorkOrder.countDocuments({ 'repair.isEmergency': true, 'repair.emergencyAt': { $gte: yearStart } }),
    FundProposal.countDocuments({ fundId: fund._id, ...AWAITING_VENDOR }),
  ]);
  const t = Object.fromEntries(totals.map((x) => [x._id, x.amount]));
  return {
    fund,
    balance: fund.balance,
    committed,
    available: fund.balance - committed,
    yearIncome: t[FUND_TX_TYPES.INCOME] ?? 0,
    yearExpense: t[FUND_TX_TYPES.EXPENSE] ?? 0,
    pendingCount, // đang xử lý: chờ chọn nhà thầu + chờ biểu quyết
    awaitingVendorCount, // trong đó: chờ Trưởng ban quản trị chọn nhà thầu
    readyToPayCount, // đã duyệt, đủ nghiệm thu, chờ Kế toán lập phiếu chi
    emergencyCount, // phiếu sửa khẩn cấp bằng Quỹ từ đầu năm (theo dõi lạm dụng nhánh khẩn cấp)
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
  { path: 'votes.memberId', select: 'fullName boardTitle' },
  { path: 'finalizedBy', select: 'fullName' },
  { path: 'workAcceptedBy', select: 'fullName' },
  { path: 'boardAcceptedBy', select: 'fullName' },
  { path: 'vendor.selectedBy', select: 'fullName' },
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
 * Trưởng BQL lập đề xuất. body: { title, description, amount (dự kiến), planType, planRef?, urgentReason?, largeRepair?, workOrderId? }
 * + ảnh hồ sơ (không bắt buộc). Kiểm số dư khả dụng; đề xuất → chờ Trưởng ban quản trị chọn nhà thầu, báo Trưởng ban.
 * Trưởng BQL không chọn nhà thầu: báo giá do Trưởng ban nhập ở bước chọn (selectVendor).
 */
export async function createProposal(user, body, files = [], { now = new Date() } = {}) {
  const { title, description, amount, planType, planRef = null, urgentReason = null, largeRepair = false, workOrderId = null } = body;
  assertPlan({ planType, planRef, urgentReason });
  const fund = await getFund();
  const available = await availableBalance(fund._id);
  if (amount > available) throw insufficient(available);
  // UC10: phiếu phải đang chờ đề xuất chi quỹ; ảnh hư hỏng của phiếu đi kèm hồ sơ
  const linked = workOrderId ? (await assertAwaitingFund(workOrderId), await fundPrefill(workOrderId)) : null;
  const attachmentUrls = [...(linked?.attachmentUrls ?? []), ...(await uploadToCloudinary(files, 'fund-quotations'))];

  const proposal = await retryOnDuplicate(async () =>
    FundProposal.create({
      code: await nextMonthlyCode(FundProposal, 'DXQ', { date: now }),
      fundId: fund._id,
      title,
      description,
      amount,
      estimatedAmount: amount,
      planType,
      planRef: planType === FUND_PLAN_TYPES.ANNUAL_PLAN ? planRef : null,
      urgentReason: planType === FUND_PLAN_TYPES.UNSCHEDULED ? urgentReason : null,
      largeRepair: linked ? true : Boolean(largeRepair), // sửa chữa thiết bị luôn là sửa chữa lớn
      workOrderId: linked ? oid(workOrderId) : null,
      attachmentUrls,
      proposedBy: user.id,
      status: PENDING,
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
  await safely(async () => notify(await vendorPickers(), {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất chi quỹ bảo trì chờ chọn nhà thầu: ${title}`,
    content:
      `${proposal.code} — ${title}, dự kiến ${formatVnd(amount)} (${planText(proposal)}). `
      + `Số dư khả dụng hiện tại ${formatVnd(available)}. Trưởng ban quản trị chọn nhà thầu và nhập báo giá, sau đó Ban quản trị biểu quyết.`,
    refId: proposal._id,
    link: proposalLink(proposal),
    email: true,
  }));
  return proposal;
}

/** Người nhận việc chọn nhà thầu: Trưởng ban; ban chưa có Trưởng ban thì báo cả ban để kiện toàn */
async function vendorPickers() {
  const members = await boardMembers();
  const chairman = members.filter((m) => m.boardTitle === BOARD_TITLES.CHAIRMAN);
  return (chairman.length ? chairman : members).map((m) => m._id);
}

/**
 * Trưởng ban quản trị chọn nhà thầu. body: { name, phone?, amount, note? } + ảnh hợp đồng (bắt buộc ≥ 1).
 * Số tiền đề xuất đổi thành giá báo (không vượt số dư khả dụng); cả ban biểu quyết trên số này. Chọn lại được tới khi có phiếu
 * Đồng ý đầu tiên. Sửa khẩn cấp (đang sửa): ghi nhà thầu vào phiếu ngay, báo KTV. Phiếu thường: ghi khi đề xuất được duyệt.
 */
export async function selectVendor(user, id, { name, phone = null, amount, note = null }, files = [], { now = new Date() } = {}) {
  // Đọc lại từ DB: token cũ có thể còn chức danh Trưởng ban sau khi đã đổi người
  if (!(await User.exists({ _id: user.id, role: ROLES.BOARD, boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true }))) throw ApiError.forbidden();
  const p = await FundProposal.findById(id).lean();
  if (!p) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (p.status !== PENDING) throw new ApiError('PROPOSAL_ALREADY_REVIEWED');
  if (p.votes.some((v) => v.decision === VOTE_DECISIONS.AGREE)) throw new ApiError('PROPOSAL_VENDOR_LOCKED');
  if (!files.length) throw ApiError.field('images', 'Đính kèm ít nhất 1 ảnh hợp đồng');
  const available = await availableBalance(p.fundId);
  if (amount > available) throw insufficient(available);
  const quoteUrls = await uploadToCloudinary(files, 'fund-quotations');
  const vendor = {
    name: name.trim(), phone: phone?.trim() || null, quoteUrls, amount, note: note?.trim() || null,
    selectedBy: user.id, selectedAt: now,
  };
  const text = `${vendor.name}, giá báo ${formatVnd(amount)}${p.vendor ? ` (thay ${p.vendor.name}, ${formatVnd(p.vendor.amount)})` : ''}`;
  const updated = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING, votes: AWAITING_VENDOR.votes, 'vendor.selectedAt': p.vendor?.selectedAt ?? null },
    { $set: { vendor, amount }, $push: { history: hist('VENDOR_SELECTED', user, now, text) } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new ApiError('CONCURRENT_UPDATE');
  await audit(AUDIT_ACTIONS.FUND_VENDOR_SELECTED, user, AUDIT_TARGETS.FUND_PROPOSAL, p._id, {
    code: p.code, vendor: vendor.name, amount, ...(p.vendor && { previousVendor: p.vendor.name, previousAmount: p.vendor.amount }),
  });
  await safely(async () => {
    const voted = new Set(updated.votes.map((v) => String(v.memberId)));
    const waiting = (await boardMembers()).filter((m) => !voted.has(String(m._id)));
    await notify(waiting.map((m) => m._id), {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đề xuất chi quỹ bảo trì chờ biểu quyết: ${p.title}`,
      content: `${p.code} — ${p.title}. Trưởng ban quản trị chọn nhà thầu ${text} (${planText(p)}). `
        + `Số dư khả dụng hiện tại ${formatVnd(available)}. Vui lòng vào hệ thống để Đồng ý hoặc Không đồng ý.`,
      refId: p._id,
      link: proposalLink(p),
      email: true,
    });
    await notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Đã chọn nhà thầu: ${p.title}`,
      content: `${p.code}: Trưởng ban quản trị chọn ${text}. Đang chờ Ban quản trị biểu quyết.`,
      refId: p._id,
      link: proposalLink(p),
    });
  });
  if (p.workOrderId) await safely(() => onVendorSelected(p.workOrderId, vendor.name));
  return updated;
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
    awaitingVendor: isAwaitingVendor(p),
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
    const next = await nextStepAfterApproval(p);
    await safely(async () => {
      await notifyRoles(['ACCOUNTANT', 'MANAGER'], {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: `Ban quản trị đã duyệt chi quỹ: ${p.title}`,
        content: `${p.code} được duyệt (${finalNote}), số tiền ${formatVnd(p.amount)}. ${next.text}`,
        refId: p._id,
        link: proposalLink(p),
        email: true,
      });
      // Phiếu khẩn cấp đã sửa xong + nghiệm thu kỹ thuật trước khi duyệt → việc tiếp theo là của Ban quản trị
      if (next.boardTurn) {
        const members = await boardMembers();
        await notify(members.map((m) => m._id), {
          type: NOTIFICATION_TYPES.FUND_APPROVAL,
          title: `Chờ xác nhận nghiệm thu: ${p.title}`,
          content: `${p.code} vừa được duyệt. ${next.text}`,
          refId: p._id,
          link: proposalLink(p),
          email: true,
        });
      }
    });
  } else if (!p.workOrderId) {
    // Đề xuất gắn phiếu bảo trì: phiếu đã tự báo Trưởng BQL quyết định lại (onFundDecision). Kế toán chưa tham gia nên không báo.
    await safely(() => notifyRoles(['MANAGER'], {
      type: NOTIFICATION_TYPES.FUND_APPROVAL,
      title: `Ban quản trị không duyệt chi quỹ: ${p.title}`,
      content: `${p.code} không đạt tỷ lệ đồng ý (${finalNote}). Cân nhắc phương án khác.`,
      refId: p._id,
      link: proposalLink(p),
      email: true,
    }));
  }
}

/**
 * Bước tiếp theo sau khi đề xuất được duyệt, theo trạng thái thực của phiếu bảo trì gắn kèm (phiếu khẩn cấp có thể đã sửa xong
 * và nghiệm thu kỹ thuật trước lúc duyệt). boardTurn: việc tiếp theo là Ban quản trị xác nhận nghiệm thu.
 */
async function nextStepAfterApproval(p) {
  if (!p.workOrderId) {
    return {
      text: p.largeRepair
        ? 'Sửa chữa lớn: Trưởng BQL nghiệm thu và Ban quản trị xác nhận xong thì Kế toán mới lập phiếu chi.'
        : 'Kế toán lập phiếu chi thực tế kèm hóa đơn, chứng từ.',
      boardTurn: false,
    };
  }
  const S = WORK_ORDER_STATUS;
  const wo = await WorkOrder.findById(p.workOrderId).select('status repair.isEmergency').lean();
  if (wo?.status === S.AWAITING_BOARD_ACCEPTANCE) {
    return {
      text: 'Phiếu bảo trì đã sửa xong và được Trưởng BQL nghiệm thu kỹ thuật: Ban quản trị xác nhận nghiệm thu, rồi Kế toán lập phiếu chi.',
      boardTurn: true,
    };
  }
  if (wo?.status === S.AWAITING_ACCEPTANCE) {
    return {
      text: 'Nhà thầu đã có biên bản: Trưởng BQL nghiệm thu kỹ thuật trên phiếu bảo trì, Ban quản trị xác nhận nghiệm thu, rồi Kế toán lập phiếu chi.',
      boardTurn: false,
    };
  }
  return {
    text: `${wo?.repair?.isEmergency ? 'Sửa chữa khẩn cấp đang tiến hành. ' : 'Phiếu bảo trì chuyển Đang sửa. '}`
      + 'Nhà thầu sửa xong: Trưởng BQL nghiệm thu kỹ thuật trên phiếu bảo trì, Ban quản trị xác nhận nghiệm thu, rồi Kế toán lập phiếu chi.',
    boardTurn: false,
  };
}

/** Ban quản trị biểu quyết. body: { decision: AGREE | DISAGREE, comment } — Không đồng ý phải ghi ý kiến; Đồng ý cần có nhà thầu */
export async function vote(user, id, { decision, comment = null }, { now = new Date() } = {}) {
  if (decision === VOTE_DECISIONS.DISAGREE && !comment?.trim()) throw ApiError.field('comment', 'Không đồng ý thì ghi rõ ý kiến');
  const current = await FundProposal.findById(id).select('status votes code vendor').lean();
  if (!current) throw ApiError.notFound('Không tìm thấy đề xuất chi');
  if (current.status !== PENDING) throw new ApiError('PROPOSAL_ALREADY_REVIEWED');
  if (current.votes.some((v) => String(v.memberId) === user.id)) throw new ApiError('PROPOSAL_ALREADY_VOTED');
  // Không đồng ý (không cần sửa) thì không cần nhà thầu; Đồng ý là đồng ý chi cho nhà thầu đã chọn
  if (decision === VOTE_DECISIONS.AGREE && isAwaitingVendor(current)) throw new ApiError('PROPOSAL_VENDOR_REQUIRED');

  // Kèm mốc chọn nhà thầu: Trưởng ban đổi nhà thầu giữa chừng thì phiếu này không tính cho nhà thầu mới
  const p = await FundProposal.findOneAndUpdate(
    { _id: id, status: PENDING, 'votes.memberId': { $ne: oid(user.id) }, 'vendor.selectedAt': current.vendor?.selectedAt ?? null },
    { $push: { votes: { memberId: user.id, decision, comment: comment || null, votedAt: now } } },
    { new: true },
  ).lean();
  if (!p) {
    const voted = await FundProposal.exists({ _id: id, 'votes.memberId': oid(user.id) });
    throw new ApiError(voted ? 'PROPOSAL_ALREADY_VOTED' : 'CONCURRENT_UPDATE');
  }
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
 * Trưởng BQL rút đề xuất đang chờ biểu quyết hoặc đã duyệt chưa chi (không gắn phiếu).
 * Đề xuất gắn phiếu bảo trì đã duyệt thì không rút được (phiếu đã sang Đang sửa, nhà thầu đã được liên hệ); rút lúc đang chờ
 * thì phiếu bỏ nguồn Quỹ, Trưởng BQL quyết định lại.
 */
export async function cancelProposal(user, id, { reason }, { now = new Date() } = {}) {
  const before = await FundProposal.findOneAndUpdate(
    { _id: id, $or: [{ status: PENDING }, { status: APPROVED, workOrderId: null }] },
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
  // Ban quản trị luôn biết đề xuất; Kế toán chỉ biết từ khi đã duyệt (chờ lập phiếu chi)
  const msg = {
    type: NOTIFICATION_TYPES.FUND_APPROVAL,
    title: `Đề xuất chi quỹ ${p.code} đã được rút`,
    content: `Trưởng BQL rút đề xuất "${p.title}": ${reason}`,
    refId: p._id,
    link: proposalLink(p),
  };
  await safely(async () => {
    const members = await boardMembers();
    await notify(members.map((m) => m._id), msg);
    if (before.status === APPROVED) await notifyRoles(['ACCOUNTANT'], msg);
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
// Cron FUND_PROPOSAL_REMIND (X8): đề xuất chờ biểu quyết quá FUND_APPROVAL_REMIND_DAYS ngày (tính từ lúc lập) → nhắc thành
// viên chưa bỏ phiếu + báo Trưởng BQL, N ngày/lần, không tự duyệt.
// ---------------------------------------------------------------------------
export async function remindProposals(now = new Date()) {
  const days = Number(await getConfig(CONFIG_KEYS.FUND_APPROVAL_REMIND_DAYS)) || 3;
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
    if (isAwaitingVendor(p)) {
      const ageDays = Math.floor((now - new Date(p.createdAt)) / DAY_MS);
      const msg = {
        type: NOTIFICATION_TYPES.FUND_APPROVAL,
        title: `Nhắc chọn nhà thầu: ${p.title}`,
        content: `${p.code} — ${p.title} (dự kiến ${formatVnd(p.amount)}) đã chờ Trưởng ban quản trị chọn nhà thầu ${ageDays} ngày.`,
        refId: p._id,
        link: proposalLink(p),
      };
      await safely(async () => {
        await notify(await vendorPickers(), { ...msg, email: true });
        await notifyRoles(['MANAGER'], msg);
      });
      continue;
    }
    const voted = new Set(p.votes.map((v) => String(v.memberId)));
    const waiting = members.filter((m) => !voted.has(String(m._id)));
    const age = Math.floor((now - new Date(p.createdAt)) / DAY_MS);
    const content = `${p.code} — ${p.title} (${formatVnd(p.amount)}) đã chờ biểu quyết ${age} ngày, còn ${waiting.length} thành viên chưa biểu quyết. Hệ thống không tự duyệt.`;
    await safely(async () => {
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
    });
  }
  return count;
}
