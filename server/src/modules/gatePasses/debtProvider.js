import mongoose from 'mongoose';
import { INVOICE_STATUS } from '../../constants/enums.js';
import { Invoice } from '../../models/index.js';

/**
 * Công nợ hiện tại của căn hộ = tổng hóa đơn chưa thanh toán (UNPAID + OVERDUE).
 * Dùng khi Trưởng BQL duyệt Gate Pass chuyển đồ ra (UC53). Khi Người 3 có API công nợ (trả một phần, phí phạt…)
 * thì thay phần tính ở đây, giữ nguyên dạng trả về.
 * @returns {Promise<{ amount: number, invoiceCount: number, available: true }>}
 */
export async function getApartmentDebt(apartmentId) {
  const [row] = await Invoice.aggregate([
    {
      $match: {
        apartmentId: new mongoose.Types.ObjectId(String(apartmentId)),
        status: { $in: [INVOICE_STATUS.UNPAID, INVOICE_STATUS.OVERDUE] },
      },
    },
    { $group: { _id: null, amount: { $sum: '$totalAmount' }, invoiceCount: { $sum: 1 } } },
  ]);
  return { amount: row?.amount ?? 0, invoiceCount: row?.invoiceCount ?? 0, available: true };
}
