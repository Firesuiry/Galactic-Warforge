import type { ScheduleJob } from '@gw/shared/agent-gateway';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createScheduleStore(root: string) {
  return {
    list: () => listJsonFiles<ScheduleJob>(root),
    get: (id: string) => readJsonFile<ScheduleJob>(root, `${id}.json`),
    save: (schedule: ScheduleJob) => writeJsonFile(root, `${schedule.id}.json`, schedule),
  };
}
