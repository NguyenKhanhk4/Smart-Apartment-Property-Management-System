import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFloorRows, initialInventory, inventoryPayload, inventoryProblems, nextManagementPeriod } from '../src/features/buildings/inventoryForm.js';

test('UC13: sao chép tầng không sao chép ID, tạo mã mới và giữ diện tích khác nhau', () => {
  assert.deepEqual(copyFloorRows([{ id: 'old', code: 'A201', managementArea: 70 }, { managementArea: 85 }], 'A3'),
    [{ code: 'A301', managementArea: 70 }, { code: 'A302', managementArea: 85 }]);
});
test('UC13: đối chiếu từng tầng, mã trùng giữa các tầng và tầng ngoài phạm vi', () => {
  const form = { totalFloors: 3, floors: [
    { floor: 1, expectedCount: 1, apartments: [{ code: 'A101', managementArea: 70 }] },
    { floor: 3, expectedCount: 2, apartments: [{ code: 'A301', managementArea: 80 }, { code: 'A302', managementArea: 90 }] },
  ] };
  assert.deepEqual(inventoryProblems(form), []);
  form.floors[1].apartments[0].code = 'a101';
  assert.ok(inventoryProblems(form).some((message) => message.includes('trùng')));
  form.floors[1].floor = 4;
  form.floors[0].expectedCount = 3;
  assert.ok(inventoryProblems(form).some((message) => message.includes('vượt')));
  assert.ok(inventoryProblems(form).some((message) => message.includes('hồ sơ 3')));
});
test('UC13: danh mục cũ giữ ID và diện tích, payload rà soát có phiên bản', () => {
  const building = { code: 'A', name: 'Tòa A', address: 'Hà Nội', totalFloors: 3, inventoryRevision: 4,
    apartments: [{ _id: 'old1', code: 'A201', floor: 2, area: 70 }] };
  const form = initialInventory(building);
  form.sourceReference = 'MB-13';
  const body = inventoryPayload(form, building);
  assert.deepEqual(body.apartments, [{ id: 'old1', code: 'A201', floor: 2, managementArea: 70 }]);
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.code, undefined);
});
test('UC13: kỳ áp dụng theo giờ Việt Nam và qua năm mới', () => {
  assert.equal(nextManagementPeriod(new Date('2026-11-30T18:00:00Z')), '2027-01');
  assert.equal(nextManagementPeriod(new Date('2026-11-14T00:00:00Z')), '2026-12');
});
