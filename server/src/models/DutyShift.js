import { DUTY_ROLE_TITLES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// duty_shifts — lịch ca trực của Kỹ thuật viên và Bảo vệ (Người 4). Mỗi dòng là 1 người trong 1 ca.
// isBackup = người trực dự phòng, nhận cảnh báo khẩn (X6) khi người trực chính chưa xử lý.
// Hàng chờ sự cố, checklist bảo trì (Người 1) và lộ trình tuần tra (Người 5) đọc lịch này.
const dutyShiftSchema = new Schema(
  {
    roleTitle: { type: String, enum: values(DUTY_ROLE_TITLES), required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    isBackup: { type: Boolean, default: false },
    note: { type: String, trim: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('duty_shifts'),
);

dutyShiftSchema.index({ roleTitle: 1, startAt: 1, endAt: 1 }); // ai đang trực lúc t
dutyShiftSchema.index({ userId: 1, startAt: 1 }); // lịch của tôi + kiểm tra trùng ca

export const DutyShift = model('DutyShift', dutyShiftSchema);
