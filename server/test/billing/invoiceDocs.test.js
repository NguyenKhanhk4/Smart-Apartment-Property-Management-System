// Mô đun 4 — việc lẻ: khoản điều chỉnh vào kỳ sau (M4-5), PDF thông báo phí, PDF biên lai (không thay thế hóa đơn GTGT).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, FeeType, Invoice, InvoiceAdjustment, Payment, PrepaidBalance, SystemConfig } from '../../src/models/index.js';
import { cancelAdjustment, createAdjustment, listAdjustments } from '../../src/modules/invoices/invoices.adjustments.js';
import { publishInvoices, submitInvoices } from '../../src/modules/invoices/invoices.approval.js';
import { recalculateDraft } from '../../src/modules/invoices/invoices.drafts.js';
import { transferContent } from '../../src/modules/invoices/invoices.payinfo.js';
import { buildInvoicePdf } from '../../src/modules/invoices/invoices.pdf.js';
import { getInvoice } from '../../src/modules/invoices/invoices.queries.js';
import { generateForApartment } from '../../src/modules/invoices/invoices.service.js';
import { recordOfflinePayment } from '../../src/modules/payments/payments.service.js';
import { buildReceiptPdf } from '../../src/modules/payments/receipt.pdf.js';
import { moneyInWords } from '../../src/services/export.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createUser } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';
import { startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const OCT = new Date('2026-10-15T03:00:00Z');
const NOV = new Date('2026-11-07T03:00:00Z');
const MONTHLY = 70 * 7000; // căn 70 m² × 7.000 đ

async function setup() {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const manager = asUser(await createUser('MANAGER'));
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
  return { accountant, manager, owner, apartment };
}

/** Tính + trình + phát hành 1 kỳ cho căn → thông báo đã phát hành */
async function publishPeriod({ accountant, manager, apartment }, period, now) {
  const draft = await generateForApartment(accountant, { period, apartmentId: apartment._id }, { now });
  await submitInvoices(accountant, { invoiceIds: [draft._id] }, { now });
  await publishInvoices(manager, { invoiceIds: [draft._id] }, { now });
  return Invoice.findById(draft._id).lean();
}

const REASON = 'Tính trùng phí vệ sinh tháng 10, hoàn lại phần thừa';

test('khoản điều chỉnh: lập trên thông báo đã phát hành → vào Nháp kỳ sau, tính lại không nhân đôi → phát hành thì Đã áp dụng', async () => {
  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  assert.equal(oct.status, 'UNPAID');

  const down = await createAdjustment(ctx.accountant, oct._id, { amount: -50_000, reason: REASON });
  await createAdjustment(ctx.accountant, oct._id, { amount: 30_000, reason: 'Thiếu phí làm lại thẻ xe tháng 10' });
  assert.equal(down.status, 'PENDING');
  assert.equal(String(down.payerId._id), String(ctx.owner._id));
  assert.equal(await AuditLog.countDocuments({ action: 'INVOICE_ADJUSTED' }), 2);

  const nov = await generateForApartment(ctx.accountant, { period: '2026-11', apartmentId: ctx.apartment._id }, { now: NOV });
  const adjItems = nov.items.filter((i) => i.feeCategory === 'ADJUSTMENT');
  assert.equal(adjItems.length, 2);
  assert.match(adjItems[0].description, /Tính trùng phí vệ sinh/);
  assert.equal(nov.totalAmount, MONTHLY - 20_000);
  assert.equal(await InvoiceAdjustment.countDocuments({ invoiceId: nov._id }), 2);

  const again = await recalculateDraft(ctx.accountant, nov._id);
  assert.equal(again.totalAmount, MONTHLY - 20_000, 'tính lại không cộng điều chỉnh 2 lần');

  // Màn hình duyệt: khoản điều chỉnh của kỳ 11 hiện riêng, có tổng tăng / giảm
  const list = await listAdjustments({ period: '2026-11' });
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.summary, { increase: 30_000, decrease: -50_000, count: 2 });

  await submitInvoices(ctx.accountant, { invoiceIds: [nov._id] }, { now: NOV });
  await publishInvoices(ctx.manager, { invoiceIds: [nov._id] }, { now: NOV });
  assert.equal(await InvoiceAdjustment.countDocuments({ status: 'APPLIED' }), 2);

  // Kỳ sau nữa không tính lại các khoản đã áp dụng
  const dec = await generateForApartment(ctx.accountant, { period: '2026-12', apartmentId: ctx.apartment._id }, { now: new Date('2026-12-02T03:00:00Z') });
  assert.equal(dec.items.filter((i) => i.feeCategory === 'ADJUSTMENT').length, 0);
});

test('khoản điều chỉnh: chỉ cho thông báo đã phát hành; tổng giảm không vượt số tiền thông báo', async () => {
  const ctx = await setup();
  const draft = await generateForApartment(ctx.accountant, { period: '2026-10', apartmentId: ctx.apartment._id }, { now: OCT });
  await assert.rejects(createAdjustment(ctx.accountant, draft._id, { amount: 10_000, reason: REASON }), /đã phát hành/);

  await submitInvoices(ctx.accountant, { invoiceIds: [draft._id] }, { now: OCT });
  await publishInvoices(ctx.manager, { invoiceIds: [draft._id] }, { now: OCT });
  await createAdjustment(ctx.accountant, draft._id, { amount: -(MONTHLY - 10_000), reason: REASON });
  await assert.rejects(createAdjustment(ctx.accountant, draft._id, { amount: -20_000, reason: REASON }), /tối đa 10\.000/);
});

test('giảm vượt số phải trả kỳ sau → thông báo 0 đ, phần dư vào Số dư trả trước khi phát hành', async () => {
  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  await createAdjustment(ctx.accountant, oct._id, { amount: -MONTHLY, reason: REASON });
  // Đổi đơn giá kỳ 11 thấp hơn để số giảm vượt số phải trả
  await FeeType.updateOne({ code: 'CLEANING' }, { $set: { unitPrice: 5000 } });

  const nov = await generateForApartment(ctx.accountant, { period: '2026-11', apartmentId: ctx.apartment._id }, { now: NOV });
  assert.equal(nov.totalAmount, 0);
  assert.equal(nov.adjustmentCredit, MONTHLY - 70 * 5000);

  await submitInvoices(ctx.accountant, { invoiceIds: [nov._id] }, { now: NOV });
  await publishInvoices(ctx.manager, { invoiceIds: [nov._id] }, { now: NOV });
  const bal = await PrepaidBalance.findOne({ apartmentId: ctx.apartment._id, payerId: ctx.owner._id }).lean();
  assert.equal(bal.balance, MONTHLY - 70 * 5000);
  assert.equal((await Invoice.findById(nov._id).lean()).status, 'PAID');
});

test('hủy khoản điều chỉnh: đang ở Nháp thì gỡ khỏi Nháp; Nháp đã trình duyệt thì không hủy được', async () => {
  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  const adj = await createAdjustment(ctx.accountant, oct._id, { amount: -50_000, reason: REASON });
  const nov = await generateForApartment(ctx.accountant, { period: '2026-11', apartmentId: ctx.apartment._id }, { now: NOV });

  await submitInvoices(ctx.accountant, { invoiceIds: [nov._id] }, { now: NOV });
  await assert.rejects(cancelAdjustment(ctx.accountant, adj._id, { reason: 'Lập nhầm' }), /trả lại về Nháp/);
  await Invoice.updateOne({ _id: nov._id }, { $set: { status: 'DRAFT' } });

  const cancelled = await cancelAdjustment(ctx.accountant, adj._id, { reason: 'Lập nhầm' });
  assert.equal(cancelled.status, 'CANCELLED');
  const after = await Invoice.findById(nov._id).lean();
  assert.equal(after.totalAmount, MONTHLY);
  assert.equal(after.items.some((i) => i.feeCategory === 'ADJUSTMENT'), false);
  assert.equal(await AuditLog.countDocuments({ action: 'INVOICE_ADJUSTMENT_CANCELLED' }), 1);
});

test('PDF thông báo phí: nội dung chuyển khoản mẫu, tài khoản nhận tiền; cư dân khác căn không tải được', async () => {
  assert.equal(transferContent('A', '1205', '2026-10'), 'A1205 T10-2026');
  assert.equal(transferContent('B', '12-05', '2026-01'), 'B1205 T01-2026');

  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  await SystemConfig.create([
    { key: 'BANK_NAME', value: 'Vietcombank', scope: 'BUSINESS' },
    { key: 'BANK_ACCOUNT_NO', value: '0123456789', scope: 'BUSINESS' },
    { key: 'BANK_ACCOUNT_NAME', value: 'BQL TOA NHA', scope: 'BUSINESS' },
  ]);
  const detail = await getInvoice(asUser(ctx.owner), oct._id);
  assert.equal(detail.payInfo.configured, true);
  assert.match(detail.payInfo.content, / T10-2026$/);

  const file = await buildInvoicePdf(asUser(ctx.owner), oct._id);
  assert.equal(file.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(file.filename, `thong-bao-phi-${oct.code}.pdf`);

  const stranger = await createHousehold();
  await assert.rejects(buildInvoicePdf(asUser(stranger.user), oct._id), /Không tìm thấy/);
});

test('PDF biên lai: mỗi lần thu có biên lai, số tiền bằng chữ, ghi chú không thay thế hóa đơn GTGT', async () => {
  assert.equal(moneyInWords(1_250_000), 'Một triệu hai trăm năm mươi nghìn đồng');
  assert.equal(moneyInWords(1_005_000), 'Một triệu không trăm linh năm nghìn đồng');
  assert.equal(moneyInWords(21_000), 'Hai mươi mốt nghìn đồng');

  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  const p = await recordOfflinePayment(ctx.accountant, { invoiceId: oct._id, method: 'CASH', amount: 200_000 }, { now: OCT });
  const file = await buildReceiptPdf(asUser(ctx.owner), p._id);
  assert.equal(file.buffer.subarray(0, 4).toString(), '%PDF');

  const pending = await Payment.create({ apartmentId: ctx.apartment._id, payerId: ctx.owner._id, amount: 1000, method: 'PAYOS', status: 'PENDING', orderCode: 9 });
  await assert.rejects(buildReceiptPdf(ctx.accountant, pending._id), /chưa có biên lai/);
});

test('API: tải PDF thông báo phí / biên lai, lập điều chỉnh chỉ Kế toán', async () => {
  const ctx = await setup();
  const oct = await publishPeriod(ctx, '2026-10', OCT);
  const app = await startApp();
  try {
    const res = await app.request('POST', `/invoices/${oct._id}/adjustments`, { user: { role: 'MANAGER' }, body: { amount: 1000, reason: REASON } });
    assert.equal(res.status, 403);
    const ok = await app.request('POST', `/invoices/${oct._id}/adjustments`, { user: { role: 'ACCOUNTANT' }, body: { amount: 0, reason: REASON } });
    assert.equal(ok.status, 400, 'số tiền 0 không hợp lệ');
    const list = await app.request('GET', '/invoices/adjustments?period=2026-11', { user: { role: 'MANAGER' } });
    assert.equal(list.status, 200);
  } finally {
    await app.close();
  }
});
