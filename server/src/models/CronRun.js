import { CRON_JOBS, CRON_STATUS, CRON_TRIGGERS, values } from '../constants/enums.js';
import { Schema, model, schemaOptions } from './_shared.js';

// cron_runs — lịch sử chạy cron job (phục vụ UC-A11)
const cronRunSchema = new Schema(
  {
    jobName: { type: String, enum: values(CRON_JOBS), required: true },
    trigger: { type: String, enum: values(CRON_TRIGGERS), default: CRON_TRIGGERS.SCHEDULE },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    status: { type: String, enum: values(CRON_STATUS), required: true },
    affectedCount: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
  },
  schemaOptions('cron_runs', { timestamps: false }),
);

cronRunSchema.index({ jobName: 1, startedAt: -1 });

export const CronRun = model('CronRun', cronRunSchema);
