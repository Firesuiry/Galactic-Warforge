import { describe, expect, it, vi } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import {
  BATTLE_EVENT_TYPES,
  emitBattleEvent,
  forwardGameEventToBattleBus,
  isBattleEventType,
  subscribeBattleEvents,
  type BattleEvent,
} from '@/engine/battle-events';

function gameEvent(eventType: string, payload: Record<string, unknown> = {}): GameEventDetail {
  return {
    event_id: `evt-${eventType}`,
    tick: 321,
    event_type: eventType,
    visibility_scope: 'p1',
    payload,
  };
}

describe('battle-events 总线', () => {
  it('BATTLE_EVENT_TYPES 覆盖五类瞬时战斗事件', () => {
    expect([...BATTLE_EVENT_TYPES].sort()).toEqual([
      'battle_report_generated',
      'damage_applied',
      'entity_destroyed',
      'missile_salvo_fired',
      'point_defense_intercept',
    ]);
    expect(isBattleEventType('missile_salvo_fired')).toBe(true);
    expect(isBattleEventType('tick_completed')).toBe(false);
  });

  it('emit → subscribe 收到事件，payload 透传且 seq 自增', () => {
    const received: BattleEvent[] = [];
    const unsubscribe = subscribeBattleEvents((event) => received.push(event));

    const first = emitBattleEvent('missile_salvo_fired', { fleet_id: 'fleet-1' }, { eventId: 'e1', tick: 10 });
    const second = emitBattleEvent('damage_applied', { damage: 3 });
    unsubscribe();

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(first);
    expect(received[0].payload).toEqual({ fleet_id: 'fleet-1' });
    expect(received[0].eventId).toBe('e1');
    expect(received[0].tick).toBe(10);
    expect(received[0].at).toBeGreaterThan(0);
    expect(second.seq).toBe(first.seq + 1);
  });

  it('退订后不再收到事件', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBattleEvents(listener);
    unsubscribe();

    emitBattleEvent('entity_destroyed', { entity_id: 'x' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('单个监听器抛错不影响其他监听器', () => {
    const healthy = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsubscribeBad = subscribeBattleEvents(() => {
      throw new Error('boom');
    });
    const unsubscribeGood = subscribeBattleEvents(healthy);

    emitBattleEvent('point_defense_intercept', {});
    expect(healthy).toHaveBeenCalledTimes(1);

    unsubscribeBad();
    unsubscribeGood();
    errorSpy.mockRestore();
  });

  it('forwardGameEventToBattleBus：战斗事件入总线，其余返回 null', () => {
    const received: BattleEvent[] = [];
    const unsubscribe = subscribeBattleEvents((event) => received.push(event));

    const forwarded = forwardGameEventToBattleBus(
      gameEvent('battle_report_generated', { battle_id: 'battle-1', fleet_id: 'fleet-1' }),
    );
    expect(forwarded).not.toBeNull();
    expect(forwarded?.type).toBe('battle_report_generated');
    expect(forwarded?.eventId).toBe('evt-battle_report_generated');
    expect(forwarded?.tick).toBe(321);
    expect(received).toHaveLength(1);

    expect(forwardGameEventToBattleBus(gameEvent('tick_completed'))).toBeNull();
    expect(forwardGameEventToBattleBus(gameEvent('orbital_superiority_changed'))).toBeNull();
    expect(received).toHaveLength(1);

    unsubscribe();
  });
});
