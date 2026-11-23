import * as reports from './reports.service.js';
import { col, fmtDate, fmtMoney, fmtPercent, renderReport } from '../../services/export.service.js';
import { FundProposal, FundTransaction } from '../../models/index.js';
import { periodLabel } from '../../utils/time.js';
import { listLedger } from '../debts/debts.ledger.js';
import { financeDashboard, supervisionReport } from './finance.service.js';
import { operationsDashboard } from './operations.service.js';

// UC-E13 / UC65 — Xuất báo cáo Excel/PDF. Mỗi loại báo cáo được chuyển về 1 "spec" chung rồi dựng file bằng
// dịch vụ xuất dùng chung (services/export.service.js) — số liệu giống hệt màn hình nguồn.

const LABELS = {
  CLEANING: 'Phí vệ sinh',
  PARKING: 'Phí gửi xe',
  AMENITY: 'Phí tiện ích',
  ADJUSTMENT: 'Điều chỉnh',
  OTHER: 'Khoản thu khác',
  REPAIR: 'Sửa chữa trong căn',
  PAYOS: 'payOS (VietQR)',
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  INCOME: 'Thu',
  EXPENSE: 'Chi',
  LOW: 'Thấp',
  MEDIUM: 'Thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
  // Sổ công nợ
  PAID: 'Đã thanh toán',
  UNPAID: 'Chưa thanh toán',
  PARTIALLY_PAID: 'Thanh toán một phần',
  OVERDUE: 'Quá hạn',
  LONG_OVERDUE: 'Nợ quá hạn dài',
  // Quỹ bảo trì
  INITIAL_HANDOVER: 'Số dư ban đầu CĐT bàn giao',
  INTEREST: 'Lãi tiền gửi',
  ANNUAL_PLAN: 'Kế hoạch bảo trì năm',
  UNSCHEDULED: 'Bảo trì đột xuất',
};
const PROPOSAL_LABELS = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt, chờ chi', REJECTED: 'Bị từ chối', PAID: 'Đã chi', CANCELLED: 'Đã rút' };
const label = (v) => LABELS[v] ?? v ?? '';


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
          ['Nợ quá hạn dài (đã nhắc đủ số lần)', r.longOverdue],
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
              col('Số lần nhắc', 'reminderCount', 10),
              col('Tình trạng', 'caseText', 18),
            ],
            rows: r.items.map((x) => ({
              ...x,
              periodsText: x.periods.join(', '),
              caseText:
                x.caseStatus === 'LONG_OVERDUE'
                  ? 'Nợ quá hạn dài'
                  : x.promisedDate
                    ? `Hẹn trả ${fmtDate(x.promisedDate)}`
                    : 'Đang nhắc nợ',
            })),
          },
        ],
      };
    }
    case 'fund': {
      const { start, end } = reports.dateRange(q.from, q.to);
      const [r, txs, proposals] = await Promise.all([
        reports.fundDashboard(q),
        FundTransaction.find({ occurredAt: { $gte: start, $lte: end } }).sort({ occurredAt: 1 }).populate('proposalId', 'code title').lean(),
        FundProposal.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 }).lean(),
      ]);
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
            title: 'Sổ thu chi',
            columns: [
              col('Ngày', 'occurredAt', 11, 'date'),
              col('Số phiếu', 'code', 17),
              col('Loại', 'typeLabel', 7),
              col('Nội dung', 'text', 34),
              col('Chứng từ', 'documentNo', 14),
              col('Thu', 'income', 15, 'money'),
              col('Chi', 'expense', 15, 'money'),
              col('Số dư sau', 'balanceAfter', 16, 'money'),
            ],
            rows: txs.map((t) => ({
              ...t,
              typeLabel: label(t.type),
              income: t.type === 'INCOME' ? t.amount : null,
              expense: t.type === 'EXPENSE' ? t.amount : null,
              text: [t.description || t.source, t.incomeSource && label(t.incomeSource), t.proposalId && `${t.proposalId.code ?? ''} ${t.proposalId.title}`]
                .filter(Boolean)
                .join(' · '),
            })),
          },
          {
            title: 'Đề xuất chi',
            columns: [
              col('Ngày lập', 'createdAt', 11, 'date'),
              col('Mã', 'code', 17),
              col('Hạng mục', 'title', 30),
              col('Loại', 'planLabel', 18),
              col('Số tiền', 'amount', 16, 'money'),
              col('Trạng thái', 'statusLabel', 16),
              col('Kết quả biểu quyết', 'finalNote', 26),
            ],
            rows: proposals.map((p) => ({ ...p, planLabel: label(p.planType), statusLabel: PROPOSAL_LABELS[p.status] ?? p.status })),
          },
        ],
      };
    }
    case 'finance': {
      const r = await financeDashboard(q);
      return {
        title: 'DASHBOARD TÀI CHÍNH',
        filterText: `Kỳ ${periodLabel(q.from)} → ${periodLabel(q.to)}`,
        summary: [
          ['Phát hành trong khoảng kỳ', r.totals.billed, 'money'],
          ['Đã thu của các kỳ này', r.totals.paidOfRange, 'money'],
          ['Tỷ lệ thu', r.totals.collectionRate, 'percent'],
          ['Tiền thu được trong khoảng (mọi kỳ)', r.totals.collected, 'money'],
          ['Tiện ích trả ngay (ngoài thông báo phí)', r.totals.amenityDirect, 'money'],
          ['Căn còn nợ / có khoản quá hạn', `${r.debt.apartments - r.debt.clear} / ${r.debt.overdueApartments} trên ${r.debt.apartments} căn`],
          ['Tổng còn nợ hiện tại', r.debt.outstanding, 'money'],
          ['Số dư trả trước', r.totals.prepaidBalance, 'money'],
          ['Số dư Quỹ bảo trì', r.fund.balance, 'money'],
        ],
        sections: [
          {
            title: 'Theo tháng',
            columns: [
              col('Tháng', 'period', 10),
              col('Phát hành', 'billed', 16, 'money'),
              col('Đã thu của kỳ', 'paidOfPeriod', 16, 'money'),
              col('Thu trong tháng', 'collected', 16, 'money'),
              col('Tiền mặt', 'CASH', 14, 'money'),
              col('Chuyển khoản', 'BANK_TRANSFER', 14, 'money'),
              col('payOS', 'PAYOS', 14, 'money'),
              col('Tiện ích trả ngay', 'amenityDirect', 14, 'money'),
            ],
            rows: r.byMonth,
          },
          {
            title: 'Cơ cấu phí',
            columns: [col('Loại phí', 'label', 22), col('Số tiền', 'amount', 18, 'money'), col('Tỷ trọng', 'share', 10, 'percent')],
            rows: r.byFeeCategory.map((x) => ({ ...x, label: label(x.feeCategory) })),
          },
          {
            title: 'Theo hình thức thanh toán',
            columns: [col('Hình thức', 'label', 20), col('Số giao dịch', 'count', 12), col('Số tiền', 'amount', 18, 'money')],
            rows: r.byMethod.map((x) => ({ ...x, label: label(x.method) })),
          },
        ],
      };
    }
    case 'supervision': {
      const r = await supervisionReport(q);
      return {
        title: 'BÁO CÁO GIÁM SÁT GỬI BAN QUẢN TRỊ',
        filterText: `Kỳ ${periodLabel(q.from)} → ${periodLabel(q.to)}`,
        summary: [
          ['Số dư Quỹ bảo trì', r.fund.balance, 'money'],
          ['Thu / chi quỹ trong khoảng', `${fmtMoney(r.fund.income)} / ${fmtMoney(r.fund.expense)}`],
          ['Đề xuất chi đang chờ', r.fund.pendingProposals],
          ['Tỷ lệ thu phí', r.billing.collectionRate, 'percent'],
          ['Căn có khoản quá hạn', `${r.billing.overdueApartments}/${r.billing.apartments}`],
          ['Sự cố / phản ánh trong khoảng', r.tickets.total],
          ['Xử lý đúng hạn', r.tickets.onTimeRate, 'percent'],
          ['Đánh giá trung bình', r.tickets.avgRating],
        ],
        sections: [
          {
            title: 'Thu phí theo tháng',
            columns: [
              col('Tháng', 'period', 10),
              col('Phát hành', 'billed', 18, 'money'),
              col('Đã thu của kỳ', 'paidOfPeriod', 18, 'money'),
              col('Thu trong tháng', 'collected', 18, 'money'),
            ],
            rows: r.billing.byMonth,
          },
          {
            title: 'Thu chi quỹ',
            columns: [
              col('Ngày', 'occurredAt', 11, 'date'),
              col('Số phiếu', 'code', 17),
              col('Loại', 'typeLabel', 7),
              col('Nội dung', 'text', 36),
              col('Số tiền', 'amount', 16, 'money'),
            ],
            rows: r.fund.transactions.map((t) => ({ ...t, typeLabel: label(t.type), text: t.description || t.proposalId?.title || t.source || '' })),
          },
          {
            title: 'Đề xuất chi quỹ',
            columns: [
              col('Mã', 'code', 17),
              col('Hạng mục', 'title', 30),
              col('Số tiền', 'amount', 16, 'money'),
              col('Trạng thái', 'statusLabel', 16),
              col('Kết quả', 'finalNote', 26),
            ],
            rows: r.fund.proposals.map((p) => ({ ...p, statusLabel: PROPOSAL_LABELS[p.status] ?? p.status })),
          },
          {
            title: 'Sự cố, phản ánh theo loại',
            columns: [col('Loại', 'name', 26), col('Số lượng', 'count', 10)],
            rows: r.tickets.byCategory,
          },
        ],
      };
    }
    case 'ledger': {
      const r = await listLedger({ buildingId: q.buildingId, status: q.status }, { all: true });
      return {
        title: 'SỔ CÔNG NỢ',
        filterText: `Tại ngày ${fmtDate(new Date())}${q.status?.length ? ` · ${q.status.map(label).join(', ')}` : ''}`,
        summary: [
          ['Số dòng (căn + Người nộp phí)', r.pagination.total],
          ['Tổng còn nợ', r.summary.outstanding, 'money'],
          ['Trong đó quá hạn', r.summary.overdueAmount, 'money'],
          ['Số dư trả trước', r.summary.prepaidBalance, 'money'],
          ['Nợ quá hạn dài', r.summary.byStatus.LONG_OVERDUE ?? 0],
          ['Giao dịch cần đối soát', r.summary.reconcileCount ?? 0],
        ],
        sections: [
          {
            title: 'Sổ công nợ',
            columns: [
              col('Căn', 'apt', 10),
              col('Người nộp phí', 'payerName', 20),
              col('Điện thoại', 'payerPhone', 13),
              col('Đã phát hành', 'billed', 15, 'money'),
              col('Đã trả', 'paid', 15, 'money'),
              col('Còn nợ', 'outstanding', 15, 'money'),
              col('Quá hạn', 'overdueAmount', 15, 'money'),
              col('Số dư trả trước', 'prepaidBalance', 14, 'money'),
              col('Tình trạng', 'statusLabel', 16),
              col('Số lần nhắc', 'reminders', 9),
            ],
            rows: r.items.map((x) => ({
              ...x,
              apt: [x.buildingCode, x.apartmentCode].filter(Boolean).join('-'),
              statusLabel: label(x.ledgerStatus),
              reminders: x.case?.reminderCount ?? '',
            })),
          },
        ],
      };
    }
    case 'operations': {
      const r = await operationsDashboard(q);
      const pct = (v) => (v == null ? '—' : fmtPercent(v));
      const num = (v) => (v == null ? '—' : v);
      const { incidents: inc, complaints: cp, maintenance: mt, residents: rs } = r;
      return {
        title: 'DASHBOARD VẬN HÀNH',
        filterText: `Kỳ ${periodLabel(q.from)} → ${periodLabel(q.to)}`,
        summary: [
          ['Sự cố kỹ thuật trong kỳ', inc.total],
          ['Đang mở / đang quá hạn', `${inc.open} / ${inc.overdueNow}`],
          ['Nhận phiếu đúng hạn', pct(inc.ackOnTimeRate)],
          ['Xử lý đúng hạn (đã trừ thời gian tạm dừng)', `${pct(inc.onTimeRate)} (${inc.onTime}/${inc.resolved})`],
          ['Thời gian xử lý TB (giờ)', num(inc.avgResolutionHours)],
          ['Đánh giá TB (sao)', `${num(inc.avgRating)} (${inc.rated} lượt)`],
          ['Phản ánh / đã phản hồi', `${cp.count} / ${cp.responded}`],
          ['Phản hồi đúng hạn / TB (giờ)', `${pct(cp.onTimeRate)} / ${num(cp.avgResponseHours)}`],
          ['Bảo trì định kỳ kiểm tra đúng hạn', `${pct(mt.onTimeRate)} (${mt.onTime}/${mt.inspected})`],
          ['Tỷ lệ lấp đầy', rs.occupancy.occupancyRate, 'percent'],
          ['Cư dân vào ở / chuyển đi', `${rs.moveIn} / ${rs.moveOut}`],
        ],
        sections: [
          {
            title: 'Theo tháng',
            columns: [
              col('Tháng', 'label', 10),
              col('Sự cố mới', 'created', 10),
              col('Xử lý xong', 'resolved', 10),
              col('Đúng hạn', 'onTime', 10),
              col('Trễ hạn', 'late', 10),
              col('Bảo trì lên lịch', 'scheduled', 12),
              col('Bảo trì xong', 'done', 12),
              col('Vào ở', 'moveIn', 9),
              col('Chuyển đi', 'moveOut', 9),
            ],
            rows: inc.byMonth.map((m, i) => ({
              ...m,
              label: periodLabel(m.period),
              scheduled: mt.byMonth[i].scheduled,
              done: mt.byMonth[i].done,
              moveIn: rs.byMonth[i].moveIn,
              moveOut: rs.byMonth[i].moveOut,
            })),
          },
          {
            title: 'Kỹ thuật viên (xếp theo số sao)',
            columns: [
              col('Họ tên', 'fullName', 22),
              col('Được giao', 'assigned', 10),
              col('Đã xử lý', 'resolved', 10),
              col('Đúng hạn', 'onTimeText', 10),
              col('Số sao TB', 'ratingText', 10),
              col('Lượt đánh giá', 'rated', 12),
            ],
            rows: inc.technicians.map((t) => ({ ...t, onTimeText: pct(t.onTimeRate), ratingText: num(t.avgRating) })),
          },
          {
            title: 'Phản ánh theo loại',
            columns: [
              col('Loại phản ánh', 'name', 24),
              col('Số phản ánh', 'count', 10),
              col('Đã phản hồi', 'responded', 10),
              col('Quá hạn chưa phản hồi', 'overdue', 14),
              col('Phản hồi đúng hạn', 'onTimeText', 12),
              col('TB phản hồi (giờ)', 'hoursText', 12),
            ],
            rows: cp.byCategory.map((c) => ({ ...c, onTimeText: pct(c.onTimeRate), hoursText: num(c.avgResponseHours) })),
          },
          {
            title: 'Lấp đầy theo tòa',
            columns: [
              col('Tòa', 'buildingName', 16),
              col('Tổng căn', 'total', 10),
              col('Chủ ở', 'owned', 10),
              col('Cho thuê', 'rented', 10),
              col('Trống', 'vacant', 10),
              col('Tỷ lệ', 'occupancyRate', 10, 'percent'),
            ],
            rows: rs.occupancy.byBuilding,
          },
          {
            title: 'Tiện ích',
            columns: [col('Tiện ích', 'name', 22), col('Lượt đặt', 'bookings', 10), col('Đã check-in', 'checkedIn', 12)],
            rows: r.amenities,
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

export async function exportReport(type, format, query) {
  return renderReport(await buildSpec(type, query), format, `bao-cao-${type}`);
}
