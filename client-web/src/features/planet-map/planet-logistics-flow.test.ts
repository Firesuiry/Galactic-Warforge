import type { Building } from '@shared/types';

import {
  BELT_ITEM_MAX_DOTS,
  beltDotInitialProgress,
  beltDotPosition,
  beltFlowVector,
  beltItemDotColors,
  beltItemSpeedTilesPerSec,
  harvestPulseEnvelope,
  resolveHarvestPulse,
} from '@/features/planet-map/planet-logistics-flow';
import { getResourceColorValue } from '@/features/planet-map/visible-entities';

function makeBuilding(overrides: Partial<Building>): Building {
  return {
    id: 'b-1',
    type: 'mining_machine',
    owner_id: 'p1',
    position: { x: 1, y: 1, z: 0 },
    hp: 1,
    max_hp: 1,
    level: 1,
    vision_range: 0,
    runtime: {
      params: {},
      state: 'running',
    },
    ...overrides,
  } as unknown as Building;
}

describe('beltItemDotColors：buffer → 圆点颜色序列', () => {
  it('空/缺失 buffer 返回空数组', () => {
    expect(beltItemDotColors(undefined)).toEqual([]);
    expect(beltItemDotColors([])).toEqual([]);
    expect(beltItemDotColors([{ item_id: 'iron_ore', quantity: 0 }])).toEqual([]);
  });

  it('按堆展开：数量决定圆点个数，颜色取资源调色板', () => {
    const colors = beltItemDotColors([
      { item_id: 'iron_ore', quantity: 2 },
      { item_id: 'copper_ore', quantity: 1 },
    ]);
    expect(colors).toEqual([
      getResourceColorValue('iron_ore'),
      getResourceColorValue('iron_ore'),
      getResourceColorValue('copper_ore'),
    ]);
  });

  it('超过上限时截断（队首优先）', () => {
    const colors = beltItemDotColors([
      { item_id: 'iron_ore', quantity: 99 },
      { item_id: 'copper_ore', quantity: 99 },
    ]);
    expect(colors).toHaveLength(BELT_ITEM_MAX_DOTS);
    expect(colors.every((color) => color === getResourceColorValue('iron_ore'))).toBe(true);
  });

  it('未知物品回退通用色', () => {
    const [color] = beltItemDotColors([{ item_id: 'quantum_chip', quantity: 1 }]);
    expect(color).toBe(getResourceColorValue(''));
  });
});

describe('beltFlowVector：流向向量', () => {
  it('四向单位向量', () => {
    expect(beltFlowVector('east')).toEqual({ x: 1, y: 0 });
    expect(beltFlowVector('south')).toEqual({ x: 0, y: 1 });
    expect(beltFlowVector('west')).toEqual({ x: -1, y: 0 });
    expect(beltFlowVector('north')).toEqual({ x: 0, y: -1 });
  });

  it('缺失/auto 回退 east（与贴图方向纹一致）', () => {
    expect(beltFlowVector(undefined)).toEqual({ x: 1, y: 0 });
    expect(beltFlowVector('auto')).toEqual({ x: 1, y: 0 });
    expect(beltFlowVector('')).toEqual({ x: 1, y: 0 });
  });
});

describe('beltItemSpeedTilesPerSec：流速近似', () => {
  it('吞吐越高流速越快，且钳在可读区间', () => {
    const slow = beltItemSpeedTilesPerSec(1);
    const fast = beltItemSpeedTilesPerSec(12);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
    expect(beltItemSpeedTilesPerSec(9999)).toBeLessThanOrEqual(3);
  });

  it('缺失/非正吞吐按 1 处理', () => {
    expect(beltItemSpeedTilesPerSec(undefined)).toBe(beltItemSpeedTilesPerSec(1));
    expect(beltItemSpeedTilesPerSec(0)).toBe(beltItemSpeedTilesPerSec(1));
  });
});

describe('beltDotPosition：圆点位置', () => {
  // cx=24, cy=24, ax=24, ay=0（48px tile 向东）：progress 0 → 输入边，1 → 输出边
  it('progress 0 在输入边，0.5 在中心，趋近 1 到输出边', () => {
    expect(beltDotPosition(0, 24, 24, 24, 0)).toEqual({ x: 0, y: 24 });
    expect(beltDotPosition(0.5, 24, 24, 24, 0)).toEqual({ x: 24, y: 24 });
    expect(beltDotPosition(0.99, 24, 24, 24, 0).x).toBeCloseTo(47.52);
  });

  it('progress 归一化到 [0,1)（回卷）', () => {
    expect(beltDotPosition(1.25, 24, 24, 24, 0)).toEqual(beltDotPosition(0.25, 24, 24, 24, 0));
    expect(beltDotPosition(-0.25, 24, 24, 24, 0)).toEqual(beltDotPosition(0.75, 24, 24, 24, 0));
  });
});

describe('beltDotInitialProgress：初始相位均匀铺开', () => {
  it('N 个圆点等间距', () => {
    expect(beltDotInitialProgress(0, 4)).toBe(0);
    expect(beltDotInitialProgress(1, 4)).toBe(0.25);
    expect(beltDotInitialProgress(3, 4)).toBe(0.75);
    expect(beltDotInitialProgress(0, 0)).toBe(0);
  });
});

describe('resolveHarvestPulse：采集产出脉冲', () => {
  it('running 的采集建筑返回脉冲参数（颜色 = resource_kind）', () => {
    const building = makeBuilding({
      runtime: {
        params: {},
        state: 'running',
        functions: { collect: { resource_kind: 'silicon_ore', yield_per_tick: 8 } },
      },
    } as Partial<Building>);
    const spec = resolveHarvestPulse(building);
    expect(spec).not.toBeNull();
    expect(spec?.color).toBe(getResourceColorValue('silicon_ore'));
    expect(spec?.periodSec).toBeGreaterThan(0);
  });

  it('非 running / 无 collect 模块返回 null', () => {
    const idle = makeBuilding({
      runtime: {
        params: {},
        state: 'idle',
        functions: { collect: { resource_kind: 'iron_ore', yield_per_tick: 8 } },
      },
    } as Partial<Building>);
    expect(resolveHarvestPulse(idle)).toBeNull();

    const smelter = makeBuilding({
      runtime: { params: {}, state: 'running', functions: {} },
    } as Partial<Building>);
    expect(resolveHarvestPulse(smelter)).toBeNull();
  });

  it('resource_kind 缺失时回退通用色', () => {
    const building = makeBuilding({
      runtime: {
        params: {},
        state: 'running',
        functions: { collect: { yield_per_tick: 8 } },
      },
    } as Partial<Building>);
    expect(resolveHarvestPulse(building)?.color).toBe(getResourceColorValue(''));
  });
});

describe('harvestPulseEnvelope：脉冲进度曲线', () => {
  it('起点透明、中段上升渐隐、周期回卷', () => {
    expect(harvestPulseEnvelope(0).alpha).toBe(0);
    expect(harvestPulseEnvelope(0).rise).toBe(0);
    const mid = harvestPulseEnvelope(0.5);
    expect(mid.rise).toBe(0.5);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(harvestPulseEnvelope(1.3)).toEqual(harvestPulseEnvelope(0.3));
  });
});
