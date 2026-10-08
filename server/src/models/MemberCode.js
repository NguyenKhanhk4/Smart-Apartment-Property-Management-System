import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// member_codes — mã cư dân theo CĂN HỘ (Module D, UC-D11, BR-O25): A-0501 (chủ hộ, seq 0), A-0501-01, A-0501-02…
// Người chuyển đi / mất quyền → bản ghi bị thu hồi (isActive=false), KHÔNG xóa: giữ lịch sử theo userId và để seq
// không bao giờ dùng lại (số tiếp theo = max(seq) của căn, kể cả đã thu hồi).
const memberCodeSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    seq: { type: Number, required: true, min: 0 }, // 0 = chủ hộ
    isActive: { type: Boolean, default: true },
    // BR-O26: thành viên chỉ phát sinh phí tiện ích khi chủ hộ bật; chủ hộ luôn được (không đọc field này)
    canIncurCharges: { type: Boolean, default: false },
    // Ngày sinh tạm lưu ở Module D cho tới khi Module A có users.dateOfBirth (BR-O24); 00:00 giờ VN của ngày sinh
    dateOfBirth: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  schemaOptions('member_codes'),
);

// Mã chữ duy nhất trong các bản ghi đang hiệu lực; mỗi người chỉ có 1 mã hiệu lực trong 1 căn
memberCodeSchema.index({ code: 1 }, { name: 'uniq_active_code', unique: true, partialFilterExpression: { isActive: true } });
memberCodeSchema.index(
  { userId: 1, apartmentId: 1 },
  { name: 'uniq_active_member', unique: true, partialFilterExpression: { isActive: true } },
);
memberCodeSchema.index({ apartmentId: 1, seq: -1 }); // max(seq) của căn, kể cả đã thu hồi
memberCodeSchema.index({ userId: 1, isActive: 1 });

export const MemberCode = model('MemberCode', memberCodeSchema);
