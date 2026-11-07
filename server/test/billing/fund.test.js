// Bước 10 — Quỹ bảo trì 2% (UC33, UC34): thu quỹ có chứng từ, đề xuất chi, Ban quản trị biểu quyết theo tỷ lệ,
// nghiệm thu sửa chữa lớn, phiếu chi trừ số dư không âm, nhắc quá 3 ngày (không tự duyệt).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, FundProposal, FundTransaction, MaintenanceFund, Notification } from '../../src/models/index.js';
import {
  acceptWork,
  cancelProposal,
  createProposal,
  getOverview,
  getProposal,
  neededAgree,
  recordExpense,
  recordIncome,
  remindProposals,
  vote,
} from '../../src/modules/fund/fund.service.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { USERS, startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
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
  return { accountant, manager: asUser(managerDoc), managerDoc, board };
}

const proposalBody = (extra = {}) => ({
  title: 'Thay bơm nước sinh hoạt',
  description: 'Bơm số 2 cháy cuộn dây',
  amount: 100_000_000,
  planType: 'ANNUAL_PLAN',
  planRef: 'KH bảo trì 2026 (NQ Hội nghị 03/2026)',
  ...extra,
});

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

test('đề xuất chi: kiểm tra kế hoạch / lý do đột xuất, không vượt số dư còn có thể chi; báo Ban quản trị', async () => {
  const { accountant, board } = await setup({ balance: 150_000_000 });
  await assert.rejects(createProposal(accountant, proposalBody({ planRef: '' }), [], { now: NOW }), /Kế hoạch bảo trì năm/);
  await assert.rejects(createProposal(accountant, proposalBody({ planType: 'UNSCHEDULED' }), [], { now: NOW }), /lý do/);
  await assert.rejects(createProposal(accountant, proposalBody({ amount: 200_000_000 }), [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });

  const p = await createProposal(accountant, proposalBody(), [], { now: NOW });
  assert.match(p.code, /^DXQ-202611-00001$/);
  assert.equal(p.status, 'PENDING');
  for (const m of board) assert.equal(await Notification.countDocuments({ userId: m.id, type: 'FUND_APPROVAL' }), 1);
});

test('biểu quyết theo tỷ lệ: 3 thành viên, > 50% → cần 2 phiếu đồng ý; mỗi người 1 phiếu; Không đồng ý phải có ý kiến', async () => {
  const { accountant, board } = await setup();
  assert.equal(neededAgree(0.5, 3), 2);
  assert.equal(neededAgree(0.5, 4), 3);
  const p = await createProposal(accountant, proposalBody(), [], { now: NOW });

  await assert.rejects(vote(board[0], p._id, { decision: 'DISAGREE' }, { now: NOW }), /ý kiến/);
  const r1 = await vote(board[0], p._id, { decision: 'AGREE', comment: 'Cần thiết' }, { now: NOW });
  assert.equal(r1.outcome, null);
  await assert.rejects(vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW }), { errorCode: 'PROPOSAL_ALREADY_VOTED' });

  const view = await getProposal(board[1], p._id);
  assert.equal(view.tally.needed, 2);
  assert.equal(view.tally.agree, 1);
  assert.equal(view.tally.notVoted.length, 2);
  assert.equal(view.myVote, null);

  const r2 = await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });
  assert.equal(r2.outcome, 'APPROVED');
  assert.equal(r2.proposal.boardSize, 3);
  await assert.rejects(vote(board[2], p._id, { decision: 'AGREE' }, { now: NOW }), { errorCode: 'PROPOSAL_ALREADY_REVIEWED' });
  assert.equal(await AuditLog.countDocuments({ action: 'FUND_PROPOSAL_APPROVED' }), 1);
});

test('không còn khả năng đạt tỷ lệ → tự Từ chối, báo Trưởng BQL', async () => {
  const { accountant, board, managerDoc } = await setup();
  const p = await createProposal(accountant, proposalBody(), [], { now: NOW });
  await vote(board[0], p._id, { decision: 'DISAGREE', comment: 'Giá cao' }, { now: NOW });
  const r = await vote(board[1], p._id, { decision: 'DISAGREE', comment: 'Xin thêm báo giá' }, { now: NOW });
  assert.equal(r.outcome, 'REJECTED');
  assert.equal(await Notification.countDocuments({ userId: managerDoc._id, type: 'FUND_APPROVAL' }), 1);
});

test('phiếu chi: chỉ khi đã duyệt, không vượt số duyệt, trừ số dư; đề xuất → Đã chi', async () => {
  const { accountant, board } = await setup({ balance: 300_000_000 });
  const p = await createProposal(accountant, proposalBody(), [], { now: NOW });
  await assert.rejects(recordExpense(accountant, p._id, { amount: 1, documentNo: 'HĐ-1' }, [], { now: NOW }), /đã được Ban quản trị duyệt/);
  await vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW });
  await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });

  await assert.rejects(recordExpense(accountant, p._id, { amount: 120_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /không vượt/);
  const tx = await recordExpense(accountant, p._id, { amount: 95_000_000, documentNo: 'HĐ-0012345' }, [], { now: NOW });
  assert.match(tx.code, /^PCQ-202611-00001$/);
  assert.equal(tx.balanceAfter, 205_000_000);
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
  const { accountant, board } = await setup({ balance: 100_000_000 });
  const p = await createProposal(accountant, proposalBody(), [], { now: NOW });
  await vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW });
  await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });
  await MaintenanceFund.updateOne({}, { $set: { balance: 50_000_000 } }); // vd chi khác ngoài hệ thống đã đối chiếu
  await assert.rejects(recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });
  assert.equal((await MaintenanceFund.findOne().lean()).balance, 50_000_000);
  assert.equal(await FundTransaction.countDocuments({ type: 'EXPENSE' }), 0);
  assert.equal((await FundProposal.findById(p._id).lean()).status, 'APPROVED');
});

test('sửa chữa lớn: phải được Trưởng BQL nghiệm thu mới lập phiếu chi (M10-3); đã cam kết trừ vào số có thể chi', async () => {
  const { accountant, manager, board } = await setup({ balance: 150_000_000 });
  const p = await createProposal(accountant, proposalBody({ largeRepair: true }), [], { now: NOW });
  await vote(board[0], p._id, { decision: 'AGREE' }, { now: NOW });
  await vote(board[1], p._id, { decision: 'AGREE' }, { now: NOW });

  // 100tr đã duyệt chưa chi → chỉ còn 50tr có thể đề xuất
  await assert.rejects(createProposal(accountant, proposalBody({ amount: 60_000_000 }), [], { now: NOW }), {
    errorCode: 'FUND_INSUFFICIENT_BALANCE',
  });

  await assert.rejects(recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW }), /nghiệm thu/);
  await acceptWork(manager, p._id, { now: NOW });
  await assert.rejects(acceptWork(manager, p._id, { now: NOW }), /chưa nghiệm thu/);
  const tx = await recordExpense(accountant, p._id, { amount: 100_000_000, documentNo: 'HĐ-1' }, [], { now: NOW });
  assert.equal(tx.balanceAfter, 50_000_000);
});

test('rút đề xuất; nhắc Ban quản trị chưa bỏ phiếu + báo Trưởng BQL sau 3 ngày, 3 ngày/lần, không tự duyệt', async () => {
  const { accountant, board, managerDoc } = await setup();
  const p1 = await createProposal(accountant, proposalBody(), [], { now: NOW });
  const p2 = await createProposal(accountant, proposalBody({ title: 'Sơn hành lang', amount: 10_000_000 }), [], { now: NOW });
  await cancelProposal(accountant, p2._id, { reason: 'Gộp vào đợt sau' });
  await assert.rejects(cancelProposal(accountant, p2._id, { reason: 'Rút lần nữa' }), /Chỉ rút/);
  await vote(board[0], p1._id, { decision: 'AGREE' }, { now: NOW });
  await FundProposal.collection.updateOne({ _id: p1._id }, { $set: { createdAt: NOW } }); // bỏ qua timestamps của Mongoose

  const count = (userId) => Notification.countDocuments({ userId, title: /Nhắc biểu quyết|chờ quá/ });
  assert.equal(await remindProposals(later(2)), 0);
  assert.equal(await remindProposals(later(3)), 1);
  assert.equal(await count(board[0].id), 0, 'người đã bỏ phiếu không bị nhắc');
  assert.equal(await count(board[1].id), 1);
  assert.equal(await count(managerDoc._id), 1);
  assert.equal(await remindProposals(later(4)), 0);
  assert.equal(await remindProposals(later(6)), 1);
  assert.equal((await FundProposal.findById(p1._id).lean()).status, 'PENDING');
});

test('phân quyền API quỹ: chỉ Kế toán lập đề xuất / thu quỹ, chỉ Ban quản trị biểu quyết, cư dân không xem', async () => {
  const app = await startApp();
  try {
    const id = '64b000000000000000000009';
    assert.equal((await app.request('GET', '/fund', { user: USERS.resident })).status, 403);
    assert.equal((await app.request('POST', '/fund/proposals', { user: USERS.manager, body: proposalBody() })).status, 403);
    assert.equal((await app.request('POST', `/fund/proposals/${id}/votes`, { user: USERS.manager, body: { decision: 'AGREE' } })).status, 403);
    assert.equal(
      (await app.request('POST', `/fund/proposals/${id}/votes`, { user: { role: 'BOARD' }, body: { decision: 'MAYBE' } })).status,
      400,
    );
  } finally {
    await app.close();
  }
});
