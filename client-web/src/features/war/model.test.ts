import { describe, expect, it } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import {
  shouldRefreshWarBlueprints,
  shouldRefreshWarFleets,
  shouldRefreshWarIndustry,
  shouldRefreshWarSystemRuntime,
  shouldRefreshWarTaskForces,
  shouldRefreshWarTheaters,
} from '@/features/war/model';

function event(event_type: string, payload: Record<string, unknown> = {}): GameEventDetail {
  return { event_id: `evt-${event_type}`, tick: 1, event_type, visibility_scope: 'p1', payload };
}

describe('war SSE invalidation helpers', () => {
  it('command_result 按 command_type 精细化失效', () => {
    expect(shouldRefreshWarBlueprints(event('command_result', { command_type: 'blueprint_create' }))).toBe(true);
    expect(shouldRefreshWarBlueprints(event('command_result', { command_type: 'task_force_create' }))).toBe(false);

    expect(shouldRefreshWarIndustry(event('command_result', { command_type: 'queue_military_production' }))).toBe(true);
    expect(shouldRefreshWarIndustry(event('command_result', { command_type: 'theater_create' }))).toBe(false);

    expect(shouldRefreshWarTaskForces(event('command_result', { command_type: 'task_force_assign' }))).toBe(true);
    expect(shouldRefreshWarTaskForces(event('command_result', { command_type: 'blueprint_validate' }))).toBe(false);

    expect(shouldRefreshWarTheaters(event('command_result', { command_type: 'theater_define_zone' }))).toBe(true);
    expect(shouldRefreshWarTheaters(event('command_result', { command_type: 'fleet_attack' }))).toBe(false);

    expect(shouldRefreshWarFleets(event('command_result', { command_type: 'commission_fleet' }))).toBe(true);
    expect(shouldRefreshWarSystemRuntime(event('command_result', { command_type: 'blockade_planet' }))).toBe(true);
  });

  it('战场瞬时事件一律打 system-runtime', () => {
    for (const type of ['battle_report_generated', 'orbital_superiority_changed', 'missile_salvo_fired', 'point_defense_intercept']) {
      expect(shouldRefreshWarSystemRuntime(event(type))).toBe(true);
    }
  });

  it('舰队/封锁/登陆/补给事件按语义广覆盖', () => {
    expect(shouldRefreshWarFleets(event('fleet_commissioned'))).toBe(true);
    expect(shouldRefreshWarFleets(event('fleet_disbanded'))).toBe(true);
    expect(shouldRefreshWarTaskForces(event('landing_started'))).toBe(true);
    expect(shouldRefreshWarTaskForces(event('supply_line_disrupted'))).toBe(true);
    expect(shouldRefreshWarIndustry(event('squad_deployed'))).toBe(true);
    expect(shouldRefreshWarIndustry(event('supply_line_disrupted'))).toBe(true);
  });

  it('无关事件不触发失效', () => {
    expect(shouldRefreshWarBlueprints(event('tick_completed'))).toBe(false);
    expect(shouldRefreshWarTheaters(event('fleet_attack_started'))).toBe(false);
    expect(shouldRefreshWarIndustry(event('research_completed'))).toBe(false);
  });
});
