import { CONTACT_METHODS, DEBT_OPEN_STATUSES, DEBT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Một lần nhắc nợ tự động đã gửi (Web + Email) — in lại trong PDF Thông báo nợ quá hạn
const reminderSchema = new Schema(
  {
    at: { type: Date, required: true },
    amount: { type: Number, required: true }, // số nợ quá hạn lúc nhắc
    invoiceCodes: [String],
  },
  { _id: false },
);

// Nhật ký xử lý nợ: Trưởng BQL ghi (by có giá trị), hoặc hệ thống ghi sự kiện (by = null, vd quá ngày hẹn)
const activitySchema = new Schema({
  at: { type: Date, default: Date.now },
  by: { type: ObjectId, ref: 'User', default: null },
  method: { type: String, enum: [...values(CONTACT_METHODS), null], default: null }, // hình thức liên hệ
  response: { type: String, default: null }, // phản hồi của Người nộp phí
  measures: { type: String, default: null }, // biện pháp đã áp dụng (hệ thống không tự áp dụng)
  promisedDate: { type: Date, default: null }, // ngày hẹn trả (00:00 giờ VN)
  note: { type: String, default: null },
});

// debt_followups — hồ sơ nợ quá hạn của 1 Người nộp phí tại 1 căn (UC31). Cron DEBT_REMIND mở / nhắc / chuyển Nợ quá hạn dài;
// trả hết các khoản quá hạn → RESOLVED. Lần quá hạn sau mở hồ sơ mới.
const debtFollowupSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building', default: null },
    payerId: { type: ObjectId, ref: 'User', required: true },
    status: { type: String, enum: values(DEBT_STATUS), required: true, default: DEBT_STATUS.REMINDING },
    openedAt: { type: Date, required: true },
    reminderCount: { type: Number, required: true, default: 0 },
    lastRemindedAt: { type: Date, default: null },
    reminders: [reminderSchema],
    longOverdueAt: { type: Date, default: null }, // lúc chuyển Nợ quá hạn dài (báo Trưởng BQL đúng 1 lần)
    promisedDate: { type: Date, default: null }, // lời hẹn đang hiệu lực → tạm dừng nhắc đến hết ngày này
    activities: [activitySchema],
    resolvedAt: { type: Date, default: null },
  },
  schemaOptions('debt_followups'),
);

// Mỗi Người nộp phí tại 1 căn tối đa 1 hồ sơ đang mở
debtFollowupSchema.index(
  { apartmentId: 1, payerId: 1 },
  {
    name: 'uniq_open_case',
    unique: true,
    partialFilterExpression: { status: { $in: [...DEBT_OPEN_STATUSES] } },
  },
);
debtFollowupSchema.index({ status: 1, updatedAt: -1 });

export const DebtFollowup = model('DebtFollowup', debtFollowupSchema);
