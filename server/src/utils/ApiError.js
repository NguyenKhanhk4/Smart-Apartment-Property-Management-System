import { ERROR_CODES } from '../constants/errorCodes.js';

/**
 * Lỗi nghiệp vụ có mã chuẩn. Throw ở service, errorHandler sẽ trả về format SRS 4.3.
 * @example throw new ApiError('FUND_INSUFFICIENT_BALANCE')
 * @example throw ApiError.notFound('Không tìm thấy căn hộ')
 */
export class ApiError extends Error {
  constructor(errorCode = 'SERVER_ERROR', message, { status, details } = {}) {
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
