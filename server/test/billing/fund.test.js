// Bước 10 — Quỹ bảo trì 2% (UC33, UC34) theo hướng mới: Trưởng BQL lập đề xuất → Kế toán xác nhận tài chính / trả lại →
// Ban quản trị biểu quyết theo tỷ lệ (kiểm lại số dư khả dụng lúc chốt) → nghiệm thu 2 lớp với sửa chữa lớn → phiếu chi
// (thấp hơn số duyệt phải có lý do), nhắc quá N ngày (không tự duyệt).
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, FundProposal, FundTransaction, MaintenanceFund, Notification } from '../../src/models/index.js';
import {
  acceptWork,
  boardAcceptProposal,
  cancelProposal,
  createProposal,
  getOverview,
  getProposal,
  listProposals,
  neededAgree,
  recordExpense,
  recordIncome,
  selectVendor,
  remindProposals,
  vote,
} from '../../src/modules/fund/fund.service.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { stubCloudinary } from '../helpers/equipment.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { USERS, startApp } from '../helpers/http.js';

before(connectTestDB);
beforeEach(() => stubCloudinary());
afterEach(async () => {
  mock.restoreAll();
  await clearTestDB();
});
after(closeTestDB);

const NOW = new Date('2026-11-07T03:00:00Z');
const later = (days) => new Date(NOW.getTime() + days * DAY_MS);

async function setup({ boardSize = 3, balance = 500_000_000 } = {}) {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const managerDoc = await createManager();
  const board = [];
  for (let i = 0; i < boardSize; i += 1) {
    board.push(asUser(await createUser('BOARD', { boardTitle: i === 0 ? 'CHAIRMAN' : 'MEMBER' })));
  }
  if (balance) {
    await recordIncome(accountant, { incomeSource: 'INITIAL_HANDOVER', amount: balance, documentNo: 'BB-001' }, [], { now: NOW });
  }
  const manager = asUser(managerDoc);
  /** Trưởng BQL lập → Trưởng ban quản trị chọn nhà thầu → chờ biểu quyết */
  const submit = async (extra = {}) => {
    const p = await createProposal(manager, proposalBody(extra), [], { now: NOW });
    return selectVendor(board[0], p._id, vendorBody({ amount: p.amount }), [PHOTO], { now: NOW });
  };
  const approve = async (p) => {
    await vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW });
    return vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });
  };
  return { accountant, manager, managerDoc, board, submit, approve };
}

const proposalBody = (extra = {}) => ({
  title: 'Thay bơm nước sinh hoạt',
  description: 'Bơm số 2 cháy cuộn dây',
  amount: 100_000_000,
  planType: 'ANNUAL_PLAN',
  planRef: 'KH bảo trì 2026 (NQ Hội nghị 03/2026)',
  ...extra,
});
const vendorBody = (extra = {}) => ({ name: 'Công ty Cơ điện Đại Dương', phone: '0243 855 6677', amount: 100_000_000, ...extra });
const PHOTO = { originalname: 'bao-gia.jpg', mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };

test('thu quỹ có chứng từ: phiếu thu PTQ, cộng số dư, ghi Audit Log', async () => {
  const { accountant } = await setup({ balance: 0 });
  const tx = await recordIncome(accountant, { incomeSource: 'INTEREST', amount: 12_500_000, documentNo: 'SK-LAI-Q3' }, [], { now: NOW });
  assert.match(tx.code, /^PTQ-202611-00001$/);
  assert.equal(tx.balanceAfter, 12_500_000);
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 12_500_000);
  assert.equal(await AuditLog.countDocuments({ action: 'FUND_INCOME_RECORDED' }), 1);
  await assert.rejects(
    recordIncome(accountant, { incomeSource: 'INTEREST', amount: 1, documentNo: 'X', occurredAt: later(1) }, [], { now: NOW }),
    /tương lai/,
  );
});

test('Trưởng BQL lập đề xuất (không cần báo giá) → báo Trưởng ban chọn nhà thầu kèm số dư khả dụng; thành viên khác, Kế toán chưa được báo', async () => {
  const { accountant, manager, board } = await setup({ balance: 150_000_000 });
  await assert.rejects(createProposal(manager, proposalBody({ planRef: '' }), [], { now: NOW }), /Kế hoạch bảo trì năm/);
  await assert.rejects(createProposal(manager, proposalBody({ planType: 'UNSCHEDULED' }), [], { now: NOW }), /lý do/);
  await assert.rejects(createProposal(manager, proposalBody({ amount: 200_000_000 }), [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });

  // Trưởng BQL không ghi được nhà thầu / số báo giá: gửi kèm cũng bị bỏ
  const p = await createProposal(manager, proposalBody({ contractNo: 'HĐ-NT-07', vendor: vendorBody() }), [], { now: NOW });
  assert.match(p.code, /^DXQ-202611-00001$/);
  assert.equal(p.status, 'PENDING');
  assert.equal(p.isOpen, true);
  assert.equal(p.contractNo, null);
  assert.equal(p.vendor, null);
  assert.equal(p.estimatedAmount, 100_000_000);
  assert.deepEqual(p.history.map((h) => h.action), ['SUBMITTED']);
  const n = await Notification.findOne({ userId: board[0].id, title: /chờ chọn nhà thầu: Thay bơm/ }).lean();
  assert.match(n.content, /Số dư khả dụng hiện tại 150\.000\.000/);
  for (const u of [board[1], board[2], accountant]) assert.equal(await Notification.countDocuments({ userId: u.id, title: /chờ (chọn nhà thầu|biểu quyết)/ }), 0);
  const o = await getOverview({ now: NOW });
  assert.equal(o.pendingCount, 1);
  assert.equal(o.awaitingVendorCount, 1);
});

test('chọn nhà thầu: chỉ Trưởng ban; bắt buộc báo giá; giá báo thành số tiền, không vượt khả dụng; báo cả ban biểu quyết và Trưởng BQL', async () => {
  const { accountant, manager, managerDoc, board } = await setup({ balance: 150_000_000 });
  const p = await createProposal(manager, proposalBody(), [], { now: NOW });
  for (const u of [board[1], manager, accountant]) {
    await assert.rejects(selectVendor(u, p._id, vendorBody(), [], { now: NOW }), { errorCode: 'FORBIDDEN_ROLE' });
  }
  // Token cũ vẫn ghi CHAIRMAN nhưng DB đã đổi chức danh → chặn
  await assert.rejects(selectVendor({ ...board[1], boardTitle: 'CHAIRMAN' }, p._id, vendorBody(), [], { now: NOW }), { errorCode: 'FORBIDDEN_ROLE' });
  await assert.rejects(selectVendor(board[0], p._id, vendorBody(), [], { now: NOW }), (e) => {
    assert.deepEqual(e.details.map((d) => d.field), ['images']);
    return true;
  });
  await assert.rejects(selectVendor(board[0], p._id, vendorBody({ amount: 160_000_000 }), [PHOTO], { now: NOW }), { errorCode: 'FUND_INSUFFICIENT_BALANCE' });

  // Chưa có nhà thầu: không Đồng ý được
  await assert.rejects(vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW }), { errorCode: 'PROPOSAL_VENDOR_REQUIRED' });
  assert.equal((await getProposal(board[1], p._id)).awaitingVendor, true);

  const picked = await selectVendor(board[0], p._id, vendorBody({ amount: 92_000_000 }), [PHOTO], { now: NOW });
  assert.equal(picked.amount, 92_000_000);
  assert.equal(picked.estimatedAmount, 100_000_000);
  assert.equal(picked.vendor.name, 'Công ty Cơ điện Đại Dương');
  assert.equal(picked.vendor.quoteUrls.length, 1);
  assert.equal(String(picked.vendor.selectedBy), board[0].id);
  for (const m of board) {
    const n = await Notification.findOne({ userId: m.id, title: /chờ biểu quyết: Thay bơm/ }).lean();
    assert.match(n.content, /Công ty Cơ điện Đại Dương, giá báo 92\.000\.000/);
  }
  assert.equal(await Notification.countDocuments({ userId: managerDoc._id, title: /Đã chọn nhà thầu/ }), 1);
  assert.equal(await AuditLog.countDocuments({ action: 'FUND_VENDOR_SELECTED' }), 1);

  // Đổi được tới khi có phiếu Đồng ý; lịch sử ghi cả nhà thầu cũ
  const changed = await selectVendor(board[0], p._id, vendorBody({ name: 'Công ty Hưng Phát', amount: 88_000_000 }), [PHOTO], { now: NOW });
  assert.equal(changed.amount, 88_000_000);
  assert.match(changed.history.at(-1).note, /Hưng Phát.*thay Công ty Cơ điện Đại Dương, 92\.000\.000/);
  await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });
  await assert.rejects(selectVendor(board[0], p._id, vendorBody(), [], { now: NOW }), { errorCode: 'PROPOSAL_VENDOR_LOCKED' });
  assert.equal((await vote(board[2], p._id, { decision: 'AGREE' }, { now: NOW })).outcome, 'APPROVED');
  await assert.rejects(selectVendor(board[0], p._id, vendorBody(), [], { now: NOW }), { errorCode: 'PROPOSAL_ALREADY_REVIEWED' });
  // Phiếu chi không vượt giá nhà thầu đã duyệt
  await assert.rejects(recordExpense(accountant, p._id, { amount: 92_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /không vượt/);
});

test('chưa có nhà thầu vẫn Không đồng ý được (không cần sửa) → đủ thì từ chối; đề xuất cũ đã có phiếu Đồng ý thì biểu quyết tiếp; 2 lần chọn song song chỉ 1 thành công', async () => {
  const { manager, board } = await setup();
  const a = await createProposal(manager, proposalBody(), [], { now: NOW });
  await vote(board[1], a._id, { decision: 'DISAGREE', comment: 'Chưa cần sửa' }, { now: NOW });
  assert.equal((await vote(board[2], a._id, { decision: 'DISAGREE', comment: 'Chưa cần sửa' }, { now: NOW })).outcome, 'REJECTED');

  const legacy = await createProposal(manager, proposalBody(), [], { now: NOW });
  await FundProposal.updateOne({ _id: legacy._id }, { $push: { votes: { memberId: board[0].id, decision: 'AGREE', votedAt: NOW } } });
  assert.equal((await getProposal(board[1], legacy._id)).awaitingVendor, false);
  assert.equal((await vote(board[1], legacy._id, { decision: 'AGREE' }, { now: NOW })).outcome, 'APPROVED');

  const c = await createProposal(manager, proposalBody(), [], { now: NOW });
  const results = await Promise.allSettled([1, 2].map((i) => selectVendor(board[0], c._id, vendorBody({ name: `Nhà thầu ${i}` }), [PHOTO], { now: new Date(NOW.getTime() + i) })));
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const doc = await FundProposal.findById(c._id).lean();
  assert.equal(doc.history.filter((h) => h.action === 'VENDOR_SELECTED').length, results.filter((r) => r.status === 'fulfilled').length);
});

test('nhắc: chờ chọn nhà thầu quá hạn thì nhắc Trưởng ban, không nhắc thành viên khác biểu quyết', async () => {
  const { manager, board } = await setup();
  await createProposal(manager, proposalBody(), [], { now: NOW });
  assert.equal(await remindProposals(later(3)), 1);
  assert.equal(await Notification.countDocuments({ userId: board[0].id, title: /Nhắc chọn nhà thầu/ }), 1);
  assert.equal(await Notification.countDocuments({ userId: board[1].id, title: /Nhắc/ }), 0);
});

test('biểu quyết theo tỷ lệ: 3 thành viên, > 50% → cần 2 phiếu đồng ý; mỗi người 1 phiếu; Không đồng ý phải có ý kiến', async () => {
  const { board, submit } = await setup();
  assert.equal(neededAgree(0.5, 3), 2);
  assert.equal(neededAgree(0.5, 4), 3);
  const p = await submit();

  await assert.rejects(vote(board[0], p._id, { decision: 'DISAGREE' }, { now: NOW }), /ý kiến/);
  const r1 = await vote(board[0], p._id, { decision: 'AGREE', comment: 'Cần thiết' }, { now: NOW });
  assert.equal(r1.outcome, null);
  await assert.rejects(vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW }), { errorCode: 'PROPOSAL_ALREADY_VOTED' });

  const view = await getProposal(board[1], p._id);
  assert.equal(view.tally.needed, 2);
  assert.equal(view.tally.agree, 1);
  assert.equal(view.tally.notVoted.length, 2);
  assert.equal(view.myVote, null);
  assert.equal(view.available, 500_000_000);

  const r2 = await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });
  assert.equal(r2.outcome, 'APPROVED');
  assert.equal(r2.proposal.boardSize, 3);
  assert.equal(r2.proposal.isOpen, false);
  await assert.rejects(vote(board[2], p._id, { decision: 'AGREE' }, { now: NOW }), { errorCode: 'PROPOSAL_ALREADY_REVIEWED' });
  assert.equal(await AuditLog.countDocuments({ action: 'FUND_PROPOSAL_APPROVED' }), 1);
});

test('không còn khả năng đạt tỷ lệ → tự Từ chối, báo Trưởng BQL', async () => {
  const { board, managerDoc, submit } = await setup();
  const p = await submit();
  await vote(board[0], p._id, { decision: 'DISAGREE', comment: 'Giá cao' }, { now: NOW });
  const r = await vote(board[1], p._id, { decision: 'DISAGREE', comment: 'Xin thêm báo giá' }, { now: NOW });
  assert.equal(r.outcome, 'REJECTED');
  assert.equal(await Notification.countDocuments({ userId: managerDoc._id, title: /không duyệt chi quỹ/ }), 1);
});

test('BR-F16: đủ phiếu nhưng số dư khả dụng không đủ → không chốt, báo Kế toán + Trưởng BQL; thu thêm quỹ thì tự chốt', async () => {
  const { accountant, board, managerDoc, submit, approve } = await setup({ balance: 200_000_000 });
  const a = await submit({ title: 'Đề xuất A', amount: 150_000_000 });
  const b = await submit({ title: 'Đề xuất B', amount: 120_000_000 }); // cùng được xác nhận khi A chưa duyệt
  assert.equal((await approve(a)).outcome, 'APPROVED');

  await vote(board[0], b._id, { decision: 'AGREE' }, { now: NOW });
  const blocked = await vote(board[1], b._id, { decision: 'AGREE' }, { now: NOW });
  assert.equal(blocked.outcome, 'BLOCKED_BALANCE');
  assert.equal(blocked.proposal.status, 'PENDING');
  assert.ok(blocked.proposal.approvalBlockedAt);
  assert.equal(await Notification.countDocuments({ userId: managerDoc._id, title: /số dư khả dụng không đủ/ }), 1);
  assert.equal(await Notification.countDocuments({ userId: accountant.id, title: /số dư khả dụng không đủ/ }), 1);
  // phiếu thứ 3 không báo lại lần nữa
  assert.equal((await vote(board[2], b._id, { decision: 'AGREE' }, { now: NOW })).outcome, 'BLOCKED_BALANCE');
  assert.equal(await Notification.countDocuments({ userId: managerDoc._id, title: /số dư khả dụng không đủ/ }), 1);

  await recordIncome(accountant, { incomeSource: 'INTEREST', amount: 100_000_000, documentNo: 'LAI-01' }, [], { now: NOW });
  const doc = await FundProposal.findById(b._id).lean();
  assert.equal(doc.status, 'APPROVED');
  assert.equal(doc.approvalBlockedAt, null);
  // Người chốt là thành viên Ban quản trị bỏ phiếu cuối, không phải Kế toán ghi thu; nhật ký ghi hệ thống tự chốt
  assert.equal(String(doc.finalizedBy), board[2].id);
  assert.match(doc.finalNote ?? '', /3\/3/);
  const log = await AuditLog.findOne({ action: 'FUND_PROPOSAL_APPROVED', targetId: b._id }).lean();
  assert.equal(log.performedBy, null);
  assert.match(log.metadata.note, /tự chốt khi số dư khả dụng đủ \(ghi thu quỹ PTQ-/);
});

test('phiếu chi: chỉ khi đã duyệt, không vượt số duyệt, thấp hơn phải ghi lý do (BR-F17); trừ số dư; đề xuất → Đã chi', async () => {
  const { accountant, submit, approve } = await setup({ balance: 300_000_000 });
  const p = await submit();
  await assert.rejects(recordExpense(accountant, p._id, { amount: 1, documentNo: 'HĐ-1' }, [], { now: NOW }), /đã được Ban quản trị duyệt/);
  await approve(p);

  await assert.rejects(recordExpense(accountant, p._id, { amount: 120_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /không vượt/);
  await assert.rejects(recordExpense(accountant, p._id, { amount: 95_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), {
    errorCode: 'EXPENSE_VARIANCE_REASON_REQUIRED',
  });
  const tx = await recordExpense(accountant, p._id, { amount: 95_000_000, documentNo: 'HĐ-0012345', varianceReason: 'Nhà thầu giảm giá 5%' }, [], { now: NOW });
  assert.match(tx.code, /^PCQ-202611-00001$/);
  assert.equal(tx.balanceAfter, 205_000_000);
  assert.equal(tx.varianceReason, 'Nhà thầu giảm giá 5%');
  const doc = await FundProposal.findById(p._id).lean();
  assert.equal(doc.status, 'PAID');
  assert.equal(String(doc.expenseTxId), String(tx._id));
  await assert.rejects(recordExpense(accountant, p._id, { amount: 1, documentNo: 'HĐ-2' }, [], { now: NOW }), /chưa chi/);

  const overview = await getOverview({ now: NOW });
  assert.equal(overview.balance, 205_000_000);
  assert.equal(overview.yearExpense, 95_000_000);
  assert.equal(overview.committed, 0);
});

test('số dư không bao giờ âm: số dư bị giảm sau khi duyệt → FUND_INSUFFICIENT_BALANCE', async () => {
  const { accountant, submit, approve } = await setup({ balance: 100_000_000 });
  const p = await submit();
  await approve(p);
  await MaintenanceFund.updateOne({}, { $set: { balance: 50_000_000 } }); // vd chi khác ngoài hệ thống đã đối chiếu
  await assert.rejects(recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 50_000_000);
  assert.equal(await FundTransaction.countDocuments({ type: 'EXPENSE' }), 0);
  assert.equal((await FundProposal.findById(p._id).lean()).status, 'APPROVED');
});

test('sửa chữa lớn: Trưởng BQL nghiệm thu + Ban quản trị xác nhận mới lập phiếu chi (M10-3, BR-E09); đã cam kết trừ vào số có thể chi', async () => {
  const { accountant, manager, board, submit, approve } = await setup({ balance: 150_000_000 });
  const p = await submit({ largeRepair: true });
  await approve(p);

  // 100tr đã duyệt chưa chi → chỉ còn 50tr có thể đề xuất
  await assert.rejects(createProposal(manager, proposalBody({ amount: 60_000_000 }), [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });

  await assert.rejects(recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /Trưởng BQL nghiệm thu/);
  await assert.rejects(boardAcceptProposal(board[0], p._id, {}, { now: NOW }), /Trưởng BQL đã nghiệm thu/);
  await acceptWork(manager, p._id, { now: NOW });
  await assert.rejects(acceptWork(manager, p._id, { now: NOW }), /chưa nghiệm thu/);
  await assert.rejects(recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /Ban quản trị xác nhận/);
  assert.equal((await listProposals({ readyToPay: true })).items.length, 0, 'chưa đủ nghiệm thu 2 lớp thì chưa vào danh sách chờ chi');
  await boardAcceptProposal(board[0], p._id, { note: 'Đúng hạng mục' }, { now: NOW });
  assert.deepEqual((await listProposals({ readyToPay: true })).items.map((x) => String(x._id)), [String(p._id)]);
  assert.equal((await getOverview({ now: NOW })).readyToPayCount, 1);
  assert.ok(await Notification.exists({ userId: accountant.id, title: /lập phiếu chi/ }));
  const tx = await recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW });
  assert.equal(tx.balanceAfter, 50_000_000);
});

test('Trưởng BQL rút đề xuất đang chờ; nhắc Ban quản trị chưa bỏ phiếu + báo Trưởng BQL quá 3 ngày, 3 ngày/lần, không tự duyệt', async () => {
  const { accountant, manager, board, managerDoc, submit } = await setup();
  const p1 = await submit();
  const p2 = await createProposal(manager, proposalBody({ title: 'Sơn hành lang', amount: 10_000_000 }), [], { now: NOW });
  await cancelProposal(manager, p2._id, { reason: 'Gộp vào đợt sau' });
  assert.equal((await FundProposal.findById(p2._id).lean()).isOpen, false);
  for (const m of board) assert.equal(await Notification.countDocuments({ userId: m.id, title: /đã được rút/ }), 1, 'Ban quản trị được báo rút');
  assert.equal(await Notification.countDocuments({ userId: accountant.id, title: /đã được rút/ }), 0, 'chưa duyệt thì Kế toán không liên quan');
  await assert.rejects(cancelProposal(manager, p2._id, { reason: 'Rút lần nữa' }), /Chỉ rút/);
  await vote(board[0], p1._id, { decision: 'AGREE' }, { now: NOW });

  const count = (userId, title) => Notification.countDocuments({ userId, title });
  assert.equal(await remindProposals(later(2)), 0);
  assert.equal(await remindProposals(later(3)), 1);
  assert.equal(await count(board[0].id, /Nhắc biểu quyết/), 0, 'người đã bỏ phiếu không bị nhắc');
  assert.equal(await count(board[1].id, /Nhắc biểu quyết/), 1);
  assert.equal(await count(managerDoc._id, /chờ quá/), 1);
  assert.equal(await count(accountant.id, /Nhắc/), 0);
  assert.equal(await remindProposals(later(4)), 0);
  assert.equal(await remindProposals(later(6)), 1);
  assert.equal((await FundProposal.findById(p1._id).lean()).status, 'PENDING');
});

test('phân quyền API quỹ: Trưởng BQL lập / rút, Kế toán thu chi, Ban quản trị biểu quyết, cư dân không xem; không còn route xác nhận / trả lại', async () => {
  const app = await startApp();
  try {
    const id = '64b000000000000000000009';
    assert.equal((await app.request('GET', '/fund', { user: USERS.resident })).status, 403);
    assert.equal((await app.request('POST', '/fund/proposals', { user: { role: 'ACCOUNTANT' }, body: proposalBody() })).status, 403);
    assert.equal((await app.request('POST', '/fund/proposals', { user: USERS.manager, body: { title: 'x' } })).status, 400);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/verify`, { user: { role: 'ACCOUNTANT' }, body: {} })).status, 404);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/return`, { user: { role: 'ACCOUNTANT' }, body: { reason: 'Thiếu chứng từ' } })).status, 404);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/cancel`, { user: { role: 'ACCOUNTANT' }, body: { reason: 'Rút đề xuất' } })).status, 403);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/votes`, { user: USERS.manager, body: { decision: 'AGREE' } })).status, 403);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/board-accept`, { user: USERS.manager, body: {} })).status, 403);
    assert.equal(
      (await app.request('POST', `/fund/proposals/${id}/votes`, { user: { role: 'BOARD' }, body: { decision: 'MAYBE' } })).status,
      400,
    );
  } finally {
    await app.close();
  }
});
