// UC04 – Phân quyền theo vai trò (BR-S07, BR-X2, BR-X3). Thiết kế: constants/permissions.js
import mongoose from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import {
  ACTION_LABELS, CORE_PERMISSIONS, FEATURES, PERMISSION_ACTIONS, PERMISSION_ROLES, READ_ONLY_ROLE, ROLE_KEYS,
  actionOf, featureOf, normalizePath, permissionKey, roleKeyOf, roleKeysOfSpec,
} from '../../constants/permissions.js';
import { RolePermission } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';

const ACTIONS = Object.values(PERMISSION_ACTIONS);
const FEATURE_BY_CODE = new Map(FEATURES.map((f) => [f.code, f]));
const labelOfKey = (key) => {
  const [code, action] = key.split(':');
  return `${FEATURE_BY_CODE.get(code)?.label ?? code} – ${ACTION_LABELS[action] ?? action}`;
};

// ===== Quyền trần: đọc từ bảng route và authorize() =====
let tableCache = null;

/**
 * Duyệt router của /api: mỗi route có authenticate → (chức năng, hành động) → các vai trò authorize() cho qua.
 * Route không có authorize() = mọi vai trò đã đăng nhập. Route công khai (không authenticate) nằm ngoài ma trận.
 * @returns {{ ceiling: Map<string, Set<string>>, routes: Map<string, { layer, methods: Set<string> }[]> }}
 *   ceiling: roleKey → các 'FEATURE:ACTION' vai trò đó gọi được; routes: tiền tố → các route (để tra mẫu đường dẫn)
 */
export function buildRouteTable(apiRouter) {
  const ceiling = new Map(ROLE_KEYS.map((r) => [r, new Set()]));
  const routes = new Map();
  const prefixes = FEATURES.flatMap((f) => f.prefixes);
  for (const prefix of prefixes) {
    // Hàm so khớp thuần (không ghi params lên layer): bảng route được dựng lúc server đang phục vụ request
    const mount = apiRouter.stack.find((layer) => layer.handle?.stack && layer.matchers?.some((m) => m(prefix)));
    if (!mount) continue;
    routes.set(prefix, mount.handle.stack.filter((l) => l.route).map((l) => ({
      layer: l,
      methods: new Set(Object.keys(l.route.methods).map((m) => m.toUpperCase())),
    })));
    let scopeSpecs = null;
    let scopeAuth = false;
    for (const layer of mount.handle.stack) {
      if (!layer.route) {
        // router.use(authenticate, authorize(...)) áp cho các route khai báo sau nó
        if (layer.name === 'authenticate') scopeAuth = true;
        if (layer.handle?.specs) scopeSpecs = layer.handle.specs;
        continue;
      }
      const handlers = layer.route.stack.map((h) => h.handle);
      if (!scopeAuth && !handlers.some((h) => h.name === 'authenticate')) continue; // route công khai
      const specs = handlers.find((h) => h.specs)?.specs ?? scopeSpecs;
      const roles = specs ? [...new Set(specs.flatMap(roleKeysOfSpec))] : ROLE_KEYS;
      const path = normalizePath(`${prefix}${layer.route.path}`);
      const feature = featureOf(path);
      if (!feature) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const key = permissionKey(feature.code, actionOf(method, path));
        roles.forEach((r) => ceiling.get(r)?.add(key));
      }
    }
  }
  return { ceiling, routes };
}

export const buildCeiling = (apiRouter) => buildRouteTable(apiRouter).ceiling;

const routeTable = () => {
  tableCache ??= import('../../routes.js').then(({ default: apiRouter }) => buildRouteTable(apiRouter));
  return tableCache;
};

async function ceilingOf(roleKey) {
  return (await routeTable()).ceiling.get(roleKey) ?? new Set();
}

/**
 * Mẫu đường dẫn của request ('/tickets/:id/claim'), để suy ra hành động giống hệt lúc dựng quyền trần.
 * authenticate gắn ở route → có req.route; gắn ở cấp router (router.use(authenticate)) → tra bảng route.
 */
async function routePattern(req) {
  const prefix = req.baseUrl.replace(/^\/api/, '');
  if (req.route) return `${prefix}${req.route.path}`;
  const entry = (await routeTable()).routes.get(prefix)
    // layer.matchers: hàm so khớp thuần; không dùng layer.match() vì nó ghi params lên layer dùng chung giữa các request
    ?.find((r) => r.methods.has(req.method === 'HEAD' ? 'GET' : req.method) && r.layer.matchers.some((m) => m(req.path)));
  return entry ? `${prefix}${entry.layer.route.path}` : `${prefix}${req.path}`;
}

// ===== Các ô đã tắt: đọc DB một lần, xóa đệm khi lưu (có hiệu lực từ request kế tiếp) =====
// Giả định triển khai: 1 tiến trình server. Nhiều tiến trình thì tiến trình khác giữ đệm cũ tới khi khởi động lại.
let revokedCache = null;

export function invalidatePermissionCache() {
  revokedCache = null;
}

async function revokedOf(roleKey) {
  if (mongoose.connection.readyState !== 1) return new Set(); // chưa kết nối DB (vd test chỉ kiểm tra route)
  revokedCache ??= RolePermission.find().lean().then((docs) => new Map(docs.map((d) => [d.roleKey, new Set(d.revoked)])))
    .catch((err) => {
      revokedCache = null;
      throw err;
    });
  return (await revokedCache).get(roleKey) ?? new Set();
}

const isCore = (roleKey, key) => (CORE_PERMISSIONS[roleKey] ?? []).includes(key);

/** Chặn request theo ma trận; gọi trong authenticate ngay sau khi có req.user */
export async function enforcePermissions(req) {
  const roleKey = roleKeyOf(req.user);
  if (!roleKey || roleKey === READ_ONLY_ROLE) return;
  const path = normalizePath(await routePattern(req));
  const feature = featureOf(path);
  if (!feature) return;
  const key = permissionKey(feature.code, actionOf(req.method, path));
  if ((await revokedOf(roleKey)).has(key) && !isCore(roleKey, key)) throw new ApiError('PERMISSION_REVOKED');
}

// ===== API cho trang Phân quyền =====
function assertRole(roleKey) {
  if (!ROLE_KEYS.includes(roleKey)) throw ApiError.notFound('Không có vai trò này');
}

export function listRoles() {
  return ROLE_KEYS.map((key) => ({ key, label: PERMISSION_ROLES[key], readOnly: key === READ_ONLY_ROLE }));
}

/** UC04 bước 2: ma trận chức năng × hành động; ô ngoài quyền trần không chỉnh được, ô lõi khóa ở trạng thái bật */
export async function getMatrix(roleKey) {
  assertRole(roleKey);
  const ceiling = await ceilingOf(roleKey);
  const revoked = await revokedOf(roleKey);
  const readOnly = roleKey === READ_ONLY_ROLE;
  const features = FEATURES.map((feature) => ({
    code: feature.code,
    label: feature.label,
    group: feature.group,
    actions: Object.fromEntries(ACTIONS.map((action) => {
      const key = permissionKey(feature.code, action);
      const available = ceiling.has(key);
      return [action, {
        available,
        granted: available && !revoked.has(key),
        core: available && isCore(roleKey, key),
      }];
    })),
  })).filter((f) => Object.values(f.actions).some((a) => a.available));
  return { roleKey, label: PERMISSION_ROLES[roleKey], readOnly, features };
}

/** UC04 bước 4–5: lưu ma trận. granted = các ô đang bật mà Trưởng BQL gửi lên */
export async function saveMatrix(actor, roleKey, granted) {
  assertRole(roleKey);
  if (roleKey === READ_ONLY_ROLE) throw new ApiError('ROLE_READ_ONLY'); // BR-X2
  const ceiling = await ceilingOf(roleKey);
  const wanted = new Set(granted);

  const outside = [...wanted].filter((k) => !ceiling.has(k));
  if (outside.length) {
    throw ApiError.badRequest('Không cấp được quyền ngoài phạm vi của vai trò', outside.map((k) => ({ field: k, message: labelOfKey(k) })));
  }
  const missingCore = (CORE_PERMISSIONS[roleKey] ?? []).filter((k) => ceiling.has(k) && !wanted.has(k));
  if (missingCore.length) {
    throw new ApiError('CORE_PERMISSION', undefined, { details: missingCore.map((k) => ({ field: k, message: labelOfKey(k) })) }); // MSG-S14
  }

  const before = await revokedOf(roleKey);
  const revoked = [...ceiling].filter((k) => !wanted.has(k)).sort();
  const changed = [...ceiling].filter((k) => before.has(k) !== !wanted.has(k)).sort();

  await RolePermission.findOneAndUpdate(
    { roleKey },
    { $set: { revoked, updatedBy: actor.id ?? actor._id ?? null } },
    { upsert: true },
  );
  invalidatePermissionCache();

  if (changed.length) {
    await logAudit({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
      user: actor,
      targetType: AUDIT_TARGETS.ROLE_PERMISSION,
      metadata: { roleKey, roleLabel: PERMISSION_ROLES[roleKey] },
      // Giá trị cũ / mới của từng ô thay đổi: true = được phép
      before: Object.fromEntries(changed.map((k) => [labelOfKey(k), !before.has(k)])),
      after: Object.fromEntries(changed.map((k) => [labelOfKey(k), wanted.has(k)])),
    });
  }
  return getMatrix(roleKey);
}

/** UC04 bước 6: quyền đang bị tắt của người đang đăng nhập, để client ẩn menu */
export async function myPermissions(user) {
  const roleKey = roleKeyOf(user);
  if (!roleKey || roleKey === READ_ONLY_ROLE) return { roleKey, revoked: [], hiddenMenuKeys: [] };
  const revoked = [...(await revokedOf(roleKey))].filter((k) => !isCore(roleKey, k)).sort();
  const hiddenMenuKeys = FEATURES
    .filter((f) => revoked.includes(permissionKey(f.code, PERMISSION_ACTIONS.VIEW)))
    .flatMap((f) => f.menuKeys);
  return { roleKey, revoked, hiddenMenuKeys };
}
