/**
 * 行星地图物流可视化纯逻辑：传送带货物圆点 + 采集产出脉冲的参数计算。
 *
 * 不依赖 Pixi：只负责把 server 快照数据（conveyor.buffer / runtime.functions.collect）
 * 翻译成渲染参数（圆点颜色序列、流向向量、流速、脉冲配色/周期），
 * 视图绑定（Sprite 挂载与 ticker 推进）在 planet-scene。
 *
 * 数据新鲜度说明：scene 快照由 SSE 事件驱动刷新（非逐 tick），
 * 圆点的连续流动由渲染层 ticker 近似——方向取 conveyor.output，
 * 速度由 throughput 近似（服务端每 tick 把 ≤throughput 个物品移交下一段）。
 */

import type { Building, ItemAmount } from '@shared/types';

import { getItemColorNumber } from '@/features/planet-map/item-colors';
import { getResourceColorValue } from '@/features/planet-map/visible-entities';

/**
 * 单段传送带上同时渲染的货物圆点上限（buffer 可能堆很多，视觉抽样即可）。
 * 细分网格后 1 cell = 1 段带体，圆点按 cell 尺寸画，4 个仍能看清。
 */
export const BELT_ITEM_MAX_DOTS = 4;
/**
 * 货物圆点直径占 cell 的比例：与 3D 物料方块同一量纲（方块 0.3 cell 边长，
 * 圆点取 0.3 cell 直径），DSP 式「带上的小物件」——远小于带宽，一格内多个。
 */
export const BELT_ITEM_DOT_FRACTION = 0.3;
/** 圆点最小像素（更小的档位已不画圆点，这里只兜底亚像素抖动）。 */
export const BELT_ITEM_DOT_MIN_PX = 2;
/**
 * 货物圆点/采集脉冲显示的最低 cell 边长（px）。
 * 细分网格后默认档是 16px/cell，4px/cell 档圆点已小到无意义。
 */
export const BELT_FLOW_MIN_TILE_SIZE = 4;
/** 采集产出脉冲周期（s）：近似"每周期一粒矿被采出"的节奏，与产量解耦（视觉近似）。 */
export const HARVEST_PULSE_PERIOD_SEC = 2.6;

/** 传送带流向（输出方向）单位向量；与 resolveConveyorBeltDirection 的四向一致。 */
export type BeltFlowDirection = 'north' | 'east' | 'south' | 'west';

const BELT_FLOW_VECTORS: Record<BeltFlowDirection, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export function beltFlowVector(direction: string | undefined): { x: number; y: number } {
  if (direction === 'north' || direction === 'south' || direction === 'west' || direction === 'east') {
    return BELT_FLOW_VECTORS[direction];
  }
  // 缺失/auto 与贴图方向纹同一回退（east）。
  return BELT_FLOW_VECTORS.east;
}

/**
 * 货物圆点颜色序列：按 buffer 堆顺序展开（队首 = 即将送出的一端），
 * 每堆按数量占比取圆点，颜色取物品配色表（item-colors，与服务端目录同源兜底）。上限 maxDots。
 */
export function beltItemDotColors(
  buffer: ItemAmount[] | undefined,
  maxDots = BELT_ITEM_MAX_DOTS,
): number[] {
  if (!buffer || buffer.length === 0 || maxDots <= 0) {
    return [];
  }
  const colors: number[] = [];
  for (const stack of buffer) {
    if (!stack || stack.quantity <= 0 || !stack.item_id) {
      continue;
    }
    const color = getItemColorNumber(stack.item_id);
    const take = Math.min(stack.quantity, maxDots - colors.length);
    for (let i = 0; i < take; i += 1) {
      colors.push(color);
    }
    if (colors.length >= maxDots) {
      break;
    }
  }
  return colors;
}

/** 带上物料的文本摘要（选中传送带详情面板用）：按 buffer 顺序「铁块 ×12 · 齿轮 ×4」。 */
export function beltBufferSummary(
  buffer: ItemAmount[] | undefined,
  label: (itemId: string) => string,
): string {
  const stacks = (buffer ?? []).filter((stack) => stack && stack.quantity > 0 && stack.item_id);
  if (stacks.length === 0) {
    return '空';
  }
  return stacks.map((stack) => `${label(stack.item_id)} ×${stack.quantity}`).join(' · ');
}

/** 单件物品颜色（带上圆点/3D 方块/机器人货箱共用），供测试与详情面板色块使用。 */
export function beltItemColor(itemId: string): number {
  return getItemColorNumber(itemId);
}

/**
 * 货物流速（tile/s，视觉近似）：服务端每 tick 把 ≤throughput 个物品移交下一段，
 * 吞吐越高流速越快，钳在可读区间内（与 tick 频率解耦，避免快到看不清）。
 */
export function beltItemSpeedTilesPerSec(throughput: number | undefined): number {
  const value = Math.max(throughput ?? 1, 1);
  return Math.min(1.1 + 0.35 * value, 3);
}

/**
 * 圆点在容器坐标系的位置：progress ∈ [0,1) 从输入边（center - axis）流向输出边（center + axis）。
 * cx/cy 为 footprint 中心，ax/ay 为 流向向量 × 半轴长。
 */
export function beltDotPosition(
  progress: number,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
): { x: number; y: number } {
  const t = ((progress % 1) + 1) % 1;
  const offset = t * 2 - 1;
  return { x: cx + ax * offset, y: cy + ay * offset };
}

/** 新建/补齐圆点时的初始相位：沿带体均匀铺开。 */
export function beltDotInitialProgress(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((index / count) % 1 + 1) % 1;
}

export interface HarvestPulseSpec {
  /** 矿粒颜色（资源调色板；resource_kind 缺失/未知时回退通用色）。 */
  color: number;
  /** 脉冲周期（s）。 */
  periodSec: number;
}

/**
 * 采集产出脉冲：采集类建筑（runtime.functions.collect）处于 running 时返回脉冲参数，
 * 否则返回 null（不演出）。颜色取 collect.resource_kind（服务端按脚下矿脉同步）。
 */
export function resolveHarvestPulse(building: Building): HarvestPulseSpec | null {
  const collect = building.runtime?.functions?.collect;
  if (!collect || building.runtime?.state !== 'running') {
    return null;
  }
  return {
    color: getResourceColorValue(collect.resource_kind ?? ''),
    periodSec: HARVEST_PULSE_PERIOD_SEC,
  };
}

/**
 * 采集脉冲进度曲线：cycle ∈ [0,1) → 矿粒上抛的归一化高度（0 → 1）与透明度。
 * 前 18% 快速弹出（alpha 0→1），后段匀速上升渐隐。
 */
export function harvestPulseEnvelope(cycle: number): { rise: number; alpha: number } {
  const t = ((cycle % 1) + 1) % 1;
  const alpha = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
  return { rise: t, alpha: Math.min(Math.max(alpha, 0), 1) };
}
