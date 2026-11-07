<<<<<<< HEAD
import { FEE_CATEGORIES, GENERATED_BY, INVOICE_ACTIVE_STATUSES, INVOICE_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Dòng chi tiết thông báo phí — snapshot đơn giá lúc tính (BR-F3)
=======
import { FEE_CATEGORIES, GENERATED_BY, INVOICE_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Dòng chi tiết hóa đơn — snapshot đơn giá lúc sinh (BR-F3)
>>>>>>> origin/minh
const invoiceItemSchema = new Schema(
  {
    feeCategory: { type: String, enum: values(FEE_CATEGORIES), required: true },
    feeCode: String,
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
    refId: { type: ObjectId, default: null }, // vehicleId / bookingId / adjustmentId
<<<<<<< HEAD
    addedBy: { type: ObjectId, ref: 'User', default: null }, // khoản thu khác Kế toán thêm tay (OTHER)
=======
>>>>>>> origin/minh
  },
  { _id: false },
);

<<<<<<< HEAD
// invoices — thông báo phí tháng (Mô đun 4)
// Vòng đời: DRAFT → PENDING_APPROVAL → UNPAID (đã phát hành) → PARTIALLY_PAID → PAID; quá hạn chưa trả đủ → OVERDUE.
// Còn nợ = totalAmount − paidAmount. Tiền lưu số nguyên VND.
const invoiceSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // HD-YYYYMM-<mã tòa>-<mã căn>[-Rn]
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building', required: true }, // lưu thừa để lọc nhanh
    payerId: { type: ObjectId, ref: 'User' }, // Người nộp phí lúc tính / phát hành (X1)
    payerSource: { type: String, enum: ['OWNER', 'TENANT', null], default: null },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // YYYY-MM
    items: { type: [invoiceItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 }, // tổng các dòng phí của kỳ
    paidAmount: { type: Number, required: true, default: 0, min: 0 }, // đã trả (kể cả trừ số dư trả trước)
    prepaidApplied: { type: Number, required: true, default: 0, min: 0 }, // phần trừ từ Số dư trả trước
    previousDebt: { type: Number, required: true, default: 0, min: 0 }, // "Nợ các kỳ trước" — chỉ hiển thị, không cộng vào kỳ này
=======
// invoices — hóa đơn tháng (UC-B02)
const invoiceSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // HD-YYYYMM-<mã căn>
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building', required: true }, // lưu thừa để lọc nhanh
    payerId: { type: ObjectId, ref: 'User' }, // BR-F7
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // YYYY-MM
    items: { type: [invoiceItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
>>>>>>> origin/minh
    status: {
      type: String,
      enum: values(INVOICE_STATUS),
      required: true,
<<<<<<< HEAD
      default: INVOICE_STATUS.DRAFT,
    },
    // Duyệt & phát hành
    submittedBy: { type: ObjectId, ref: 'User', default: null }, // Kế toán trình duyệt
    submittedAt: { type: Date, default: null },
    reviewedBy: { type: ObjectId, ref: 'User', default: null }, // Trưởng BQL duyệt / trả lại
    returnNote: { type: String, default: null }, // lý do trả lại gần nhất
    returnedAt: { type: Date, default: null },
    issuedAt: { type: Date, default: null }, // ngày phát hành (null khi còn Nháp / Chờ duyệt)
    dueDate: { type: Date, default: null }, // hạn đóng, đặt khi phát hành
    paidAt: { type: Date, default: null },
    generatedBy: { type: String, enum: values(GENERATED_BY), default: GENERATED_BY.MANUAL },
    lastReminderAt: { type: Date, default: null }, // nhắc nợ: tối đa 1 lần/ngày
=======
      default: INVOICE_STATUS.UNPAID,
    },
    issuedAt: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    generatedBy: { type: String, enum: values(GENERATED_BY), default: GENERATED_BY.CRON },
    lastReminderAt: { type: Date, default: null }, // BR-D4: tối đa 1 nhắc nợ/ngày
>>>>>>> origin/minh
  },
  schemaOptions('invoices'),
);

<<<<<<< HEAD
invoiceSchema.virtual('outstanding').get(function outstanding() {
  return Math.max(0, (this.totalAmount ?? 0) - (this.paidAmount ?? 0));
});

// BR-F2: mỗi căn hộ 1 thông báo phí/kỳ chưa bị hủy (kể cả Nháp / Chờ duyệt)
=======
// BR-F2: mỗi căn hộ 1 hóa đơn/kỳ không bị hủy
>>>>>>> origin/minh
invoiceSchema.index(
  { apartmentId: 1, period: 1 },
  {
    name: 'uniq_apartment_period_active',
    unique: true,
<<<<<<< HEAD
    partialFilterExpression: { status: { $in: [...INVOICE_ACTIVE_STATUSES] } },
  },
);
invoiceSchema.index({ period: 1, status: 1 }); // báo cáo thu phí, danh sách theo kỳ
invoiceSchema.index({ buildingId: 1, period: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 }); // cron quá hạn
invoiceSchema.index({ payerId: 1, period: -1 });
invoiceSchema.index({ apartmentId: 1, payerId: 1, status: 1 }); // sổ công nợ, phân bổ tiền cũ nhất trước
=======
    partialFilterExpression: {
      status: { $in: [INVOICE_STATUS.UNPAID, INVOICE_STATUS.PAID, INVOICE_STATUS.OVERDUE] },
    },
  },
);
invoiceSchema.index({ period: 1, status: 1 }); // NFR-13 báo cáo thu phí
invoiceSchema.index({ buildingId: 1, period: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 }); // cron quá hạn
invoiceSchema.index({ payerId: 1, period: -1 });
>>>>>>> origin/minh

export const Invoice = model('Invoice', invoiceSchema);
