import { describe, expect, it } from 'vitest';

import type { CatalogView, PlanetResource } from '@shared/types';

import { describeMiningCoverage } from '@/features/planet-map/mining-coverage';
import type { PlanetRenderView } from '@/features/planet-map/model';

/**
 * 「将开采哪一种矿」本地预览必须与服务端 model.MiningItemAt 同口径
 * （docs/dev/服务端API.md §5.1）：覆盖框 = 占地 + max(1, coverage_radius) 圈，
 * 取框里数量最多的矿种，平票取物品 ID 较小者。
 */

const catalog = {
  buildings: [
    { id: 'mining_machine', name: '采矿机', buildable: true, requires_resource_node: true, coverage_radius: 1, footprint: { width: 3, height: 3 } },
    { id: 'advanced_mining_machine', name: '大型采矿机', buildable: true, requires_resource_node: true, coverage_radius: 2, footprint: { width: 3, height: 3 } },
    { id: 'wind_turbine', name: '风力涡轮机', buildable: true, footprint: { width: 1, height: 1 } },
  ],
  items: [
    { id: 'iron_ore', name: '铁矿' },
    { id: 'copper_ore', name: '铜矿' },
    { id: 'stone_ore', name: '石矿' },
  ],
} as unknown as CatalogView;

function planetWith(resources: Array<{ kind: string; x: number; y: number; depleted?: boolean }>): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere', face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, () => Array.from({ length: 24 }, () => 'buildable')),
    buildings: {},
    units: {},
    resources: resources.map((resource, index) => ({
      id: `res-${index}`,
      planet_id: 'planet-1-1',
      kind: resource.kind,
      behavior: 'finite',
      position: { x: resource.x, y: resource.y, z: 0 },
      remaining: resource.depleted ? 0 : 100,
      depleted: resource.depleted,
    } as PlanetResource)),
  } as PlanetRenderView;
}

/** 3×3 矿机锚点 (1,1)：覆盖框 = 0..4 × 0..4（25 格）。 */
const ANCHOR = { x: 1, y: 1, z: 0 };

describe('describeMiningCoverage 覆盖框矿种统计', () => {
  it('只有一种矿 → 就是它，不带「不会开采」警示', () => {
    const coverage = describeMiningCoverage(catalog, 'mining_machine', planetWith([
      { kind: 'iron_ore', x: 2, y: 2 },
      { kind: 'iron_ore', x: 3, y: 2 },
    ]), ANCHOR)!;
    expect(coverage.miningItem).toBe('iron_ore');
    expect(coverage.mixed).toBe(false);
    expect(coverage.others).toEqual([]);
    expect(coverage.text).toBe('将开采：铁矿');
  });

  it('多种矿 → 取格数最多者，并列出不会开采的矿种与格数', () => {
    const coverage = describeMiningCoverage(catalog, 'mining_machine', planetWith([
      { kind: 'iron_ore', x: 1, y: 1 }, { kind: 'iron_ore', x: 2, y: 1 }, { kind: 'iron_ore', x: 3, y: 1 },
      { kind: 'copper_ore', x: 1, y: 2 }, { kind: 'copper_ore', x: 2, y: 2 },
      { kind: 'stone_ore', x: 3, y: 2 },
    ]), ANCHOR)!;
    expect(coverage.miningItem).toBe('iron_ore');
    expect(coverage.mixed).toBe(true);
    expect(coverage.others).toEqual([
      { kind: 'copper_ore', count: 2 },
      { kind: 'stone_ore', count: 1 },
    ]);
    expect(coverage.text).toBe('将开采：铁矿（覆盖内还有：铜矿×2、石矿×1，不会开采）');
  });

  it('平票取物品 ID 较小者（copper_ore < iron_ore）', () => {
    const coverage = describeMiningCoverage(catalog, 'mining_machine', planetWith([
      { kind: 'iron_ore', x: 1, y: 1 }, { kind: 'iron_ore', x: 2, y: 1 },
      { kind: 'copper_ore', x: 3, y: 1 }, { kind: 'copper_ore', x: 4, y: 1 },
    ]), ANCHOR)!;
    expect(coverage.miningItem).toBe('copper_ore');
    expect(coverage.text).toBe('将开采：铜矿（覆盖内还有：铁矿×2，不会开采）');
  });

  it('覆盖框外的矿不参与统计（占地 + 1 圈之外）', () => {
    // 3×3 矿机覆盖 0..4；(5,2) 在框外。
    const coverage = describeMiningCoverage(catalog, 'mining_machine', planetWith([
      { kind: 'iron_ore', x: 1, y: 1 },
      { kind: 'copper_ore', x: 5, y: 2 }, { kind: 'copper_ore', x: 5, y: 3 },
    ]), ANCHOR)!;
    expect(coverage.miningItem).toBe('iron_ore');
    expect(coverage.mixed).toBe(false);
  });

  it('coverage_radius=2 的大型矿机把外两圈的矿也算进来', () => {
    const resources = [
      { kind: 'iron_ore', x: 1, y: 1 },
      // (-1..5) 覆盖框：(-1,1) 与 (5,1) 在第二圈内。
      { kind: 'copper_ore', x: 5, y: 1 }, { kind: 'copper_ore', x: 5, y: 2 }, { kind: 'copper_ore', x: 5, y: 3 },
    ];
    const small = describeMiningCoverage(catalog, 'mining_machine', planetWith(resources), ANCHOR)!;
    const large = describeMiningCoverage(catalog, 'advanced_mining_machine', planetWith(resources), ANCHOR)!;
    expect(small.miningItem).toBe('iron_ore');
    expect(large.miningItem).toBe('copper_ore');
    expect(large.text).toBe('将开采：铜矿（覆盖内还有：铁矿×1，不会开采）');
  });

  it('枯竭矿脉不算（服务端 MiningItemAt 跳过 Depleted）', () => {
    const coverage = describeMiningCoverage(catalog, 'mining_machine', planetWith([
      { kind: 'iron_ore', x: 1, y: 1 },
      { kind: 'copper_ore', x: 2, y: 1, depleted: true }, { kind: 'copper_ore', x: 3, y: 1, depleted: true },
    ]), ANCHOR)!;
    expect(coverage.miningItem).toBe('iron_ore');
    expect(coverage.mixed).toBe(false);
  });

  it('非采集建筑 / 覆盖框里没有矿 → 没有「将开采」提示', () => {
    expect(describeMiningCoverage(catalog, 'wind_turbine', planetWith([{ kind: 'iron_ore', x: 1, y: 1 }]), ANCHOR)).toBeNull();
    expect(describeMiningCoverage(catalog, 'mining_machine', planetWith([]), ANCHOR)).toBeNull();
  });

  it('旋转 90/270 交换占地宽高（覆盖框跟着转）', () => {
    const entryCatalog = {
      buildings: [
        { id: 'mining_machine_wide', name: '宽矿机', buildable: true, requires_resource_node: true, coverage_radius: 1, footprint: { width: 3, height: 1 } },
      ],
      items: catalog.items,
    } as unknown as CatalogView;
    // 竖着放（旋转 90）：占地 1 宽 × 3 高 → 覆盖框 -1..1 × -1..3；横着放覆盖 -1..3 × -1..1。
    const resources = [
      { kind: 'iron_ore', x: 1, y: 3 }, { kind: 'iron_ore', x: 0, y: 3 },
      { kind: 'copper_ore', x: 4, y: 1 },
    ];
    const upright = describeMiningCoverage(entryCatalog, 'mining_machine_wide', planetWith(resources), ANCHOR, 0)!;
    const rotated = describeMiningCoverage(entryCatalog, 'mining_machine_wide', planetWith(resources), ANCHOR, 90)!;
    expect(upright.miningItem).toBe('copper_ore');
    expect(rotated.miningItem).toBe('iron_ore');
  });
});
