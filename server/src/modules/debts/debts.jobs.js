// Mô đun 4 — UC31 nhắc nợ tự động (cron DEBT_REMIND, 08:00 hằng ngày; Admin chạy lại thủ công được).
// Mỗi Người nộp phí còn khoản quá hạn tại 1 căn có 1 hồ sơ nợ (debt_followups):
//   • Lần nhắc 1 ngay lần chạy đầu tiên sau khi quá hạn, sau đó cách DEBT_REMINDER_INTERVAL_DAYS ngày, tối đa DEBT_REMINDER_MAX lần
//     (Web + Email cho Người nộp phí).
//   • Nhắc đủ số lần, thêm 1 khoảng nhắc nữa vẫn chưa trả → "Nợ quá hạn dài", báo Trưởng BQL đúng 1 lần, dừng nhắc tự động.
//   • Có ngày hẹn trả → không nhắc đến hết ngày hẹn; quá ngày hẹn mà còn nợ → đóng lời hẹn, báo lại Trưởng BQL 1 lần.
//   • Trả hết các khoản quá hạn → hồ sơ RESOLVED (cũng đóng ngay khi gạch nợ, xem closeCaseIfCleared).
// Hệ thống không tự áp dụng biện pháp cưỡng chế. Mọi cập nhật có điều kiện trên trạng thái cũ nên chạy lại / chạy song song an toàn.
import { CONFIG_KEYS, DEBT_OPEN_STATUSES, DEBT_STATUS, NOTIFICATION_TYPES } from '../../constants/enums.js';
import { DebtFollowup, Invoice } from '../../models/index.js';
import { notify, notifyRoles } from '../../services/notification.service.js';
import { getConfigs } from '../../services/systemConfig.service.js';
import { DAY_MS, fmtDateVn, periodLabel, startOfVnDay } from '../../utils/time.js';
import { formatVnd } from '../amenities/pricing.js';
import { overdueFilter } from './debts.check.js';

const key = (apartmentId, payerId) => `${apartmentId}:${payerId}`;
const aptLabel = (g) => [g.buildingCode, g.apartmentCode].filter(Boolean).join('-') || 'căn hộ';
const periodsText = (g) => [...new Set(g.invoices.map((i) => i.period))].sort().map(periodLabel).join(', ');
const managerLink = (apartmentId) => `/app/debts/apartments/${apartmentId}`;

/** Nợ quá hạn hiện tại, gộp theo căn + Người nộp phí, kèm mã căn / tòa / tên người nộp */
export async function overdueByPayer(today) {
  return Invoice.aggregate([
    { $match: { payerId: { $ne: null }, ...overdueFilter(today) } },
    { $sort: { period: 1 } },
    {
      $group: {
        _id: { apartmentId: '$apartmentId', payerId: '$payerId' },
        buildingId: { $first: '$buildingId' },
        amount: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } },
        invoices: { $push: { code: '$code', period: '$period' } },
      },
    },
    { $match: { amount: { $gt: 0 } } },
    { $lookup: { from: 'apartments', localField: '_id.apartmentId', foreignField: '_id', as: 'a' } },
    { $lookup: { from: 'buildings', localField: 'buildingId', foreignField: '_id', as: 'b' } },
    { $lookup: { from: 'users', localField: '_id.payerId', foreignField: '_id', as: 'u' } },
    {
      $project: {
        _id: 0,
        apartmentId: '$_id.apartmentId',
        payerId: '$_id.payerId',
        buildingId: 1,
        amount: 1,
        invoices: 1,
        apartmentCode: { $first: '$a.code' },
        buildingCode: { $first: '$b.code' },
        payerName: { $first: '$u.fullName' },
      },
    },
  ]);
}

async function openCase(g, now) {
  try {
    const doc = await DebtFollowup.create({
      apartmentId: g.apartmentId,
      buildingId: g.buildingId,
      payerId: g.payerId,
      status: DEBT_STATUS.REMINDING,
      openedAt: now,
    });
    return doc.toObject();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Lần chạy song song vừa mở hồ sơ → dùng hồ sơ đó
    return DebtFollowup.findOne({ apartmentId: g.apartmentId, payerId: g.payerId, status: { $in: [...DEBT_OPEN_STATUSES] } }).lean();
  }
}

function sendReminder(g, n, max) {
  return notify(g.payerId, {
    type: NOTIFICATION_TYPES.DEBT_REMINDER,
    title: `Nhắc nợ phí dịch vụ căn ${aptLabel(g)} (lần ${n}/${max})`,
    content:
      `Căn ${aptLabel(g)} còn nợ quá hạn ${formatVnd(g.amount)} (kỳ ${periodsText(g)}).\n` +
      'Vui lòng thanh toán trực tuyến trên ứng dụng hoặc tại quầy Ban quản lý. Nếu đã thanh toán, vui lòng bỏ qua thông báo này.',
    link: '/r/invoices',
    email: true,
  });
}

/** Xử lý 1 hồ sơ đang mở; trả về số việc đã làm (nhắc / chuyển nợ dài / báo quá hẹn) */
async function processCase(c, g, { now, today, interval, max }) {
  let acted = 0;
  let current = c;

  if (current.promisedDate) {
    if (today <= current.promisedDate) return 0; // đang trong thời gian hẹn trả → tạm dừng nhắc
    const res = await DebtFollowup.updateOne(
      { _id: current._id, promisedDate: current.promisedDate },
      {
        $set: { promisedDate: null },
        $push: {
          activities: { at: now, by: null, note: `Quá ngày hẹn trả ${fmtDateVn(current.promisedDate)} mà chưa trả đủ, còn nợ quá hạn ${formatVnd(g.amount)}` },
        },
      },
    );
    if (res.modifiedCount) {
      acted += 1;
      await notifyRoles(['ACCOUNTANT'], {
        type: NOTIFICATION_TYPES.DEBT_REMINDER,
        title: `Quá ngày hẹn trả nợ: căn ${aptLabel(g)}`,
        content: `${g.payerName ?? 'Người nộp phí'} hẹn trả trước ${fmtDateVn(current.promisedDate)} nhưng vẫn còn nợ quá hạn ${formatVnd(g.amount)} (kỳ ${periodsText(g)}). Vào sổ công nợ để ghi kết quả xử lý tiếp.`,
        refId: current._id,
        link: managerLink(g.apartmentId),
        email: true,
      });
    }
    current = { ...current, promisedDate: null };
  }

  if (current.status !== DEBT_STATUS.REMINDING) return acted;
  const nextAt = current.lastRemindedAt ? startOfVnDay(current.lastRemindedAt).getTime() + interval * DAY_MS : 0;
  if (today.getTime() < nextAt) return acted;

  if (current.reminderCount < max) {
    const n = current.reminderCount + 1;
    const res = await DebtFollowup.updateOne(
      { _id: current._id, status: DEBT_STATUS.REMINDING, reminderCount: current.reminderCount },
      {
        $set: { reminderCount: n, lastRemindedAt: now },
        $push: { reminders: { at: now, amount: g.amount, invoiceCodes: g.invoices.map((i) => i.code) } },
      },
    );
    if (res.modifiedCount) {
      acted += 1;
      await sendReminder(g, n, max);
    }
    return acted;
  }

  const res = await DebtFollowup.updateOne(
    { _id: current._id, status: DEBT_STATUS.REMINDING },
    { $set: { status: DEBT_STATUS.LONG_OVERDUE, longOverdueAt: now } },
  );
  if (res.modifiedCount) {
    acted += 1;
    // Kế toán xử lý; Trưởng BQL nhận để nắm tình hình (chỉ xem)
    await notifyRoles(['ACCOUNTANT', 'MANAGER'], {
      type: NOTIFICATION_TYPES.DEBT_REMINDER,
      title: `Nợ quá hạn dài: căn ${aptLabel(g)}`,
      content: `${g.payerName ?? 'Người nộp phí'} còn nợ quá hạn ${formatVnd(g.amount)} (kỳ ${periodsText(g)}) dù đã được nhắc ${current.reminderCount} lần. Hệ thống đã dừng nhắc tự động; vào sổ công nợ để liên hệ và ghi kết quả xử lý.`,
      refId: current._id,
      link: managerLink(g.apartmentId),
      email: true,
    });
  }
  return acted;
}

/** Cron DEBT_REMIND. Trả về { affectedCount, failed } cho runTrackedJob */
export async function remindDebts(now = new Date()) {
  const { [CONFIG_KEYS.DEBT_REMINDER_INTERVAL_DAYS]: interval, [CONFIG_KEYS.DEBT_REMINDER_MAX]: max } = await getConfigs([
    CONFIG_KEYS.DEBT_REMINDER_INTERVAL_DAYS,
    CONFIG_KEYS.DEBT_REMINDER_MAX,
  ]);
  const today = startOfVnDay(now);
  const [groups, open] = await Promise.all([
    overdueByPayer(today),
    DebtFollowup.find({ status: { $in: [...DEBT_OPEN_STATUSES] } }).lean(),
  ]);
  const groupMap = new Map(groups.map((g) => [key(g.apartmentId, g.payerId), g]));
  const openMap = new Map(open.map((c) => [key(c.apartmentId, c.payerId), c]));

  let affectedCount = 0;
  const failed = [];

  // Đã trả hết các khoản quá hạn (hoặc thông báo bị hủy) → đóng hồ sơ
  const cleared = open.filter((c) => !groupMap.has(key(c.apartmentId, c.payerId))).map((c) => c._id);
  if (cleared.length) {
    const res = await DebtFollowup.updateMany(
      { _id: { $in: cleared }, status: { $in: [...DEBT_OPEN_STATUSES] } },
      { $set: { status: DEBT_STATUS.RESOLVED, resolvedAt: now, promisedDate: null } },
    );
    affectedCount += res.modifiedCount;
  }

  for (const g of groups) {
    const k = key(g.apartmentId, g.payerId);
    try {
      const c = openMap.get(k) ?? (await openCase(g, now));
      if (c) affectedCount += await processCase(c, g, { now, today, interval, max });
    } catch (err) {
      failed.push({ message: `${aptLabel(g)}: ${err.message}` });
    }
  }
  return { affectedCount, failed };
}
