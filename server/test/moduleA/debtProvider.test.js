// Công nợ căn hộ hiển thị khi duyệt Gate Pass chuyển đồ ra: tổng hóa đơn chưa thanh toán / quá hạn.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Invoice } from '../../src/models/index.js';
import { getApartmentDebt } from '../../src/modules/gatePasses/debtProvider.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createApartment } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const invoice = (apartment, period, totalAmount, status) =>
  Invoice.create({
    code: `HD-${period}-${new mongoose.Types.ObjectId()}`,
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    period,
    items: [{ feeCategory: 'CLEANING', description: 'Phí', quantity: 1, unitPrice: totalAmount, amount: totalAmount }],
    totalAmount,
    status,
    issuedAt: new Date(),
    dueDate: new Date(),
  });

test('getApartmentDebt: cộng UNPAID + OVERDUE, bỏ PAID / CANCELLED và căn khác', async () => {
  const apartment = await createApartment();
  const other = await createApartment();
  await invoice(apartment, '2026-08', 300_000, 'OVERDUE');
  await invoice(apartment, '2026-09', 200_000, 'UNPAID');
  await invoice(apartment, '2026-07', 999_000, 'PAID');
  await invoice(apartment, '2026-06', 888_000, 'CANCELLED');
  await invoice(other, '2026-09', 777_000, 'UNPAID');

  const debt = await getApartmentDebt(apartment._id);
  assert.equal(debt.amount, 500_000);
  assert.equal(debt.invoiceCount, 2);
  assert.equal(debt.available, true);
});

test('getApartmentDebt: không nợ → 0', async () => {
  const apartment = await createApartment();
  assert.equal((await getApartmentDebt(apartment._id)).amount, 0);
});
