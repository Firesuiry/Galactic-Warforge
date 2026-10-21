/**
 * 游戏音效挂接层（行星侧）：把行星 SSE 游戏事件映射为程序化音效。
 *
 * 由 use-planet-realtime 的 SSE 回调处调用（单页单实例挂载）。模块级
 * event_id 去重兜底：即便未来同事件流被多处订阅/重放，同一事件也只响一次。
 */

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import { isPowerAlertType } from '@/features/notifications/event-toasts';
import { spatialForTile, type TilePoint } from '@/features/audio/spatial';

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

/** payload 里的格坐标（position / target_pos / from），与 battle-events 同口径。 */
function payloadTile(payload: Record<string, unknown>): TilePoint | null {
  for (const key of ['position', 'target_pos', 'from']) {
    const value = payload[key];
    if (typeof value === 'object' && value !== null) {
      const point = value as { x?: unknown; y?: unknown };
      if (typeof point.x === 'number' && typeof point.y === 'number') return { x: point.x, y: point.y };
    }
  }
  return null;
}

/**
 * 行星游戏事件 → 音效映射（在 SSE 回调线程内同步调用）：
 * - building_state_changed（完成态）→ 建造完成 chime
 * - research_completed → 研究完成琶音
 * - production_alert → 告警双脉冲
 * - rocket_launched → 导弹开火音
 * - construction_paused / construction_resumed → 指令成功/失败短音
 * - dark_fog_provoked / dark_fog_calmed → 告警 / 通知
 * 带格坐标的事件（position/target_pos/from）按空间衰减播放。
 */
export function playPlanetEventAudio(event: GameEventDetail): void {
  if (isDuplicateEvent(event.event_id)) {
    return;
  }
  const payload = event.payload ?? {};
  const spatial = spatialForTile(payloadTile(payload));
  switch (event.event_type) {
    case 'building_state_changed':
      if (isBuildingCompletionEvent(payload)) {
        sfx.buildComplete();
      }
      break;
    case 'research_completed':
      sfx.researchComplete();
      break;
    case 'production_alert':
      // 缺电告警（电力类）与普通产线告警用不同提示音，便于不看屏幕时分辨。
      const alertType = typeof payload.alert_type === 'string'
        ? payload.alert_type
        : (payload.alert as { alert_type?: string } | undefined)?.alert_type;
      if (isPowerAlertType(alertType)) {
        sfx.alert();
      } else {
        sfx.notify();
      }
      break;
    case 'rocket_launched':
      sfx.fireMissile(spatial);
      break;
    case 'construction_paused':
      sfx.commandFail();
      break;
    case 'construction_resumed':
      sfx.commandOk();
      break;
    case 'dark_fog_provoked':
      sfx.alert();
      break;
    case 'dark_fog_calmed':
      sfx.notify();
      break;
    default:
      break;
  }
}
