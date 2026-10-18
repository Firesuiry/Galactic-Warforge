import type { Building } from '@shared/types';

/**
 * 第 19 轮（docs/guide/传送带与分拣器DSP对齐.md §3.6）：传送带/分拣器的分档色与多层带常量。
 * 3D 场景、2D 战术图、建造交互共用这一份，避免各处各写一套颜色/层高。
 */

/** 最高高架层（0 = 地面）。与服务端 `MaxBeltElevation` 一致。 */
export const MAX_BELT_ELEVATION = 4;
/** 3D 层高（单位 cell）：1 层刚好跨过地面带上的货物。 */
export const BELT_LEVEL_HEIGHT = .5;

export type LogisticsTier = 1 | 2 | 3 | 'pile';

/** DSP 分档色：Mk.I 琥珀黄 / Mk.II 绿 / Mk.III 蓝；集装分拣器紫。 */
export const TIER_COLOR: Record<LogisticsTier, string> = {
  1: '#f5b942',
  2: '#46d483',
  3: '#3ea6ff',
  pile: '#b48cff',
};

/** DSP 带速比 6 : 12 : 30 件/秒 = 1 : 2 : 5（带面箭头滚速同比）。 */
export const BELT_TIER_SPEED: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 5 };

export function logisticsTier(type: string): LogisticsTier {
  if (type === 'pile_sorter') return 'pile';
  if (/mk3|_3$/.test(type)) return 3;
  if (/mk2|_2$/.test(type)) return 2;
  return 1;
}

export function tierColor(type: string): string {
  return TIER_COLOR[logisticsTier(type)];
}

/** 传送带所在层（非传送带、旧数据一律 0）。 */
export function beltElevation(building: Pick<Building, 'type' | 'conveyor'>): number {
  if (!building.type.startsWith('conveyor_belt_')) return 0;
  return clampBeltElevation(building.conveyor?.elevation ?? 0);
}

/** 高度钳到 0–4（服务端 MaxBeltElevation 同口径）。 */
export function clampBeltElevation(elevation: number): number {
  return Math.max(0, Math.min(MAX_BELT_ELEVATION, Math.round(elevation)));
}

/**
 * 第 19 轮 §3.1 的「低矮物流」：高架带可以压在这些地面建筑上方。
 * 与服务端 LowLogistics 同一份清单（带子、分流器、集装机、流速监测器、分拣器、集装分拣器）。
 */
export function isLowLogisticsType(type: string): boolean {
  return type.startsWith('conveyor_belt_')
    || type === 'splitter'
    || type === 'automatic_piler'
    || type === 'traffic_monitor'
    || type === 'pile_sorter'
    || type.startsWith('sorter_');
}
