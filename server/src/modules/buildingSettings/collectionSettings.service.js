// collectionSettings.service.js — Quản lý công tắc thu hộ điện/nước (UC05, BR-S09)
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { CollectionSetting } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { periodLabel, shiftPeriod, vnPeriod } from '../../utils/time.js';

/**
 * Mặc định: Điện TẮT (false), Nước BẬT (true) theo SRS
 */
const DEFAULTS = {
  ELECTRICITY: { enabled: false, waterQuotaPerOccupant: null },
  WATER: { enabled: true, waterQuotaPerOccupant: null },
};

/**
 * Kiểm tra trạng thái thu hộ tại một kỳ (cho module hóa đơn gọi)
 */
export async function isCollecting(utility, period) {
  const setting = await CollectionSetting.findOne({
    utility,
    fromPeriod: { $lte: period },
  })
    .sort({ fromPeriod: -1 })
    .lean();

  if (!setting) {
    return DEFAULTS[utility]?.enabled ?? false;
  }
  return setting.enabled;
}

/**
 * Lấy cấu hình thu hộ hiện tại và hẹn cho kỳ sau
 */
export async function getCollectionSettings({ now = new Date() } = {}) {
  const currentPeriod = vnPeriod(now);
  const nextPeriod = shiftPeriod(currentPeriod, 1);

  const getForUtility = async (utility) => {
    // Bản ghi đang áp dụng tại kỳ hiện tại
    const current = await CollectionSetting.findOne({
      utility,
      fromPeriod: { $lte: currentPeriod },
    })
      .sort({ fromPeriod: -1 })
      .lean();

    // Bản ghi hẹn cho tương lai (từ kỳ sau trở đi)
    const upcoming = await CollectionSetting.findOne({
      utility,
      fromPeriod: { $gt: currentPeriod },
    })
      .sort({ fromPeriod: 1 })
      .lean();

    return {
      utility,
      current: {
        enabled: current ? current.enabled : DEFAULTS[utility].enabled,
        waterQuotaPerOccupant: current ? current.waterQuotaPerOccupant : DEFAULTS[utility].waterQuotaPerOccupant,
        fromPeriod: current ? current.fromPeriod : null,
      },
      upcoming: upcoming
        ? {
            enabled: upcoming.enabled,
            waterQuotaPerOccupant: upcoming.waterQuotaPerOccupant,
            fromPeriod: upcoming.fromPeriod,
          }
        : null,
    };
  };

  const electricity = await getForUtility('ELECTRICITY');
  const water = await getForUtility('WATER');

  return {
    currentPeriod,
    nextPeriod,
    settings: {
      ELECTRICITY: electricity,
      WATER: water,
    },
  };
}

/**
 * Đổi công tắc thu hộ: luôn có hiệu lực từ kỳ sau (Rule 5a, BR-S09)
 */
export async function updateCollectionSetting(user, { utility, enabled, waterQuotaPerOccupant }, { now = new Date() } = {}) {
  const currentPeriod = vnPeriod(now);
  const nextPeriod = shiftPeriod(currentPeriod, 1);

  // Lấy trạng thái trước đó
  const before = await CollectionSetting.findOne({ utility })
    .sort({ fromPeriod: -1 })
    .lean();

  const beforeState = before
    ? { enabled: before.enabled, waterQuotaPerOccupant: before.waterQuotaPerOccupant }
    : DEFAULTS[utility];

  const updateData = {
    utility,
    enabled: Boolean(enabled),
    waterQuotaPerOccupant: utility === 'WATER' && enabled && waterQuotaPerOccupant != null ? Number(waterQuotaPerOccupant) : null,
    fromPeriod: nextPeriod,
    createdBy: user.id,
  };

  const setting = await CollectionSetting.findOneAndUpdate(
    { utility, fromPeriod: nextPeriod },
    { $set: updateData },
    { upsert: true, returnDocument: 'after', new: true },
  ).lean();

  await logAudit({
    action: AUDIT_ACTIONS.COLLECTION_SETTING_CHANGED,
    user,
    targetType: AUDIT_TARGETS.COLLECTION_SETTING,
    targetId: setting._id,
    before: beforeState,
    after: {
      enabled: setting.enabled,
      waterQuotaPerOccupant: setting.waterQuotaPerOccupant,
      fromPeriod: setting.fromPeriod,
    },
  });

  return {
    setting,
    effectiveFrom: nextPeriod,
    message: `Đã lưu cấu hình. Thay đổi thu hộ có hiệu lực từ kỳ sau (${periodLabel(nextPeriod)}).`,
  };
}

