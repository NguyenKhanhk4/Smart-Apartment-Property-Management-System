import { checkApartmentDebt } from '../debts/debts.check.js';

/**
 * Công nợ hiện tại của căn hộ khi Trưởng BQL duyệt Gate Pass chuyển đồ ra (UC53, M7-G1).
 * Lấy từ UC23 của Mô đun 4 (`debts.check.js`): tổng nợ ròng các Người nộp phí (còn nợ − Số dư trả trước của từng người).
 * Giữ nguyên dạng trả về cũ; thêm `overdueAmount`, `byPayer` để hiển thị chi tiết nếu cần.
 * @returns {Promise<{ amount: number, invoiceCount: number, overdueAmount: number, byPayer: object[], available: true }>}
 */
export async function getApartmentDebt(apartmentId) {
  const debt = await checkApartmentDebt(apartmentId);
  return {
    amount: debt.amount,
    invoiceCount: debt.invoiceCount,
    overdueAmount: debt.overdueAmount,
    byPayer: debt.byPayer.map(({ payerId, fullName, net, overdueAmount }) => ({ payerId, fullName, amount: net, overdueAmount })),
    available: true,
  };
}
