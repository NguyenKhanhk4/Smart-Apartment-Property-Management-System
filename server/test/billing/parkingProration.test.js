// Mô đun 4 — UC26: phí gửi xe theo số ngày thực tế (xe đăng ký mới / gỡ xe / bàn giao giữa tháng) và truy thu / hoàn
// ở thông báo kỳ sau khi xe đăng ký / gỡ sau lúc đã tính phí kỳ trước (phí thu trước).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeeType, Invoice } from '../../src/models/index.js';
import { PARKING_CORRECTION_FEE_CODE, vehicleDays } from '../../src/modules/invoices/invoices.builder.js';
import { recalculateDraft } from '../../src/modules/invoices/invoices.drafts.js';
import { generateForApartment } from '../../src/modules/invoices/invoices.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createHousehold, createUser } from '../helpers/fixtures.js';
import { createContract, createVehicle } from '../helpers/fixtures.moduleA.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const vn = (ymd) => new Date(`${ymd}T00:00:00+07:00`);
const MOTO = 310_000; // tháng 10 có 31 ngày → 10.000 đ/ngày

async function setup() {
  const user = asUser(await createUser('ACCOUNTANT'));
  const { user: owner, apartment } = await createHousehold();
  await createContract({ apartment, owner });
  await FeeType.create({
    code: 'PARKING_MOTORBIKE', name: 'Phí gửi xe máy', feeCategory: 'PARKING', calcMethod: 'PER_VEHICLE',
    vehicleType: 'MOTORBIKE', unitPrice: MOTO, effectiveFrom: vn('2026-01-01'),
  });
  const vehicle = (approvedAt, extra = {}) => createVehicle({ apartment, registeredBy: owner, status: 'APPROVED', approvedAt, ...extra });
  const generate = (period, now) => generateForApartment(user, { period, apartmentId: apartment._id }, { now });
  return { user, owner, apartment, vehicle, generate };
}

const parking = (inv) => inv.items.filter((i) => i.feeCategory === 'PARKING');
const publish = (inv) => Invoice.updateOne({ _id: inv._id }, { $set: { status: 'UNPAID', issuedAt: new Date() } });

test('số ngày gửi: tính cả ngày duyệt, dừng từ ngày gỡ, theo ngày giờ VN', () => {
  const from = vn('2026-10-01');
  const to = vn('2026-11-01');
  assert.equal(vehicleDays({ approvedAt: vn('2026-09-01') }, from, to), 31);
  assert.equal(vehicleDays({ approvedAt: new Date('2026-10-16T09:30:00+07:00') }, from, to), 16); // 16 → 31/10
  assert.equal(vehicleDays({ approvedAt: new Date('2026-10-15T17:30:00Z') }, from, to), 16); // 00:30 ngày 16 giờ VN
  assert.equal(vehicleDays({ approvedAt: vn('2026-09-01'), cancelledAt: new Date('2026-10-11T15:00:00+07:00') }, from, to), 10);
  assert.equal(vehicleDays({ approvedAt: vn('2026-10-05'), cancelledAt: vn('2026-10-05') }, from, to), 0);
  assert.equal(vehicleDays({ approvedAt: vn('2026-12-01') }, from, to), 0);
});

test('kỳ đang tính: đủ tháng = 1, xe đăng ký / gỡ giữa tháng tính theo ngày, xe đã gỡ trước kỳ không tính', async () => {
  const { vehicle, generate } = await setup();
  const full = await vehicle(vn('2026-09-01'));
  const added = await vehicle(vn('2026-10-16'));
  const removed = await vehicle(vn('2026-09-01'), { status: 'CANCELLED', cancelledAt: vn('2026-10-11') });
  await vehicle(vn('2026-08-01'), { status: 'CANCELLED', cancelledAt: vn('2026-09-20') });

  const inv = await generate('2026-10', vn('2026-11-01'));
  const byRef = new Map(parking(inv).map((i) => [String(i.refId), i]));
  assert.equal(parking(inv).length, 3);
  assert.equal(byRef.get(full.id).quantity, 1);
  assert.equal(byRef.get(full.id).amount, MOTO);
  assert.equal(byRef.get(full.id).description, `Phí gửi xe máy ${full.plateNumber}`);
  assert.equal(byRef.get(added.id).amount, 160_000); // 16/31 ngày
  assert.match(byRef.get(added.id).description, /\(16\/31 ngày\)$/);
  assert.equal(byRef.get(removed.id).amount, 100_000); // 1 → 10/10
  assert.equal(inv.totalAmount, MOTO + 160_000 + 100_000);
});

test('bàn giao giữa tháng: phí xe tính từ ngày bàn giao', async () => {
  const { apartment, vehicle, generate } = await setup();
  apartment.handoverDate = vn('2026-10-22');
  await apartment.save();
  await vehicle(vn('2026-10-01')); // dữ liệu nhập trước ngày bàn giao vẫn chỉ tính từ 22/10
  const inv = await generate('2026-10', vn('2026-10-25'));
  assert.equal(parking(inv)[0].amount, 100_000); // 22 → 31/10
});

test('kỳ sau đối chiếu kỳ trước đã phát hành: xe đăng ký sau lúc tính → truy thu; xe gỡ sau lúc tính → hoàn; tính lại không nhân đôi', async () => {
  const { user, vehicle, generate } = await setup();
  const kept = await vehicle(vn('2026-09-01'));
  const leaving = await vehicle(vn('2026-09-01'));
  const oct = await generate('2026-10', vn('2026-10-01')); // tính đầu tháng 10: 2 xe đủ tháng
  assert.equal(parking(oct).length, 2);
  await publish(oct);

  // Trong tháng 10, sau khi đã tính phí: 1 xe mới đăng ký 16/10, 1 xe gỡ 11/10
  const added = await vehicle(vn('2026-10-16'));
  await leaving.updateOne({ status: 'CANCELLED', cancelledAt: vn('2026-10-11') });

  const nov = await generate('2026-11', vn('2026-11-01'));
  const fixes = parking(nov).filter((i) => i.feeCode === PARKING_CORRECTION_FEE_CODE);
  const fixFor = (v) => fixes.find((i) => String(i.refId) === v.id);
  assert.equal(fixes.length, 2);
  assert.equal(fixFor(added).amount, 160_000); // truy thu 16/31 ngày tháng 10
  assert.match(fixFor(added).description, /^Truy thu phí gửi xe máy .* kỳ .*10\/2026 \(16 ngày, đăng ký 16\/10\)$/);
  assert.equal(fixFor(leaving).amount, -210_000); // hoàn 21/31 ngày (11 → 31/10)
  assert.match(fixFor(leaving).description, /^Hoàn .*\(21 ngày, gỡ xe 11\/10\)$/);
  assert.equal(fixFor(kept), undefined);

  // Kỳ 11 tự thân: xe giữ + xe mới đủ tháng, xe đã gỡ không tính
  const regular = parking(nov).filter((i) => i.feeCode !== PARKING_CORRECTION_FEE_CODE);
  assert.deepEqual(regular.map((i) => String(i.refId)).sort(), [kept.id, added.id].sort());
  assert.equal(nov.totalAmount, 2 * MOTO + 160_000 - 210_000);

  // Tính lại Nháp: vẫn đúng 2 dòng điều chỉnh
  const again = await recalculateDraft(user, nov._id);
  assert.equal(parking(again).filter((i) => i.feeCode === PARKING_CORRECTION_FEE_CODE).length, 2);
  assert.equal(again.totalAmount, nov.totalAmount);
});

test('không đối chiếu khi kỳ trước chưa phát hành hoặc không có thông báo (lần tính đầu tiên của hệ thống)', async () => {
  const { vehicle, generate } = await setup();
  await vehicle(vn('2026-10-16')); // xe từ giữa tháng 10, nhưng tháng 10 chưa từng có thông báo
  let nov = await generate('2026-11', vn('2026-11-01'));
  assert.equal(parking(nov).filter((i) => i.feeCode === PARKING_CORRECTION_FEE_CODE).length, 0);
  await Invoice.deleteMany({});

  // Nháp tháng 10 chưa phát hành: tự có đúng 16/31 ngày (tính lại Nháp cũng vậy) → kỳ 11 không đối chiếu để khỏi tính 2 lần
  const oct = await generate('2026-10', vn('2026-10-20'));
  assert.equal(parking(oct)[0].amount, 160_000);
  nov = await generate('2026-11', vn('2026-11-01'));
  assert.equal(parking(nov).filter((i) => i.feeCode === PARKING_CORRECTION_FEE_CODE).length, 0);
});
