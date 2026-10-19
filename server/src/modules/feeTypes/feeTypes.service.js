// UC-B01 — Danh mục phí & đơn giá theo thời gian (BR-F4, BR-F12).
// Đổi giá = tạo mức giá mới từ một kỳ, mức đang mở tự đóng lại; không sửa đè giá đã dùng lập hóa đơn (BR-F3).
import { AUDIT_ACTIONS, FEE_CALC_METHODS, FEE_CATEGORIES } from '../../constants/enums.js';
import { FeeType } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { periodStart, vnPeriod } from '../../utils/time.js';
import { withTransaction } from '../../utils/transaction.js';
import { billedPeriodsByCode, endPeriodOf, fromPeriodOf, getPriceTable, isBilled } from './feeTypes.queries.js';

export const FEE_TYPE_STATES = Object.freeze({ ACTIVE: 'ACTIVE', UPCOMING: 'UPCOMING', ENDED: 'ENDED' });

// Thuộc tính cố định của một mã phí — mọi mức giá cùng code phải giống nhau để hóa đơn tính nhất quán
const SHAPE_FIELDS = ['feeCategory', 'calcMethod', 'vehicleType'];

function present(fee, currentPeriod, billedPeriods = []) {
  const fromPeriod = fromPeriodOf(fee);
  const endPeriod = endPeriodOf(fee);
  let state = FEE_TYPE_STATES.ACTIVE;
  if (fromPeriod > currentPeriod) state = FEE_TYPE_STATES.UPCOMING;
  else if (endPeriod && endPeriod < currentPeriod) state = FEE_TYPE_STATES.ENDED;
  return {
    ...fee,
    fromPeriod,
    endPeriod,
    state,
    // Đã có hóa đơn dùng mức giá này → khóa sửa giá / xóa
    inUse: billedPeriods.some((p) => p >= fromPeriod && (!endPeriod || p <= endPeriod)),
  };
}

/** BR-F4: PARKING tính theo xe (bắt buộc loại xe); CLEANING tính theo m² hoặc theo căn */
function assertValidShape({ feeCategory, calcMethod, vehicleType }) {
  if (feeCategory === FEE_CATEGORIES.PARKING) {
    if (calcMethod !== FEE_CALC_METHODS.PER_VEHICLE) throw ApiError.badRequest('Phí gửi xe phải tính theo xe (PER_VEHICLE)');
    if (!vehicleType) throw ApiError.badRequest('Phí gửi xe cần chọn loại xe');
  } else {
    if (calcMethod === FEE_CALC_METHODS.PER_VEHICLE) throw ApiError.badRequest('Chỉ phí gửi xe mới tính theo xe');
    if (vehicleType) throw ApiError.badRequest('Chỉ phí gửi xe mới có loại xe');
  }
}

/** BR-F12: cùng code không có 2 mức giá chồng khoảng. Hai khoảng [a1,a2) và [b1,b2) chồng nhau khi a1 < b2 và b1 < a2 */
async function assertNoOverlap(code, from, to, { excludeId } = {}) {
  const filter = {
    code,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: from } }],
    ...(to && { effectiveFrom: { $lt: to } }),
    ...(excludeId && { _id: { $ne: excludeId } }),
  };
  if (await FeeType.exists(filter)) throw new ApiError('FEE_TYPE_OVERLAP');
}

async function findOrThrow(id) {
  const fee = await FeeType.findById(id).lean();
  if (!fee) throw ApiError.notFound('Không tìm thấy mức giá');
  return fee;
}

const audit = (user, fee, metadata, opts) =>
  logAudit({ action: AUDIT_ACTIONS.FEE_TYPE_CHANGED, user, targetType: 'fee_types', targetId: fee._id, metadata }, opts);

/** Danh sách mức giá (mới nhất trước trong từng code), kèm trạng thái hiệu lực và cờ đã lập hóa đơn */
export async function listFeeTypes({ code, feeCategory, state }, { now = new Date() } = {}) {
  const filter = {};
  if (code) filter.code = code;
  if (feeCategory) filter.feeCategory = feeCategory;
  const rows = await FeeType.find(filter).sort({ feeCategory: 1, code: 1, effectiveFrom: -1 }).lean();

  const billed = await billedPeriodsByCode([...new Set(rows.map((r) => r.code))]);
  const currentPeriod = vnPeriod(now);
  const items = rows.map((r) => present(r, currentPeriod, billed.get(r.code)));
  return state ? items.filter((r) => r.state === state) : items;
}

/** Bảng giá đang áp dụng kỳ hiện tại — ai đăng nhập cũng xem được */
export async function getCurrentPrices({ now = new Date() } = {}) {
  const currentPeriod = vnPeriod(now);
  const table = await getPriceTable(currentPeriod);
  return [...table.values()].map(({ createdBy: _createdBy, ...fee }) => present(fee, currentPeriod));
}

/**
 * Tạo mức giá áp dụng từ kỳ `effectiveFrom` ('YYYY-MM').
 * - Mã phí mới: bắt buộc name, feeCategory, calcMethod (+ vehicleType nếu gửi xe).
 * - Mã đã có (đổi giá): chỉ cần unitPrice + effectiveFrom; mức giá đang mở bắt đầu trước kỳ mới được tự đóng lại.
 */
export async function createFeeType(user, body, { now = new Date() } = {}) {
  const { code, unitPrice, effectiveFrom: fromPeriod } = body;
  if (fromPeriod < vnPeriod(now)) throw ApiError.badRequest('Chỉ áp dụng giá từ kỳ hiện tại trở đi');

  const latest = await FeeType.findOne({ code }).sort({ effectiveFrom: -1 }).lean();
  let shape;
  if (latest) {
    shape = Object.fromEntries(SHAPE_FIELDS.map((k) => [k, latest[k] ?? null]));
    const changed = SHAPE_FIELDS.find((k) => body[k] !== undefined && (body[k] ?? null) !== shape[k]);
    if (changed) {
      throw ApiError.badRequest(`Mã phí ${code} đã có, không đổi được nhóm phí / cách tính / loại xe. Hãy tạo mã phí khác`);
    }
  } else {
    if (!body.name || !body.feeCategory || !body.calcMethod) {
      throw ApiError.badRequest('Loại phí mới cần có tên, nhóm phí và cách tính');
    }
    shape = Object.fromEntries(SHAPE_FIELDS.map((k) => [k, body[k] ?? null]));
    assertValidShape(shape);
    // Mỗi loại xe chỉ 1 mã phí gửi xe, để lúc sinh hóa đơn không phải đoán dùng giá nào
    if (shape.vehicleType && (await FeeType.exists({ vehicleType: shape.vehicleType }))) {
      throw ApiError.badRequest('Loại xe này đã có mã phí gửi xe, hãy đổi giá trên mã đó');
    }
  }

  // Kỳ đã lập hóa đơn thì giá phải giữ nguyên (BR-F3)
  if (await isBilled(code, fromPeriod)) throw new ApiError('FEE_PERIOD_BILLED');

  const from = periodStart(fromPeriod);
  // Kiểm tra trước khi ghi (MongoDB standalone không có transaction để rollback); mức đang mở sẽ được đóng nên bỏ qua
  const open = await FeeType.findOne({ code, effectiveTo: null, effectiveFrom: { $lt: from } }).lean();
  await assertNoOverlap(code, from, null, { excludeId: open?._id });

  return withTransaction(async (session) => {
    if (open) {
      const { modifiedCount } = await FeeType.updateOne(
        { _id: open._id, effectiveTo: null },
        { $set: { effectiveTo: from } },
        { session },
      );
      if (!modifiedCount) throw new ApiError('CONCURRENT_UPDATE');
    }

    const [fee] = await FeeType.create(
      [{ code, name: body.name ?? latest.name, ...shape, unitPrice, effectiveFrom: from, effectiveTo: null, createdBy: user.id }],
      { session },
    );
    await audit(
      user,
      fee,
      { op: latest ? 'CHANGE_PRICE' : 'CREATE', code, fromPeriod, unitPrice, previous: open && { id: open._id, unitPrice: open.unitPrice } },
      { session },
    );
    return fee.toObject();
  });
}

/** Đổi tên (áp dụng cho mọi mức giá của mã phí) và/hoặc sửa đơn giá của mức chưa dùng lập hóa đơn */
export async function updateFeeType(user, id, { name, unitPrice }) {
  const fee = await findOrThrow(id);
  const priceChanged = unitPrice !== undefined && unitPrice !== fee.unitPrice;
  if (priceChanged && (await isBilled(fee.code, fromPeriodOf(fee), endPeriodOf(fee)))) {
    throw new ApiError('FEE_TYPE_IN_USE');
  }

  await withTransaction(async (session) => {
    if (name !== undefined && name !== fee.name) {
      await FeeType.updateMany({ code: fee.code }, { $set: { name } }, { session });
    }
    if (priceChanged) await FeeType.updateOne({ _id: id }, { $set: { unitPrice } }, { session });
    await audit(
      user,
      fee,
      {
        op: 'UPDATE',
        code: fee.code,
        before: { name: fee.name, unitPrice: fee.unitPrice },
        after: { name: name ?? fee.name, unitPrice: unitPrice ?? fee.unitPrice },
      },
      { session },
    );
  });
  return FeeType.findById(id).lean();
}

/** Ngừng thu phí từ kỳ `effectiveTo` ('YYYY-MM'): kỳ trước đó là kỳ cuối cùng còn tính */
export async function endFeeType(user, id, { effectiveTo: stopPeriod }, { now = new Date() } = {}) {
  const fee = await findOrThrow(id);
  if (fee.effectiveTo) throw ApiError.badRequest('Mức giá này đã có kỳ kết thúc');
  if (stopPeriod <= fromPeriodOf(fee)) throw ApiError.badRequest('Kỳ ngừng thu phải sau kỳ bắt đầu áp dụng');
  if (stopPeriod < vnPeriod(now)) throw ApiError.badRequest('Chỉ ngừng thu được từ kỳ hiện tại trở đi');
  if (await isBilled(fee.code, stopPeriod)) throw new ApiError('FEE_PERIOD_BILLED');

  const updated = await FeeType.findOneAndUpdate(
    { _id: id, effectiveTo: null },
    { $set: { effectiveTo: periodStart(stopPeriod) } },
    { new: true },
  ).lean();
  if (!updated) throw new ApiError('CONCURRENT_UPDATE');
  await audit(user, fee, { op: 'END', code: fee.code, stopPeriod });
  return updated;
}

/**
 * Xóa mức giá chưa dùng lập hóa đơn (vd nhập nhầm, hủy lịch tăng giá).
 * Mức giá liền trước (kết thúc đúng lúc mức này bắt đầu) được nối dài để bảng giá không bị hở.
 */
export async function deleteFeeType(user, id) {
  const fee = await findOrThrow(id);
  if (await isBilled(fee.code, fromPeriodOf(fee), endPeriodOf(fee))) throw new ApiError('FEE_TYPE_IN_USE');

  await withTransaction(async (session) => {
    const { deletedCount } = await FeeType.deleteOne({ _id: id }, { session });
    if (!deletedCount) throw ApiError.notFound('Không tìm thấy mức giá');
    await FeeType.updateOne(
      { code: fee.code, effectiveTo: fee.effectiveFrom },
      { $set: { effectiveTo: fee.effectiveTo } },
      { session },
    );
    await audit(user, fee, { op: 'DELETE', code: fee.code, fromPeriod: fromPeriodOf(fee), unitPrice: fee.unitPrice }, { session });
  });
  return { deleted: true };
}
