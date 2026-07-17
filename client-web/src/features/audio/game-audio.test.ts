import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import type { BattleEvent } from '@/engine/battle-events';
import { sfx } from '@/engine/audio';
import { isBuildingCompletionEvent, playPlanetEventAudio } from '@/features/audio/planet-audio';
import { playBattleEventAudio } from '@/features/audio/use-game-audio';

vi.mock('@/engine/audio', () => ({
  sfx: {
    fire: vi.fn(),
    explosion: vi.fn(),
    intercept: vi.fn(),
    commandOk: vi.fn(),
    commandFail: vi.fn(),
    buildComplete: vi.fn(),
    researchComplete: vi.fn(),
    alert: vi.fn(),
    uiClick: vi.fn(),
  },
}));

function battleEvent(type: string, payload: Record<string, unknown> = {}): BattleEvent {
  return { seq: 1, at: 0, type, payload, eventId: `be-${type}`, tick: 0 };
}

let nextEventId = 1;
function gameEvent(eventType: string, payload: Record<string, unknown> = {}, eventId?: string): GameEventDetail {
  const id = eventId ?? `evt-audio-${nextEventId}`;
  nextEventId += 1;
  return {
    event_id: id,
    tick: 100,
    event_type: eventType,
    visibility_scope: 'p1',
    payload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playBattleEventAudio 战斗事件 → 音效', () => {
  it('missile_salvo_fired → fire', () => {
    playBattleEventAudio(battleEvent('missile_salvo_fired', { fleet_id: 'f1' }));
    expect(sfx.fire).toHaveBeenCalledTimes(1);
  });

  it('point_defense_intercept → intercept', () => {
    playBattleEventAudio(battleEvent('point_defense_intercept', { intercepted: 2 }));
    expect(sfx.intercept).toHaveBeenCalledTimes(1);
  });

  it('battle_report_generated：target_destroyed 升级大爆炸，否则小爆炸', () => {
    playBattleEventAudio(battleEvent('battle_report_generated', { report: { target_destroyed: true } }));
    expect(sfx.explosion).toHaveBeenCalledWith(true);

    playBattleEventAudio(battleEvent('battle_report_generated', { report: { target_destroyed: false } }));
    expect(sfx.explosion).toHaveBeenCalledWith(false);

    playBattleEventAudio(battleEvent('battle_report_generated', {}));
    expect(sfx.explosion).toHaveBeenCalledWith(false);
    expect(sfx.explosion).toHaveBeenCalledTimes(3);
  });

  it('entity_destroyed → 大爆炸', () => {
    playBattleEventAudio(battleEvent('entity_destroyed', { entity_id: 'e1' }));
    expect(sfx.explosion).toHaveBeenCalledWith(true);
  });

  it('damage_applied 不映射（击毁演出已由战报承担）', () => {
    playBattleEventAudio(battleEvent('damage_applied', { damage: 5 }));
    expect(sfx.fire).not.toHaveBeenCalled();
    expect(sfx.explosion).not.toHaveBeenCalled();
    expect(sfx.intercept).not.toHaveBeenCalled();
  });
});

describe('isBuildingCompletionEvent 建筑完成态判定', () => {
  it('idle → running（start/空原因/resume）算完成', () => {
    expect(isBuildingCompletionEvent({ prev_state: 'idle', next_state: 'running', reason: 'start' })).toBe(true);
    expect(isBuildingCompletionEvent({ prev_state: 'idle', next_state: 'running' })).toBe(true);
    expect(isBuildingCompletionEvent({ prev_state: 'paused', next_state: 'running', reason: 'resume' })).toBe(true);
  });

  it('电力恢复/故障清除/非 running 终态不算完成', () => {
    expect(isBuildingCompletionEvent({ prev_state: 'no_power', next_state: 'running', reason: 'power_restored' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'error', next_state: 'running', reason: 'fault_cleared' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'running', next_state: 'paused', reason: 'pause' })).toBe(false);
    expect(isBuildingCompletionEvent({ prev_state: 'running', next_state: 'running', reason: 'start' })).toBe(false);
  });
});

describe('playPlanetEventAudio 行星事件 → 音效', () => {
  it('building_state_changed 完成态 → buildComplete；非完成态不响', () => {
    playPlanetEventAudio(gameEvent('building_state_changed', {
      prev_state: 'idle', next_state: 'running', reason: 'start',
    }));
    expect(sfx.buildComplete).toHaveBeenCalledTimes(1);

    playPlanetEventAudio(gameEvent('building_state_changed', {
      prev_state: 'running', next_state: 'paused', reason: 'pause',
    }));
    expect(sfx.buildComplete).toHaveBeenCalledTimes(1);
  });

  it('research_completed → researchComplete', () => {
    playPlanetEventAudio(gameEvent('research_completed', { tech_id: 't1' }));
    expect(sfx.researchComplete).toHaveBeenCalledTimes(1);
  });

  it('production_alert → alert', () => {
    playPlanetEventAudio(gameEvent('production_alert', { alert: { alert_id: 'a1' } }));
    expect(sfx.alert).toHaveBeenCalledTimes(1);
  });

  it('rocket_launched → fire', () => {
    playPlanetEventAudio(gameEvent('rocket_launched', { rocket_id: 'r1' }));
    expect(sfx.fire).toHaveBeenCalledTimes(1);
  });

  it('无关事件不响', () => {
    playPlanetEventAudio(gameEvent('tick_completed', {}));
    playPlanetEventAudio(gameEvent('resource_changed', {}));
    expect(sfx.buildComplete).not.toHaveBeenCalled();
    expect(sfx.researchComplete).not.toHaveBeenCalled();
    expect(sfx.alert).not.toHaveBeenCalled();
    expect(sfx.fire).not.toHaveBeenCalled();
  });

  it('同一 event_id 重复到达只响一次', () => {
    const event = gameEvent('production_alert', { alert: { alert_id: 'a2' } }, 'evt-dup-1');
    playPlanetEventAudio(event);
    playPlanetEventAudio(event);
    playPlanetEventAudio(gameEvent('production_alert', { alert: { alert_id: 'a2' } }, 'evt-dup-1'));
    expect(sfx.alert).toHaveBeenCalledTimes(1);
  });
});
