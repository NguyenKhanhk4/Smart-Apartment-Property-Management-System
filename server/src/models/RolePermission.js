import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// role_permissions — UC04: các quyền Trưởng BQL đã TẮT của một vai trò (BR-S07).
// Lưu phần bị tắt, không lưu phần được bật: chức năng / route mới mà nhóm thêm sau tự có quyền theo authorize().
// Không có bản ghi = vai trò đang dùng đủ quyền mặc định.
const rolePermissionSchema = new Schema(
  {
    roleKey: { type: String, required: true, unique: true }, // PERMISSION_ROLES (constants/permissions.js)
    revoked: { type: [String], default: [] }, // 'FEATURE:ACTION', vd 'TICKETS:DELETE'
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('role_permissions'),
);

export const RolePermission = model('RolePermission', rolePermissionSchema);
