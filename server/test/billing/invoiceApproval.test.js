// Mô đun 4 — Bước 3: Trình duyệt, Duyệt & Phát hành, Trả lại, nhắc Trưởng BQL duyệt quá hạn.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, FeeType, Invoice, Notification, PrepaidBalance, PrepaidTransaction } from '../../src/models/index.js';
import { publishInvoices, remindPendingApprovals, returnInvoices, submitInvoices } from '../../src/modules/invoices/invoices.approval.js';
import { addOtherItem } from '../../src/modules/invoices/invoices.drafts.js';
import { generateForApartment } from '../../src/modules/invoices/invoices.service.js';
import { billingSummary } from '../../src/modules/reports/reports.service.js';
import { DAY_MS } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createManager, createUser } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const PERIOD = '2026-10';
const NOW = new Date('2026-10-15T03:00:00Z');
const TOTAL = 70 * 7000;

async function setup() {
  const accountantUser = await createUser('ACCOUNTANT');
  const managerUser = await createManager();
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  await FeeType.create({
    code: 'CLEANING',
    name: 'Phí vệ sinh',
    feeCategory: 'CLEANING',
    calcMethod: 'PER_M2',
    unitPrice: 7000,
    effectiveFrom: new Date('2026-01-01T00:00:00+07:00'),
  });
  const accountant = asUser(accountantUser);
  const manager = asUser(managerUser);
  const draft = await generateForApartment(accountant, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });
  return { accountant, accountantUser, manager, managerUser, owner, apartment, draft };
}

const countNotif = (userId, type) => Notification.countDocuments({ userId, type });

test('trình duyệt: Nháp → Chờ duyệt, báo Trưởng BQL, chạy lại bỏ qua', async () => {
  const { accountant, managerUser, draft } = await setup();
  const r = await submitInvoices(accountant, { period: PERIOD }, { now: NOW });
  assert.equal(r.count, 1);
  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.status, 'PENDING_APPROVAL');
  assert.equal(String(inv.submittedBy), String(accountant.id));
  assert.equal(await countNotif(managerUser._id, 'INVOICE_APPROVAL'), 1);

  const again = await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  assert.equal(again.count, 0);
  assert.equal(again.skipped[0].status, 'PENDING_APPROVAL');
});

test('trả lại: về Nháp kèm lý do, báo Kế toán, Kế toán sửa tiếp được', async () => {
  const { accountant, accountantUser, manager, draft } = await setup();
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  const r = await returnInvoices(manager, { invoiceIds: [draft._id], reason: 'Thiếu phí gửi xe' }, { now: NOW });
  assert.equal(r.count, 1);

  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.status, 'DRAFT');
  assert.equal(inv.returnNote, 'Thiếu phí gửi xe');
  assert.equal(await countNotif(accountantUser._id, 'INVOICE_APPROVAL'), 1);

  const edited = await addOtherItem(accountant, draft._id, { description: 'Làm lại thẻ xe', amount: 50_000 });
  assert.equal(edited.totalAmount, TOTAL + 50_000);
});

test('phát hành: Chờ duyệt → Chưa thanh toán, có hạn đóng, gửi cho Người nộp phí, ghi Audit Log', async () => {
  const { accountant, manager, owner, draft } = await setup();
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  const r = await publishInvoices(manager, { period: PERIOD }, { now: NOW });
  assert.equal(r.count, 1);

  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.status, 'UNPAID');
  assert.equal(inv.issuedAt.getTime(), NOW.getTime());
  assert.equal(inv.dueDate.getTime(), NOW.getTime() + 15 * DAY_MS); // PAYMENT_TERM_DAYS mặc định 15
  assert.equal(String(inv.reviewedBy), String(manager.id));
  assert.equal(await countNotif(owner._id, 'INVOICE'), 1);
  assert.ok(await AuditLog.exists({ targetId: draft._id, action: 'INVOICE_PUBLISHED' }));

  // Phát hành lại không xử lý lần 2
  const again = await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });
  assert.equal(again.count, 0);
  assert.equal(await countNotif(owner._id, 'INVOICE'), 1);
});

test('không phát hành được thông báo còn Nháp (chưa trình duyệt)', async () => {
  const { manager, owner, draft } = await setup();
  const r = await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });
  assert.equal(r.count, 0);
  assert.equal(r.skipped[0].status, 'DRAFT');
  assert.equal((await Invoice.findById(draft._id).lean()).status, 'DRAFT');
  assert.equal(await countNotif(owner._id, 'INVOICE'), 0);
});

test('phát hành trừ Số dư trả trước: thiếu → Thanh toán một phần; đủ → Đã thanh toán', async () => {
  const { accountant, manager, owner, apartment, draft } = await setup();
  await PrepaidBalance.create({ apartmentId: apartment._id, payerId: owner._id, balance: 200_000 });
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });

  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.status, 'PARTIALLY_PAID');
  assert.equal(inv.paidAmount, 200_000);
  assert.equal(inv.prepaidApplied, 200_000);
  assert.equal((await PrepaidBalance.findOne({ apartmentId: apartment._id }).lean()).balance, 0);
  const tx = await PrepaidTransaction.findOne({ invoiceId: draft._id }).lean();
  assert.equal(tx.type, 'APPLY');
  assert.equal(tx.amount, 200_000);
  assert.equal(tx.balanceAfter, 0);
});

test('phát hành: số dư lớn hơn tiền kỳ → Đã thanh toán, còn dư giữ lại', async () => {
  const { accountant, manager, owner, apartment, draft } = await setup();
  await PrepaidBalance.create({ apartmentId: apartment._id, payerId: owner._id, balance: TOTAL + 100_000 });
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });

  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.status, 'PAID');
  assert.equal(inv.paidAmount, TOTAL);
  assert.equal(inv.paidAt.getTime(), NOW.getTime());
  assert.equal((await PrepaidBalance.findOne({ apartmentId: apartment._id }).lean()).balance, 100_000);
});

test('Nợ các kỳ trước: chỉ tính nợ của chính Người nộp phí, không cộng vào tiền kỳ mới', async () => {
  const { accountant, manager, owner, apartment, draft } = await setup();
  const other = await createUser('RESIDENT');
  const base = { apartmentId: apartment._id, buildingId: apartment.buildingId, items: [], issuedAt: NOW, dueDate: NOW };
  await Invoice.create([
    { ...base, code: 'OLD-1', period: '2026-08', payerId: owner._id, totalAmount: 300_000, paidAmount: 100_000, status: 'PARTIALLY_PAID' },
    { ...base, code: 'OLD-2', period: '2026-09', payerId: owner._id, totalAmount: 250_000, status: 'OVERDUE' },
    { ...base, code: 'OLD-3', period: '2026-07', payerId: other._id, totalAmount: 999_000, status: 'OVERDUE' }, // chủ cũ
    { ...base, code: 'OLD-4', period: '2026-06', payerId: owner._id, totalAmount: 500_000, paidAmount: 500_000, status: 'PAID' },
  ]);
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });

  const inv = await Invoice.findById(draft._id).lean();
  assert.equal(inv.previousDebt, 200_000 + 250_000);
  assert.equal(inv.totalAmount, TOTAL);
});

test('báo cáo thu phí bỏ qua Nháp / Chờ duyệt', async () => {
  const { accountant, manager, draft } = await setup();
  const before1 = await billingSummary({ from: PERIOD, to: PERIOD });
  assert.equal(before1.overview.issued, 0);
  assert.equal(before1.overview.billed, 0);

  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  assert.equal((await billingSummary({ from: PERIOD, to: PERIOD })).overview.billed, 0);

  await publishInvoices(manager, { invoiceIds: [draft._id] }, { now: NOW });
  const after1 = await billingSummary({ from: PERIOD, to: PERIOD });
  assert.equal(after1.overview.issued, 1);
  assert.equal(after1.overview.billed, TOTAL);
});

test('cron nhắc Trưởng BQL khi chờ duyệt quá 2 ngày, chưa quá thì không nhắc', async () => {
  const { accountant, managerUser, draft } = await setup();
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now: NOW });
  await Notification.deleteMany({});

  assert.equal(await remindPendingApprovals(new Date(NOW.getTime() + DAY_MS)), 0);
  assert.equal(await remindPendingApprovals(new Date(NOW.getTime() + 2 * DAY_MS)), 1);
  assert.equal(await countNotif(managerUser._id, 'INVOICE_APPROVAL'), 1);
  assert.equal((await Invoice.findById(draft._id).lean()).status, 'PENDING_APPROVAL'); // không tự duyệt
});
