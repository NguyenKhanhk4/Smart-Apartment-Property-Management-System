import { PRIORITIES, TICKET_SCOPES, TICKET_STATUS, TICKET_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// Lịch sử xử lý — mỗi lần đổi trạng thái/phân công/leo thang thêm 1 dòng
const ticketHistorySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: ObjectId, ref: 'User', default: null }, // null = hệ thống (cron)
    action: { type: String, required: true }, // CREATED, ASSIGNED, PROGRESS, ESCALATED, CONFIRMED...
    fromStatus: String,
    toStatus: String,
    note: String,
    imageUrls: { type: [String], default: undefined }, // ảnh bằng chứng KTV đính kèm khi báo đã xử lý xong (RESOLVED)
  },
  { _id: false },
);

// tickets — phản ánh/khiếu nại (UC-E02..E06)
const ticketSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // TK-YYYYMM-xxxxx
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building' }, // lưu thừa để lọc/dashboard theo tòa
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByStaff: { type: ObjectId, ref: 'User', default: null }, // Lễ tân tạo hộ cư dân (Người 4)
    // Phân loại (Người 4); bản ghi cũ không có → Sự cố kỹ thuật ở khu vực chung
    type: { type: String, enum: values(TICKET_TYPES), required: true, default: TICKET_TYPES.INCIDENT },
    scope: { type: String, enum: values(TICKET_SCOPES), required: true, default: TICKET_SCOPES.COMMON_AREA },
    category: { type: ObjectId, ref: 'ComplaintCategory', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    imageUrls: { type: [String], validate: [(v) => v.length <= 5, 'Tối đa 5 ảnh'] },
    priority: { type: String, enum: values(PRIORITIES), required: true },
    status: {
      type: String,
      enum: values(TICKET_STATUS),
      required: true,
      default: TICKET_STATUS.NEW,
    },
    assignedTo: { type: ObjectId, ref: 'User', default: null },
    assignedBy: { type: ObjectId, ref: 'User', default: null },
    assignedAt: Date,
    dueDate: Date, // SLA hoàn thành
    // SLA nhận phiếu (sự cố) và SLA phản hồi (phản ánh); *AlertedAt chống báo Trưởng BQL nhiều lần
    ackDueAt: { type: Date, default: null },
    ackAlertedAt: { type: Date, default: null },
    responseDueAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null }, // Người 2 ghi khi nhập kết quả xử lý phản ánh
    responseAlertedAt: { type: Date, default: null },
    // Sự cố trong căn hộ: cư dân đồng ý / từ chối báo giá (form báo giá do Người 3 làm)
    quoteDecision: {
      accepted: { type: Boolean, default: null },
      at: { type: Date, default: null },
      by: { type: ObjectId, ref: 'User', default: null },
      note: String,
    },
    escalatedAt: { type: Date, default: null }, // BR-O8: tối đa 1 lần/ngày
    escalationCount: { type: Number, default: 0 },
    resolvedAt: Date, // lúc chuyển WAITING_CONFIRM
    closedAt: Date,
    autoClosed: { type: Boolean, default: false }, // BR-O9: đóng do quá hạn không phản hồi
    rating: { type: Number, min: 1, max: 5, default: null },
    ratingComment: String,
    rejectReason: String,
    linkedAssetId: { type: ObjectId, ref: 'Asset', default: null },
    history: [ticketHistorySchema],
  },
  // optimisticConcurrency: 2 request sửa cùng lúc (assign/progress/confirm) → request sau bị VersionError,
  // tránh ghi đè trạng thái lẫn nhau (errorHandler trả 409 CONCURRENT_UPDATE)
  schemaOptions('tickets', { optimisticConcurrency: true }),
);

ticketSchema.index({ status: 1, dueDate: 1 }); // cron leo thang + danh sách quá hạn
ticketSchema.index({ apartmentId: 1, createdAt: -1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ buildingId: 1, createdAt: -1 });
ticketSchema.index({ type: 1, status: 1, assignedTo: 1 }); // hàng chờ sự cố theo ca
ticketSchema.index({ status: 1, ackDueAt: 1 }); // cron cảnh báo SLA nhận phiếu

export const Ticket = model('Ticket', ticketSchema);
