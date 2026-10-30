// BR-R6: Dashboard hệ thống chỉ đọc tài khoản, tòa / căn, hợp đồng (đếm file), cron_runs, audit_logs — không đọc dữ liệu tài chính.
import { CRON_STATUS } from '../../constants/enums.js';
import { JOBS } from '../../jobs/index.js';
import { Apartment, AuditLog, Building, Contract, CronRun, User } from '../../models/index.js';
import { DAY_MS, VN_OFFSET_MS, periodStart, startOfVnDay, toVnYmd } from '../../utils/time.js';

/**
 * UC-A11: Thống kê số liệu hệ thống cho Admin
 */
export async function getDashboard() {
  const now = new Date();

  // 1. ACCOUNTS
  const byRoleRaw = await User.aggregate([
    {
      $group: {
        _id: {
          role: '$role',
          roleTitle: '$roleTitle',
          boardTitle: '$boardTitle',
        },
        active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
        locked: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        role: '$_id.role',
        roleTitle: '$_id.roleTitle',
        boardTitle: '$_id.boardTitle',
        active: 1,
        locked: 1,
      },
    },
    { $sort: { role: 1, roleTitle: 1, boardTitle: 1 } },
  ]);

  // 6 tháng gần nhất (theo giờ VN)
  const monthList = [];
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth() - i, 1));
    const mStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthList.push(mStr);
  }

  const start6Months = periodStart(monthList[0]);
  const newUsersRaw = await User.aggregate([
    { $match: { createdAt: { $gte: start6Months } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m',
            date: '$createdAt',
            timezone: '+07:00',
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const newUsersMap = Object.fromEntries(newUsersRaw.map((r) => [r._id, r.count]));
  const newPerMonth = monthList.map((month) => ({
    month,
    count: newUsersMap[month] || 0,
  }));

  // 2. BASE DATA (Tòa nhà & Căn hộ)
  const [buildingsCount, apartmentsCount, aptStatusRaw] = await Promise.all([
    Building.countDocuments(),
    Apartment.countDocuments(),
    Apartment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const byStatus = {
    VACANT: 0,
    OWNED: 0,
    RENTED: 0,
  };
  for (const s of aptStatusRaw) {
    if (s._id && byStatus[s._id] !== undefined) {
      byStatus[s._id] = s.count;
    }
  }

  const occupancyRate =
    apartmentsCount > 0 ? (byStatus.OWNED + byStatus.RENTED) / apartmentsCount : 0;

  // 3. SYSTEM (Cron jobs & Uploaded files)
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [latestRuns, failed7DaysRaw] = await Promise.all([
    CronRun.aggregate([
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: '$jobName',
          lastRunAt: { $first: '$finishedAt' },
          lastStatus: { $first: '$status' },
          lastAffected: { $first: '$affectedCount' },
          lastError: { $first: '$errorMessage' },
        },
      },
    ]),
    CronRun.aggregate([
      { $match: { status: CRON_STATUS.FAILED, startedAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: '$jobName', count: { $sum: 1 } } },
    ]),
  ]);

  const latestMap = Object.fromEntries(latestRuns.map((r) => [r._id, r]));
  const failedMap = Object.fromEntries(failed7DaysRaw.map((r) => [r._id, r.count]));

  // Chỉ job đã đăng ký chạy (jobs/index.js); enum CRON_JOBS còn job chưa có handler
  const jobs = JOBS.map(({ name: jobName }) => {
    const run = latestMap[jobName];
    return {
      jobName,
      lastRunAt: run?.lastRunAt || null,
      lastStatus: run?.lastStatus || null,
      lastAffected: run?.lastAffected ?? null,
      lastError: run?.lastError || null,
      failedLast7Days: failedMap[jobName] || 0,
    };
  });

  const [userAvatars, contractFiles] = await Promise.all([
    User.countDocuments({ avatarUrl: { $ne: null } }),
    Contract.countDocuments({ fileUrl: { $ne: null } }),
  ]);
  const uploadedFiles = userAvatars + contractFiles;

  // 4. AUDIT (30 ngày)
  const days30List = [];
  for (let i = 29; i >= 0; i -= 1) {
    days30List.push(toVnYmd(new Date(now.getTime() - i * DAY_MS)));
  }

  const start30Days = startOfVnDay(new Date(now.getTime() - 29 * DAY_MS));

  const [perDayRaw, topActionsRaw, topUsersRaw] = await Promise.all([
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: start30Days } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: '+07:00',
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: start30Days } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, action: '$_id', count: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: start30Days }, performedBy: { $ne: null } } },
      { $group: { _id: '$performedBy', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const perDayMap = Object.fromEntries(perDayRaw.map((r) => [r._id, r.count]));
  const perDay = days30List.map((date) => ({
    date,
    count: perDayMap[date] || 0,
  }));

  const userIds = topUsersRaw.map((u) => u._id);
  const userDocs = await User.find({ _id: { $in: userIds } })
    .select('_id fullName')
    .lean();
  const userNameMap = Object.fromEntries(userDocs.map((u) => [String(u._id), u.fullName]));

  const topUsers = topUsersRaw.map((u) => ({
    userId: u._id,
    fullName: userNameMap[String(u._id)] || 'Người dùng hệ thống',
    count: u.count,
  }));

  return {
    accounts: {
      byRole: byRoleRaw,
      newPerMonth,
    },
    baseData: {
      buildings: buildingsCount,
      apartments: apartmentsCount,
      byStatus,
      occupancyRate,
    },
    system: {
      jobs,
      uploadedFiles,
    },
    audit: {
      perDay,
      topActions: topActionsRaw,
      topUsers,
    },
  };
}
