/**
 * 地图悬停提示（2D/3D 共用）：格子上的单位/建筑/敌军/资源 → 简洁中文文案。
 * 优先级：单位 > 建筑 > 敌军兵力 > 资源（交战时最常需要看单位血量）。
 */

import type { CatalogView, PlanetRuntimeView } from '@shared/types';

import { translateUnitType } from '@/i18n/translate';
import {
  getBuildingDisplayName,
  getBuildingList,
  getItemDisplayName,
  getResourceList,
  getUnitList,
  tileContainsBuilding,
  toTilePoint,
  type PlanetRenderView,
  type TilePoint,
} from '@/features/planet-map/model';
import { FACTION_LABEL, unitFaction, type UnitFaction } from '@/features/planet-map/rts-commands';

export interface HoverInfo {
  title: string;
  /** 归属（资源无归属）。 */
  faction?: UnitFaction;
  ownerLabel?: string;
  detail?: string;
}

export interface HoverContext {
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  catalog?: CatalogView;
  playerId: string;
  darkFogHostile: boolean;
}

const at = (position: { x: number; y: number }, tile: TilePoint) => {
  const point = toTilePoint({ x: position.x, y: position.y, z: 0 });
  return point.x === tile.x && point.y === tile.y;
};

const hp = (current: number, max: number) => `血量 ${Math.max(0, Math.round(current))}/${Math.round(max)}`;

export function describeHover(context: HoverContext, tile: TilePoint): HoverInfo | null {
  const { planet, runtime, catalog, playerId, darkFogHostile } = context;
  const unit = getUnitList(planet).find((candidate) => at(candidate.position, tile));
  if (unit) {
    const faction = unitFaction(unit, playerId, darkFogHostile);
    return { title: translateUnitType(unit.type), faction, ownerLabel: FACTION_LABEL[faction], detail: hp(unit.hp, unit.max_hp) };
  }
  const building = getBuildingList(planet).find((candidate) => tileContainsBuilding(candidate, tile.x, tile.y, planet.map_width / 3));
  if (building) {
    const faction = unitFaction({ owner_id: building.owner_id, type: building.type as never }, playerId, darkFogHostile);
    return {
      title: getBuildingDisplayName(catalog, building.type),
      faction,
      ownerLabel: FACTION_LABEL[faction],
      detail: hp(building.hp, building.max_hp),
    };
  }
  const force = (runtime?.enemy_forces ?? []).find((candidate) => at(candidate.position, tile));
  if (force) {
    const faction: UnitFaction = darkFogHostile ? 'fog_hostile' : 'fog_neutral';
    return { title: '黑雾兵力', faction, ownerLabel: FACTION_LABEL[faction], detail: `强度 ${Math.round(force.strength)}` };
  }
  const resource = getResourceList(planet).find((candidate) => at(candidate.position, tile));
  if (resource) {
    const remaining = resource.remaining === undefined
      ? undefined
      : resource.max_amount
        ? `剩余 ${Math.round(resource.remaining)}/${Math.round(resource.max_amount)}`
        : `剩余 ${Math.round(resource.remaining)}`;
    return { title: getItemDisplayName(catalog, resource.kind), detail: remaining };
  }
  return null;
}
