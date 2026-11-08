import { AUDIT_ACTIONS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// audit_logs — nhật ký hành động (NFR-05, BR-O11). Chỉ ghi thêm, không sửa/xóa.
const auditLogSchema = new Schema(
  {
    action: { type: String, enum: values(AUDIT_ACTIONS), required: true },
    performedBy: { type: ObjectId, ref: 'User', default: null }, // null = hệ thống
    targetType: String, // tên collection — dùng AUDIT_TARGETS (dữ liệu cũ có thể còn tên model, vd 'Contract')
    targetId: { type: ObjectId, default: null },
    metadata: Schema.Types.Mixed,
    before: Schema.Types.Mixed, // giá trị cũ của các trường bị đổi (BR-S10, UC06 bước 4)
    after: Schema.Types.Mixed, // giá trị mới
    ip: String,
  },
  schemaOptions('audit_logs', { timestamps: { createdAt: true, updatedAt: false } }),
);

// BR-S10: nhật ký chỉ ghi thêm, không sửa / xóa qua code ứng dụng.
// Script chuyển dữ liệu (scripts/migrateAuditTargets.js) đi qua driver gốc (AuditLog.collection) nên không bị chặn.
const readOnly = () => {
  throw new Error('Nhật ký hoạt động chỉ được ghi thêm, không được sửa hoặc xóa (BR-S10)');
};
auditLogSchema.pre('save', function blockEdit() {
  if (!this.isNew) readOnly();
});
const MUTATIONS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
auditLogSchema.pre(MUTATIONS, { query: true, document: true }, readOnly);
auditLogSchema.pre('bulkWrite', readOnly);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ performedBy: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export const AuditLog = model('AuditLog', auditLogSchema);
