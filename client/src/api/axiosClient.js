// HTTP client dùng chung cho mọi module.
//
// QUY ƯỚC: các hàm trong `src/api/*.api.js` gọi qua `http.get/post/patch/put/delete`,
// kết quả trả về là NGUYÊN envelope của backend (không bóc `.data`):
//   - một bản ghi:  { success, data, message }
//   - danh sách:    { success, data: [...], pagination: { page, limit, total } }
// → Nơi gọi tự lấy `data` / `pagination`.
//
// Lỗi luôn được chuẩn hóa thành `ApiError` { status, message, errorCode, details }.
// `message` ưu tiên thông báo của backend, dự phòng theo errorCode (constants/errorMessages.js).
//
// Tự refresh khi gặp 401 — module Auth (thành viên A) cần làm endpoint đúng hợp đồng:
//   POST /auth/refresh  body { refreshToken }  →  { success: true, data: { accessToken, refreshToken } }

import axios from 'axios';
import { authStorage } from '../utils/authStorage';
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
} from '../constants/errorMessages';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** Phát ra khi phiên đăng nhập không thể khôi phục (refresh thất bại). AuthContext lắng nghe để đăng xuất. */
export const SESSION_EXPIRED_EVENT = 'sapms:session-expired';

export class ApiError extends Error {
  constructor({ status = 0, message, errorCode, details = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }

  get canceled() {
    return this.errorCode === 'REQUEST_CANCELED';
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Instance riêng, không gắn interceptor, để gọi refresh mà không bị vòng lặp 401.
const refreshClient = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

apiClient.interceptors.request.use((config) => {
  const token = authStorage.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight: nhiều request cùng nhận 401 thì chỉ gọi refresh một lần, các request còn lại chờ chung promise.
let refreshPromise = null;

function refreshTokens() {
  if (!refreshPromise) {
    const refreshToken = authStorage.getRefreshToken();
    refreshPromise = (
      refreshToken
        ? refreshClient.post('/auth/refresh', { refreshToken }).then((res) => {
            authStorage.setTokens(res.data.data);
            return res.data.data.accessToken;
          })
        : Promise.reject(new Error('Missing refresh token'))
    ).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function expireSession() {
  authStorage.clear();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

function shouldTryRefresh(error) {
  const { config, response } = error;
  if (!config || config._retried || response?.status !== 401) return false;
  if (response.data?.errorCode && response.data.errorCode !== 'UNAUTHORIZED') return false;
  return !NO_REFRESH_PATHS.some((path) => config.url?.includes(path));
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error)) {
    return new ApiError({ message: 'Yêu cầu đã bị hủy.', errorCode: 'REQUEST_CANCELED' });
  }
  if (!error.response) {
    return new ApiError({ message: NETWORK_ERROR_MESSAGE, errorCode: 'NETWORK_ERROR' });
  }
  const { status, data } = error.response;
  const errorCode = data?.errorCode || (status >= 500 ? 'SERVER_ERROR' : undefined);
  return new ApiError({
    status,
    errorCode,
    details: data?.details ?? null,
    message: data?.message || ERROR_MESSAGES[errorCode] || DEFAULT_ERROR_MESSAGE,
  });
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!shouldTryRefresh(error)) throw toApiError(error);

    const { config } = error;
    config._retried = true;
    const usedHeader = config.headers?.Authorization;
    const currentToken = authStorage.getAccessToken();

    try {
      // Request cũ mang token đã bị thay trong lúc chờ → chỉ cần gửi lại với token mới.
      const token =
        currentToken && usedHeader !== `Bearer ${currentToken}`
          ? currentToken
          : await refreshTokens();
      config.headers.Authorization = `Bearer ${token}`;
    } catch {
      expireSession();
      throw toApiError(error);
    }
    return apiClient(config);
  },
);

const unwrap = (promise) => promise.then((res) => res.data);

export const http = {
  get: (url, config) => unwrap(apiClient.get(url, config)),
  post: (url, body, config) => unwrap(apiClient.post(url, body, config)),
  put: (url, body, config) => unwrap(apiClient.put(url, body, config)),
  patch: (url, body, config) => unwrap(apiClient.patch(url, body, config)),
  delete: (url, config) => unwrap(apiClient.delete(url, config)),
};
