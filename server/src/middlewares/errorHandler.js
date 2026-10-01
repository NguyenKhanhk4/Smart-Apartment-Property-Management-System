import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Chuyển mọi loại lỗi về ApiError để response luôn đúng format SRS 4.3
function toApiError(err) {
  if (err instanceof ApiError) return err;

  if (err.isJoi) {
    const details = err.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
    return ApiError.badRequest(details[0]?.message, details);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest(details[0]?.message, details);
  }

  // Ghi đè đồng thời trên document bật optimisticConcurrency (Ticket, GuestLog...)
  if (err instanceof mongoose.Error.VersionError) return new ApiError('CONCURRENT_UPDATE');

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Giá trị không hợp lệ cho trường "${err.path}"`, [
      { field: err.path, message: 'Giá trị không hợp lệ' },
    ]);
  }

  // Trùng unique index. Module muốn trả mã riêng (vd INVOICE_ALREADY_EXISTS) thì tự bắt lỗi 11000.
  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue ?? err.keyPattern ?? {});
    return new ApiError('DUPLICATE_VALUE', `Dữ liệu bị trùng: ${fields.join(', ')}`, {
      details: fields.map((field) => ({ field, message: 'Giá trị đã tồn tại' })),
    });
  }

  // Lỗi từ body parser của Express
  if (err.type === 'entity.parse.failed') return ApiError.badRequest('Body JSON không hợp lệ');
  if (err.type === 'entity.too.large') {
    return new ApiError('VALIDATION_ERROR', 'Dữ liệu gửi lên quá lớn', { status: 413 });
  }

  return null;
}

// Express nhận diện error middleware qua đủ 4 tham số, nên giữ _next dù không dùng
export function errorHandler(err, req, res, _next) {
  const apiError = toApiError(err) ?? new ApiError('SERVER_ERROR');

  if (apiError.status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  res.status(apiError.status).json({
    success: false,
    message: apiError.message,
    errorCode: apiError.errorCode,
    ...(apiError.details && { details: apiError.details }),
    ...(env.isDev && apiError.status >= 500 && { stack: err.stack }),
  });
}
