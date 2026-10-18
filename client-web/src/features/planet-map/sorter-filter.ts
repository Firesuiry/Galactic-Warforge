/**
 * 分拣器过滤物品选择器的纯逻辑（试玩 1016 U2）。
 *
 * 旧实现是一个原生 `<select multiple>`，把 100+ 件物品一次性铺开：没有搜索、没有分类，
 * 玩家要 Ctrl+点选一个铁矿得在长列表里翻半天。这里把「筛选 / 排序 / 增删」抽成纯函数，
 * 组件只负责渲染，便于单测。
 *
 * 排序规则：**已选在前**（玩家最关心自己挑了什么），其次按目录顺序（与服务端 catalog
 * 一致，不另造一套物品序）。搜索按中文名 / 物品 id 子串匹配，大小写不敏感。
 */

import type { Building, CatalogView } from '@shared/types';

import { getBuildingFootprint, type TilePoint } from './model';
import { MAX_BELT_ELEVATION, beltElevation, occupiesGround } from './logistics-tier';
import { DIRECTION_NAMES, OPPOSITE_DIRECTION, isCardinalDirection, logisticsArrows, stepTile, type CardinalDirection } from './logistics-direction';

export interface SorterFilterOption {
  id: string;
  name: string;
  color: string;
  selected: boolean;
}

/** 过滤物品候选：搜索命中（空串 = 全部）的目录项，已选项排在最前。 */
export function sorterFilterOptions(
  catalog: CatalogView | undefined,
  selected: readonly string[],
  query: string,
): SorterFilterOption[] {
  const chosen = new Set(selected);
  const needle = query.trim().toLowerCase();
  const entries = (catalog?.items ?? [])
    .filter((item) => !needle
      || item.id.toLowerCase().includes(needle)
      || (item.name ?? '').toLowerCase().includes(needle))
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      color: item.color,
      selected: chosen.has(item.id),
    }));
  return [...entries.filter((option) => option.selected), ...entries.filter((option) => !option.selected)];
}

/**
 * 勾选/取消勾选一件物品。**保持目录顺序**（不按点击顺序）：服务端过滤列表是集合语义，
 * 但稳定的顺序让下拉/回显在多次编辑后不会跳来跳去（试玩 1016 U2）。
 */
export function toggleSorterFilterItem(
  catalog: CatalogView | undefined,
  selected: readonly string[],
  itemId: string,
): string[] {
  const chosen = new Set(selected);
  if (chosen.has(itemId)) {
    chosen.delete(itemId);
  } else {
    chosen.add(itemId);
  }
  const order = (catalog?.items ?? []).map((item) => item.id);
  const known = order.filter((id) => chosen.has(id));
  const extra = [...chosen].filter((id) => !order.includes(id));
  return [...known, ...extra];
}

export type SorterEndpointSide = 'take' | 'drop';

export interface SorterEndpointStatus {
  side: SorterEndpointSide;
  direction: CardinalDirection;
  /** 端点格（朝向轴上最近的那个非空格；没找到时 = 方向上的第 1 格）。 */
  tile: TilePoint;
  buildingId?: string;
  buildingType?: string;
  /** 端点是建筑还是传送带（建筑可能是生产/仓储/研究站等，传送带单独说）。 */
  kind?: 'building' | 'belt';
  /**
   * 服务端视角能不能用：`null` = 客户端数据不足（端点格不在本机场景窗口里），
   * 不给结论；`true/false` = 依据可见建筑 + 朝向/端口推出的结论。
   */
  ok: boolean | null;
  /** 不通时的原因（可直接显示给玩家）。 */
  problem?: string;
}

/**
 * 分拣器两端的连通性提示（试玩 1016 U8）。
 *
 * 服务端没有下发「取货端/放货端有没有接上」的字段（`SorterState` 只有 cycle_ticks /
 * range / filter / last_transfer），玩家看到的是「运行中 / 停机原因 -」，只能靠抽屉里
 * 那行「流向」文字猜朝向对不对。这里按**与服务端同一套规则**在客户端推一遍。
 *
 * 口径（`server/internal/gamecore/sorter_settlement.go` 的 `sorterFindEndpoint`）：
 * - 沿朝向轴从分拣器所在格**逐格**向外扫，**第一个非空格**就是端点（中间的格
 *   `TileBuilding` 为空时 continue，继续往前）；所以本函数也只扫到第一个占格为止。
 * - 端点必须己方；传送带端点必须运行中且**不是分流器**（服务端直接拒掉分流器）。
 * - 取货端：运行中的带格**任何位置都能取**（`sorterCanTakeFromConveyor`，DSP 口径：
 *   带子上路过的物品都能被取走，**不要求带尾朝向分拣器**——第 16 轮契约 §2）。
 * - 放货端：按 `conveyorAllowedInputs` 判该侧能不能插入（输出侧不收；`input` 被限制成
 *   某一侧时只收那一侧）。
 * - 端点是「建筑」（不占 TileBuilding 的多格建筑按占地判定）时，取货要有输出端口、
 *   放货要有输入端口。
 *
 * 结论分三档：`true` 接得上 / `false` 接不上（附原因）/ `null` 数据不足（端点不在本机
 * 场景窗口里，或建筑没有端口数据），**绝不在数据不足时下「接不上」的结论**。
 */
export function sorterEndpointStatuses(
  building: Building,
  buildings: readonly Building[],
  faceSize: number,
  /** 本机场景窗口（`/scene` 的 bounds）：只有窗口内的格子才能下「空着」的结论。 */
  bounds?: { x: number; y: number; width: number; height: number },
): SorterEndpointStatus[] {
  const { arrows } = logisticsArrows(building);
  const arrow = arrows[0];
  if (!arrow) return [];
  const origin: TilePoint = { x: Math.round(building.position.x), y: Math.round(building.position.y) };
  const range = building.sorter?.range ?? 1;
  const owner = building.owner_id;
  const sides: { side: SorterEndpointSide; direction: CardinalDirection }[] = [
    { side: 'take', direction: arrow.from ?? arrow.to },
    { side: 'drop', direction: arrow.to },
  ];
  return sides.map(({ side, direction }) => {
    let cursor = origin;
    let tile = stepTile(origin, direction, faceSize).tile;
    let endpoint: Building | undefined;
    for (let step = 0; step < range; step += 1) {
      const stepped = stepTile(cursor, direction, faceSize);
      cursor = stepped.tile;
      tile = cursor;
      // 只看登记地面格的建筑（服务端 TileBuilding 口径：高架带/地基/配送器/叠层不挡、也不算端点）。
      const hit = buildings.find((candidate) => candidate.id !== building.id && occupiesGround(candidate) && containsCell(candidate, cursor, faceSize));
      if (hit) {
        endpoint = hit;
        break;
      }
    }
    const base = { side, direction, tile };
    // 端点格可能不在本机场景窗口里（/scene 只返回相机窗口内的建筑）：那种情况下
    // 「前方没有建筑」是**数据不足**而不是事实，报 ok: null，不给玩家错误结论。
    if (!endpoint && bounds && !tileInBounds(tile, bounds)) {
      return { ...base, ok: null, problem: '端点格不在当前场景窗口内，暂时看不出接没接上' };
    }
    if (!endpoint) return { ...base, ok: false, problem: side === 'take' ? '没有可取的物品（前方没有建筑/传送带）' : '不接收（前方没有建筑/传送带）' };
    if (endpoint.owner_id !== owner) {
      return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind: endpoint.conveyor ? 'belt' : 'building', ok: false, problem: '端点不属于你（分拣器只服务自己的建筑）' };
    }
    const isBelt = Boolean(endpoint.conveyor);
    const kind = isBelt ? 'belt' as const : 'building' as const;
    if (isBelt) {
      const beltState = endpoint.conveyor!;
      const state = endpoint.runtime?.state;
      if (state && state !== 'running') {
        return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: false, problem: '端点的传送带没有运行（未接入电网 / 停机）' };
      }
      // 服务端 sorterFindEndpoint 对分流器一律不接（取/放都拒）。
      if (endpoint.splitter) {
        return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: false, problem: '端点的传送带是分流器（分拣器不能直接接分流器）' };
      }
      const opposite = OPPOSITE_DIRECTION[direction];
      // 取货：运行中的带格任何位置都能取（服务端 sorterCanTakeFromConveyor：不要求带尾朝向分拣器）。
      if (side === 'take') {
        return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: true };
      }
      // 放货：该侧必须允许输入（服务端 conveyorAllowedInputs：输出侧不收、input 受限时只收那一侧）。
      const allowed = conveyorAllowedInputs(beltState);
      const ok = allowed.has(opposite);
      const output = isCardinalDirection(beltState.output) ? beltState.output : null;
      const inputRestricted = isCardinalDirection(beltState.input)
        && beltState.input !== output
        && beltState.input !== (output ? OPPOSITE_DIRECTION[output] : null);
      return {
        ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok,
        ...(ok ? {} : {
          problem: inputRestricted
            ? `传送带不接收这个方向：它被限制为只从${DIRECTION_NAMES[beltState.input as CardinalDirection]}侧输入（分拣器在${DIRECTION_NAMES[direction]}侧）`
            : `传送带不接收这个方向：带子朝${output ? DIRECTION_NAMES[output] : '未知'}输出（输出侧不收）`,
        }),
      };
    }
    const ports = endpoint.runtime?.params?.io_ports ?? [];
    const wanted: 'output' | 'input' = side === 'take' ? 'output' : 'input';
    const accepts = ports.some((port) => port.direction === wanted || port.direction === 'both');
    if (accepts) return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: true };
    // 没有端口数据（旧存档 / 采集类建筑）：不下结论，交给服务端。
    if (ports.length === 0) return { ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: null };
    return {
      ...base, buildingId: endpoint.id, buildingType: endpoint.type, kind, ok: false,
      problem: side === 'take' ? '没有可取的物品（该建筑没有输出口）' : '不接收（该建筑没有输入口）',
    };
  });
}

/**
 * 传送带可接受的输入侧（镜像服务端 `conveyorAllowedInputs`，`conveyor_settlement.go`）：
 * - 分流器：只收 `splitter.input_directions`；
 * - `input` 是实方向、且不等于 output / output 的反向（说明是「受限输入」）：只收那一侧；
 * - 否则四向都收，但**输出侧不收**。
 */
export function conveyorAllowedInputs(
  conveyor: { input?: string; output?: string },
  splitter?: { input_directions?: readonly string[] },
): Set<CardinalDirection> {
  const allowed = new Set<CardinalDirection>();
  if (splitter) {
    for (const direction of splitter.input_directions ?? []) {
      if (isCardinalDirection(direction)) allowed.add(direction);
    }
    return allowed;
  }
  const output: CardinalDirection | null = isCardinalDirection(conveyor.output) ? conveyor.output : null;
  const input: CardinalDirection | null = isCardinalDirection(conveyor.input) ? conveyor.input : null;
  if (input && input !== output && input !== (output ? OPPOSITE_DIRECTION[output] : null)) {
    allowed.add(input);
    return allowed;
  }
  for (const direction of ['north', 'east', 'south', 'west'] as CardinalDirection[]) {
    if (direction !== output) allowed.add(direction);
  }
  return allowed;
}

/** 该格是否落在本机场景窗口里。 */
function tileInBounds(tile: TilePoint, bounds: { x: number; y: number; width: number; height: number }): boolean {
  return tile.x >= bounds.x && tile.x < bounds.x + bounds.width
    && tile.y >= bounds.y && tile.y < bounds.y + bounds.height;
}

/** 建筑占地展开成格（按 footprint，跨面走 stepTile）。 */
function footprintCells(building: Building, faceSize: number): TilePoint[] {
  const { width, height } = getBuildingFootprint(building);
  const cells: TilePoint[] = [];
  let row: TilePoint = { x: Math.round(building.position.x), y: Math.round(building.position.y) };
  for (let dy = 0; dy < height; dy += 1) {
    let cell = row;
    for (let dx = 0; dx < width; dx += 1) {
      cells.push(cell);
      cell = stepTile(cell, 'east', faceSize).tile;
    }
    row = stepTile(row, 'south', faceSize).tile;
  }
  return cells;
}

/** 建筑是否占着这一格（按 footprint 展开）。 */
function containsCell(building: Building, tile: TilePoint, faceSize: number): boolean {
  return footprintCells(building, faceSize).some((cell) => cell.x === tile.x && cell.y === tile.y);
}

const tileKey = (tile: TilePoint) => `${tile.x},${tile.y}`;

export interface BeltDeadEnd {
  id: string;
  /** 带子自身的格（告警短杠画在这里）。 */
  tile: TilePoint;
  /** 朝向轴上的邻格（死端时是空的；也是短杠朝向）。 */
  aheadTile: TilePoint;
  direction: CardinalDirection;
  /** 带子所在层（3D 把短杠抬到这一层的带面高度）。 */
  elevation: number;
}

/**
 * 传送带死端（试玩 1016 U7）：带子按自己的输出方向看过去**接不上任何下游**，
 * 且带上还压着货——货推到带尾就走不动了，只会堆满后堵回上游（玩家看到的是「熔炉产物
 * 阻塞」，其实问题在带尾没接东西）。这里只报「有货 + 死端」，空带子不算问题。
 *
 * 判定按输出方向的**相邻一格**，分层口径同服务端 `conveyorDownstreamAt`（第 19 轮 §3.3）：
 * - 同层有带子 → 接上；
 * - ±1 层有**直行延续**的纯传送带（坡道）→ 接上；
 * - 地面带（0 层）前方是任何地面建筑也算接上（物流站/分馏塔等直接从带上收货，保持宽松）；
 *   高架带只接带子，前方的地面建筑收不到它的货。
 *
 * 另外，被分拣器当**取货端**的带子不报：「带尾 + 分拣器夹货」是 DSP 最常见的收货口，
 * 分拣器隔着空格跨格取货时带尾前方本来就是空的（扫法同 `sorterEndpointStatuses`）。
 */
export function beltDeadEnds(
  buildings: readonly Building[],
  faceSize: number,
): BeltDeadEnd[] {
  // 地面格（服务端 TileBuilding 口径）与高架层（BeltLayers `x,y@e`）各建一张索引。
  const ground = new Map<string, Building>();
  const elevated = new Map<string, Building>();
  for (const building of buildings) {
    if (occupiesGround(building)) {
      for (const cell of footprintCells(building, faceSize)) ground.set(tileKey(cell), building);
    } else if (building.conveyor && beltElevation(building) > 0) {
      elevated.set(`${tileKey({ x: Math.round(building.position.x), y: Math.round(building.position.y) })}@${beltElevation(building)}`, building);
    }
  }
  const beltAt = (tile: TilePoint, level: number) => {
    const hit = level === 0 ? ground.get(tileKey(tile)) : elevated.get(`${tileKey(tile)}@${level}`);
    return hit?.conveyor ? hit : undefined;
  };
  const picked = new Set<string>();
  for (const sorter of buildings) {
    if (!sorter.sorter) continue;
    const arrow = logisticsArrows(sorter).arrows[0];
    if (!arrow) continue;
    let cursor: TilePoint = { x: Math.round(sorter.position.x), y: Math.round(sorter.position.y) };
    for (let step = 0; step < (sorter.sorter.range ?? 1); step += 1) {
      cursor = stepTile(cursor, arrow.from ?? arrow.to, faceSize).tile;
      const hit = ground.get(tileKey(cursor));
      if (!hit || hit.id === sorter.id) continue;
      if (hit.conveyor && !hit.splitter) picked.add(hit.id);
      break;
    }
  }
  const result: BeltDeadEnd[] = [];
  for (const building of buildings) {
    if (!building.conveyor || building.splitter || picked.has(building.id)) continue;
    if (building.runtime?.state && building.runtime.state !== 'running') continue;
    const output = building.conveyor.output;
    if (output !== 'north' && output !== 'east' && output !== 'south' && output !== 'west') continue;
    const cargo = (building.conveyor.buffer ?? []).reduce((sum, stack) => sum + (stack.quantity ?? 0), 0);
    if (cargo <= 0) continue;
    const tile: TilePoint = { x: Math.round(building.position.x), y: Math.round(building.position.y) };
    const { tile: aheadTile, direction: aheadDirection } = stepTile(tile, output, faceSize);
    const level = beltElevation(building);
    const linked = (level === 0 ? ground.has(tileKey(aheadTile)) : Boolean(beltAt(aheadTile, level)))
      || [level - 1, level + 1].some((ramp) => {
        if (ramp < 0 || ramp > MAX_BELT_ELEVATION) return false;
        const candidate = beltAt(aheadTile, ramp);
        return Boolean(candidate && !candidate.splitter && candidate.type.startsWith('conveyor_belt_')
          && candidate.conveyor!.output === aheadDirection);
      });
    if (linked) continue;
    result.push({ id: building.id, tile, aheadTile, direction: output, elevation: level });
  }
  return result;
}
