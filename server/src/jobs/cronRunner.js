import { CRON_STATUS, CRON_TRIGGERS } from '../constants/enums.js';
import { CronRun } from '../models/index.js';

const MAX_LISTED_FAILURES = 10;

/** Ghép danh sách lỗi từng bản ghi thành errorMessage ngắn gọn */
function describeFailures(failed) {
  const list = failed
    .slice(0, MAX_LISTED_FAILURES)
    .map((f) => f.message ?? String(f))
    .join('; ');
  const more = failed.length > MAX_LISTED_FAILURES ? `; … và ${failed.length - MAX_LISTED_FAILURES} lỗi khác` : '';
  return `Lỗi ${failed.length} bản ghi: ${list}${more}`;
}

/**
 * Chạy 1 job và ghi `cron_runs` (Cron Run Tracker — phục vụ UC-A11).
 * `handler` trả về số bản ghi đã xử lý (affectedCount), hoặc `{ affectedCount, failed: [{ message }] }`
 * khi một số bản ghi lỗi nhưng các bản ghi khác vẫn xử lý xong → FAILED nhưng giữ affectedCount.
 * Dùng chung cho cả lịch tự động lẫn nút "chạy lại thủ công".
 *
 * @example await runTrackedJob('TICKET_ESCALATE', escalateOverdueTickets)
 */
export async function runTrackedJob(jobName, handler, { trigger = CRON_TRIGGERS.SCHEDULE } = {}) {
  const startedAt = new Date();
  const record = (fields) => CronRun.create({ jobName, trigger, startedAt, finishedAt: new Date(), ...fields }).then((r) => r.toJSON());
  try {
    const result = await handler();
    const affectedCount = Number(typeof result === 'object' && result ? result.affectedCount : result) || 0;
    const failed = (typeof result === 'object' && result?.failed) || [];
    if (failed.length) {
      console.error(`[cron] ${jobName}: ${describeFailures(failed)}`);
      return record({ status: CRON_STATUS.FAILED, affectedCount, errorMessage: describeFailures(failed) });
    }
    return record({ status: CRON_STATUS.SUCCESS, affectedCount });
  } catch (err) {
    console.error(`[cron] ${jobName} lỗi:`, err);
    return record({ status: CRON_STATUS.FAILED, errorMessage: err.message });
  }
}
