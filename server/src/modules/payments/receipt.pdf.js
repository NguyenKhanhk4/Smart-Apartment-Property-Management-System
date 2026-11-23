// Mô đun 4 — UC35: PDF biên lai cho mỗi lần thu (tiền mặt, chuyển khoản, payOS; kể cả trả một phần, phí tiện ích).
// Quyền như xem biên lai (getReceipt): Kế toán / Trưởng BQL, hoặc chính Người nộp phí. Ghi rõ không thay thế hóa đơn GTGT.
import { PAYMENT_STATUS } from '../../constants/enums.js';
import { Building } from '../../models/index.js';
import { drawLetterhead, drawTable, drawTotals, fmtMoney, moneyInWords, renderDocument } from '../../services/export.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { fmtDateTimeVn, fmtDateVn, periodLabel } from '../../utils/time.js';
import { getReceipt } from './payments.service.js';

const METHOD_LABELS = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', PAYOS: 'Trực tuyến (payOS)' };

export async function buildReceiptPdf(user, id) {
  const r = await getReceipt(user, id);
  if (r.status !== PAYMENT_STATUS.SUCCESS) throw ApiError.badRequest('Giao dịch chưa thành công, chưa có biên lai');
  const building = r.apartmentId?.buildingId?._id
    ? await Building.findById(r.apartmentId.buildingId._id).select('code name address').lean()
    : null;
  const apt = [building?.code, r.apartmentId?.code].filter(Boolean).join('-');

  const rows = r.allocations.map((a) => [
    a.invoice ? `Thông báo phí kỳ ${periodLabel(a.invoice.period)} (${a.invoice.code})` : 'Thông báo phí',
    fmtMoney(a.amount),
  ]);
  const booking = r.bookingId;
  if (booking && !r.creditAmount) {
    rows.push([`Phí tiện ích ${booking.amenityId?.name ?? ''} ngày ${fmtDateVn(booking.date)} ${booking.slotStart}–${booking.slotEnd}`.trim(), fmtMoney(r.amount)]);
  }
  if (r.creditAmount > 0) rows.push(['Ghi vào Số dư trả trước', fmtMoney(r.creditAmount)]);

  const buffer = await renderDocument(
    (doc, layout) => {
      const { left, width } = layout;
      drawLetterhead(doc, layout, { building, right: `Ngày ${fmtDateVn(r.paidAt)}` });
      doc.font('bold').fontSize(16).text('BIÊN LAI THU TIỀN', left, doc.y, { width, align: 'center' });
      doc.font('regular').fontSize(9).text(`Số: ${r.receiptNumber}`, { width, align: 'center' });
      doc.moveDown(1.2);

      doc.fontSize(11);
      doc.text('Người nộp: ', left, doc.y, { continued: true }).font('bold').text(r.payerId?.fullName ?? '');
      doc.font('regular').text(`Căn hộ: ${apt}`);
      doc.text(`Thời gian thu: ${fmtDateTimeVn(r.paidAt)}`);
      doc.text(`Hình thức: ${METHOD_LABELS[r.method] ?? r.method}`);
      const ref = r.bankRef || r.reference;
      if (ref) doc.text(`Mã giao dịch ngân hàng: ${ref}`);
      if (r.confirmedBy?.fullName) doc.text(`Người thu: ${r.confirmedBy.fullName}`);
      doc.moveDown(0.6);

      doc.font('regular').text('Số tiền: ', { continued: true }).font('bold').text(fmtMoney(r.amount));
      doc.font('regular').text(`Bằng chữ: ${moneyInWords(r.amount)}.`, { width });
      doc.moveDown(0.6);

      drawTable(
        doc,
        layout,
        [
          { header: 'Nội dung', width: 0.7 },
          { header: 'Số tiền', width: 0.3, align: 'right' },
        ],
        [...rows, { cells: ['Tổng cộng', fmtMoney(r.amount)], bold: true }],
      );
      doc.moveDown(0.6);
      drawTotals(doc, layout, [
        ['Còn nợ hiện tại', fmtMoney(r.currentOutstanding)],
        ['Số dư trả trước hiện tại', fmtMoney(r.prepaidBalance)],
      ]);

      doc.moveDown(1).font('bold').fontSize(10).fillColor('#c0392b');
      doc.text(r.vatNote, left, doc.y, { width });
      doc.fillColor('#000');
    },
    { title: `Biên lai ${r.receiptNumber}` },
  );
  return { buffer, filename: `bien-lai-${r.receiptNumber}.pdf`, contentType: 'application/pdf' };
}
