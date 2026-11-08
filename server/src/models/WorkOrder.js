import { REPAIR_COST_SOURCES, WORK_ORDER_INSPECTING_STATUSES, WORK_ORDER_RESULTS, WORK_ORDER_STATUS, WORK_ORDER_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// work_orders — công việc bảo trì (UC-D02..D04)
const workOrderSchema = new Schema(
  {
    assetId: { type: ObjectId, ref: 'Asset', required: true },
    ticketId: { type: ObjectId, ref: 'Ticket', default: null }, // khi TICKET_LINKED
    type: { type: String, enum: values(WORK_ORDER_TYPES), required: true },
    title: String,
    assignedTo: { type: ObjectId, ref: 'User', default: null }, // Kỹ thuật viên
    assignedBy: { type: ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: values(WORK_ORDER_STATUS),
      required: true,
      default: WORK_ORDER_STATUS.PENDING,
    },
    scheduledDate: Date,
    completedAt: Date,
    note: String,
    // UC07: bản sao mẫu checklist của thiết bị lúc tạo phiếu; Trưởng BQL sửa mẫu sau đó không làm đổi phiếu này (UC08 dùng)
    checklist: {
      type: [{
        _id: false,
        label: String,
        unit: { type: String, default: null },
        minValue: { type: Number, default: null },
        maxValue: { type: Number, default: null },
        required: { type: Boolean, default: true },
      }],
      default: [],
    },
    // UC08: kiểm tra định kỳ. Quét đúng QR thiết bị mới được nộp kết quả (BR-E04)
    scannedAt: { type: Date, default: null },
    inspectedAt: { type: Date, default: null }, // lúc nộp kết quả; đo đúng hạn theo mốc này
    result: { type: String, enum: [...values(WORK_ORDER_RESULTS), null], default: null },
    // Kết quả từng mục, cùng thứ tự với checklist. value: giá trị đo; ok: KTV tick đạt / không đạt; isOk: server tự tính
    results: {
      type: [{
        _id: false,
        index: Number,
        label: String,
        value: { type: Number, default: null },
        ok: { type: Boolean, default: null },
        isOk: { type: Boolean, default: null },
      }],
      default: [],
    },
    // UC09, UC10: sửa chữa khi kiểm tra có sự cố
    repair: {
      type: new Schema({
        faultDesc: String, // mô tả hư hỏng
        vendorName: String, // nhà thầu đề xuất
        vendorProposal: String, // phương án sửa
        estimatedCost: Number, // VNĐ
        faultImages: { type: [String], default: [] },
        reportedBy: { type: ObjectId, ref: 'User' },
        reportedAt: Date,
        costSource: { type: String, enum: [...values(REPAIR_COST_SOURCES), null], default: null },
        decidedBy: { type: ObjectId, ref: 'User', default: null },
        decidedAt: { type: Date, default: null },
        decisionNote: { type: String, default: null },
        // UC10 tạm hoãn: ngày xem lại (đầu ngày giờ VN), job nhắc từ ngày đó, lặp mỗi N ngày cho tới khi xử lý
        reviewDate: { type: Date, default: null },
        postponedAt: { type: Date, default: null },
        lastRemindedAt: { type: Date, default: null },
        remindCount: { type: Number, default: 0 },
        acceptanceImages: { type: [String], default: [] }, // biên bản nghiệm thu của nhà thầu (bản đang chờ / đã nghiệm thu)
        acceptanceNote: { type: String, default: null },
        acceptanceUploadedAt: { type: Date, default: null },
        acceptedBy: { type: ObjectId, ref: 'User', default: null },
        acceptedAt: { type: Date, default: null },
        // Mỗi bước: báo cáo, duyệt, quỹ, hoãn, yêu cầu lại, kiểm tra lại, tải biên bản, nghiệm thu... Không ghi đè bản cũ
        history: {
          type: [{
            _id: false, action: String, by: { type: ObjectId, ref: 'User', default: null }, at: Date, note: String, images: [String],
            cost: { type: Number, default: null }, reviewDate: { type: Date, default: null }, // POSTPONED: hoãn đến ngày
            refId: { type: ObjectId, default: null }, // FOLLOWUP_CHECK: phiếu kiểm tra lại; FUND_*: đề xuất chi quỹ
          }],
          default: [],
        },
      }, { _id: false }),
      default: null,
    },
    // Ảnh bằng chứng KTV chụp khi hoàn thành (UC-D04), bắt buộc ≥ 1 ảnh khi DONE
    completionImages: { type: [String], default: [], validate: [(v) => v.length <= 5, 'Tối đa 5 ảnh'] },
  },
  schemaOptions('work_orders'),
);

// BR-O6: 1 tài sản chỉ có 1 work order SCHEDULED chưa hoàn thành
workOrderSchema.index(
  { assetId: 1 },
  {
    name: 'uniq_open_scheduled_wo',
    unique: true,
    partialFilterExpression: {
      type: WORK_ORDER_TYPES.SCHEDULED,
      status: { $in: [...WORK_ORDER_INSPECTING_STATUSES] }, // phiếu đang sửa chữa: job tự kiểm tra (WORK_ORDER_ACTIVE_STATUSES)
    },
  },
);
workOrderSchema.index({ assignedTo: 1, status: 1 });
workOrderSchema.index({ status: 1, scheduledDate: 1 });
workOrderSchema.index({ assetId: 1, completedAt: -1 }); // lịch sử bảo trì của tài sản

export const WorkOrder = model('WorkOrder', workOrderSchema);
