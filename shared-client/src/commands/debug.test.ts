import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { cmdAlertSnapshot, runSaveCommand } from './debug.js';

describe('save command', () => {
  it('shows help', async () => {
    const out = await runSaveCommand(['--help'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /save \[--reason <text>\]/);
  });

  it('prints save result', async () => {
    const out = await runSaveCommand([], async () => ({
      ok: true,
      tick: 64,
      saved_at: '2026-04-02T12:00:00Z',
      path: '/tmp/game/save.json',
      trigger: 'manual',
    }));
    assert.match(out, /Saved at tick 64/);
    assert.match(out, /\/tmp\/game\/save\.json/);
  });

  it('prints formatted error', async () => {
    const out = await runSaveCommand([], async () => {
      throw new Error('disk full');
    });
    assert.match(out, /disk full/);
  });
});

describe('alert_snapshot 中文文案', () => {
  it('--active-only 透传 active_only，已解除条目标「（已解除）」', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const out = await cmdAlertSnapshot(['--active-only', '--limit', '5'], {
      api: {
        fetchAlertSnapshot: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            available_from_tick: 1,
            has_more: false,
            alerts: [
              {
                alert_id: 'a-active', tick: 400, player_id: 'p1', building_id: 'b-9',
                building_type: 'arc_smelter', alert_type: 'output_blocked',
                severity: 'warning', message: '建筑 b-9：产物阻塞', metrics: {}, details: {},
              },
              {
                alert_id: 'a-resolved', tick: 100, player_id: 'p1', building_id: 'b-1',
                building_type: 'arc_smelter', alert_type: 'output_blocked',
                severity: 'warning', message: '建筑 b-1：产物阻塞', metrics: {}, details: {},
                active: false, resolved_tick: 200,
              },
            ],
          };
        },
      },
    } as never);
    assert.deepEqual(calls[0], { after_alert_id: undefined, since_tick: undefined, active_only: true, limit: 5 });
    assert.match(out, /Earliest recorded alert tick 1/);
    assert.match(out, /产物阻塞/);
    assert.match(out, /（已解除）/);
  });

  it('传送带堵塞带位置/件数/时长，不裸显 belt_blocked', async () => {
    const out = await cmdAlertSnapshot([], {
      api: {
        fetchAlertSnapshot: async () => ({
          available_from_tick: 1,
          has_more: false,
          alerts: [{
            alert_id: 'alert-400-b-9-belt_blocked',
            tick: 400,
            player_id: 'p1',
            building_id: 'b-9',
            building_type: 'conveyor_belt_mk1',
            alert_type: 'belt_blocked',
            severity: 'warning',
            message: '建筑 b-9：传送带被堵，物品运不出去',
            metrics: {},
            details: { position: { x: 12, y: 7, z: 0 }, queued_items: 5, blocked_ticks: 300 },
          }],
        }),
      },
    } as never);
    assert.match(out, /传送带堵塞 \(12, 7\)：5 件货 30 秒没动/);
    assert.match(out, /alert_type=belt_blocked building=b-9/);
  });

  it('其余告警类型给中文标签，同样不裸显枚举 id', async () => {
    const out = await cmdAlertSnapshot([], {
      api: {
        fetchAlertSnapshot: async () => ({
          available_from_tick: 1,
          has_more: false,
          alerts: [{
            alert_id: 'a-1',
            tick: 10,
            player_id: 'p1',
            building_id: 'b-1',
            building_type: 'arc_smelter',
            alert_type: 'output_blocked',
            severity: 'warning',
            message: '建筑 b-1：产物阻塞',
            metrics: {},
            details: {},
          }],
        }),
      },
    } as never);
    assert.match(out, /产物阻塞/);
    assert.match(out, /alert_type=output_blocked building=b-1/);
  });
});
