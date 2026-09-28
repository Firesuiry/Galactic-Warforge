/**
 * 受袭警报（C3）：damage_applied（目标属己方）聚合告警 + enemy_wave_incoming 黑雾袭击预警。
 *
 * - damage_applied 太频繁：按目标建筑/单位 mergeKey 5s 窗口合并计数（toast store 既有机制），
 *   文案"XX 正遭受攻击"，点击深链跳转受击位置（PlanetPage 深链恢复 effect 消费 x/y → requestFocus）。
 * - 己方开火（attacker 也是己方实体）不告警。
 * - enemy_wave_incoming → 记录来袭波次（小地图红线/主图标记数据源）+ danger toast + 跳转。
 *
 * buildCombatAlert 为纯函数便于测试；notifyCombatAlert 是副作用入口（事件 id 环形去重 +
 * toast 推送 + 波次落库 + 提示音），由 use-planet-realtime 在每条 SSE 事件上调用。
 */

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { toTilePoint, type TilePoint } from '@/features/planet-map/model';
import { isNotificationsFrozen } from '@/features/notifications/notify';
import { useNotificationsStore, type ToastInput } from '@/features/notifications/store';
import { usePlanetViewStore, type IncomingWave } from '@/features/planet-map/store';
import { translateBuildingType, translateUnitType } from '@/i18n/translate';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asPosition(value: unknown): TilePoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  return x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : null;
}

function planetFocusHref(planetId: string, tile: TilePoint): string {
  return `/planet/${encodeURIComponent(planetId)}?x=${tile.x}&y=${tile.y}`;
}

export interface CombatAlertContext {
  /** 当前行星视图（归属判定；未加载时降级为不告警）。 */
  planet?: PlanetRenderView;
  playerId: string;
  planetId: string;
  /** 注入时间（测试用；缺省 Date.now）。 */
  now?: number;
}

export interface CombatAlert {
  toast?: ToastInput;
  wave?: IncomingWave;
}

/**
 * 把一条战斗事件映射为受袭警报（toast + 可选来袭波次）；无需告警返回 null。
 */
export function buildCombatAlert(
  event: GameEventDetail,
  context: CombatAlertContext,
): CombatAlert | null {
  const payload = event.payload ?? {};

  if (event.event_type === 'damage_applied') {
    const planet = context.planet;
    if (!planet) {
      return null;
    }
    const targetId = asString(payload.target_id);
    if (!targetId) {
      return null;
    }
    const building = planet.buildings?.[targetId];
    const unit = planet.units?.[targetId];
    const ownBuilding = building && building.owner_id === context.playerId ? building : null;
    const ownUnit = !ownBuilding && unit && unit.owner_id === context.playerId ? unit : null;
    if (!ownBuilding && !ownUnit) {
      return null;
    }
    // 己方开火不告警（含误伤）
    const attackerId = asString(payload.attacker_id);
    const attacker = planet.buildings?.[attackerId] ?? planet.units?.[attackerId];
    if (attacker && attacker.owner_id === context.playerId) {
      return null;
    }
    const tile = toTilePoint((ownBuilding ?? ownUnit)!.position);
    const name = ownBuilding
      ? translateBuildingType(ownBuilding.type)
      : translateUnitType(ownUnit!.type);
    return {
      toast: {
        kind: 'danger',
        title: ownBuilding ? '建筑遭受攻击' : '单位遭受攻击',
        body: `${name} (${tile.x}, ${tile.y}) 正遭受攻击`,
        href: planetFocusHref(context.planetId, tile),
        mergeKey: `base_attack:${targetId}`,
      },
    };
  }

  if (event.event_type === 'enemy_wave_incoming') {
    const from = asPosition(payload.from);
    if (!from) {
      return null;
    }
    const target = asPosition(payload.target_pos);
    const count = asNumber(payload.count) ?? 0;
    const wave: IncomingWave = {
      id: event.event_id || `enemy_wave:${asString(payload.nest_id)}:${event.tick}`,
      nestId: asString(payload.nest_id),
      from,
      target,
      count,
      level: asNumber(payload.level) ?? 1,
      at: context.now ?? Date.now(),
    };
    const focus = target ?? from;
    return {
      wave,
      toast: {
        kind: 'danger',
        title: '侦测到黑雾袭击',
        body: `${count} 个单位来自 (${from.x}, ${from.y})${target ? `，目标 (${target.x}, ${target.y})` : ''}`,
        href: planetFocusHref(context.planetId, focus),
        mergeKey: `enemy_wave:${wave.nestId || wave.id}`,
      },
    };
  }

  return null;
}

const DEDUP_BUFFER_SIZE = 64;
const recentAlertEventIds: string[] = [];

function isDuplicateAlertEvent(eventId: string): boolean {
  if (!eventId) {
    return false;
  }
  if (recentAlertEventIds.includes(eventId)) {
    return true;
  }
  recentAlertEventIds.push(eventId);
  if (recentAlertEventIds.length > DEDUP_BUFFER_SIZE) {
    recentAlertEventIds.splice(0, recentAlertEventIds.length - DEDUP_BUFFER_SIZE);
  }
  return false;
}

/**
 * SSE 事件 → 受袭警报副作用入口（use-planet-realtime 每条 game 事件调用一次）。
 * ?freeze=1 不弹 toast（截图测试约定），波次标记仍落库。
 */
export function notifyCombatAlert(event: GameEventDetail, context: CombatAlertContext): void {
  if (isDuplicateAlertEvent(event.event_id)) {
    return;
  }
  const alert = buildCombatAlert(event, context);
  if (!alert) {
    return;
  }
  if (alert.wave) {
    usePlanetViewStore.getState().recordIncomingWave(alert.wave);
  }
  if (alert.toast && !isNotificationsFrozen()) {
    const toast = useNotificationsStore.getState().push(alert.toast);
    if (toast.count === 1) {
      sfx.alert();
    }
  }
}
