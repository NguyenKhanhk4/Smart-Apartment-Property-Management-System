import { WORK_ORDER_STATUS, WORK_ORDER_TYPES, values } from '../constants/enums.js';
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
      status: { $in: [WORK_ORDER_STATUS.PENDING, WORK_ORDER_STATUS.IN_PROGRESS] },
    },
  },
);
workOrderSchema.index({ assignedTo: 1, status: 1 });
workOrderSchema.index({ status: 1, scheduledDate: 1 });
workOrderSchema.index({ assetId: 1, completedAt: -1 }); // lịch sử bảo trì của tài sản

export const WorkOrder = model('WorkOrder', workOrderSchema);
