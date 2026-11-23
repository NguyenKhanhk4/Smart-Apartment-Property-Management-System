// UC06 – Xem nhật ký hoạt động (BR-S10, BR-X2, BR-D02). Chỉ đọc; Ban quản trị chỉ thấy phần tài chính.
import mongoose from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_TARGETS, ROLES } from '../../constants/enums.js';
import { Apartment, Asset, AuditLog, Resident, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { col, renderReport } from '../../services/export.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { endOfVnDay, fmtDateTimeVn, fmtDateVn, startOfVnDay } from '../../utils/time.js';
import {
  auditActionLabel, auditTargetLabel, auditOptions, financialAuditFilter, normalizeTarget, targetTypeAliases,
} from './auditLogs.rules.js';

// Chỉ che ở API đọc; giữ nguyên log gốc và contract logAudit(session) của các module.
const sensitive = (key) => /password|passwd|smtppass|apikey|encryptionkey|privatekey|secret|token|otp|authorization|cookie|idnumber|identity|cccd|phone|email|address|signature|documenturl|idphoto/i
  .test(String(key).replace(/[^a-z0-9]/gi, ''));
const HIDDEN = '[Đã ẩn]';
const FINANCIAL_METADATA = new Set([
  'code', 'incomeSource', 'documentNo', 'amount', 'balanceBefore', 'balanceAfter', 'fundId', 'transactionId', 'proposalId',
  'source', 'description', 'occurredAt', 'period', 'receiptNo', 'invoiceId', 'invoiceIds',
  'totalAmount', 'paidAmount', 'method', 'before', 'after', 'key', 'value', 'reason',
  'oldValue', 'newValue', 'count', 'decision', 'status', 'fromStatus', 'toStatus',
]);
/** Xuất tối đa bấy nhiêu dòng; nhiều hơn thì yêu cầu thu hẹp bộ lọc (không cắt bớt vì BR-D02 đòi đúng dữ liệu đang xem) */
export const MAX_EXPORT_ROWS = 5000;

export function redactAuditMetadata(value, depth = 0) {
  if (depth > 8) return HIDDEN;
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map((v) => redactAuditMetadata(v, depth + 1));
  // Các log lưu thay đổi dưới dạng { field: 'phone', before, after } cũng cần được che.
  const privateChange = ['field', 'path', 'key'].some((k) => typeof value[k] === 'string' && sensitive(value[k]));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, sensitive(key) || (privateChange && !['field', 'path', 'key'].includes(key))
      ? HIDDEN : redactAuditMetadata(item, depth + 1),
  ]));
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && typeof v.toHexString !== 'function';

/** { a: 1 } và { a: 2, b: 3 } → [{ field: 'a', before: 1, after: 2 }, { field: 'b', before: undefined, after: 3 }] */
function pairObjects(field, before, after) {
  if (!isPlainObject(before) && !isPlainObject(after)) return [{ field, before, after }];
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.map((k) => ({ field: k, before: before?.[k], after: after?.[k] }));
}

// Log ghi { from, to } không kèm tên trường: đặt tên theo hành động để giao diện hiện đúng nhãn
const FROM_TO_FIELD = {
  TICKET_ESCALATED: 'priority',
  TICKET_RECLASSIFIED: 'classification',
  WORKORDER_ASSIGNED: 'assignee',
};

/**
 * Giá trị cũ / mới của một log (UC06 bước 4). Log mới ghi ở `before` / `after`;
 * log của các module cũ ghi trong metadata theo nhiều kiểu, đọc lại về cùng một dạng.
 * @returns {{ changes: { field, before, after }[], rest: object }} rest = phần metadata còn lại
 */
export function extractChanges(log) {
  const meta = isPlainObject(log.metadata) ? { ...log.metadata } : {};
  if (log.before !== undefined || log.after !== undefined) return { changes: pairObjects('value', log.before, log.after), rest: meta };

  const changes = [];
  const named = meta.field ?? meta.key ?? FROM_TO_FIELD[log.action] ?? 'value';
  if (isPlainObject(meta.changes)) {
    // { field: [cũ, mới] } hoặc { field: { from, to } } / { before, after }
    for (const [field, v] of Object.entries(meta.changes)) {
      if (Array.isArray(v) && v.length === 2) changes.push({ field, before: v[0], after: v[1] });
      else if (isPlainObject(v) && ('from' in v || 'to' in v)) changes.push({ field, before: v.from, after: v.to });
      else if (isPlainObject(v) && ('before' in v || 'after' in v)) changes.push({ field, before: v.before, after: v.after });
      else changes.push({ field, before: undefined, after: v });
    }
    delete meta.changes;
  }
  for (const [oldKey, newKey] of [['before', 'after'], ['oldValue', 'newValue'], ['from', 'to'], ['fromStatus', 'toStatus']]) {
    if (oldKey in meta || newKey in meta) {
      changes.push(...pairObjects(oldKey === 'fromStatus' ? 'status' : named, meta[oldKey], meta[newKey]));
      delete meta[oldKey];
      delete meta[newKey];
    }
  }
  return { changes, rest: meta };
}

function assertReader(user) {
  if (![ROLES.MANAGER, ROLES.BOARD].includes(user?.role)) throw ApiError.forbidden();
}

export function getAuditOptions(user) {
  assertReader(user);
  return auditOptions(user.role === ROLES.BOARD);
}

/** Bộ lọc dùng chung cho danh sách và file xuất (BR-D02: xuất đúng dữ liệu đang xem) */
async function buildFilter(user, query) {
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.performedBy) filter.performedBy = query.performedBy;
  if (query.targetType) filter.targetType = { $in: targetTypeAliases(normalizeTarget(query.targetType)) };
  if (query.targetId) filter.targetId = query.targetId;
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from && { $gte: startOfVnDay(new Date(query.from)) }),
      ...(query.to && { $lte: endOfVnDay(new Date(query.to)) }),
    };
  }
  const clauses = [];
  if (user.role === ROLES.BOARD) clauses.push(financialAuditFilter());
  if (query.q) {
    const people = await User.find({ fullName: new RegExp(escapeRegex(query.q), 'i') }).select('_id').lean();
    clauses.push({ performedBy: { $in: people.map((u) => u._id) } });
  }
  if (clauses.length) filter.$and = clauses;
  return filter;
}

const sortOf = (query) => {
  const dir = query.sort === 'createdAt' ? 1 : -1;
  return { createdAt: dir, _id: dir };
};
const SELECT = 'action performedBy targetType targetId metadata before after ip createdAt';
const POPULATE = { path: 'performedBy', select: 'fullName role roleTitle boardTitle' };

// Trường dễ đọc của bản ghi, ưu tiên theo thứ tự (mã trước, tên sau)
const NAME_FIELDS = ['code', 'receiptNo', 'cardNumber', 'plateNumber', 'key', 'fullName', 'name', 'title'];

/**
 * Mã bản ghi dễ đọc thay cho ObjectId: 1 truy vấn cho mỗi loại đối tượng trong trang.
 * Bản ghi đã bị xóa hoặc collection không có trường dễ đọc → dùng metadata.code nếu có.
 * @returns {Map<string, string>} key `${targetType}:${targetId}`
 */
async function targetNames(logs) {
  const groups = new Map();
  for (const log of logs) {
    if (!log.targetId || !log.targetType) continue;
    const type = normalizeTarget(log.targetType);
    if (!groups.has(type)) groups.set(type, new Set());
    groups.get(type).add(String(log.targetId));
  }
  const names = new Map();
  await Promise.all([...groups].map(async ([type, ids]) => {
    if (SPECIAL_NAMES[type]) {
      for (const [id, name] of await SPECIAL_NAMES[type]([...ids])) names.set(`${type}:${id}`, name);
      return;
    }
    const Model = Object.values(mongoose.models).find((M) => M.collection.collectionName === type);
    const fields = Model ? NAME_FIELDS.filter((f) => Model.schema.path(f)) : [];
    if (!fields.length) return;
    const docs = await Model.find({ _id: { $in: [...ids] } }).select(fields.join(' ')).lean();
    for (const doc of docs) {
      const name = fields.map((f) => doc[f]).find((v) => v != null && v !== '');
      if (name != null) names.set(`${type}:${doc._id}`, String(name));
    }
  }));
  return names;
}

// Bản ghi tự nó không có tên dễ đọc: ghép từ bản ghi liên quan
const SPECIAL_NAMES = {
  // Dòng cư dân trong căn: tên người (tài khoản hoặc nhân khẩu không tài khoản) + mã căn → "Nguyễn Văn A (A102)"
  residents: async (ids) => {
    const docs = await Resident.find({ _id: { $in: ids } })
      .select('fullName userId apartmentId')
      .populate('userId', 'fullName')
      .populate('apartmentId', 'code')
      .lean();
    return docs.map((d) => {
      const person = d.userId?.fullName ?? d.fullName ?? 'Cư dân';
      return [String(d._id), d.apartmentId?.code ? `${person} (${d.apartmentId.code})` : person];
    });
  },
};

// Biểu giá / thu hộ điện nước (UC05): không có trường tên, bản ghi có thể đã bị xóa → ghép từ before/after của log
const UTILITY_NAMES = { ELECTRICITY: 'Điện', WATER: 'Nước' };
const UTILITY_TARGETS = new Set([AUDIT_TARGETS.UTILITY_TARIFF, AUDIT_TARGETS.COLLECTION_SETTING]);
const periodText = (p) => (typeof p === 'string' && /^\d{4}-\d{2}$/.test(p) ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : null);
function utilityName(log) {
  if (!UTILITY_TARGETS.has(normalizeTarget(log.targetType))) return null;
  const data = { ...(log.before ?? {}), ...(log.after ?? {}) };
  const utility = UTILITY_NAMES[data.utility ?? log.metadata?.utility];
  const period = periodText(data.fromPeriod ?? log.before?.fromPeriod);
  if (!utility) return period ? `Từ ${period}` : null;
  return period ? `${utility} · ${period}` : utility;
}

// Log không gắn ID bản ghi: lấy tên từ metadata (mã phiếu, vai trò được phân quyền...)
const nameOf = (names, log) =>
  (log.targetId && names.get(`${normalizeTarget(log.targetType)}:${log.targetId}`))
  ?? utilityName(log)
  ?? (typeof log.metadata?.code === 'string' ? log.metadata.code : null)
  ?? (typeof log.metadata?.roleLabel === 'string' ? `Vai trò ${log.metadata.roleLabel}` : null);

// ===== Trường tham chiếu: đổi ObjectId sang tên / mã dễ đọc =====
const REF_FIELDS = {
  assignee: 'user', assignedTo: 'user', prevAssignee: 'user', userId: 'user', ownerId: 'user', tenantId: 'user',
  payerId: 'user', recipientId: 'user', technicianId: 'user',
  assetId: 'asset',
  apartmentId: 'apartment',
};
const REF_LOOKUP = {
  user: (ids) => User.find({ _id: { $in: ids } }).select('fullName').lean().then((rows) => rows.map((r) => [r._id, r.fullName])),
  asset: (ids) => Asset.find({ _id: { $in: ids } }).select('code name').lean().then((rows) => rows.map((r) => [r._id, r.code ? `${r.code} – ${r.name}` : r.name])),
  apartment: (ids) => Apartment.find({ _id: { $in: ids } }).select('code').lean().then((rows) => rows.map((r) => [r._id, `Căn ${r.code}`])),
};
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const idOf = (v) => {
  const s = v && typeof v.toHexString === 'function' ? v.toHexString() : v;
  return typeof s === 'string' && OBJECT_ID.test(s) ? s.toLowerCase() : null;
};

/** Gom ID trong các trường tham chiếu của 1 trang log → Map id → tên. Một truy vấn cho mỗi loại */
async function refNames(logs) {
  const wanted = { user: new Set(), asset: new Set(), apartment: new Set() };
  const add = (field, value) => {
    const kind = REF_FIELDS[field];
    if (!kind) return;
    for (const v of [value].flat()) {
      const id = idOf(v);
      if (id) wanted[kind].add(id);
    }
  };
  for (const log of logs) {
    const { changes, rest } = extractChanges(log);
    changes.forEach((c) => { add(c.field, c.before); add(c.field, c.after); });
    Object.entries(rest).forEach(([k, v]) => add(k, v));
  }
  const names = new Map();
  await Promise.all(Object.entries(wanted).filter(([, ids]) => ids.size).map(async ([kind, ids]) => {
    for (const [id, name] of await REF_LOOKUP[kind]([...ids])) names.set(String(id), name);
  }));
  return names;
}

/** Giá trị của trường tham chiếu → tên; ID không còn bản ghi thì giữ nguyên */
const withRef = (refs, field, value) => {
  if (!REF_FIELDS[field]) return value;
  if (Array.isArray(value)) return value.map((v) => refs.get(idOf(v)) ?? v);
  return refs.get(idOf(value)) ?? value;
};

/** Dạng trả về cho client: nhãn, giá trị cũ / mới đã che, IP chỉ cho Trưởng BQL */
function present(user, log, names = new Map(), refs = new Map()) {
  const isBoard = user.role === ROLES.BOARD;
  const { changes, rest } = extractChanges(log);
  const metadata = isBoard ? Object.fromEntries(Object.entries(rest).filter(([key]) => FINANCIAL_METADATA.has(key))) : rest;
  const { ip, ...safeLog } = log;
  delete safeLog.before; // trả về dạng `changes` đã che, không trả bản gốc
  delete safeLog.after;
  return {
    ...safeLog,
    targetType: log.targetType ? normalizeTarget(log.targetType) : log.targetType, // log cũ 'Resident' → 'residents'
    actionLabel: auditActionLabel(log.action),
    targetLabel: auditTargetLabel(log.targetType),
    targetName: nameOf(names, log),
    changes: changes.map((c) => (sensitive(c.field)
      ? { field: c.field, before: c.before === undefined ? undefined : HIDDEN, after: c.after === undefined ? undefined : HIDDEN }
      : { field: c.field, before: withRef(refs, c.field, redactAuditMetadata(c.before)), after: withRef(refs, c.field, redactAuditMetadata(c.after)) })),
    metadata: Object.fromEntries(Object.entries(redactAuditMetadata(metadata)).map(([k, v]) => [k, withRef(refs, k, v)])),
    ...(!isBoard && { ip }),
  };
}

export async function listAuditLogs(user, query = {}) {
  assertReader(user);
  const result = await paginate(AuditLog, await buildFilter(user, query), { ...query, sort: sortOf(query) }, { select: SELECT, populate: POPULATE });
  const [names, refs] = await Promise.all([targetNames(result.items), refNames(result.items)]);
  result.items = result.items.map((log) => present(user, log, names, refs));
  return result;
}

// ===== Xuất Excel / PDF (UC06 bước 5, UC65) =====
const show = (v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const changeText = (changes) => changes.map((c) => `${c.field === 'value' ? '' : `${c.field}: `}${show(c.before)} → ${show(c.after)}`).join('; ');

async function filterText(query) {
  const parts = [];
  if (query.from || query.to) parts.push(`Từ ${query.from ? fmtDateVn(new Date(query.from)) : '…'} đến ${query.to ? fmtDateVn(new Date(query.to)) : '…'}`);
  if (query.action) parts.push(`Hành động: ${auditActionLabel(query.action)}`);
  if (query.targetType) parts.push(`Đối tượng: ${auditTargetLabel(query.targetType)}`);
  if (query.targetId) parts.push(`Mã bản ghi: ${query.targetId}`);
  if (query.performedBy) {
    const who = await User.findById(query.performedBy).select('fullName').lean();
    parts.push(`Người thực hiện: ${who?.fullName ?? query.performedBy}`);
  }
  if (query.q) parts.push(`Tên người thực hiện có "${query.q}"`);
  return parts.length ? `Bộ lọc: ${parts.join(' · ')}` : 'Bộ lọc: tất cả';
}

export async function exportAuditLogs(user, { format, ...query }) {
  assertReader(user);
  const filter = await buildFilter(user, query);
  const total = await AuditLog.countDocuments(filter);
  if (!total) throw new ApiError('NO_DATA'); // MSG-D01
  if (total > MAX_EXPORT_ROWS) {
    throw ApiError.badRequest(`Có ${total} dòng, vượt giới hạn ${MAX_EXPORT_ROWS} dòng mỗi lần xuất. Hãy thu hẹp khoảng thời gian hoặc bộ lọc.`);
  }
  const logs = await AuditLog.find(filter).sort(sortOf(query)).select(SELECT).populate(POPULATE).lean();
  const isBoard = user.role === ROLES.BOARD;
  const [names, refs] = await Promise.all([targetNames(logs), refNames(logs)]);
  const rows = logs.map((log) => {
    const item = present(user, log, names, refs);
    return {
      time: fmtDateTimeVn(log.createdAt),
      user: log.performedBy?.fullName ?? 'Hệ thống',
      action: item.actionLabel,
      target: item.targetLabel,
      targetId: item.targetName ?? (log.targetId ? String(log.targetId) : '—'),
      changes: changeText(item.changes) || '—',
      ip: item.ip || (log.performedBy ? 'Không ghi nhận' : 'Hệ thống'),
    };
  });
  const title = isBoard ? 'Nhật ký hoạt động tài chính' : 'Nhật ký hoạt động';
  const columns = [
    col('Thời điểm', 'time', 18),
    col('Người thực hiện', 'user', 22),
    col('Hành động', 'action', 30),
    col('Đối tượng', 'target', 18),
    col('Mã bản ghi', 'targetId', 26),
    col('Giá trị cũ → mới', 'changes', 48),
    ...(isBoard ? [] : [col('IP', 'ip', 16)]),
  ];
  const exporter = await User.findById(user.id ?? user._id).select('fullName').lean();
  const spec = {
    title,
    filterText: await filterText(query),
    summary: [['Số dòng', rows.length], ['Người xuất', exporter?.fullName ?? '']],
    sections: [{ title: 'Nhật ký', columns, rows }],
  };
  const file = await renderReport(spec, format, isBoard ? 'nhat-ky-tai-chinh' : 'nhat-ky-hoat-dong');

  // UC65: việc xuất file cũng được ghi lại
  await logAudit({
    action: AUDIT_ACTIONS.AUDIT_LOG_EXPORTED,
    user,
    targetType: AUDIT_TARGETS.AUDIT_LOG,
    metadata: { format, count: rows.length, filters: query },
  });
  return file;
}
