// Gọi API payOS (https://payos.vn/docs) bằng fetch — không cần SDK.
//   Tạo link:   POST /v2/payment-requests            (ký amount, cancelUrl, description, orderCode, returnUrl)
//   Tra cứu:    GET  /v2/payment-requests/{orderCode}
//   Hủy link:   POST /v2/payment-requests/{orderCode}/cancel
//   Webhook:    payOS POST { code, desc, success, data, signature } — chữ ký = HMAC-SHA256 của data (key sắp A→Z)
// Test thay `payosConfig` / `payosFetch` bằng setPayosForTest() để không gọi mạng.
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

let config = env.payos;
let doFetch = (...args) => fetch(...args);

/** Chỉ dùng trong test: cấu hình giả + fetch giả */
export function setPayosForTest({ config: c, fetch: f } = {}) {
  config = c ?? env.payos;
  doFetch = f ?? ((...args) => fetch(...args));
}

export const payosConfig = () => config;
export const isPayosEnabled = () => Boolean(config.enabled);

function assertEnabled() {
  if (!config.enabled) throw new ApiError('PAYOS_DISABLED');
}

const hmac = (text) => crypto.createHmac('sha256', config.checksumKey).update(text).digest('hex');

/** Chuỗi ký: key sắp A→Z, `key=value` nối bằng `&`; null/undefined → rỗng; mảng/object → JSON */
export function signatureOf(data) {
  const text = Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k];
      if (v === null || v === undefined || v === 'null' || v === 'undefined') return `${k}=`;
      return `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`;
    })
    .join('&');
  return hmac(text);
}

/** So sánh chữ ký thời gian hằng (chống dò chữ ký theo thời gian phản hồi) */
export function isValidSignature(data, signature) {
  if (!data || typeof signature !== 'string' || !config.checksumKey) return false;
  const expected = Buffer.from(signatureOf(data), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

async function call(method, path, body) {
  assertEnabled();
  let res;
  try {
    res = await doFetch(`${config.apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-client-id': config.clientId, 'x-api-key': config.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error('[payos] không kết nối được:', err.message);
    throw new ApiError('PAYOS_UNAVAILABLE');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.code !== '00') {
    console.error(`[payos] ${method} ${path} lỗi:`, res.status, json?.code, json?.desc);
    throw new ApiError('PAYOS_UNAVAILABLE', `payOS từ chối yêu cầu: ${json?.desc ?? res.status}`);
  }
  return json;
}

/**
 * Tạo link thanh toán. `description` tối đa 25 ký tự (giới hạn của payOS với tài khoản không liên kết).
 * Trả về { checkoutUrl, qrCode, paymentLinkId, accountNumber, accountName, bin, ... }
 */
export async function createPaymentLink({ orderCode, amount, description, expiredAt, items, buyerName }) {
  const signed = { amount, cancelUrl: config.cancelUrl, description, orderCode, returnUrl: config.returnUrl };
  const json = await call('POST', '/v2/payment-requests', {
    ...signed,
    items,
    buyerName,
    expiredAt: Math.floor(expiredAt.getTime() / 1000),
    signature: signatureOf(signed),
  });
  if (json.signature && !isValidSignature(json.data, json.signature)) {
    throw new ApiError('PAYOS_UNAVAILABLE', 'Phản hồi payOS sai chữ ký');
  }
  return json.data;
}

/** Trạng thái link: { status: PENDING | PROCESSING | PAID | CANCELLED | EXPIRED, amount, amountPaid, transactions[] } */
export async function getPaymentLink(orderCode) {
  return (await call('GET', `/v2/payment-requests/${orderCode}`)).data;
}

export async function cancelPaymentLink(orderCode, reason = 'Cư dân hủy thanh toán') {
  return (await call('POST', `/v2/payment-requests/${orderCode}/cancel`, { cancellationReason: reason })).data;
}
