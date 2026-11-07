import { QUOTE_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const quoteItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true }, // hạng mục: vật tư / nhân công
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }, // VND nguyên
  },
  { _id: false },
);

// repair_quotes — báo giá sửa chữa trong căn hộ (Mô đun 5, phần của Người 3 — UC48, UC40).
// Kỹ thuật viên gửi báo giá → Người nộp phí đồng ý / từ chối (POST /tickets/:id/quote-decision của Người 4).
// Mỗi lần gửi lại là 1 phiên bản mới (version), bản cũ chuyển SUPERSEDED. Phiếu đã nghiệm thu (CLOSED) thì bản ACCEPTED
// được tính vào thông báo phí kỳ sau; invoiceId đánh dấu đã tính để không cộng 2 lần.
const repairQuoteSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // BG-YYYYMM-xxxxx
    ticketId: { type: ObjectId, ref: 'Ticket', required: true },
    version: { type: Number, required: true, min: 1 },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building', default: null },
    payerId: { type: ObjectId, ref: 'User', default: null }, // Người nộp phí lúc gửi (X1); null = căn chưa có hợp đồng
    items: { type: [quoteItemSchema], validate: [(v) => v.length > 0 && v.length <= 30, 'Báo giá cần 1–30 hạng mục'] },
    totalAmount: { type: Number, required: true, min: 1 },
    note: { type: String, default: null }, // mô tả hư hỏng, cách xử lý, thời gian dự kiến
    previousAmount: { type: Number, default: null }, // số đã đồng ý trước khi báo giá lại
    status: { type: String, enum: values(QUOTE_STATUS), required: true, default: QUOTE_STATUS.PENDING },
    autoAccepted: { type: Boolean, default: false }, // báo giá lại trong ngưỡng % → không cần duyệt lại
    createdBy: { type: ObjectId, ref: 'User', required: true }, // kỹ thuật viên
    sentAt: { type: Date, required: true },
    remindedAt: { type: Date, default: null }, // đã nhắc Người nộp phí (1 lần)
    decidedAt: { type: Date, default: null },
    decidedBy: { type: ObjectId, ref: 'User', default: null }, // null khi hệ thống tự đóng / tự chấp nhận
    decisionNote: { type: String, default: null },
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null }, // thông báo phí đã tính chi phí này
  },
  schemaOptions('repair_quotes'),
);

repairQuoteSchema.index({ ticketId: 1, version: 1 }, { unique: true });
// Mỗi phiếu tối đa 1 báo giá đang chờ đồng ý
repairQuoteSchema.index(
  { ticketId: 1 },
  { name: 'uniq_pending_quote', unique: true, partialFilterExpression: { status: QUOTE_STATUS.PENDING } },
);
repairQuoteSchema.index({ status: 1, sentAt: 1 }); // cron nhắc / tự đóng
repairQuoteSchema.index({ apartmentId: 1, status: 1, invoiceId: 1 }); // gom chi phí vào thông báo phí

export const RepairQuote = model('RepairQuote', repairQuoteSchema);
