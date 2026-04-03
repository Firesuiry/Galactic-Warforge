import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runDueSchedules } from './scheduler.js';

describe('scheduler', () => {
  it('dispatches due schedules and advances nextRunAt', async () => {
    const dispatched: string[] = [];
    const saved: string[] = [];

    const schedules = await runDueSchedules({
      now: '2026-04-03T12:00:00.000Z',
      schedules: [{
        id: 'schedule-a',
        workspaceId: 'workspace-default',
        name: 'A星巡检',
        creatorType: 'player',
        creatorId: 'p1',
        targetType: 'conversation',
        targetId: 'conv-a',
        intervalSeconds: 300,
        messageTemplate: '@总管 每五分钟检查一次星球A',
        enabled: true,
        nextRunAt: '2026-04-03T12:00:00.000Z',
        createdAt: '2026-04-03T11:55:00.000Z',
        updatedAt: '2026-04-03T11:55:00.000Z',
      }],
      onDispatch(schedule) {
        dispatched.push(schedule.id);
      },
      onSave(schedule) {
        saved.push(schedule.nextRunAt);
      },
    });

    assert.equal(dispatched[0], 'schedule-a');
    assert.equal(saved[0], '2026-04-03T12:05:00.000Z');
    assert.equal(schedules[0]?.lastRunAt, '2026-04-03T12:00:00.000Z');
  });
});
