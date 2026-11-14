export const HOALAC_ADDRESS = 'Khu Công Nghệ Cao Hòa Lạc, CT03, Hòa Lạc, Hà Nội, Việt Nam';

export function initialInventory(building) {
  const groups = new Map();
  for (const apartment of building?.apartments ?? []) {
    const floor = apartment.floor ?? 1;
    if (!groups.has(floor)) groups.set(floor, []);
    groups.get(floor).push({ id: apartment.id ?? apartment._id, code: apartment.code,
      managementArea: apartment.managementArea ?? apartment.netArea ?? apartment.area });
  }
  for (const row of building?.floorInventory ?? []) if (!groups.has(row.floor)) groups.set(row.floor, []);
  return {
    code: building?.code ?? '', name: building?.name ?? '', address: building?.address ?? HOALAC_ADDRESS,
    totalFloors: building?.totalFloors ?? Math.max(1, ...groups.keys()),
    sourceReference: building?.inventorySource ?? '', reason: '',
    floors: [...groups].sort(([a], [b]) => a - b).map(([floor, apartments]) => ({ floor,
      expectedCount: building?.floorInventory?.find((row) => row.floor === floor)?.expectedCount ?? apartments.length,
      apartments })),
  };
}

export function copyFloorRows(rows, prefix) {
  return rows.map((row, index) => ({ code: `${prefix}${String(index + 1).padStart(2, '0')}`,
    managementArea: row.managementArea }));
}

export function inventoryProblems(form) {
  const problems = [];
  const floors = new Set();
  const codes = new Set();
  if (!form.floors.length) problems.push('Chưa khai báo tầng có căn hộ.');
  if (form.floors.reduce((total, row) => total + row.apartments.length, 0) > 5000) problems.push('Mỗi lần thiết lập hỗ trợ tối đa 5.000 căn.');
  for (const row of form.floors) {
    if (!Number.isInteger(row.floor) || row.floor < 1 || row.floor > form.totalFloors || floors.has(row.floor)) {
      problems.push(`Tầng ${row.floor ?? '?'} bị trùng hoặc vượt tổng số tầng.`);
    }
    floors.add(row.floor);
    if (!(row.expectedCount > 0) || !Number.isInteger(row.expectedCount) || row.expectedCount !== row.apartments.length) {
      problems.push(`Tầng ${row.floor}: hồ sơ ${row.expectedCount ?? 0} căn, đã nhập ${row.apartments.length} căn.`);
    }
    for (const apartment of row.apartments) {
      const code = apartment.code?.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,20}$/.test(code ?? '') || codes.has(code)) problems.push(`Mã căn trùng hoặc không hợp lệ: ${code || '(trống)'}.`);
      codes.add(code);
      if (!Number.isFinite(apartment.managementArea) || apartment.managementArea < 1) {
        problems.push(`Căn ${code || '(trống)'} chưa có diện tích tính phí hợp lệ.`);
      }
    }
  }
  return problems;
}

export function inventoryPayload(form, building) {
  return {
    ...(!building && { code: form.code.trim(), name: form.name.trim(), address: form.address.trim() }),
    totalFloors: form.totalFloors, sourceReference: form.sourceReference.trim(),
    ...(building && { expectedRevision: building.inventoryRevision ?? 0 }),
    ...(form.reason.trim() && { reason: form.reason.trim() }),
    floors: form.floors.map(({ floor, expectedCount }) => ({ floor, expectedCount })),
    apartments: form.floors.flatMap(({ floor, apartments }) => apartments.map((row) => ({
      ...(row.id && { id: row.id }), code: row.code.trim().toUpperCase(), floor, managementArea: row.managementArea,
    }))),
  };
}

export function nextManagementPeriod(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600000);
  const next = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 7);
}
