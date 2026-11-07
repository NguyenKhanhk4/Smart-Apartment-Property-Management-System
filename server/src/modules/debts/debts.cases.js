// Mô đun 4 — UC31: Trưởng BQL ghi kết quả xử lý nợ quá hạn, ngày hẹn trả; PDF Thông báo nợ quá hạn.
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONTACT_METHODS,
  DEBT_OPEN_STATUSES,
  DEBT_STATUS,
  INVOICE_OUTSTANDING_STATUSES,
} from '../../constants/enums.js';
import { DebtFollowup, Invoice } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { fmtDateTimeVn, fmtDateVn, periodLabel, startOfVnDay, toVnYmd, vnDayStart } from '../../utils/time.js';
import { hasOverdueDebt } from './debts.check.js';

const require = createRequire(import.meta.url);
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const CONTACT_LABELS = {
  [CONTACT_METHODS.PHONE]: 'Gọi điện',
  [CONTACT_METHODS.SMS]: 'Tin nhắn',
  [CONTACT_METHODS.EMAIL]: 'Email',
  [CONTACT_METHODS.IN_PERSON]: 'Gặp trực tiếp',
  [CONTACT_METHODS.LETTER]: 'Gửi văn bản',
};

/**
 * Gọi sau mỗi lần gạch nợ (trong transaction): Người nộp phí không còn khoản quá hạn nào tại căn → đóng hồ sơ nợ đang mở.
 */
export async function closeCaseIfCleared(apartmentId, payerId, { now = new Date(), session = null } = {}) {
  if (!payerId) return 0;
  if (await hasOverdueDebt(apartmentId, payerId, startOfVnDay(now), session)) return 0;
  const res = await DebtFollowup.updateMany(
    { apartmentId, payerId, status: { $in: [...DEBT_OPEN_STATUSES] } },
    { $set: { status: DEBT_STATUS.RESOLVED, resolvedAt: now, promisedDate: null } },
    { session },
  );
  return res.modifiedCount;
}

const CASE_POPULATE = [
  { path: 'apartmentId', select: 'code', populate: { path: 'buildingId', select: 'code name address' } },
  { path: 'payerId', select: 'fullName phone email' },
  { path: 'activities.by', select: 'fullName' },
];

export async function getCase(id) {
  const c = await DebtFollowup.findById(id).populate(CASE_POPULATE).lean();
  if (!c) throw ApiError.notFound('Không tìm thấy hồ sơ nợ');
  return c;
}

/**
 * Trưởng BQL ghi kết quả xử lý: hình thức liên hệ, phản hồi, biện pháp đã áp dụng, ngày hẹn trả (YYYY-MM-DD).
 * Có ngày hẹn → tạm dừng nhắc tự động đến hết ngày đó; quá hẹn mà chưa trả đủ cron báo lại 1 lần.
 */
export async function recordActivity(user, id, { method, response, measures, note, promisedDate }, { now = new Date() } = {}) {
  const c = await DebtFollowup.findById(id).select('status apartmentId payerId').lean();
  if (!c) throw ApiError.notFound('Không tìm thấy hồ sơ nợ');
  if (!DEBT_OPEN_STATUSES.includes(c.status)) throw ApiError.badRequest('Hồ sơ nợ đã đóng (đã trả hết nợ quá hạn)');

  const promised = promisedDate ? vnDayStart(promisedDate) : null;
  if (promised && promised < startOfVnDay(now)) throw ApiError.badRequest('Ngày hẹn trả không được ở quá khứ');

  const activity = {
    at: now,
    by: user.id,
    method: method ?? null,
    response: response || null,
    measures: measures || null,
    note: note || null,
    promisedDate: promised,
  };
  const updated = await DebtFollowup.findOneAndUpdate(
    { _id: id, status: { $in: [...DEBT_OPEN_STATUSES] } },
    { $push: { activities: activity }, ...(promised && { $set: { promisedDate: promised } }) },
    { new: true },
  );
  if (!updated) throw ApiError.badRequest('Hồ sơ nợ đã đóng (đã trả hết nợ quá hạn)');

  await logAudit({
    action: AUDIT_ACTIONS.DEBT_FOLLOWUP_RECORDED,
    user,
    targetType: AUDIT_TARGETS.DEBT_FOLLOWUP,
    targetId: c._id,
    metadata: { apartmentId: c.apartmentId, payerId: c.payerId, method, promisedDate: promisedDate ?? null },
  });
  return getCase(id);
}

// ---------------------------------------------------------------------------
// PDF Thông báo nợ quá hạn
// ---------------------------------------------------------------------------
const money = (n) => `${Math.round(n ?? 0).toLocaleString('vi-VN')} đ`;

function renderNoticePdf({ c, invoices, total, overdueTotal, now }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);
    const chunks = [];
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const building = c.apartmentId?.buildingId;
    const apt = [building?.code, c.apartmentId?.code].filter(Boolean).join('-');
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font('bold').fontSize(11).text('BAN QUẢN LÝ TÒA NHÀ', left, 50);
    doc.font('regular').fontSize(10).text(building?.name ?? '', left);
    if (building?.address) doc.text(building.address, left);
    doc.text(`Ngày ${fmtDateVn(now)}`, left, 50, { width, align: 'right' });
    doc.moveDown(2);

    doc.font('bold').fontSize(16).text('THÔNG BÁO NỢ QUÁ HẠN', left, doc.y, { width, align: 'center' });
    doc.font('regular').fontSize(9).text(`Số: TBN-${toVnYmd(now).replaceAll('-', '')}-${String(c._id).slice(-6).toUpperCase()}`, { width, align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11).font('regular').text('Kính gửi: ', { continued: true }).font('bold').text(c.payerId?.fullName ?? '');
    doc.font('regular').text(`Căn hộ: ${apt}`);
    if (c.payerId?.phone) doc.text(`Điện thoại: ${c.payerId.phone}`);
    doc.moveDown();
    doc.text(
      `Tính đến ngày ${fmtDateVn(now)}, Ban quản lý ghi nhận ông/bà còn các khoản phí dịch vụ chưa thanh toán như sau ` +
        '(các khoản đánh dấu * đã quá hạn thanh toán):',
      { width, align: 'justify' },
    );
    doc.moveDown(0.5);

    // Bảng các kỳ còn nợ
    const cols = [
      { h: 'Kỳ', w: 0.1, a: 'left' },
      { h: 'Mã thông báo', w: 0.27, a: 'left' },
      { h: 'Hạn đóng', w: 0.14, a: 'left' },
      { h: 'Phải trả', w: 0.16, a: 'right' },
      { h: 'Đã trả', w: 0.16, a: 'right' },
      { h: 'Còn nợ', w: 0.17, a: 'right' },
    ].map((x) => ({ ...x, w: x.w * width }));
    const row = (cells, { bold = false } = {}) => {
      const y = doc.y;
      let x = left;
      doc.font(bold ? 'bold' : 'regular').fontSize(9.5);
      cells.forEach((text, i) => {
        doc.text(String(text), x + 3, y + 4, { width: cols[i].w - 6, align: cols[i].a });
        x += cols[i].w;
      });
      const h = 20;
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor('#999').stroke();
      doc.y = y + h;
      doc.x = left;
    };
    row(cols.map((x) => x.h), { bold: true });
    for (const inv of invoices) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      row([
        `${periodLabel(inv.period)}${inv.overdue ? ' *' : ''}`,
        inv.code,
        fmtDateVn(inv.dueDate),
        money(inv.totalAmount),
        money(inv.paidAmount),
        money(inv.totalAmount - inv.paidAmount),
      ]);
    }
    row(['', 'Tổng cộng', '', '', '', money(total)], { bold: true });
    doc.moveDown();
    doc.font('regular').fontSize(11).text('Trong đó số tiền đã quá hạn: ', { continued: true }).font('bold').text(money(overdueTotal));
    doc.moveDown();

    doc.font('regular');
    if (c.reminders?.length) {
      doc.text(
        `Ban quản lý đã gửi nhắc nợ qua ứng dụng và email ${c.reminders.length} lần vào các ngày: ` +
          `${c.reminders.map((r) => fmtDateVn(r.at)).join(', ')}.`,
        { width, align: 'justify' },
      );
      doc.moveDown(0.5);
    }
    const contacts = (c.activities ?? []).filter((a) => a.by);
    if (contacts.length) {
      doc.text('Các lần Ban quản lý đã liên hệ:');
      for (const a of contacts) {
        const parts = [CONTACT_LABELS[a.method], a.response, a.promisedDate && `hẹn trả ${fmtDateVn(a.promisedDate)}`].filter(Boolean);
        doc.text(`• ${fmtDateTimeVn(a.at)}: ${parts.join('; ') || a.note || ''}`, { width, indent: 10 });
      }
      doc.moveDown(0.5);
    }
    const first = invoices[0].period;
    const transferNote = `${apt.replace(/[^A-Za-z0-9]/g, '')} T${first.slice(5)}-${first.slice(0, 4)}`;
    doc.text(
      'Đề nghị ông/bà thanh toán số tiền còn nợ trong thời gian sớm nhất, trực tuyến trên ứng dụng hoặc tại quầy Ban quản lý. ' +
        `Nếu chuyển khoản, ghi nội dung theo mẫu "<mã căn> <kỳ>", ví dụ "${transferNote}". ` +
        'Nếu đã thanh toán, xin vui lòng bỏ qua thông báo này hoặc liên hệ Ban quản lý để đối chiếu.',
      { width, align: 'justify' },
    );
    doc.moveDown(2);
    doc.font('bold').text('TRƯỞNG BAN QUẢN LÝ', left + width / 2, doc.y, { width: width / 2, align: 'center' });
    doc.font('regular').fontSize(9).text('(Ký, ghi rõ họ tên)', left + width / 2, doc.y, { width: width / 2, align: 'center' });
    doc.end();
  });
}

/** PDF Thông báo nợ quá hạn của 1 hồ sơ: các kỳ còn nợ, số tiền, các lần đã nhắc / liên hệ */
export async function buildDebtNotice(user, id, { now = new Date() } = {}) {
  const c = await getCase(id);
  const today = startOfVnDay(now);
  const invoices = (
    await Invoice.find({ apartmentId: c.apartmentId._id, payerId: c.payerId._id, status: { $in: [...INVOICE_OUTSTANDING_STATUSES] } })
      .sort({ period: 1 })
      .select('code period dueDate totalAmount paidAmount status')
      .lean()
  ).map((i) => ({ ...i, overdue: i.status === 'OVERDUE' || Boolean(i.dueDate && i.dueDate < today) }));
  if (!invoices.length) throw ApiError.badRequest('Người nộp phí không còn khoản nợ nào tại căn này');

  const total = invoices.reduce((s, i) => s + i.totalAmount - i.paidAmount, 0);
  const overdueTotal = invoices.filter((i) => i.overdue).reduce((s, i) => s + i.totalAmount - i.paidAmount, 0);
  const buffer = await renderNoticePdf({ c, invoices, total, overdueTotal, now });
  await logAudit({
    action: AUDIT_ACTIONS.DEBT_NOTICE_EXPORTED,
    user,
    targetType: AUDIT_TARGETS.DEBT_FOLLOWUP,
    targetId: c._id,
    metadata: { total, overdueTotal, invoices: invoices.map((i) => i.code) },
  });
  const apt = [c.apartmentId?.buildingId?.code, c.apartmentId?.code].filter(Boolean).join('-');
  return { buffer, filename: `thong-bao-no-${apt}-${toVnYmd(now)}.pdf`, contentType: 'application/pdf' };
}
