import { CONSENT_ACTIONS, CONSENT_POLICY_VERSION } from '../constants/enums.js';

/**
 * BR-X7: trạng thái đồng ý điều khoản dữ liệu cá nhân, tính từ lần ghi gần nhất trong lịch sử.
 * Đồng ý với phiên bản cũ (điều khoản đã đổi, CONSENT_POLICY_VERSION tăng) thì `outdated` = true và
 * không còn được tính là đồng ý cho tới khi cư dân đồng ý lại bản mới.
 */
export function consentState(consents) {
  const last = consents?.at(-1);
  const outdated = last?.action === CONSENT_ACTIONS.ACCEPTED && last.policyVersion !== CONSENT_POLICY_VERSION;
  return {
    status: last?.action ?? null,
    policyVersion: last?.policyVersion ?? null,
    outdated,
    accepted: last?.action === CONSENT_ACTIONS.ACCEPTED && !outdated,
  };
}
