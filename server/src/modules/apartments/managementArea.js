/** Diện tích tính phí quản lý có hiệu lực tại mốc thời gian; trường netArea giữ nền lịch sử. */
export function managementAreaAt(apartment, at = new Date()) {
  let area = apartment.netArea;
  let latest = -Infinity;
  const time = new Date(at).getTime();
  for (const change of apartment.managementAreaHistory ?? []) {
    const effective = new Date(change.effectiveFrom).getTime();
    if (effective <= time && effective >= latest) {
      area = change.area;
      latest = effective;
    }
  }
  return area;
}

export function apartmentAreaView(apartment) {
  const value = apartment.toObject ? apartment.toObject() : apartment;
  const netArea = managementAreaAt(value);
  return { ...value, netArea, managementArea: netArea ?? value.area };
}
