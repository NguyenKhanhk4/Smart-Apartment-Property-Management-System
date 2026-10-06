import { CronRun } from '../models/index.js';

/**
 * Chạy 1 job và ghi `cron_runs` (Cron Run Tracker — phục vụ UC-A11).
 * `handler` trả về số bản ghi đã xử lý (affectedCount).
 * Dùng chung cho cả lịch tự động lẫn nút "chạy lại thủ công".
 *
 * @example await runTrackedJob('TICKET_ESCALATE', escalateOverdueTickets)
 */
export async function runTrackedJob(jobName, handler, { trigger = 'SCHEDULE' } = {}) {
  const startedAt = new Date();
  try {
    const affectedCount = Number(await handler()) || 0;
    const run = await CronRun.create({
      jobName,
      trigger,
      startedAt,
      finishedAt: new Date(),
      status: 'SUCCESS',
      affectedCount,
    });
    return run.toJSON();
  } catch (err) {
    console.error(`[cron] ${jobName} lỗi:`, err);
    const run = await CronRun.create({
      jobName,
      trigger,
      startedAt,
      finishedAt: new Date(),
      status: 'FAILED',
      errorMessage: err.message,
    });
    return run.toJSON();
  }
}
