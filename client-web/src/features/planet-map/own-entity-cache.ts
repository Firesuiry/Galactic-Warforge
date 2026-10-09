/**
 * 己方实体累积缓存（跨场景窗口）。
 *
 * 场景查询（GET /world/planets/{id}/scene）只返回**相机窗口内**的实体：镜头一移动，
 * 窗口外的己方建筑/单位就从响应里消失。而新手引导（features/onboarding/war-guide）
 * 问的是「玩家有没有建过/造过某样东西」，一旦用窗口数据推导，普通平移就会让引导
 * 从 4/8 回退到 1/8（试玩报告 2026-10-07 阻断级 4：镜头移到没有己方实体的窗口后引导回退）。
 *
 * 这里按 id 累积「见过的己方实体」，只增不减，供引导这类**历史性**推导使用。
 * 渲染与交互仍必须用窗口数据——那里要回答的是「此刻画面上有什么」。
 *
 * 失效条件：行星变化**或对局变化**（game-identity 由 /games/current 的 started_at+map_seed 得到，
 * 见 features/lobby/current-game 的 gameIdentityOf）。同一颗行星开新局时实体 id 会复用，
 * 只按 planetId 判断会把上一局的建筑当成这一局的成绩点亮引导。
 */

import type { Building, Unit } from '@shared/types';

import { getBuildingList, getUnitList, type PlanetRenderView } from '@/features/planet-map/model';
import { isDarkFogUnit } from '@/features/planet-map/rts-commands';

export interface OwnEntityCache {
  /** 缓存归属的行星：切换行星时整份作废。 */
  planetId: string;
  /** 缓存归属的对局（started_at::map_seed）：同行星开新局时整份作废，见 gameIdentityOf。 */
  gameIdentity: string;
  buildings: Map<string, Building>;
  units: Map<string, Unit>;
  /** 见过的黑雾单位：新手引导的「黑雾是中立的」提示靠它，同样不能因窗口平移而消失。 */
  fogUnits: Map<string, Unit>;
}

export function createOwnEntityCache(): OwnEntityCache {
  return { planetId: '', gameIdentity: '', buildings: new Map(), units: new Map(), fogUnits: new Map() };
}

/**
 * 把一帧窗口数据并入缓存（原地更新并返回，方便直接放在 ref 上）。
 *
 * - 只收己方与黑雾、hp > 0 的实体（阵亡的不进缓存，避免引导被死人点亮）；
 * - 已缓存过的实体不会被窗口缺失删除——「建过」是历史事实，镜头平移不改变它；
 * - planetId 或 gameIdentity 变化（换行星 / 开新局）时清空重来；
 * - gameIdentity 为空（离线样例没有 /games/current）时不做对局判定，只按行星作废。
 */
export function accumulateOwnEntities(
  cache: OwnEntityCache,
  planet: PlanetRenderView | undefined,
  playerId: string,
  gameIdentity = '',
): OwnEntityCache {
  if (!planet) {
    return cache;
  }
  const gameChanged = Boolean(gameIdentity) && cache.gameIdentity !== gameIdentity;
  if (cache.planetId !== planet.planet_id || gameChanged) {
    cache.planetId = planet.planet_id;
    cache.buildings.clear();
    cache.units.clear();
    cache.fogUnits.clear();
  }
  if (gameIdentity) {
    cache.gameIdentity = gameIdentity;
  }
  for (const building of getBuildingList(planet)) {
    if (building.owner_id === playerId && building.hp > 0) {
      cache.buildings.set(building.id, building);
    }
  }
  for (const unit of getUnitList(planet)) {
    if (unit.hp <= 0) {
      continue;
    }
    if (isDarkFogUnit(unit)) {
      cache.fogUnits.set(unit.id, unit);
    } else if (unit.owner_id === playerId) {
      cache.units.set(unit.id, unit);
    }
  }
  return cache;
}

/** 累积结果的稳定数组视图（按 id 排序，便于引导推导与测试断言）。 */
export function ownEntitySnapshot(cache: OwnEntityCache): { buildings: Building[]; units: Unit[]; fogUnits: Unit[] } {
  const byId = <T extends { id: string }>(values: Iterable<T>) =>
    [...values].sort((left, right) => left.id.localeCompare(right.id));
  return {
    buildings: byId(cache.buildings.values()),
    units: byId(cache.units.values()),
    fogUnits: byId(cache.fogUnits.values()),
  };
}
