// Mô đun 4 — thông tin chuyển khoản in trên thông báo phí (PDF + màn hình): tài khoản nhận tiền, nội dung mẫu.
// Tài khoản nhận tiền lấy từ hồ sơ tòa nhà (UC05, Người 1) — một nguồn duy nhất, Trưởng BQL sửa ở "Tòa nhà & biểu phí".
import { BuildingProfile, SystemConfig } from '../../models/index.js';
import { getBankInfo } from '../buildingSettings/buildingProfile.service.js';

/** Nội dung chuyển khoản mẫu: mã tòa + mã căn (bỏ ký tự đặc biệt) + kỳ, vd "A1205 T10-2026" */
export function transferContent(buildingCode, apartmentCode, period) {
  const apt = `${buildingCode ?? ''}${apartmentCode ?? ''}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${apt} T${period.slice(5)}-${period.slice(0, 4)}`;
}

/** Tài khoản nhận tiền (hồ sơ tòa nhà UC05); thiếu mục nào thì configured = false */
export async function bankInfo() {
  const b = await getBankInfo();
  const info = { bankName: b.bankName || null, accountNo: b.accountNo || null, accountName: b.accountName || null };
  return { ...info, configured: Boolean(info.bankName && info.accountNo && info.accountName) };
}

// Tham số hệ thống cũ (trước khi có UC05) — chỉ còn dùng để chuyển dữ liệu trong db:sync
const LEGACY_BANK_KEYS = { BANK_NAME: 'bankName', BANK_ACCOUNT_NO: 'bankAccountNo', BANK_ACCOUNT_NAME: 'bankAccountName' };

/**
 * db:sync — chuyển tài khoản nhận tiền đã nhập ở tham số BANK_* sang hồ sơ tòa nhà (chỉ điền ô hồ sơ đang trống,
 * không ghi đè dữ liệu Trưởng BQL đã nhập ở UC05), rồi xóa tham số cũ để không còn 2 nguồn. Chạy lại không đổi gì.
 * @returns {Promise<{ moved: string[], removed: number }>}
 */
export async function migrateLegacyBankConfigs() {
  const docs = await SystemConfig.find({ key: { $in: Object.keys(LEGACY_BANK_KEYS) } }).lean();
  if (!docs.length) return { moved: [], removed: 0 };

  const profile = await BuildingProfile.findOne().lean();
  const set = {};
  for (const d of docs) {
    const field = LEGACY_BANK_KEYS[d.key];
    let value = typeof d.value === 'string' ? d.value.trim() : '';
    if (field === 'bankAccountNo') value = value.replace(/\D/g, ''); // UC05 chỉ nhận chữ số
    if (value && !profile?.[field]) set[field] = value;
  }
  if (Object.keys(set).length) {
    if (profile) await BuildingProfile.updateOne({ _id: profile._id }, { $set: set });
    else await BuildingProfile.create(set);
  }
  const { deletedCount } = await SystemConfig.deleteMany({ key: { $in: Object.keys(LEGACY_BANK_KEYS) } });
  return { moved: Object.keys(set), removed: deletedCount };
}
