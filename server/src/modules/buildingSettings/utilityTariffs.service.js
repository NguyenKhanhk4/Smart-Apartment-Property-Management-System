// utilityTariffs.service.js — Quản lý biểu giá điện/nước bậc thang (UC05, BR-S08, BR-F03)
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { UtilityTariff } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { periodLabel, shiftPeriod, vnPeriod } from '../../utils/time.js';

/**
 * Tính số tiền bậc thang (hàm thuần, không side-effect).
 * @param {Array<{ upTo: number|null, unitPrice: number }>} tiers Danh sách bậc, bậc cuối upTo = null
 * @param {number} consumption Lượng tiêu thụ (kWh hoặc m³)
 * @param {{ occupants?: number, perOccupant?: boolean }} options Số người và cờ định mức theo người
 * @returns {number} Tổng tiền (làm tròn số nguyên VNĐ)
 */
export function computeTieredAmount(tiers, consumption, { occupants = 1, perOccupant = false } = {}) {
  if (!consumption || consumption <= 0 || !Array.isArray(tiers) || tiers.length === 0) {
    return 0;
  }
  const nOccupants = perOccupant ? Math.max(1, Number(occupants) || 1) : 1;

  let remaining = consumption;
  let prevLimit = 0;
  let total = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;
    if (tier.upTo === null) {
      // Bậc cuối: tính toàn bộ lượng còn lại
      total += remaining * tier.unitPrice;
      break;
    }

    const tierCapacity = (tier.upTo * nOccupants) - prevLimit;
    if (tierCapacity <= 0) continue;

    const usedInTier = Math.min(remaining, tierCapacity);
    total += usedInTier * tier.unitPrice;
    remaining -= usedInTier;
    prevLimit = tier.upTo * nOccupants;
  }

  return Math.round(total);
}

/**
 * Lấy biểu giá hiệu lực tại kỳ `period` ('YYYY-MM')
 */
export async function getTariffAt(utility, period) {
  return UtilityTariff.findOne({
    utility,
    fromPeriod: { $lte: period },
    $or: [{ toPeriod: null }, { toPeriod: { $gte: period } }],
  })
    .sort({ fromPeriod: -1 })
    .lean();
}

/**
 * Lấy danh sách toàn bộ các phiên bản biểu giá điện/nước
 */
export async function listTariffs({ utility } = {}, { now = new Date() } = {}) {
  const currentPeriod = vnPeriod(now);
  const filter = utility ? { utility } : {};
  const list = await UtilityTariff.find(filter)
    .sort({ utility: 1, fromPeriod: -1 })
    .lean();

  return list.map((t) => {
    let state = 'ACTIVE';
    if (t.fromPeriod > currentPeriod) {
      state = 'UPCOMING';
    } else if (t.toPeriod && t.toPeriod < currentPeriod) {
      state = 'ENDED';
    }
    return {
      ...t,
      state,
      // Đã có hiệu lực (từ kỳ hiện tại trở về trước) thì không thể xóa (BR-S08)
      canDelete: t.fromPeriod > currentPeriod,
    };
  });
}

/**
 * Kiểm tra tính hợp lệ của danh sách bậc thang
 */
export function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw ApiError.field('tiers', 'Cần ít nhất một bậc giá');
  }

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (typeof tier.unitPrice !== 'number' || tier.unitPrice < 0) {
      throw ApiError.field(`tiers.${i}.unitPrice`, 'Đơn giá không được âm');
    }

    const isLast = i === tiers.length - 1;
    if (isLast) {
      if (tier.upTo !== null && tier.upTo !== undefined) {
        throw ApiError.field(`tiers.${i}.upTo`, 'Bậc cuối cùng phải để trống mức tối đa (vô hạn)');
      }
    } else {
      if (typeof tier.upTo !== 'number' || tier.upTo <= 0) {
        throw ApiError.field(`tiers.${i}.upTo`, 'Mức tối đa của bậc phải là số lớn hơn 0');
      }
      if (i > 0 && tier.upTo <= tiers[i - 1].upTo) {
        throw ApiError.field(`tiers.${i}.upTo`, 'Mức tối đa của các bậc phải tăng dần');
      }
    }
  }
}

/**
 * Tạo phiên bản biểu giá mới (BR-S08, 4a, 4b)
 */
export async function createTariff(user, body, { now = new Date() } = {}) {
  const { utility, fromPeriod: reqFromPeriod, tiers, perOccupant } = body;
  validateTiers(tiers);

  const currentPeriod = vnPeriod(now);
  const nextPeriod = shiftPeriod(currentPeriod, 1);

  let fromPeriod = reqFromPeriod;
  let movedTo = null;
  let message = 'Đã lưu cấu hình. Thay đổi phí áp dụng từ kỳ tính phí sau.';

  // Rule 4b: Ngày hiệu lực nằm trong kỳ tính phí đang mở hoặc quá khứ → tự dời sang đầu kỳ sau
  if (fromPeriod <= currentPeriod) {
    movedTo = nextPeriod;
    fromPeriod = nextPeriod;
    message = `Ngày hiệu lực trong kỳ đang mở đã được tự động dời sang kỳ sau (${periodLabel(nextPeriod)}).`;
  }

  // Rule 4a: Ngày hiệu lực trùng với phiên bản đang có của cùng mục → MSG-S16
  const existing = await UtilityTariff.findOne({ utility, fromPeriod }).lean();
  if (existing) {
    throw ApiError.field('fromPeriod', 'Ngày hiệu lực trùng với mức giá đã có của mục này');
  }

  // Tự đóng toPeriod của phiên bản trước đó nếu đang mở (toPeriod == null)
  const previous = await UtilityTariff.findOne({
    utility,
    fromPeriod: { $lt: fromPeriod },
    toPeriod: null,
  }).sort({ fromPeriod: -1 });

  if (previous) {
    const prevToPeriod = shiftPeriod(fromPeriod, -1);
    previous.toPeriod = prevToPeriod;
    await previous.save();
  }

  const cleanTiers = tiers.map((t, idx) => ({
    upTo: idx === tiers.length - 1 ? null : Number(t.upTo),
    unitPrice: Number(t.unitPrice),
  }));

  const created = await UtilityTariff.create({
    utility,
    fromPeriod,
    toPeriod: null,
    tiers: cleanTiers,
    perOccupant: utility === 'WATER' ? Boolean(perOccupant) : false,
    createdBy: user.id,
  });

  await logAudit({
    action: AUDIT_ACTIONS.UTILITY_TARIFF_CREATED,
    user,
    targetType: AUDIT_TARGETS.UTILITY_TARIFF,
    targetId: created._id,
    after: {
      utility,
      fromPeriod,
      tiers: cleanTiers,
      perOccupant: created.perOccupant,
    },
  });

  return {
    tariff: created,
    movedTo,
    message,
  };
}

/**
 * Xóa biểu giá chưa có hiệu lực (kỳ tương lai). Không cho sửa hoặc xóa phiên bản đã có hiệu lực.
 */
export async function deleteTariff(user, id, { now = new Date() } = {}) {
  const tariff = await UtilityTariff.findById(id);
  if (!tariff) throw ApiError.notFound('Không tìm thấy biểu giá');

  const currentPeriod = vnPeriod(now);
  if (tariff.fromPeriod <= currentPeriod) {
    throw new ApiError('UTILITY_TARIFF_IN_USE', 'Biểu giá đã có hiệu lực, không thể xóa');
  }

  // Nếu xóa phiên bản tương lai, mở lại toPeriod của phiên bản liền trước nếu có
  const previous = await UtilityTariff.findOne({
    utility: tariff.utility,
    fromPeriod: { $lt: tariff.fromPeriod },
  }).sort({ fromPeriod: -1 });

  if (previous && previous.toPeriod === shiftPeriod(tariff.fromPeriod, -1)) {
    previous.toPeriod = null;
    await previous.save();
  }

  await UtilityTariff.findByIdAndDelete(id);

  await logAudit({
    action: AUDIT_ACTIONS.UTILITY_TARIFF_DELETED,
    user,
    targetType: AUDIT_TARGETS.UTILITY_TARIFF,
    targetId: tariff._id,
    before: {
      utility: tariff.utility,
      fromPeriod: tariff.fromPeriod,
      toPeriod: tariff.toPeriod,
      tiers: tariff.tiers,
    },
  });

  return { deleted: true };
}
