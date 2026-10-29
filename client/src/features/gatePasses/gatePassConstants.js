export const GATE_PASS_DIRECTIONS_MAP = {
  IN: { label: 'Chuyển đồ vào (IN)', color: 'blue' },
  OUT: { label: 'Chuyển đồ ra (OUT)', color: 'volcano' },
};

export const GATE_PASS_STATUS_MAP = {
  AWAITING_OWNER: { label: 'Chờ chủ hộ xác nhận', color: 'gold' },
  PENDING: { label: 'Chờ BQL duyệt', color: 'processing' },
  APPROVED: { label: 'Đã duyệt', color: 'success' },
  USED: { label: 'Đã qua cổng', color: 'cyan' },
  REJECTED: { label: 'Từ chối', color: 'error' },
  EXPIRED: { label: 'Hết hạn', color: 'default' },
};
