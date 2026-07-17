/**
 * 游戏音效挂接层（行星侧）：把行星 SSE 游戏事件映射为程序化音效。
 *
 * 由 use-planet-realtime 的 SSE 回调处调用（单页单实例挂载）。模块级
 * event_id 去重兜底：即便未来同事件流被多处订阅/重放，同一事件也只响一次。
 */

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';

/**
 * 建筑「完成态」判定：状态进入 running 且原因属于建成/恢复运转
 * （start=建造或升级完成开始运转，resume=手动恢复）。
 * 排除 power_restored / fault_cleared：电力波动与故障恢复不算建成，
 * 避免电网震荡时 chime 刷屏。
 */
const BUILDING_COMPLETION_REASONS: ReadonlySet<string> = new Set(['', 'start', 'resume']);

export function isBuildingCompletionEvent(payload: Record<string, unknown>): boolean {
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  return (
    payload.next_state === 'running'
    && payload.prev_state !== 'running'
    && BUILDING_COMPLETION_REASONS.has(reason)
  );
}

const DEDUP_BUFFER_SIZE = 64;
const recentEventIds: string[] = [];

function isDuplicateEvent(eventId: string): boolean {
  if (!eventId) {
    return false;
  }
  if (recentEventIds.includes(eventId)) {
    return true;
  }
  recentEventIds.push(eventId);
  if (recentEventIds.length > DEDUP_BUFFER_SIZE) {
    recentEventIds.splice(0, recentEventIds.length - DEDUP_BUFFER_SIZE);
  }
  return false;
}

/**
 * 行星游戏事件 → 音效映射（在 SSE 回调线程内同步调用）：
 * - building_state_changed（完成态）→ 建造完成 chime
 * - research_completed → 研究完成琶音
 * - production_alert → 告警双脉冲
 * - rocket_launched → 发射音
 */
export function playPlanetEventAudio(event: GameEventDetail): void {
  if (isDuplicateEvent(event.event_id)) {
    return;
  }
  switch (event.event_type) {
    case 'building_state_changed':
      if (isBuildingCompletionEvent(event.payload ?? {})) {
        sfx.buildComplete();
      }
      break;
    case 'research_completed':
      sfx.researchComplete();
      break;
    case 'production_alert':
      sfx.alert();
      break;
    case 'rocket_launched':
      sfx.fire();
      break;
    default:
      break;
  }
}
