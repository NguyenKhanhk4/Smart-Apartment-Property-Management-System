// Mô đun 4 — File PDF thông báo phí (UC27, UC28): thông tin tòa nhà, các dòng phí, số phải trả, "Nợ các kỳ trước"
// (chỉ để biết), hướng dẫn chuyển khoản với nội dung mẫu "<Mã căn> T<MM>-<YYYY>" (vd A1205 T10-2026).
// Quyền xem như chi tiết thông báo (getInvoice, X1). Bản Nháp / Chờ duyệt (chỉ quản trị thấy) in dấu BẢN NHÁP.
import { INVOICE_STATUS } from '../../constants/enums.js';
import { Building } from '../../models/index.js';
import { drawLetterhead, drawTable, drawTotals, fmtMoney, renderDocument } from '../../services/export.service.js';
import { fmtDateVn, periodLabel } from '../../utils/time.js';
import { getInvoice } from './invoices.queries.js';

const UNPUBLISHED = [INVOICE_STATUS.DRAFT, INVOICE_STATUS.PENDING_APPROVAL];
export async function buildInvoicePdf(user, id) {
  const invoice = await getInvoice(user, id);
  const building = await Building.findById(invoice.buildingId?._id).select('code name address').lean();
  const bank = invoice.payInfo;
  const aptLabel = [building?.code, invoice.apartmentId?.code].filter(Boolean).join('-');
  const outstanding = Math.max(0, invoice.totalAmount - invoice.paidAmount);
  const draft = UNPUBLISHED.includes(invoice.status);

  const buffer = await renderDocument(
    (doc, layout) => {
      const { left, width } = layout;
      drawLetterhead(doc, layout, {
        building,
        right: invoice.issuedAt ? `Ngày phát hành: ${fmtDateVn(invoice.issuedAt)}` : 'Chưa phát hành',
      });

      doc.font('bold').fontSize(16).text(`THÔNG BÁO PHÍ DỊCH VỤ THÁNG ${periodLabel(invoice.period)}`, left, doc.y, { width, align: 'center' });
      doc.font('regular').fontSize(9).text(`Số: ${invoice.code}`, { width, align: 'center' });
      if (draft) {
        doc.moveDown(0.3).font('bold').fontSize(10).fillColor('#c0392b');
        doc.text('BẢN NHÁP — chưa phát hành, không dùng để thu tiền', { width, align: 'center' }).fillColor('#000');
      }
      doc.moveDown(1.2);

      doc.font('regular').fontSize(11).text('Kính gửi: ', left, doc.y, { continued: true }).font('bold').text(invoice.payerId?.fullName ?? '');
      doc.font('regular').text(`Căn hộ: ${aptLabel}`);
      if (invoice.dueDate) doc.text(`Hạn thanh toán: ${fmtDateVn(invoice.dueDate)}`);
      doc.moveDown(0.6);

      drawTable(
        doc,
        layout,
        [
          { header: 'STT', width: 0.07, align: 'center' },
          { header: 'Nội dung', width: 0.48 },
          { header: 'SL', width: 0.09, align: 'right' },
          { header: 'Đơn giá', width: 0.17, align: 'right' },
          { header: 'Thành tiền', width: 0.19, align: 'right' },
        ],
        invoice.items.map((i, idx) => [idx + 1, i.description, i.quantity, fmtMoney(i.unitPrice), fmtMoney(i.amount)]),
      );
      doc.moveDown(0.5);

      const pairs = [['Tổng phí kỳ này', fmtMoney(invoice.totalAmount), { bold: true }]];
      if (invoice.adjustmentCredit) pairs.push(['Điều chỉnh giảm còn dư (vào Số dư trả trước)', fmtMoney(invoice.adjustmentCredit)]);
      if (invoice.prepaidApplied) pairs.push(['Đã trừ Số dư trả trước', `- ${fmtMoney(invoice.prepaidApplied)}`]);
      const paidOther = invoice.paidAmount - (invoice.prepaidApplied ?? 0);
      if (paidOther > 0) pairs.push(['Đã thanh toán', `- ${fmtMoney(paidOther)}`]);
      pairs.push(['Còn phải trả', fmtMoney(outstanding), { bold: true }]);
      drawTotals(doc, layout, pairs);
      if (invoice.previousDebt > 0) {
        doc.moveDown(0.3).font('regular').fontSize(10).fillColor('#c0392b');
        doc.text(
          `Nợ các kỳ trước chưa thanh toán: ${fmtMoney(invoice.previousDebt)} (chỉ để ông/bà biết, không cộng vào số tiền kỳ này).`,
          left,
          doc.y,
          { width },
        );
        doc.fillColor('#000');
      }

      doc.moveDown(1);
      if (doc.y > layout.bottom() - 140) doc.addPage();
      doc.font('bold').fontSize(11).text('Hướng dẫn thanh toán', left, doc.y);
      doc.font('regular').fontSize(10);
      doc.text('1. Trực tuyến: đăng nhập cổng cư dân, mở thông báo phí và chọn "Thanh toán" (quét mã VietQR payOS).', { width });
      if (bank.configured) {
        doc.text(`2. Chuyển khoản: ${bank.bankName} — số tài khoản ${bank.accountNo} — chủ tài khoản ${bank.accountName}.`, { width });
      } else {
        doc.text('2. Chuyển khoản: liên hệ Ban quản lý để biết tài khoản nhận tiền.', { width });
      }
      doc.text('   Nội dung chuyển khoản: ', { continued: true }).font('bold').text(bank.content);
      doc.font('regular').text('3. Tiền mặt: nộp tại quầy Ban quản lý, nhận biên lai ngay.', { width });
      doc.moveDown(0.6).fontSize(9).fillColor('#555');
      doc.text(
        'Ghi đúng nội dung chuyển khoản để hệ thống gạch nợ nhanh. Số tiền nộp thừa được ghi vào Số dư trả trước và trừ vào kỳ sau.',
        { width },
      );
      doc.fillColor('#000');
    },
    { title: `Thông báo phí ${invoice.code}` },
  );
  return { buffer, filename: `thong-bao-phi-${invoice.code}.pdf`, contentType: 'application/pdf' };
}
