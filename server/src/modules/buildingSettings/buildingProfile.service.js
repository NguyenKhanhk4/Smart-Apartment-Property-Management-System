import { BuildingProfile } from '../../models/index.js';

/** Trả thông tin ngân hàng để in lên PDF thông báo phí */
export async function getBankInfo() {
  const profile = await BuildingProfile.findOne().lean();
  if (!profile) return { bankName: '', accountNo: '', accountName: '' };
  return {
    bankName: profile.bankName ?? '',
    accountNo: profile.bankAccountNo ?? '',
    accountName: profile.bankAccountName ?? '',
  };
}
