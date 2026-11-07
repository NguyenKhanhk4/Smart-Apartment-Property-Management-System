// Khoảng cách cho component antd ở các trang tài khoản.
// Không dùng class Tailwind (mb-4, mt-4) trên component antd: Tailwind v4 đặt utility trong @layer,
// còn style của antd không nằm trong layer nên luôn thắng → class khoảng cách bị mất.
export const ALERT_GAP = { marginBottom: 16 };
export const TOP_GAP = { marginTop: 16 };
