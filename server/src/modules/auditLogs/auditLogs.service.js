import { ROLES } from '../../constants/enums.js';
import { AuditLog, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { endOfVnDay, startOfVnDay } from '../../utils/time.js';
import { auditActionLabel, auditTargetLabel, auditOptions, financialAuditFilter } from './auditLogs.rules.js';

// Chỉ che ở API đọc; giữ nguyên log gốc và contract logAudit(session) của các module.
const sensitive = (key) => /password|passwd|smtppass|apikey|encryptionkey|privatekey|secret|token|otp|authorization|cookie|idnumber|identity|cccd|phone|email|address|signature|documenturl|idphoto/i
  .test(String(key).replace(/[^a-z0-9]/gi, ''));
const FINANCIAL_METADATA = new Set([
  'code', 'incomeSource', 'documentNo', 'amount', 'balanceBefore', 'balanceAfter', 'fundId', 'transactionId', 'proposalId',
  'source', 'description', 'occurredAt', 'period', 'receiptNo', 'invoiceId', 'invoiceIds',
  'totalAmount', 'paidAmount', 'method', 'before', 'after', 'key', 'value', 'reason',
  'oldValue', 'newValue', 'count', 'decision', 'status', 'fromStatus', 'toStatus',
]);

export function redactAuditMetadata(value, depth = 0) {
  if (depth > 8) return '[Đã ẩn]';
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map((v) => redactAuditMetadata(v, depth + 1));
  // Các log lưu thay đổi dưới dạng { field: 'phone', before, after } cũng cần được che.
  const privateChange = ['field', 'path', 'key'].some((k) => typeof value[k] === 'string' && sensitive(value[k]));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, sensitive(key) || (privateChange && !['field', 'path', 'key'].includes(key))
      ? '[Đã ẩn]' : redactAuditMetadata(item, depth + 1),
  ]));
}

function assertReader(user) {
  if (![ROLES.MANAGER, ROLES.BOARD].includes(user?.role)) throw ApiError.forbidden();
}

export function getAuditOptions(user) {
  assertReader(user);
  return auditOptions(user.role === ROLES.BOARD);
}

export async function listAuditLogs(user, query = {}) {
  assertReader(user);
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.performedBy) filter.performedBy = query.performedBy;
  if (query.targetType) filter.targetType = query.targetType;
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
  const result = await paginate(AuditLog, filter, {
    ...query, sort: { createdAt: query.sort === 'createdAt' ? 1 : -1, _id: query.sort === 'createdAt' ? 1 : -1 },
  }, {
    select: 'action performedBy targetType targetId metadata ip createdAt',
    populate: { path: 'performedBy', select: 'fullName role roleTitle boardTitle' },
  });
  result.items = result.items.map((log) => {
    const metadata = user.role === ROLES.BOARD && log.metadata && typeof log.metadata === 'object'
      ? Object.fromEntries(Object.entries(log.metadata).filter(([key]) => FINANCIAL_METADATA.has(key)))
      : log.metadata;
    const { ip, ...safeLog } = log;
    return {
      ...safeLog,
      actionLabel: auditActionLabel(log.action),
      targetLabel: auditTargetLabel(log.targetType),
      metadata: redactAuditMetadata(metadata),
      ...(user.role === ROLES.MANAGER && { ip }),
    };
  });
  return result;
}
