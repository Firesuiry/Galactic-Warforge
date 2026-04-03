import type { ScheduleJob } from '../types.js';

interface RunDueSchedulesInput {
  now: string;
  schedules: ScheduleJob[];
  onDispatch: (schedule: ScheduleJob) => void | Promise<void>;
  onSave: (schedule: ScheduleJob) => void | Promise<void>;
}

function advanceSchedule(schedule: ScheduleJob, now: string) {
  return {
    ...schedule,
    lastRunAt: now,
    nextRunAt: new Date(Date.parse(now) + schedule.intervalSeconds * 1000).toISOString(),
    updatedAt: now,
  };
}

export async function runDueSchedules(input: RunDueSchedulesInput) {
  const updatedSchedules: ScheduleJob[] = [];

  for (const schedule of input.schedules) {
    if (!schedule.enabled || Date.parse(schedule.nextRunAt) > Date.parse(input.now)) {
      updatedSchedules.push(schedule);
      continue;
    }

    await input.onDispatch(schedule);
    const advanced = advanceSchedule(schedule, input.now);
    await input.onSave(advanced);
    updatedSchedules.push(advanced);
  }

  return updatedSchedules;
}
