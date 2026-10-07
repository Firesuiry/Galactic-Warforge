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

import { surfaceDistanceWithin } from '@shared/surface';
import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { toTilePoint, type TilePoint } from '@/features/planet-map/model';
import { isNotificationsFrozen } from '@/features/notifications/notify';
import { useNotificationsStore, type ToastInput } from '@/features/notifications/store';
import { usePlanetViewStore, type IncomingWave } from '@/features/planet-map/store';
import { unitFaction } from '@/features/planet-map/rts-commands';
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

function planetFocusHref(planetId: string, tile: TilePoint, currentSearch?: string): string {
  // 保留当前视图参数（view=2d/quality 等），避免跳转后意外切换 2D/3D 视图
  const params = new URLSearchParams(currentSearch ?? '');
  params.delete('build');
  params.delete('workflow');
  params.set('x', String(tile.x));
  params.set('y', String(tile.y));
  return `/planet/${encodeURIComponent(planetId)}?${params.toString()}`;
}

export interface CombatAlertContext {
  /** 当前行星视图（归属判定；未加载时降级为不告警）。 */
  planet?: PlanetRenderView;
  playerId: string;
  planetId: string;
  /** 当前 URL 查询串（保留 view 等视图参数；由副作用层注入，测试可不给）。 */
  currentSearch?: string;
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
        href: planetFocusHref(context.planetId, tile, context.currentSearch),
        locate: { planetId: context.planetId, ...tile },
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
        href: planetFocusHref(context.planetId, focus, context.currentSearch),
        locate: { planetId: context.planetId, ...focus },
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
  const alert = buildCombatAlert(event, {
    ...context,
    currentSearch: context.currentSearch
      ?? (typeof window !== 'undefined' ? window.location.search : ''),
  });
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

/** 敌袭预警半径（格）：敌对单位进入己方建筑此距离内即告警。 */
export const APPROACH_ALERT_RADIUS = 20;
/** 同一建筑的敌袭预警冷却（ms）。 */
export const APPROACH_ALERT_COOLDOWN_MS = 30_000;

export interface ApproachingThreat {
  buildingId: string;
  buildingType: string;
  buildingTile: TilePoint;
  /** 最近一个来犯单位的位置。 */
  threatTile: TilePoint;
  count: number;
}

/**
 * 逼近己方建筑的敌对单位：敌方玩家单位，以及对我敌对的黑雾（中立黑雾不算）。
 * 每个来犯单位归到最近的己方建筑；结果按建筑聚合。
 */
export function findApproachingThreats(
  planet: PlanetRenderView,
  playerId: string,
  darkFogHostile: boolean,
  radius = APPROACH_ALERT_RADIUS,
): ApproachingThreat[] {
  // 部分场景（fixture/旧快照）缺 surface 元数据：按立方体球 3 面宽推算
  const faceSize = planet.surface?.face_size ?? planet.map_width / 3;
  const own = Object.values(planet.buildings ?? {}).filter((building) => building.owner_id === playerId && building.hp > 0);
  if (own.length === 0) return [];
  const byBuilding = new Map<string, ApproachingThreat & { best: number }>();
  for (const unit of Object.values(planet.units ?? {})) {
    if (unit.hp <= 0) continue;
    const faction = unitFaction(unit, playerId, darkFogHostile);
    if (faction !== 'enemy' && faction !== 'fog_hostile') continue;
    let nearest: { building: typeof own[number]; distance: number } | undefined;
    for (const building of own) {
      const distance = surfaceDistanceWithin(unit.position, building.position, faceSize, radius);
      if (distance !== undefined && (!nearest || distance < nearest.distance)) nearest = { building, distance };
    }
    if (!nearest) continue;
    const entry = byBuilding.get(nearest.building.id);
    if (entry) {
      entry.count += 1;
      if (nearest.distance < entry.best) {
        entry.best = nearest.distance;
        entry.threatTile = toTilePoint(unit.position);
      }
    } else {
      byBuilding.set(nearest.building.id, {
        buildingId: nearest.building.id,
        buildingType: nearest.building.type,
        buildingTile: toTilePoint(nearest.building.position),
        threatTile: toTilePoint(unit.position),
        count: 1,
        best: nearest.distance,
      });
    }
  }
  return [...byBuilding.values()].map(({ best: _best, ...threat }) => threat);
}

const lastApproachAlertAt = new Map<string, number>();

/**
 * 敌袭预警副作用入口（PlanetPage 在场景/黑雾敌对状态更新时调用）：
 * 每个受威胁建筑冷却期内只告警一次；toast 带「定位」，小地图闪点。
 */
export function notifyApproachingThreats(
  planet: PlanetRenderView,
  playerId: string,
  darkFogHostile: boolean,
  now = Date.now(),
): void {
  for (const threat of findApproachingThreats(planet, playerId, darkFogHostile)) {
    const last = lastApproachAlertAt.get(threat.buildingId);
    if (last !== undefined && now - last < APPROACH_ALERT_COOLDOWN_MS) continue;
    lastApproachAlertAt.set(threat.buildingId, now);
    usePlanetViewStore.getState().recordIncomingWave({
      id: `approach:${threat.buildingId}:${now}`,
      nestId: '',
      from: threat.threatTile,
      target: threat.buildingTile,
      count: threat.count,
      level: 1,
      at: now,
    });
    if (isNotificationsFrozen()) continue;
    useNotificationsStore.getState().push({
      kind: 'danger',
      title: '敌袭预警',
      body: `${threat.count} 个敌对单位逼近${translateBuildingType(threat.buildingType)} (${threat.buildingTile.x}, ${threat.buildingTile.y})`,
      locate: { planetId: planet.planet_id, ...threat.threatTile },
      mergeKey: `approach:${threat.buildingId}`,
      sticky: true,
    }, now);
    sfx.alert();
  }
}
