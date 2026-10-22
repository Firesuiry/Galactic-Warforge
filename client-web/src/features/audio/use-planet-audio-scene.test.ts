import { describe, expect, it } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import { countRunningBuildings, tenseSignalFromEvent } from '@/features/audio/use-planet-audio-scene';
import type { PlanetRenderView } from '@/features/planet-map/model';

function event(type: string, payload: Record<string, unknown> = {}): GameEventDetail {
  return { event_id: `e-${type}`, tick: 500, event_type: type, visibility_scope: 'p1', payload };
}

function planetWith(buildings: Array<{ id: string; owner: string; state: string; hp?: number }>): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    buildings: Object.fromEntries(buildings.map((building) => [building.id, {
      id: building.id,
      type: 'wind_turbine',
      owner_id: building.owner,
      hp: building.hp ?? 100,
      position: { x: 0, y: 0, z: 0 },
      runtime: { state: building.state },
    }])),
  } as unknown as PlanetRenderView;
}

describe('countRunningBuildings 声床嗡鸣输入', () => {
  it('只数己方、存活、running 的建筑', () => {
    const planet = planetWith([
      { id: 'a', owner: 'p1', state: 'running' },
      { id: 'b', owner: 'p1', state: 'idle' },
      { id: 'c', owner: 'p1', state: 'running', hp: 0 },
      { id: 'd', owner: 'p2', state: 'running' },
      { id: 'e', owner: 'p1', state: 'running' },
    ]);
    expect(countRunningBuildings(planet, 'p1')).toBe(2);
  });

  it('没有行星数据时为 0', () => {
    expect(countRunningBuildings(undefined, 'p1')).toBe(0);
  });
});

describe('tenseSignalFromEvent 配乐紧张信号', () => {
  it('dark_fog_provoked 用 until_tick', () => {
    expect(tenseSignalFromEvent(event('dark_fog_provoked', { until_tick: 900 }), null, 500)).toEqual({ hostileUntilTick: 900 });
  });

  it('enemy_wave_incoming 给 600 tick 的保守窗口，且不缩短已有窗口', () => {
    expect(tenseSignalFromEvent(event('enemy_wave_incoming', {}), null, 500)).toEqual({ hostileUntilTick: 1100 });
    expect(tenseSignalFromEvent(event('enemy_wave_incoming', {}), { hostileUntilTick: 5000, nowTick: 500 }, 500))
      .toEqual({ hostileUntilTick: 5000 });
  });

  it('其它事件不产生紧张信号', () => {
    expect(tenseSignalFromEvent(event('tick_completed'), null, 500)).toBeNull();
  });
});
