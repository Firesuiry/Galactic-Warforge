/**
 * 物流方向纯逻辑：传送带 / 分拣器 / 分流器的箭头方向推导与「流向」文案。
 *
 * 试玩 1011 第六轮：玩家铺了 9 段传送带却一次没接成产线，因为看不出带子朝哪、
 * 分拣器往哪搬。这里把「方向从哪来、往哪去」收敛成一份事实来源，供：
 * - 3D 流向箭头（three/conveyor-geometry）、
 * - 3D 分拣器顶面箭头（planet-three-scene）、
 * - 3D/2D 建造 ghost 朝向箭头、
 * - 2D 平面战术图方向纹（planet-building-sprites）、
 * - 选中详情「流向」行（PlanetPanels）
 * 共用，避免多套实现各自猜方向。
 *
 * 数据口径全部来自服务端：传送带 conveyor.input/output（建成时 construction.go
 * 已把 auto 落成实方向），分拣器/分流器 sorter|splitter.input_directions/output_directions
 * （ApplyBuildingRotation 已按建造旋转改写）。缺失即「未配置」，绝不替玩家猜一个方向。
 */

import { surfaceStep } from '@shared/surface';
import type { Building, CatalogView, ConveyorDirection } from '@shared/types';

import { getBuildingDisplayName, getBuildingFootprint, toTilePoint, type TilePoint } from './model';

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';

export const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];

export const DIRECTION_NAMES: Record<CardinalDirection, string> = { north: '北', east: '东', south: '南', west: '西' };

export const OPPOSITE_DIRECTION: Record<CardinalDirection, CardinalDirection> = { north: 'south', east: 'west', south: 'north', west: 'east' };

/** 面内格步进偏移（tile 坐标系：x 向东、y 向南）。 */
const TILE_OFFSETS: Record<CardinalDirection, { x: number; y: number }> = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
};

export function isCardinalDirection(direction: ConveyorDirection | undefined): direction is CardinalDirection {
  return direction === 'north' || direction === 'east' || direction === 'south' || direction === 'west';
}

/** 面内单位向量（2D 战术图/3D 局部平面共用；y 向南为正）。 */
export function directionVector(direction: CardinalDirection): { x: number; y: number } {
  return TILE_OFFSETS[direction];
}

/** 沿 direction 走一格后的 tile 与「跨面后仍等价的朝向」（跨立方体接缝时会翻转）。 */
export function stepTile(tile: TilePoint, direction: CardinalDirection, faceSize: number): { tile: TilePoint; direction: CardinalDirection } {
  const step = surfaceStep(tile, direction, faceSize);
  return { tile: step.tile, direction: isCardinalDirection(step.direction) ? step.direction : direction };
}

function cardinals(directions: readonly ConveyorDirection[] | undefined): CardinalDirection[] {
  return (directions ?? []).filter(isCardinalDirection);
}

/** 物流建筑的一个有向箭头：从 from 侧取货，往 to 侧放货（from 为空表示方向未知）。 */
export interface LogisticsArrow {
  from: CardinalDirection | null;
  to: CardinalDirection;
}

export interface LogisticsArrows {
  arrows: LogisticsArrow[];
  /** 四向皆可（未配置方向）：没有单一流向，渲染为枢纽标记而不是箭头。 */
  omnidirectional: boolean;
}

const OMNIDIRECTIONAL: LogisticsArrows = { arrows: [], omnidirectional: true };

/** 一个 (取料,放料) 组合集合 → 箭头列表；超过 4 组说明四向皆可，交给枢纽标记。 */
function arrowsFromPairs(inputs: readonly CardinalDirection[], outputs: readonly CardinalDirection[]): LogisticsArrows {
  if (outputs.length === 0) return { arrows: [], omnidirectional: false };
  const pairs: LogisticsArrow[] = [];
  for (const to of outputs) {
    for (const from of inputs) {
      if (from === to) continue;
      pairs.push({ from, to });
    }
  }
  if (pairs.length === 0) return inputs.length === 0 ? { arrows: outputs.map(to => ({ from: null, to })), omnidirectional: false } : OMNIDIRECTIONAL;
  if (pairs.length > 4) return OMNIDIRECTIONAL;
  return { arrows: pairs, omnidirectional: false };
}

/**
 * 物流建筑的有向箭头（传送带 / 分拣器 / 分流器通用）。
 * 非物流建筑返回空（omnidirectional=false）。
 */
export function logisticsArrows(building: Pick<Building, 'type' | 'conveyor' | 'sorter' | 'splitter'>): LogisticsArrows {
  if (building.splitter) {
    return arrowsFromPairs(cardinals(building.splitter.input_directions), cardinals(building.splitter.output_directions));
  }
  if (building.sorter) {
    return arrowsFromPairs(cardinals(building.sorter.input_directions), cardinals(building.sorter.output_directions));
  }
  if (!building.conveyor) return { arrows: [], omnidirectional: false };
  const output = isCardinalDirection(building.conveyor.output) ? building.conveyor.output : null;
  if (!output) return { arrows: [], omnidirectional: false };
  const input = isCardinalDirection(building.conveyor.input) && building.conveyor.input !== output
    ? building.conveyor.input
    : OPPOSITE_DIRECTION[output];
  return { arrows: [{ from: input, to: output }], omnidirectional: false };
}

/** 传送带输出方向；auto / 缺失返回 null（不猜）。 */
export function beltOutputDirection(building: Pick<Building, 'conveyor'>): CardinalDirection | null {
  return isCardinalDirection(building.conveyor?.output) ? building.conveyor!.output as CardinalDirection : null;
}

/** 物流建筑是否是分拣器/分流器（走「顶面箭头 + 过滤物品」渲染路径）。 */
export function isSorterBuilding(building: Pick<Building, 'type' | 'sorter' | 'splitter'>): boolean {
  return Boolean(building.sorter || building.splitter || /sorter|splitter/.test(building.type));
}

/**
 * 2D 方向纹朝向：单一方向的物流建筑取输出侧；四向皆可返回 null（改画枢纽标记）。
 * 与 planet-logistics-flow.beltFlowVector 的「auto 回退 east」不同——那里是货物流向的近似，
 * 这里要的是真实方向，未配置就不画箭头。
 */
export function resolveLogisticsDirection(building: Pick<Building, 'type' | 'conveyor' | 'sorter' | 'splitter'>): CardinalDirection | null {
  const { arrows, omnidirectional } = logisticsArrows(building);
  if (omnidirectional) return null;
  return arrows[0]?.to ?? null;
}

/** 物流建筑是否四向皆可（分拣器/分流器默认配置）：2D 画枢纽、3D 画枢纽标记。 */
export function isOmnidirectionalLogistics(building: Pick<Building, 'type' | 'conveyor' | 'sorter' | 'splitter'>): boolean {
  return logisticsArrows(building).omnidirectional;
}

/** 该格上的建筑（按 footprint 命中；排除自身）。footprint 逐格步进，跨面方向由 surfaceStep 承担。 */
export function neighborBuildingAt(buildings: readonly Building[], tile: TilePoint, faceSize: number, selfId?: string): Building | undefined {
  for (const building of buildings) {
    if (building.id === selfId) continue;
    const footprint = getBuildingFootprint(building);
    let row = toTilePoint(building.position);
    for (let dy = 0; dy < footprint.height; dy++) {
      let cell = row;
      for (let dx = 0; dx < footprint.width; dx++) {
        if (cell.x === tile.x && cell.y === tile.y) return building;
        cell = surfaceStep(cell, 'east', faceSize).tile;
      }
      row = surfaceStep(row, 'south', faceSize).tile;
    }
  }
  return undefined;
}

/** 上游（输入侧）相邻格与下游（输出侧）相邻格上的建筑名。 */
export interface FlowNeighbors {
  upstream?: string;
  downstream?: string;
}

export function describeFlowNeighbors(
  building: Building,
  buildings: readonly Building[],
  faceSize: number,
  catalog?: CatalogView,
): FlowNeighbors {
  const { arrows, omnidirectional } = logisticsArrows(building);
  if (omnidirectional) return {};
  const origin = toTilePoint(building.position);
  const result: FlowNeighbors = {};
  const first = arrows[0];
  if (first?.from) {
    const neighbor = neighborBuildingAt(buildings, stepTile(origin, first.from, faceSize).tile, faceSize, building.id);
    if (neighbor) result.upstream = getBuildingDisplayName(catalog, neighbor.type);
  }
  const names = [...new Set(arrows.map(arrow => arrow.to))]
    .map(direction => neighborBuildingAt(buildings, stepTile(origin, direction, faceSize).tile, faceSize, building.id))
    .filter((neighbor): neighbor is Building => Boolean(neighbor))
    .map(neighbor => getBuildingDisplayName(catalog, neighbor.type));
  if (names.length > 0) result.downstream = [...new Set(names)].join('、');
  return result;
}

/** 「北→南」式一句话流向（详情面板/提示用）。 */
export function describeFlowText(building: Pick<Building, 'type' | 'conveyor' | 'sorter' | 'splitter'>): string {
  const { arrows, omnidirectional } = logisticsArrows(building);
  if (omnidirectional) return '四向皆可（未配置取料/放料方向）';
  if (arrows.length === 0) return '方向未定（等待服务端解析输出方向）';
  const unique = new Map<string, LogisticsArrow>();
  for (const arrow of arrows) unique.set(`${arrow.from ?? '?'}->${arrow.to}`, arrow);
  return [...unique.values()]
    .map(arrow => arrow.from ? `${DIRECTION_NAMES[arrow.from]}→${DIRECTION_NAMES[arrow.to]}` : `→${DIRECTION_NAMES[arrow.to]}`)
    .join('、');
}

/**
 * 详情面板的完整流向行：「从 西 (x1,y1) → 往 东 (x2,y2)」+ 上下游建筑。
 * 未配置/未解析时给出可操作的解释，不显示空格子。
 */
export function describeLogisticsDetail(
  building: Building,
  buildings: readonly Building[],
  faceSize: number,
  catalog?: CatalogView,
): string {
  const { arrows, omnidirectional } = logisticsArrows(building);
  if (omnidirectional) return '四向皆可：未配置取料/放料方向，四条边都收发。';
  if (arrows.length === 0) return '方向未定：服务端尚未解析输出方向。';
  const origin = toTilePoint(building.position);
  const neighbors = describeFlowNeighbors(building, buildings, faceSize, catalog);
  const unique = new Map<string, LogisticsArrow>();
  for (const arrow of arrows) unique.set(`${arrow.from ?? '?'}->${arrow.to}`, arrow);
  const routes = [...unique.values()].map((arrow) => {
    const from = arrow.from ? stepTile(origin, arrow.from, faceSize).tile : null;
    const to = stepTile(origin, arrow.to, faceSize).tile;
    return arrow.from && from
      ? `从 ${DIRECTION_NAMES[arrow.from]} (${from.x},${from.y}) → 往 ${DIRECTION_NAMES[arrow.to]} (${to.x},${to.y})`
      : `往 ${DIRECTION_NAMES[arrow.to]} (${to.x},${to.y})`;
  }).join('；');
  const parts = [routes];
  if (neighbors.upstream) parts.push(`上游接：${neighbors.upstream}`);
  if (neighbors.downstream) parts.push(`下游接：${neighbors.downstream}`);
  return parts.join(' · ');
}

/**
 * 建造 ghost 的朝向箭头：传送带按 direction（auto 返回 null，由服务端放置时解析）；
 * 其他建筑按 rotation 推「正面」方向（0° = 南向，与服务端 rotateOffset 的 90° 一档一致）。
 */
export function buildGhostDirection(
  buildingType: string,
  direction: ConveyorDirection | undefined,
  rotation: number | undefined,
): CardinalDirection | null {
  if (buildingType.startsWith('conveyor_belt')) return isCardinalDirection(direction) ? direction : null;
  const turns = ((Math.round((rotation ?? 0) / 90) % 4) + 4) % 4;
  return CARDINAL_DIRECTIONS[turns];
}
