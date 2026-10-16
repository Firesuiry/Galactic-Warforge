/**
 * 建造 ghost 的「将开采哪一种矿」预览（第 16 轮契约，docs/dev/服务端API.md §5.1）。
 *
 * 服务端一台采集建筑只采**一种**矿：下单时按覆盖框（占地 + `max(1, coverage_radius)`
 * 圈）里数量最多的矿种定死（平票取物品 ID 较小者，`model.MiningItemAt`），覆盖框里
 * 混进来的别的矿种一格都不采。服务端没有建造预览接口，这里用同一套覆盖格与同一条
 * 平票规则在本地数一遍，所以 hover 里显示的就是建成后真正会产出的那种矿。
 */
import { surfaceOffset } from '@shared/surface';
import type { CatalogView, Position } from '@shared/types';

import {
  getBuildingCatalogEntry,
  getItemDisplayName,
  getResourceList,
  toTilePoint,
  type PlanetRenderView,
} from '@/features/planet-map/model';

export interface MiningCount {
  /** 矿种（目录物品 ID，与服务端 `ResourceNodeState.Kind` 同值）。 */
  kind: string;
  /** 覆盖框里该矿种的格数。 */
  count: number;
}

export interface MiningCoverage {
  /** 将开采的矿种（物品 ID）。 */
  miningItem: string;
  /** 覆盖框内各矿种格数（按物品 ID 排序，含将开采的那种）。 */
  counts: MiningCount[];
  /** 除将开采的矿种外，覆盖框里还有别的矿种——那些矿脉一格都不采。 */
  others: MiningCount[];
  /** 覆盖框里混了多种矿：hover 用警示色，并列出不会开采的矿。 */
  mixed: boolean;
  /** 中文文案：「将开采：铁矿」/「将开采：铁矿（覆盖内还有：铜矿×4，不会开采）」。 */
  text: string;
}

/** 覆盖框（占地 + 采集圈）内的矿种格数：占地按 rotation 交换宽高，坐标走球面 offset。 */
function coverageCounts(
  entry: ReturnType<typeof getBuildingCatalogEntry>,
  planet: PlanetRenderView,
  position: Position,
  rotation?: number,
) {
  let width = Math.max(1, entry?.footprint?.width ?? 1);
  let height = Math.max(1, entry?.footprint?.height ?? 1);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  // 与服务端 CollectorCoverageCells 同口径：至少外扩 1 圈，coverage_radius 更大时取它。
  const rings = Math.max(1, entry?.coverage_radius ?? 1);
  const size = planet.map_width / 3;
  // 格 → 矿种索引：一格最多一条矿脉（服务端 Grid 每格一个 ResourceNodeID）。
  const kindAt = new Map<string, string>();
  for (const resource of getResourceList(planet)) {
    // 枯竭的矿脉服务端不算（MiningItemAt 跳过 Depleted）。
    if (resource.depleted) continue;
    const tile = toTilePoint(resource.position);
    kindAt.set(`${tile.x},${tile.y}`, resource.kind);
  }
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (let dy = -rings; dy < height + rings; dy += 1) {
    for (let dx = -rings; dx < width + rings; dx += 1) {
      const cell = surfaceOffset(position, dx, dy, size);
      const key = `${cell.x},${cell.y}`;
      // 球面 offset 在面接缝/极点附近可能走回同一格：去重，与服务端 seen 同口径。
      if (seen.has(key)) continue;
      seen.add(key);
      const kind = kindAt.get(key);
      if (!kind) continue;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

/**
 * 采集建筑落在 (position, rotation) 时这一台会采哪种矿。
 *
 * 非采集建筑（目录里没有 `requires_resource_node`）与覆盖框里没有矿时返回 null——
 * 前者根本不该有「将开采」提示，后者由建造预检的「需要建在资源点上」负责说明。
 */
export function describeMiningCoverage(
  catalog: CatalogView | undefined,
  buildingType: string | undefined,
  planet: PlanetRenderView,
  position: Position | undefined,
  rotation?: number,
  itemName: (itemId: string) => string = (itemId) => getItemDisplayName(catalog, itemId),
): MiningCoverage | null {
  if (!buildingType || !position) return null;
  const entry = getBuildingCatalogEntry(catalog, buildingType);
  if (entry?.requires_resource_node !== true) return null;
  const counts = coverageCounts(entry, planet, position, rotation);
  if (counts.length === 0) return null;
  // 平票取物品 ID 较小者（与服务端 MiningItemAt 的 `kind < best` 同一条规则）。
  const best = counts.reduce((winner, candidate) => (
    candidate.count > winner.count || (candidate.count === winner.count && candidate.kind < winner.kind)
      ? candidate
      : winner
  ));
  const others = counts.filter((entryCount) => entryCount.kind !== best.kind);
  const mixed = others.length > 0;
  const othersText = others.map((other) => `${itemName(other.kind)}×${other.count}`).join('、');
  return {
    miningItem: best.kind,
    counts,
    others,
    mixed,
    text: mixed
      ? `将开采：${itemName(best.kind)}（覆盖内还有：${othersText}，不会开采）`
      : `将开采：${itemName(best.kind)}`,
  };
}
