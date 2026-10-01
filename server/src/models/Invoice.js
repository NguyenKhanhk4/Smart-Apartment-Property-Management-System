import { FEE_CATEGORIES, GENERATED_BY, INVOICE_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Dòng chi tiết hóa đơn — snapshot đơn giá lúc sinh (BR-F3)
const invoiceItemSchema = new Schema(
  {
    feeCategory: { type: String, enum: values(FEE_CATEGORIES), required: true },
    feeCode: String,
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
    refId: { type: ObjectId, default: null }, // vehicleId / bookingId / adjustmentId
  },
  { _id: false },
);

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
    status: {
      type: String,
      enum: values(INVOICE_STATUS),
      required: true,
      default: INVOICE_STATUS.UNPAID,
    },
    issuedAt: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    generatedBy: { type: String, enum: values(GENERATED_BY), default: GENERATED_BY.CRON },
    lastReminderAt: { type: Date, default: null }, // BR-D4: tối đa 1 nhắc nợ/ngày
  },
  schemaOptions('invoices'),
);

// BR-F2: mỗi căn hộ 1 hóa đơn/kỳ không bị hủy
invoiceSchema.index(
  { apartmentId: 1, period: 1 },
  {
    name: 'uniq_apartment_period_active',
    unique: true,
    partialFilterExpression: {
      status: { $in: [INVOICE_STATUS.UNPAID, INVOICE_STATUS.PAID, INVOICE_STATUS.OVERDUE] },
    },
  },
);
invoiceSchema.index({ period: 1, status: 1 }); // NFR-13 báo cáo thu phí
invoiceSchema.index({ buildingId: 1, period: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 }); // cron quá hạn
invoiceSchema.index({ payerId: 1, period: -1 });

export const Invoice = model('Invoice', invoiceSchema);
