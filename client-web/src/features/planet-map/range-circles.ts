import type { Building, CatalogView } from '@shared/types';

import { getBuildingCatalogEntry } from '@/features/planet-map/model';

/**
 * 射程圈判定（2D/3D 共用纯函数）。
 *
 * 只回答「该画哪些圈、半径多少（tile）」；具体画法（Pixi Graphics / 球面色带）由场景层决定。
 * 半径是 server 的曼哈顿距离口径（tile 单位），绘制时按格宽换算。
 */
export interface RangeCircleSpec {
  kind: 'combat' | 'power';
  /** 半径（tile 单位，与 server 曼哈顿距离语义一致，绘制时换算）。 */
  radiusTiles: number;
}

/**
 * build 幽灵范围圈：catalog 条目带 combat_range / power_range 时各出一圈；
 * 无范围字段的建筑类型不画。
 */
export function resolveGhostRangeCircles(
  catalog: CatalogView | undefined,
  buildingType: string | undefined,
): RangeCircleSpec[] {
  if (!buildingType) {
    return [];
  }
  const entry = getBuildingCatalogEntry(catalog, buildingType);
  const circles: RangeCircleSpec[] = [];
  if (entry?.combat_range && entry.combat_range > 0) {
    circles.push({ kind: 'combat', radiusTiles: entry.combat_range });
  }
  if (entry?.power_range && entry.power_range > 0) {
    circles.push({ kind: 'power', radiusTiles: entry.power_range });
  }
  return circles;
}

/**
 * 选中建筑射程圈半径（tile）：已放置防御建筑读 runtime.functions.combat.range；
 * 无战斗能力返回 undefined。供电建筑的无线覆盖由电网图层（连线 + 覆盖标记）承担，不重复画圈。
 */
export function resolveSelectedCombatRange(building: Building | undefined | null): number | undefined {
  const range = building?.runtime?.functions?.combat?.range;
  return range !== undefined && range > 0 ? range : undefined;
}

/** 范围圈配色：攻击射程暖红、供电覆盖青色（2D/3D 同口径）。 */
export const RANGE_CIRCLE_COLORS = { combat: '#ff7a59', power: '#5fd4e8' } as const;
