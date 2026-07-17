/**
 * 战斗事件总线：把 SSE 瞬时战斗事件（导弹齐射/点防拦截/战报/伤害/击毁）
 * 从 react-query 失效管线分流一份给演出层（战场特效、后续音效）。
 *
 * 设计约束：
 * - 零依赖极简发布订阅；payload 透传，不做 schema 收窄（消费方各自解读）。
 * - 每条事件带总线内自增 seq 与本地时间戳：seq 供订阅方去重
 *   （StrictMode 双挂载/多重转发时同一事件只演出一次）。
 * - 同步派发：emit 在 SSE 回调线程内直接调用监听器，抛错只影响肇事监听器。
 */

import type { GameEventDetail } from '@shared/types';

/** 分流到总线的瞬时战斗事件类型（其余战争事件只走 react-query 失效）。 */
export const BATTLE_EVENT_TYPES: readonly string[] = [
  'missile_salvo_fired',
  'point_defense_intercept',
  'battle_report_generated',
  'damage_applied',
  'entity_destroyed',
];

const BATTLE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(BATTLE_EVENT_TYPES);

export interface BattleEvent {
  /** 总线内自增序号（从 1 开始），订阅方用它去重。 */
  seq: number;
  /** emit 时的本地时间戳（performance 时基 ms）。 */
  at: number;
  /** SSE 事件类型（见 BATTLE_EVENT_TYPES）。 */
  type: string;
  /** SSE payload 透传。 */
  payload: Record<string, unknown>;
  /** 来源 SSE 事件 id（可能为空字符串）。 */
  eventId: string;
  /** 来源 SSE 事件 tick（缺省 0）。 */
  tick: number;
}

export type BattleEventListener = (event: BattleEvent) => void;

const listeners = new Set<BattleEventListener>();
let nextSeq = 1;

export function isBattleEventType(eventType: string): boolean {
  return BATTLE_EVENT_TYPE_SET.has(eventType);
}

/** 订阅总线，返回退订函数（组件卸载时必须调用，防泄漏/重复演出）。 */
export function subscribeBattleEvents(listener: BattleEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitBattleEvent(
  type: string,
  payload: Record<string, unknown>,
  meta?: { eventId?: string; tick?: number; at?: number },
): BattleEvent {
  const event: BattleEvent = {
    seq: nextSeq,
    at: meta?.at ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    type,
    payload,
    eventId: meta?.eventId ?? '',
    tick: meta?.tick ?? 0,
  };
  nextSeq += 1;
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error('[battle-events] listener failed', error);
    }
  });
  return event;
}

/**
 * 把一条 SSE 游戏事件分流到总线；非战斗瞬时事件返回 null（调用方无需预判类型）。
 * use-war-realtime 在每条 game 事件上调用本函数，react-query 失效逻辑不受影响。
 */
export function forwardGameEventToBattleBus(event: GameEventDetail): BattleEvent | null {
  if (!isBattleEventType(event.event_type)) {
    return null;
  }
  return emitBattleEvent(event.event_type, event.payload ?? {}, {
    eventId: event.event_id,
    tick: event.tick,
  });
}
