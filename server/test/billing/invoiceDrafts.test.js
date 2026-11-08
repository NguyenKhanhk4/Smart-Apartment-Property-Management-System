// Mô đun 4 — Bước 2: tính phí ra thông báo Nháp, khoản thu khác, tính lại, cron nhắc Kế toán.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog, Booking, Contract, FeeType, Invoice, Notification, SystemConfig } from '../../src/models/index.js';
import { addOtherItem, recalculateDraft, removeOtherItem } from '../../src/modules/invoices/invoices.drafts.js';
import { remindBilling } from '../../src/modules/invoices/invoices.jobs.js';
import { generateForApartment, generateForPeriod, previewInvoices } from '../../src/modules/invoices/invoices.service.js';
import { createFeeType } from '../../src/modules/feeTypes/feeTypes.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createUser } from '../helpers/fixtures.js';
import { createContract } from '../helpers/fixtures.moduleA.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const PERIOD = '2026-10';
const NOW = new Date('2026-10-15T03:00:00Z');

async function setup() {
  const accountant = await createUser('ACCOUNTANT');
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
  return { accountant, user: asUser(accountant), owner, apartment };
}

test('tính phí 1 căn → Nháp, chưa có hạn đóng, chưa gửi thông báo cho cư dân', async () => {
  const { user, owner, apartment } = await setup();
  const inv = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });

  assert.equal(inv.status, 'DRAFT');
  assert.equal(inv.totalAmount, 70 * 7000);
  assert.equal(inv.paidAmount, 0);
  assert.equal(inv.dueDate, null);
  assert.equal(inv.issuedAt, null);
  assert.equal(String(inv.payerId), String(owner._id));
  assert.equal(inv.payerSource, 'OWNER');
  assert.equal(await Notification.countDocuments({ userId: owner._id }), 0);
});

test('UC13: căn chưa bàn giao bị bỏ qua kể cả khi đã có hợp đồng mua bán', async () => {
  const { user, apartment } = await setup();
  apartment.handoverDate = null;
  apartment.occupancyStatus = 'NOT_HANDED_OVER';
  await apartment.save();

  const preview = await previewInvoices({ period: PERIOD, apartmentId: apartment._id });
  assert.equal(preview.rows[0].status, 'NOT_HANDED_OVER');
  assert.equal(preview.summary.notHandedOver, 1);
  const batch = await generateForPeriod({ period: PERIOD, user });
  assert.equal(batch.notHandedOver, 1);
  assert.equal(batch.created, 0);
  await assert.rejects(generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW }), /chưa bàn giao trong kỳ/);
});

test('UC13: phí quản lý lấy diện tích thông thủy, đúng loại căn và số ngày từ bàn giao', async () => {
  const { user, apartment } = await setup();
  apartment.type = 'RESIDENTIAL';
  apartment.netArea = 62;
  apartment.handoverDate = new Date('2026-10-16T00:00:00+07:00');
  apartment.occupancyStatus = 'UNDER_REPAIR';
  await apartment.save();
  await Contract.updateOne({ apartmentId: apartment._id }, { $set: { startDate: apartment.handoverDate } });
  const managementRate = {
    name: 'Phí quản lý căn ở', feeCategory: 'MANAGEMENT', calcMethod: 'PER_M2',
    unitPrice: 12_000, effectiveFrom: PERIOD,
  };
  await assert.rejects(createFeeType(user, { ...managementRate, code: 'MANAGEMENT_OTHER' }, { now: new Date('2026-09-15T00:00:00Z') }), /mã phí tương ứng/);
  await createFeeType(user, { ...managementRate, code: 'MANAGEMENT_RESIDENTIAL' }, { now: new Date('2026-09-15T00:00:00Z') });
  await createFeeType(user, {
    ...managementRate, code: 'MANAGEMENT_COMMERCIAL', name: 'Phí quản lý căn kinh doanh', unitPrice: 20_000,
  }, { now: new Date('2026-09-15T00:00:00Z') });

  const beforeHandover = await previewInvoices({ period: '2026-09', apartmentId: apartment._id });
  assert.equal(beforeHandover.rows[0].status, 'NOT_HANDED_OVER');
  const draft = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, {
    now: new Date('2026-10-20T03:00:00Z'),
  });
  const management = draft.items.filter((item) => item.feeCategory === 'MANAGEMENT');
  assert.equal(management.length, 1);
  assert.equal(management[0].feeCode, 'MANAGEMENT_RESIDENTIAL');
  assert.equal(management[0].amount, 384_000);
  assert.match(management[0].description, /16\/31 ngày/);
  assert.equal(draft.totalAmount, 384_000 + 70 * 7000);
  const recalculated = await recalculateDraft(user, draft._id);
  assert.equal(recalculated.totalAmount, draft.totalAmount);
});

test('tính phí cả kỳ chạy lại không tạo trùng (Nháp cũng được tính là đã có)', async () => {
  const { user } = await setup();
  const first = await generateForPeriod({ period: PERIOD, user });
  const second = await generateForPeriod({ period: PERIOD, user });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.existing, 1);
  assert.equal(await Invoice.countDocuments({ period: PERIOD }), 1);
});

test('khoản thu khác: thêm cộng tổng, xóa trừ tổng, ghi Audit Log; không xóa được dòng tự động', async () => {
  const { user, apartment } = await setup();
  const inv = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });

  const added = await addOtherItem(user, inv._id, { description: 'Làm lại thẻ xe', amount: 50_000 });
  assert.equal(added.totalAmount, inv.totalAmount + 50_000);
  assert.equal(added.items.at(-1).feeCategory, 'OTHER');

  await assert.rejects(removeOtherItem(user, inv._id, 0), /Chỉ xóa được khoản thu khác/);
  const removed = await removeOtherItem(user, inv._id, added.items.length - 1);
  assert.equal(removed.totalAmount, inv.totalAmount);

  const actions = (await AuditLog.find({ targetId: inv._id }).lean()).map((a) => a.action).sort();
  assert.deepEqual(actions, ['INVOICE_GENERATED', 'INVOICE_ITEM_ADDED', 'INVOICE_ITEM_REMOVED']);
});

test('tính lại lấy đơn giá mới nhưng giữ khoản thu khác', async () => {
  const { user, apartment } = await setup();
  const inv = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });
  await addOtherItem(user, inv._id, { description: 'Dịch vụ phát sinh', amount: 30_000 });
  await FeeType.updateOne({ code: 'CLEANING' }, { $set: { unitPrice: 8000 } });

  const re = await recalculateDraft(user, inv._id);
  assert.equal(re.totalAmount, 70 * 8000 + 30_000);
  assert.equal(re.items.filter((i) => i.feeCategory === 'OTHER').length, 1);
});

test('tính lại: booking đã hủy được gỡ khỏi thông báo, booking mới phát sinh được gắn vào', async () => {
  const { user, apartment } = await setup();
  const amenity = await createAmenity();
  const old = await createBooking({ amenity, apartment, startAt: new Date('2026-09-10T03:00:00Z'), status: 'COMPLETED', fee: 100_000 });
  const inv = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });
  assert.equal(String((await Booking.findById(old._id).lean()).invoiceId), String(inv._id));

  await Booking.updateOne({ _id: old._id }, { $set: { status: 'CANCELLED' } });
  const fresh = await createBooking({ amenity, apartment, startAt: new Date('2026-09-20T03:00:00Z'), status: 'COMPLETED', fee: 40_000 });

  const re = await recalculateDraft(user, inv._id);
  assert.equal(re.totalAmount, 70 * 7000 + 40_000);
  assert.equal((await Booking.findById(old._id).lean()).invoiceId, null);
  assert.equal(String((await Booking.findById(fresh._id).lean()).invoiceId), String(inv._id));
});

test('không sửa được thông báo không còn là Nháp', async () => {
  const { user, apartment } = await setup();
  const inv = await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });
  await Invoice.updateOne({ _id: inv._id }, { $set: { status: 'PENDING_APPROVAL' } });

  await assert.rejects(addOtherItem(user, inv._id, { description: 'abc', amount: 1000 }), { errorCode: 'INVOICE_NOT_DRAFT' });
  await assert.rejects(recalculateDraft(user, inv._id), { errorCode: 'INVOICE_NOT_DRAFT' });
});

test('cron nhắc Kế toán: chỉ đúng ngày cấu hình và khi kỳ chưa tính phí', async () => {
  const { accountant, user, apartment } = await setup();
  await SystemConfig.create({ key: 'BILLING_REMIND_DAY', value: 15, scope: 'BUSINESS' });

  assert.equal(await remindBilling(new Date('2026-10-14T03:00:00Z')), 0); // ngày 14 giờ VN
  assert.equal(await remindBilling(NOW), 1); // ngày 15 giờ VN
  assert.equal(await Notification.countDocuments({ userId: accountant._id, type: 'INVOICE_APPROVAL' }), 1);

  await generateForApartment(user, { period: PERIOD, apartmentId: apartment._id }, { now: NOW });
  assert.equal(await remindBilling(NOW), 0); // đã tính phí
});
