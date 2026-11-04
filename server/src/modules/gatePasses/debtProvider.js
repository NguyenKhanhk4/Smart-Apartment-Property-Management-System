import mongoose from 'mongoose';
import { INVOICE_OUTSTANDING_STATUSES } from '../../constants/enums.js';
import { Invoice } from '../../models/index.js';

/**
 * Công nợ hiện tại của căn hộ = tổng số còn nợ (tổng − đã trả) của thông báo phí đã phát hành chưa trả đủ
 * (Chưa thanh toán / Thanh toán một phần / Quá hạn). Dùng khi Trưởng BQL duyệt Gate Pass chuyển đồ ra (UC53).
 * @returns {Promise<{ amount: number, invoiceCount: number, available: true }>}
 */
export async function getApartmentDebt(apartmentId) {
  const [row] = await Invoice.aggregate([
    {
      $match: {
        apartmentId: new mongoose.Types.ObjectId(String(apartmentId)),
        status: { $in: [...INVOICE_OUTSTANDING_STATUSES] },
      },
    },
    { $group: { _id: null, amount: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } }, invoiceCount: { $sum: 1 } } },
  ]);
  return { amount: row?.amount ?? 0, invoiceCount: row?.invoiceCount ?? 0, available: true };
}
