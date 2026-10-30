import { ERROR_CODES } from '../constants/errorCodes.js';

/**
 * Lỗi nghiệp vụ có mã chuẩn. Throw ở service, errorHandler sẽ trả về format SRS 4.3.
 * @example throw new ApiError('FUND_INSUFFICIENT_BALANCE')
 * @example throw ApiError.notFound('Không tìm thấy căn hộ')
 */
export class ApiError extends Error {
  constructor(errorCode = 'SERVER_ERROR', message, { status, details } = {}) {
    // Gõ sai mã lỗi: dev/test báo ngay; production vẫn trả 500 thay vì sập request
    if (!ERROR_CODES[errorCode] && process.env.NODE_ENV !== 'production') {
      throw new Error(`ApiError: errorCode "${errorCode}" chưa khai báo trong constants/errorCodes.js`);
    }
    const def = ERROR_CODES[errorCode] ?? ERROR_CODES.SERVER_ERROR;
    super(message ?? def.message);
    this.name = 'ApiError';
    this.errorCode = ERROR_CODES[errorCode] ? errorCode : 'SERVER_ERROR';
    this.status = status ?? def.status;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError('VALIDATION_ERROR', message, { details });
  }

  /** Lỗi 400 gắn với 1 field của form */
  static field(field, message) {
    return ApiError.badRequest(message, [{ field, message }]);
  }

  static unauthorized(message) {
    return new ApiError('UNAUTHORIZED', message);
  }

  static forbidden(message) {
    return new ApiError('FORBIDDEN_ROLE', message);
  }

  static notFound(message) {
    return new ApiError('NOT_FOUND', message);
  }
}
