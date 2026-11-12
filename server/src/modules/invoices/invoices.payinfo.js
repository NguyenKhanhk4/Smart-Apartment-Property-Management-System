// Mô đun 4 — thông tin chuyển khoản in trên thông báo phí (PDF + màn hình): tài khoản nhận tiền, nội dung mẫu.
import { CONFIG_KEYS } from '../../constants/enums.js';
import { getConfigs } from '../../services/systemConfig.service.js';

const BANK_KEYS = [CONFIG_KEYS.BANK_NAME, CONFIG_KEYS.BANK_ACCOUNT_NO, CONFIG_KEYS.BANK_ACCOUNT_NAME];

/** Nội dung chuyển khoản mẫu: mã tòa + mã căn (bỏ ký tự đặc biệt) + kỳ, vd "A1205 T10-2026" */
export function transferContent(buildingCode, apartmentCode, period) {
  const apt = `${buildingCode ?? ''}${apartmentCode ?? ''}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${apt} T${period.slice(5)}-${period.slice(0, 4)}`;
}

/** Tài khoản nhận tiền (tham số hệ thống, Trưởng BQL sửa); thiếu mục nào thì configured = false */
export async function bankInfo() {
  const c = await getConfigs(BANK_KEYS);
  const info = { bankName: c.BANK_NAME || null, accountNo: c.BANK_ACCOUNT_NO || null, accountName: c.BANK_ACCOUNT_NAME || null };
  return { ...info, configured: Boolean(info.bankName && info.accountNo && info.accountName) };
}
