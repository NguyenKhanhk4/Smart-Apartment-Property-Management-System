// UC65 — Dịch vụ xuất Excel / PDF dùng chung cho mọi báo cáo (Mô đun 9) và sổ sách tài chính (Mô đun 4).
// Nơi gọi chuyển dữ liệu về 1 "spec": { title, filterText, summary: [[nhãn, giá trị, format]], sections: [{ title, columns, rows }] }
// (cột tạo bằng col(header, key, width, format), format: money | percent | date) rồi gọi renderReport(spec, format, tênFile).
// PDF tiếng Việt dùng font DejaVu Sans (pdfkit mặc định không có glyph tiếng Việt).
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { fmtDateTimeVn, fmtDateVn, toVnYmd } from '../utils/time.js';

const require = createRequire(import.meta.url);
export const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
export const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

export const fmtMoney = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;
export const fmtPercent = (n) => `${((n ?? 0) * 100).toFixed(1)}%`;
export const fmtDate = (d) => (d ? fmtDateVn(d) : '');
const FORMATTERS = { money: fmtMoney, percent: fmtPercent, date: fmtDate };
export const formatValue = (value, format) => (FORMATTERS[format] ? FORMATTERS[format](value) : (value ?? ''));

/** Cột bảng: col('Số tiền', 'amount', 18, 'money') */
export const col = (header, key, width = 16, format) => ({ header, key, width, format });

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ===== Excel =====
export async function renderXlsx(spec) {
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
export function renderPdf(spec) {
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
    doc.text(`Xuất lúc ${fmtDateTimeVn(new Date())}`, { align: 'center' });
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


// ===== PDF văn bản (thông báo phí, biên lai): khổ dọc A4, tiêu đề Ban quản lý, bảng tự sang trang =====

/**
 * Dựng 1 PDF văn bản: draw(doc, layout) vẽ nội dung; layout = { left, width, bottom() }.
 * @returns {Promise<Buffer>}
 */
export function renderDocument(draw, { title } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: title ? { Title: title } : undefined });
    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);
    const chunks = [];
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const layout = { left, width: doc.page.width - left - doc.page.margins.right, bottom: () => doc.page.height - doc.page.margins.bottom };
    try {
      draw(doc, layout);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Đầu trang: "BAN QUẢN LÝ TÒA NHÀ" + tên, địa chỉ tòa bên trái; dòng phải (vd ngày) bên phải */
export function drawLetterhead(doc, { left, width }, { building, right }) {
  const top = doc.y;
  doc.font('bold').fontSize(11).text('BAN QUẢN LÝ TÒA NHÀ', left, top);
  doc.font('regular').fontSize(10);
  if (building?.name) doc.text(building.name, left);
  if (building?.address) doc.text(building.address, left, doc.y, { width: width * 0.6 });
  const after = doc.y;
  if (right) doc.text(right, left, top, { width, align: 'right' });
  doc.x = left;
  doc.y = after;
  doc.moveDown(1.5);
}

/**
 * Bảng đơn giản: columns [{ header, width (tỷ lệ), align }], rows: mảng chuỗi, hoặc { cells, bold } để in đậm.
 * Dòng cao theo nội dung; hết trang thì sang trang và vẽ lại tiêu đề cột.
 */
export function drawTable(doc, { left, width, bottom }, columns, rows) {
  const total = columns.reduce((s, c) => s + c.width, 0);
  const widths = columns.map((c) => (c.width / total) * width);
  const line = (cells, { header = false, bold = false } = {}) => {
    const font = header || bold ? 'bold' : 'regular';
    doc.font(font).fontSize(9.5);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: widths[i] - 8 }))) + 8;
    if (doc.y + h > bottom()) {
      doc.addPage();
      if (!header) line(columns.map((c) => c.header), { header: true });
      doc.font(font).fontSize(9.5);
    }
    const y = doc.y;
    if (header) doc.rect(left, y, width, h).fill('#eef3f8').fillColor('#000');
    let x = left;
    cells.forEach((t, i) => {
      doc.text(String(t ?? ''), x + 4, y + 4, { width: widths[i] - 8, align: columns[i].align ?? 'left' });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor('#999').stroke();
    doc.x = left;
    doc.y = y + h;
  };
  line(columns.map((c) => c.header), { header: true });
  for (const r of rows) {
    if (Array.isArray(r)) line(r);
    else line(r.cells, { bold: r.bold });
  }
}

/** Cặp nhãn – giá trị căn phải (khối tổng tiền dưới bảng): [[nhãn, giá trị, { bold }]] */
export function drawTotals(doc, { left, width }, pairs) {
  for (const [label, value, { bold = false } = {}] of pairs) {
    const y = doc.y;
    doc.font(bold ? 'bold' : 'regular').fontSize(10.5);
    doc.text(label, left + width * 0.35, y, { width: width * 0.4 });
    const after = doc.y;
    doc.text(value, left + width * 0.75, y, { width: width * 0.25, align: 'right' });
    doc.x = left;
    doc.y = Math.max(after, doc.y);
    doc.moveDown(0.25);
  }
}

// ===== Đọc số tiền bằng chữ (biên lai) =====
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const GROUP_UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

function readTriple(n, full) {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts = [];
  if (h > 0 || full) parts.push(`${DIGITS[h]} trăm`);
  if (t > 1) {
    parts.push(`${DIGITS[t]} mươi`);
    if (u === 1) parts.push('mốt');
    else if (u === 4) parts.push('tư');
    else if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (t === 1) {
    parts.push('mười');
    if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (u > 0) {
    if (h > 0 || full) parts.push('linh');
    parts.push(DIGITS[u]);
  }
  return parts.join(' ');
}

/** 1250000 → "Một triệu hai trăm năm mươi nghìn đồng" */
export function moneyInWords(amount) {
  let n = Math.round(Math.abs(amount ?? 0));
  if (n === 0) return 'Không đồng';
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    words.push(readTriple(groups[i], i < groups.length - 1), GROUP_UNITS[i]);
  }
  const text = words.filter(Boolean).join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} đồng`;
}

/**
 * Dựng file từ spec. `basename` không có đuôi, vd 'so-cong-no' → so-cong-no-2026-11-07.xlsx
 * @returns {Promise<{ buffer: Buffer, filename: string, contentType: string }>}
 */
export async function renderReport(spec, format, basename) {
  const stamp = toVnYmd(new Date());
  if (format === 'pdf') return { buffer: await renderPdf(spec), filename: `${basename}-${stamp}.pdf`, contentType: 'application/pdf' };
  return { buffer: await renderXlsx(spec), filename: `${basename}-${stamp}.xlsx`, contentType: XLSX_TYPE };
}

/** Gửi file đã dựng về client (route Express) */
export function sendFile(res, file) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(file.buffer);
}
