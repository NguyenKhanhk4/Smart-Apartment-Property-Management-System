import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// audit_logs — nhật ký hành động (NFR-05, BR-O11). Chỉ ghi thêm, không sửa/xóa.
const auditLogSchema = new Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: ObjectId, ref: 'User', default: null }, // null = hệ thống
    targetType: String, // tên collection, vd 'tickets'
    targetId: { type: ObjectId, default: null },
    metadata: Schema.Types.Mixed,
    ip: String,
  },
  schemaOptions('audit_logs', { timestamps: { createdAt: true, updatedAt: false } }),
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ performedBy: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export const AuditLog = model('AuditLog', auditLogSchema);
