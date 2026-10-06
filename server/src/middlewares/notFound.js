import { ApiError } from '../utils/ApiError.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Không tìm thấy API: ${req.method} ${req.originalUrl}`));
}
