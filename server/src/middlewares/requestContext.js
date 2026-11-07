// Ngữ cảnh của request đang xử lý (IP người gọi). logAudit đọc ở đây khi nơi gọi không truyền ip,
// để mọi bản ghi nhật ký đều có IP (BR-S10) mà không phải sửa từng module.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function requestContext(req, _res, next) {
  // '::ffff:1.2.3.4' (IPv4 qua socket IPv6) → '1.2.3.4' cho dễ đọc
  storage.run({ ip: req.ip?.replace(/^::ffff:/, '') }, next);
}

/** Ngữ cảnh request hiện tại; null khi chạy ngoài request (cron, script, test gọi service trực tiếp) */
export const currentRequest = () => storage.getStore() ?? null;
