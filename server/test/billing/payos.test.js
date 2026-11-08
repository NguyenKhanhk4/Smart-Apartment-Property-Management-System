// Mô đun 4 — Bước 6: payOS (tạo link, webhook ký HMAC, chống gạch nợ trùng, tra cứu trạng thái, cron đối soát).
// Dùng payOS giả lập: không gọi mạng.
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Invoice, Notification, Payment, PrepaidBalance } from '../../src/models/index.js';
import {
  _test,
  createPayosPayment,
  getPayosStatus,
  handlePayosWebhook,
  reconcilePayosPayments,
} from '../../src/modules/payments/payments.payos.js';
import { recordOfflinePayment } from '../../src/modules/payments/payments.service.js';
import { setPayosForTest, signatureOf } from '../../src/modules/payments/payos.client.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createUser } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(async () => {
  setPayosForTest();
  await closeTestDB();
});

const CHECKSUM = 'test-checksum-key';
const CONFIG = {
  enabled: true,
  clientId: 'cid',
  apiKey: 'key',
  checksumKey: CHECKSUM,
  apiUrl: 'https://payos.test',
  returnUrl: 'http://localhost:5173/r/payments/result',
  cancelUrl: 'http://localhost:5173/r/payments/result',
};
const NOW = new Date('2026-10-20T03:00:00Z');

let calls;
let linkStatus; // trạng thái GET payment-requests trả về
function fakeFetch(url, init) {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method, body, headers: init.headers });
  const json = (data) => ({ ok: true, status: 200, json: async () => ({ code: '00', desc: 'success', data }) });
  if (init.method === 'POST' && url.endsWith('/v2/payment-requests')) {
    return json({ checkoutUrl: `https://pay.payos.vn/web/${body.orderCode}`, qrCode: '000201...', paymentLinkId: `pl-${body.orderCode}` });
  }
  if (init.method === 'GET') return json(linkStatus);
  return json({});
}

beforeEach(() => {
  calls = [];
  linkStatus = { status: 'PENDING' };
  setPayosForTest({ config: CONFIG, fetch: fakeFetch });
});

async function setup() {
  const { user: owner, apartment } = await createHousehold();
  const mk = (code, period, totalAmount, extra = {}) =>
    Invoice.create({
      code,
      apartmentId: apartment._id,
      buildingId: apartment.buildingId,
      payerId: owner._id,
      period,
      items: [],
      totalAmount,
      status: 'UNPAID',
      issuedAt: NOW,
      dueDate: NOW,
      ...extra,
    });
  return { owner, ownerUser: asUser(owner), apartment, mk };
}

/** Webhook payOS đã ký đúng */
const webhook = (orderCode, amount, extra = {}) => {
  const data = {
    orderCode,
    amount,
    description: 'A1205 T10-2026',
    accountNumber: '12345678',
    reference: `FT${orderCode}`,
    transactionDateTime: '2026-10-20 10:15:00',
    currency: 'VND',
    paymentLinkId: `pl-${orderCode}`,
    code: '00',
    desc: 'success',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: '',
    virtualAccountNumber: '',
    ...extra,
  };
  return { code: '00', desc: 'success', success: true, data, signature: signatureOf(data) };
};

test('chữ ký: key sắp A→Z, null → rỗng, HMAC-SHA256 bằng checksumKey', () => {
  const data = { orderCode: 123, amount: 1000, description: 'x', z: null };
  const expected = crypto.createHmac('sha256', CHECKSUM).update('amount=1000&description=x&orderCode=123&z=').digest('hex');
  assert.equal(signatureOf(data), expected);
});

test('tạo link: số tiền = tổng còn nợ đã chọn, ký đúng, giao dịch PENDING; gọi lại dùng lại link cũ', async () => {
  const { ownerUser, mk } = await setup();
  const sep = await mk('HD-09', '2026-09', 300_000, { status: 'PARTIALLY_PAID', paidAmount: 100_000 });
  const oct = await mk('HD-10', '2026-10', 500_000);

  const link = await createPayosPayment(ownerUser, { invoiceIds: [oct._id, sep._id] }, { now: NOW });
  assert.equal(link.amount, 200_000 + 500_000);
  assert.match(link.checkoutUrl, /pay\.payos\.vn/);
  assert.ok(Number.isSafeInteger(link.orderCode));

  const sent = calls[0];
  assert.equal(sent.headers['x-client-id'], 'cid');
  const { amount, cancelUrl, description, orderCode, returnUrl } = sent.body;
  assert.equal(sent.body.signature, signatureOf({ amount, cancelUrl, description, orderCode, returnUrl }));
  assert.ok(description.length <= 25);
  assert.equal((await Payment.findById(link.paymentId).lean()).status, 'PENDING');

  const again = await createPayosPayment(ownerUser, { invoiceIds: [sep._id, oct._id] }, { now: NOW });
  assert.equal(again.orderCode, link.orderCode);
  assert.equal(calls.length, 1);
});

test('tạo link: chỉ Người nộp phí; thông báo đã trả đủ bị chặn; chưa cấu hình → PAYOS_DISABLED', async () => {
  const { mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  const paid = await mk('HD-08', '2026-08', 100_000, { status: 'PAID', paidAmount: 100_000 });
  const stranger = asUser(await createUser('RESIDENT'));
  await assert.rejects(createPayosPayment(stranger, { invoiceIds: [inv._id] }, { now: NOW }), { status: 403 });

  const owner = { id: String(inv.payerId), role: 'RESIDENT' };
  await assert.rejects(createPayosPayment(owner, { invoiceIds: [paid._id] }, { now: NOW }), /không còn nợ/);

  setPayosForTest({ config: { ...CONFIG, enabled: false }, fetch: fakeFetch });
  await assert.rejects(createPayosPayment(owner, { invoiceIds: [inv._id] }, { now: NOW }), { errorCode: 'PAYOS_DISABLED' });
});

test('webhook đúng chữ ký → gạch nợ + biên lai; gửi lại không gạch lần 2; sai chữ ký bị từ chối', async () => {
  const { owner, ownerUser, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  const link = await createPayosPayment(ownerUser, { invoiceIds: [inv._id] }, { now: NOW });

  const bad = webhook(link.orderCode, 500_000);
  bad.data.amount = 1; // sửa dữ liệu sau khi ký
  await assert.rejects(handlePayosWebhook(bad), { errorCode: 'PAYOS_INVALID_SIGNATURE' });

  assert.deepEqual(await handlePayosWebhook(webhook(link.orderCode, 500_000)), { handled: true });
  const doc = await Invoice.findById(inv._id).lean();
  assert.equal(doc.status, 'PAID');
  assert.equal(doc.paidAmount, 500_000);
  const p = await Payment.findById(link.paymentId).lean();
  assert.equal(p.status, 'SUCCESS');
  assert.equal(p.reference, `FT${link.orderCode}`);
  assert.equal(p.paidAt.toISOString(), '2026-10-20T03:15:00.000Z');

  assert.equal((await handlePayosWebhook(webhook(link.orderCode, 500_000))).handled, false);
  assert.equal((await Invoice.findById(inv._id).lean()).paidAmount, 500_000);
  assert.equal(await Notification.countDocuments({ userId: owner._id, type: 'PAYMENT_RECEIPT' }), 1);

  // Webhook thử khi khai báo URL trên payOS: orderCode lạ → bỏ qua, không lỗi
  assert.equal((await handlePayosWebhook(webhook(123, 2000))).handled, false);
});

test('thông báo đã trả tiền mặt trong lúc chờ → tiền payOS vào Số dư trả trước (M4-3)', async () => {
  const { owner, ownerUser, apartment, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  const link = await createPayosPayment(ownerUser, { invoiceIds: [inv._id] }, { now: NOW });
  await recordOfflinePayment(asUser(await createUser('ACCOUNTANT')), { invoiceId: inv._id, method: 'CASH', amount: 500_000 }, { now: NOW });

  await handlePayosWebhook(webhook(link.orderCode, 500_000));
  const p = await Payment.findById(link.paymentId).lean();
  assert.equal(p.status, 'SUCCESS');
  assert.equal(p.creditAmount, 500_000);
  assert.equal(p.allocations.length, 0);
  assert.equal((await PrepaidBalance.findOne({ apartmentId: apartment._id, payerId: owner._id }).lean()).balance, 500_000);
});

test('trang kết quả: còn chờ thì hỏi payOS — PAID → gạch nợ; CANCELLED → thất bại', async () => {
  const { ownerUser, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  const a = await createPayosPayment(ownerUser, { invoiceIds: [inv._id] }, { now: NOW });

  linkStatus = { status: 'PAID', amount: 500_000, amountPaid: 500_000, transactions: [{ reference: 'FT1', transactionDateTime: '2026-10-20 10:20:00' }] };
  const r = await getPayosStatus(ownerUser, a.orderCode, { now: NOW });
  assert.equal(r.status, 'SUCCESS');
  assert.equal(r.allocations[0].invoice.status, 'PAID');

  const inv2 = await mk('HD-11', '2026-11', 100_000);
  const b = await createPayosPayment(ownerUser, { invoiceIds: [inv2._id] }, { now: NOW });
  linkStatus = { status: 'CANCELLED' };
  assert.equal((await getPayosStatus(ownerUser, b.orderCode, { now: NOW })).status, 'FAILED');
  assert.equal((await Invoice.findById(inv2._id).lean()).status, 'UNPAID');

  const stranger = asUser(await createUser('RESIDENT'));
  await assert.rejects(getPayosStatus(stranger, a.orderCode), { status: 404 });
});

test('cron đối soát: quá 15 phút payOS vẫn chưa rõ → Cần đối soát', async () => {
  const { ownerUser, mk } = await setup();
  const inv = await mk('HD-10', '2026-10', 500_000);
  const link = await createPayosPayment(ownerUser, { invoiceIds: [inv._id] }, { now: NOW });
  await Payment.collection.updateOne({ _id: link.paymentId }, { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } });

  linkStatus = { status: 'PROCESSING' };
  const r = await reconcilePayosPayments(new Date());
  assert.equal(r.affectedCount, 1);
  assert.equal((await Payment.findById(link.paymentId).lean()).needsReconcile, true);
});

test('nội dung chuyển khoản dạng <Mã căn> <Kỳ>, tối đa 25 ký tự', () => {
  const apt = { code: '1205', buildingId: { code: 'A' } };
  assert.equal(_test.descriptionOf(apt, [{ period: '2026-10' }]), 'A1205 T10-2026');
  assert.equal(_test.descriptionOf(apt, [{ period: '2026-09' }, { period: '2026-10' }]), 'A1205 T10-2026 2KY');
});

test('hóa đơn dữ liệu cũ thiếu paidAmount (ghi thẳng DB) vẫn tạo được link: số tiền = tổng phí, không lỗi "amount"', async () => {
  const { ownerUser, mk } = await setup();
  const inv = await mk('HD-OLD', '2026-09', 694000);
  await Invoice.collection.updateOne({ _id: inv._id }, { $unset: { paidAmount: '' } });
  const link = await createPayosPayment(ownerUser, { invoiceIds: [inv._id] }, { now: NOW });
  assert.equal(link.amount, 694000);
});
