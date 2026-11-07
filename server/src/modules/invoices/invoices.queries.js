// Mô đun 4 — UC28 Xem thông báo phí.
//   Kế toán / Trưởng BQL: danh sách mọi thông báo (lọc kỳ, trạng thái, tòa, căn, mã), chi tiết + các lần thanh toán.
//   Cư dân (X1): Người nộp phí xem mọi thông báo đã phát hành mà mình là người nộp; thành viên khác trong căn chỉ xem
//   các kỳ từ khi mình chuyển vào. Cư dân không bao giờ thấy Nháp / Chờ duyệt.
import mongoose from 'mongoose';
import {
  INVOICE_OUTSTANDING_STATUSES,
  INVOICE_PUBLISHED_STATUSES,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  ROLES,
} from '../../constants/enums.js';
import { Invoice, Payment, PrepaidBalance, PrepaidTransaction, Resident } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { vnPeriod } from '../../utils/time.js';
import { adjustmentsOf } from './invoices.adjustments.js';
import { bankInfo, transferContent } from './invoices.payinfo.js';

export const STAFF_VIEW_ROLES = [ROLES.ACCOUNTANT, ROLES.MANAGER];
const RESIDENT_VISIBLE = [...INVOICE_PUBLISHED_STATUSES, INVOICE_STATUS.CANCELLED];
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

const LIST_POPULATE = [
  { path: 'apartmentId', select: 'code floor' },
  { path: 'buildingId', select: 'code name' },
  { path: 'payerId', select: 'fullName phone' },
];
const withOutstanding = (inv) => ({ ...inv, outstanding: Math.max(0, inv.totalAmount - (inv.paidAmount ?? 0)) });

// ---------------------------------------------------------------------------
// Quản trị
// ---------------------------------------------------------------------------
function staffFilter({ period, status, buildingId, apartmentId, payerId, q }) {
  const filter = {};
  if (period) filter.period = period;
  if (status?.length) filter.status = { $in: status };
  if (buildingId) filter.buildingId = oid(buildingId);
  if (apartmentId) filter.apartmentId = oid(apartmentId);
  if (payerId) filter.payerId = oid(payerId);
  if (q) filter.code = { $regex: escapeRegex(q.trim()), $options: 'i' };
  return filter;
}

/** Danh sách + đếm theo trạng thái (cùng bộ lọc, bỏ lọc trạng thái) để làm tab / thống kê nhanh */
export async function listInvoices(query) {
  const filter = staffFilter(query);
  const noStatus = staffFilter({ ...query, status: undefined });
  const [{ items, pagination }, counts] = await Promise.all([
    paginate(Invoice, filter, query, { populate: LIST_POPULATE, select: '-items' }),
    Invoice.aggregate([
      { $match: noStatus },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: { $sum: '$paidAmount' },
        },
      },
    ]),
  ]);
  const byStatus = Object.fromEntries(Object.values(INVOICE_STATUS).map((s) => [s, { count: 0, totalAmount: 0, paidAmount: 0 }]));
  for (const { _id, ...rest } of counts) byStatus[_id] = rest;
  return { items: items.map(withOutstanding), pagination, byStatus };
}

// ---------------------------------------------------------------------------
// Chi tiết (dùng chung quản trị + cư dân)
// ---------------------------------------------------------------------------

/** Cư dân có được xem thông báo này không (X1) */
async function residentCanView(userId, invoice) {
  if (!RESIDENT_VISIBLE.includes(invoice.status)) return false;
  if (sameId(invoice.payerId?._id ?? invoice.payerId, userId)) return true;
  const membership = await Resident.findOne({ userId, apartmentId: invoice.apartmentId?._id ?? invoice.apartmentId, isActive: true })
    .select('moveInDate createdAt')
    .lean();
  return Boolean(membership) && invoice.period >= vnPeriod(membership.moveInDate ?? membership.createdAt);
}

/** Các lần thanh toán đã ghi nhận có phân bổ vào thông báo này (kèm số tiền phân bổ cho thông báo này) */
async function paymentsOf(invoiceId) {
  const payments = await Payment.find({
    $or: [{ 'allocations.invoiceId': invoiceId }, { invoiceId, allocations: { $size: 0 } }],
    status: PAYMENT_STATUS.SUCCESS,
  })
    .select('method amount allocations creditAmount receiptNo bankRef reference paidAt confirmedBy')
    .populate('confirmedBy', 'fullName')
    .sort({ paidAt: 1 })
    .lean();
  return payments.map((p) => ({
    ...p,
    allocatedAmount: p.allocations.length
      ? p.allocations.filter((a) => sameId(a.invoiceId, invoiceId)).reduce((s, a) => s + a.amount, 0)
      : p.amount,
  }));
}

export async function getInvoice(user, id) {
  const invoice = await Invoice.findById(id)
    .populate([
      ...LIST_POPULATE,
      { path: 'submittedBy', select: 'fullName' },
      { path: 'reviewedBy', select: 'fullName' },
      { path: 'items.addedBy', select: 'fullName' },
    ])
    .lean();
  if (!invoice) throw ApiError.notFound('Không tìm thấy thông báo phí');

  const isStaff = STAFF_VIEW_ROLES.includes(user.role);
  if (!isStaff) {
    // Không lộ việc thông báo tồn tại với người không có quyền
    if (user.role !== ROLES.RESIDENT || !(await residentCanView(user.id, invoice))) {
      throw ApiError.notFound('Không tìm thấy thông báo phí');
    }
  }

  const [payments, prepaidTransactions, bank, adjustments] = await Promise.all([
    paymentsOf(invoice._id),
    PrepaidTransaction.find({ invoiceId: invoice._id }).select('type amount createdAt').lean(),
    bankInfo(),
    isStaff ? adjustmentsOf(invoice._id) : null,
  ]);
  const result = {
    ...withOutstanding(invoice),
    payments,
    prepaidTransactions,
    payInfo: { ...bank, content: transferContent(invoice.buildingId?.code, invoice.apartmentId?.code, invoice.period) },
    ...(isStaff && { adjustments }),
  };
  if (!isStaff) {
    // Cư dân không cần thông tin quy trình nội bộ
    delete result.returnNote;
    delete result.returnedAt;
    delete result.submittedBy;
    delete result.reviewedBy;
    result.isPayer = sameId(invoice.payerId?._id, user.id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cư dân: thông báo phí của căn đang chọn
// ---------------------------------------------------------------------------
export async function myInvoices(user, { apartmentId, status, period, ...query }) {
  const userId = oid(user.id);
  const aptId = oid(apartmentId);
  const membership = await Resident.findOne({ userId, apartmentId: aptId, isActive: true })
    .select('moveInDate createdAt')
    .lean();
  const isPayerHere = await Invoice.exists({ apartmentId: aptId, payerId: userId, status: { $in: RESIDENT_VISIBLE } });
  if (!membership && !isPayerHere) throw ApiError.forbidden('Bạn không thuộc căn hộ này');

  const visibility = [{ payerId: userId }];
  if (membership) visibility.push({ period: { $gte: vnPeriod(membership.moveInDate ?? membership.createdAt) } });

  const filter = {
    apartmentId: aptId,
    status: { $in: status?.length ? status.filter((s) => RESIDENT_VISIBLE.includes(s)) : RESIDENT_VISIBLE },
    $or: visibility,
  };
  if (period) filter.period = period;

  const [{ items, pagination }, debt, balance] = await Promise.all([
    paginate(Invoice, filter, { ...query, sort: query.sort ?? '-period' }, { select: '-items', populate: LIST_POPULATE.slice(0, 2) }),
    // Tổng còn nợ của chính mình (Người nộp phí) tại căn này
    Invoice.aggregate([
      { $match: { apartmentId: aptId, payerId: userId, status: { $in: [...INVOICE_OUTSTANDING_STATUSES] } } },
      {
        $group: {
          _id: null,
          outstanding: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } },
          overdue: {
            $sum: { $cond: [{ $eq: ['$status', INVOICE_STATUS.OVERDUE] }, { $subtract: ['$totalAmount', '$paidAmount'] }, 0] },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    PrepaidBalance.findOne({ apartmentId: aptId, payerId: userId }).select('balance').lean(),
  ]);

  return {
    items: items.map((i) => ({ ...withOutstanding(i), isPayer: sameId(i.payerId, userId) })),
    pagination,
    summary: {
      isPayer: Boolean(isPayerHere),
      outstanding: debt[0]?.outstanding ?? 0,
      overdue: debt[0]?.overdue ?? 0,
      unpaidCount: debt[0]?.count ?? 0,
      prepaidBalance: balance?.balance ?? 0,
    },
  };
}
