// Helper trả response đúng format SRS 4.3 — controller luôn dùng các hàm này, không tự res.json.

export function ok(res, data = null, message) {
  return res.status(200).json({ success: true, data, ...(message && { message }) });
}

export function created(res, data = null, message) {
  return res.status(201).json({ success: true, data, ...(message && { message }) });
}

// `extra` (tuỳ chọn): trường bổ sung cạnh data, vd { summary } — đếm theo trạng thái, tổng tiền...
export function paginated(res, items, { page, limit, total }, extra = {}) {
  return res.status(200).json({ success: true, data: items, pagination: { page, limit, total }, ...extra });
}
