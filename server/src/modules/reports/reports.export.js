import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import * as reports from './reports.service.js';

// UC-E13 — Xuất báo cáo Excel/PDF. Mỗi loại báo cáo được chuyển về 1 "spec" chung
// { title, filterText, summary: [[nhãn, giá trị, format]], sections: [{ title, columns, rows }] }
// rồi render bằng exceljs hoặc pdfkit — số liệu giống hệt màn hình nguồn.

const require = createRequire(import.meta.url);
// pdfkit mặc định không có glyph tiếng Việt → dùng DejaVu Sans
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const LABELS = {
  CLEANING: 'Phí vệ sinh',
  PARKING: 'Phí gửi xe',
  AMENITY: 'Phí tiện ích',
  ADJUSTMENT: 'Điều chỉnh',
  VNPAY: 'VNPay',
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  INCOME: 'Thu',
  EXPENSE: 'Chi',
  LOW: 'Thấp',
  MEDIUM: 'Thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};
const label = (v) => LABELS[v] ?? v ?? '';

const fmtMoney = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;
const fmtPercent = (n) => `${((n ?? 0) * 100).toFixed(1)}%`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
const FORMATTERS = { money: fmtMoney, percent: fmtPercent, date: fmtDate };
const formatValue = (value, format) => (FORMATTERS[format] ? FORMATTERS[format](value) : (value ?? ''));

const col = (header, key, width = 16, format) => ({ header, key, width, format });

// ===== Chuyển dữ liệu từng loại báo cáo → spec =====
async function buildSpec(type, q) {
  switch (type) {
    case 'billing': {
      const r = await reports.billingSummary(q);
      const moneyCols = [
        col('Phải thu', 'billed', 18, 'money'),
        col('Đã thu', 'collected', 18, 'money'),
        col('Còn nợ', 'outstanding', 18, 'money'),
        col('Tỷ lệ thu', 'collectionRate', 12, 'percent'),
      ];
      return {
        title: 'BÁO CÁO TỔNG HỢP THU PHÍ',
        filterText: `Kỳ ${q.from} → ${q.to}${q.feeCategory ? ` · ${label(q.feeCategory)}` : ''}`,
        summary: [
          ['Tổng hóa đơn', r.overview.issued],
          ['Đã thanh toán / Chưa / Quá hạn / Hủy', `${r.overview.paid} / ${r.overview.unpaid} / ${r.overview.overdue} / ${r.overview.cancelled}`],
          ['Tổng phải thu', r.overview.billed, 'money'],
          ['Đã thu', r.overview.collected, 'money'],
          ['Còn nợ', r.overview.outstanding, 'money'],
          ['Tỷ lệ thu', r.overview.collectionRate, 'percent'],
        ],
        sections: [
          {
            title: 'Theo loại phí',
            columns: [col('Loại phí', 'feeCategoryLabel', 20), ...moneyCols],
            rows: r.byFeeCategory.map((x) => ({ ...x, feeCategoryLabel: label(x.feeCategory) })),
          },
          { title: 'Theo tháng', columns: [col('Kỳ', 'period', 12), ...moneyCols], rows: r.byMonth },
          { title: 'Theo tòa', columns: [col('Tòa', 'buildingName', 20), ...moneyCols], rows: r.byBuilding },
          {
            title: 'Theo phương thức thanh toán',
            columns: [col('Phương thức', 'methodLabel', 20), col('Số giao dịch', 'count', 14), col('Số tiền', 'amount', 18, 'money')],
            rows: r.byMethod.map((x) => ({ ...x, methodLabel: label(x.method) })),
          },
        ],
      };
    }
    case 'debts': {
      const r = await reports.debtReport(q);
      return {
        title: 'BÁO CÁO CÔNG NỢ QUÁ HẠN',
        filterText: `Tại ngày ${fmtDate(new Date())}`,
        summary: [
          ['Số căn quá hạn', r.totalApartments],
          ['Tổng nợ quá hạn', r.totalOutstanding, 'money'],
          ['Chưa phân công đòi nợ', r.unassigned],
        ],
        sections: [
          {
            title: 'Danh sách căn hộ quá hạn',
            columns: [
              col('Căn hộ', 'apartmentCode', 12),
              col('Tòa', 'buildingName', 14),
              col('Số HĐ', 'invoiceCount', 8),
              col('Các kỳ', 'periodsText', 22),
              col('Số tiền nợ', 'outstanding', 18, 'money'),
              col('Số ngày quá hạn', 'daysOverdue', 12),
              col('Phụ trách', 'assignedToText', 18),
            ],
            rows: r.items.map((x) => ({
              ...x,
              periodsText: x.periods.join(', '),
              assignedToText: x.assignedTo ?? 'Chưa giao',
            })),
          },
        ],
      };
    }
    case 'fund': {
      const r = await reports.fundDashboard(q);
      return {
        title: 'BÁO CÁO QUỸ BẢO TRÌ',
        filterText: `Từ ${fmtDate(q.from)} đến ${fmtDate(q.to)}`,
        summary: [
          ['Số dư hiện tại', r.balance, 'money'],
          ['Tổng thu trong kỳ', r.totalIncome, 'money'],
          ['Tổng chi trong kỳ', r.totalExpense, 'money'],
          ['Đề xuất chi đang chờ', r.pendingProposals.length],
        ],
        sections: [
          {
            title: 'Thu chi theo tháng',
            columns: [col('Tháng', 'period', 12), col('Thu', 'income', 18, 'money'), col('Chi', 'expense', 18, 'money')],
            rows: r.monthly,
          },
          {
            title: 'Giao dịch gần nhất',
            columns: [
              col('Ngày', 'occurredAt', 12, 'date'),
              col('Loại', 'typeLabel', 8),
              col('Số tiền', 'amount', 18, 'money'),
              col('Nội dung', 'text', 40),
            ],
            rows: r.recentTransactions.map((t) => ({
              ...t,
              typeLabel: label(t.type),
              text: t.description || t.proposalId?.title || t.source || '',
            })),
          },
        ],
      };
    }
    case 'operations': {
      const [occ, tk, mt] = await Promise.all([
        reports.occupancyReport(q),
        reports.ticketReport(q),
        reports.maintenanceReport(q),
      ]);
      return {
        title: 'BÁO CÁO VẬN HÀNH',
        filterText: `Từ ${fmtDate(q.from)} đến ${fmtDate(q.to)}`,
        summary: [
          ['Tỷ lệ lấp đầy', occ.occupancyRate, 'percent'],
          ['Phản ánh trong kỳ', tk.total],
          ['Đang mở / Quá hạn', `${tk.open} / ${tk.overdue}`],
          ['Thời gian xử lý TB (giờ)', tk.avgResolutionHours],
          ['Đánh giá TB', tk.avgRating],
          ['Work order hoàn thành (đúng hạn/trễ)', `${mt.done} (${mt.onTime}/${mt.late})`],
        ],
        sections: [
          {
            title: 'Lấp đầy theo tòa',
            columns: [
              col('Tòa', 'buildingName', 16),
              col('Tổng căn', 'total', 10),
              col('Sở hữu', 'owned', 10),
              col('Cho thuê', 'rented', 10),
              col('Trống', 'vacant', 10),
              col('Tỷ lệ', 'occupancyRate', 10, 'percent'),
            ],
            rows: occ.byBuilding,
          },
          {
            title: 'Phản ánh theo loại',
            columns: [col('Loại phản ánh', 'name', 24), col('Số lượng', 'count', 10)],
            rows: tk.byCategory,
          },
          {
            title: 'Kỹ thuật viên',
            columns: [
              col('Họ tên', 'fullName', 22),
              col('Được giao', 'assigned', 10),
              col('Đã đóng', 'closed', 10),
              col('Đánh giá TB', 'avgRating', 12),
            ],
            rows: tk.technicians,
          },
        ],
      };
    }
    case 'amenity': {
      const r = await reports.amenityUsage(q);
      return {
        title: 'THỐNG KÊ SỬ DỤNG TIỆN ÍCH',
        filterText: `Từ ${fmtDate(q.from)} đến ${fmtDate(q.to)}`,
        summary: [
          ['Tổng lượt đặt', r.total],
          ['Đã sử dụng (COMPLETED)', r.completed],
          ['Tỷ lệ hủy / từ chối', `${fmtPercent(r.cancelRate)} / ${fmtPercent(r.rejectRate)}`],
          ['Khung giờ cao điểm', r.peakSlot ?? '—'],
          ['Doanh thu tiện ích', r.revenue, 'money'],
        ],
        sections: [
          {
            title: 'Theo tiện ích',
            columns: [
              col('Tiện ích', 'name', 20),
              col('Tổng', 'total', 8),
              col('Chờ duyệt', 'pending', 10),
              col('Đã duyệt', 'approved', 10),
              col('Hoàn thành', 'completed', 10),
              col('Hủy', 'cancelled', 8),
              col('Từ chối', 'rejected', 8),
              col('Doanh thu', 'revenue', 16, 'money'),
            ],
            rows: r.byAmenity,
          },
          {
            title: 'Theo khung giờ',
            columns: [col('Khung giờ', 'slotStart', 12), col('Lượt', 'bookings', 10), col('Tỷ lệ lấp TB', 'avgFillRate', 14, 'percent')],
            rows: r.bySlot,
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown report type ${type}`);
  }
}

// ===== Excel =====
async function renderXlsx(spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SAPMS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Tổng quan');
  ws.addRow([spec.title]).font = { bold: true, size: 14 };
  ws.addRow([spec.filterText]).font = { italic: true };
  ws.addRow([]);
  for (const [k, v, format] of spec.summary) {
    const row = ws.addRow([k, typeof v === 'number' && format !== 'percent' ? v : formatValue(v, format)]);
    row.getCell(1).font = { bold: true };
    if (format === 'money') row.getCell(2).numFmt = '#,##0" đ"';
  }
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 28;

  for (const section of spec.sections) {
    const sheet = wb.addWorksheet(section.title.slice(0, 31));
    sheet.columns = section.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4FF' } };
    for (const row of section.rows) {
      sheet.addRow(
        Object.fromEntries(
          section.columns.map((c) => [
            c.key,
            c.format === 'date' ? (row[c.key] ? new Date(row[c.key]) : null) : row[c.key],
          ]),
        ),
      );
    }
    section.columns.forEach((c, i) => {
      const column = sheet.getColumn(i + 1);
      if (c.format === 'money') column.numFmt = '#,##0" đ"';
      if (c.format === 'percent') column.numFmt = '0.0%';
      if (c.format === 'date') column.numFmt = 'dd/mm/yyyy';
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ===== PDF =====
function renderPdf(spec) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);
    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    doc.font('bold').fontSize(16).text(spec.title, { align: 'center' });
    doc.font('regular').fontSize(10).fillColor('#555').text(spec.filterText, { align: 'center' });
    doc.text(`Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`, { align: 'center' });
    doc.moveDown().fillColor('#000');

    for (const [k, v, format] of spec.summary) {
      doc.font('bold').fontSize(10).text(`${k}: `, { continued: true });
      doc.font('regular').text(String(formatValue(v, format)));
    }

    for (const section of spec.sections) {
      doc.moveDown();
      if (doc.y > bottom() - 60) doc.addPage();
      doc.font('bold').fontSize(12).text(section.title, left);
      doc.moveDown(0.3);

      const totalWidth = section.columns.reduce((s, c) => s + c.width, 0);
      const widths = section.columns.map((c) => (c.width / totalWidth) * usable);
      const drawRow = (cells, { header = false } = {}) => {
        doc.font(header ? 'bold' : 'regular').fontSize(9);
        const height =
          Math.max(...cells.map((t, i) => doc.heightOfString(String(t), { width: widths[i] - 6 }))) + 6;
        if (doc.y + height > bottom()) doc.addPage();
        const y = doc.y;
        if (header) doc.rect(left, y, usable, height).fill('#e6f4ff').fillColor('#000');
        let x = left;
        cells.forEach((t, i) => {
          doc.text(String(t), x + 3, y + 3, { width: widths[i] - 6 });
          x += widths[i];
        });
        doc.moveTo(left, y + height).lineTo(left + usable, y + height).strokeColor('#ddd').stroke();
        doc.x = left;
        doc.y = y + height;
      };

      drawRow(section.columns.map((c) => c.header), { header: true });
      if (!section.rows.length) drawRow(['Không có dữ liệu', ...section.columns.slice(1).map(() => '')]);
      for (const row of section.rows) {
        drawRow(section.columns.map((c) => formatValue(row[c.key], c.format)));
      }
    }
    doc.end();
  });
}

export async function exportReport(type, format, query) {
  const spec = await buildSpec(type, query);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'pdf') {
    return { buffer: await renderPdf(spec), filename: `bao-cao-${type}-${stamp}.pdf`, contentType: 'application/pdf' };
  }
  return {
    buffer: await renderXlsx(spec),
    filename: `bao-cao-${type}-${stamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
