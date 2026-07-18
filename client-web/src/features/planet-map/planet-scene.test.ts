import { describe, expect, it } from 'vitest';

import type { Building, BuildingFunctionModules, CatalogView } from '@shared/types';

import {
  buildDashArcSegments,
  buildDashSegments,
  buildingSortKey,
  constructionProgress,
  entityAnimPhase,
  hpArcParams,
  resolveGhostRangeCircles,
  resolveSelectedCombatRange,
  resolveTileHoverHighlight,
  resolveUnitDirection,
  resourceDecalLayout,
  smoothingBlend,
  UNIT_SMOOTHING_RATE,
  unitSortKey,
  unitWedgePoints,
} from '@/features/planet-map/planet-scene';

describe('planet-scene 纯函数', () => {
  it('smoothingBlend：dt=0 不动，dt 越大越接近 1（帧率无关的指数趋近）', () => {
    expect(smoothingBlend(0)).toBe(0);
    const small = smoothingBlend(1 / 60);
    const large = smoothingBlend(1 / 30);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(large);
    expect(large).toBeLessThan(1);
    // k≈8/s 时 60fps 单帧约 12.5% 的剩余距离被消除
    expect(smoothingBlend(1 / 60)).toBeCloseTo(1 - Math.exp(-UNIT_SMOOTHING_RATE / 60), 6);
  });

  it('buildDashSegments：空 pattern 退化为整条线段', () => {
    expect(buildDashSegments(0, 0, 10, 0, [])).toEqual([[0, 0, 10, 0]]);
  });

  it('buildDashSegments：按画/空交替切段，段落总长不超过原线段', () => {
    // 水平 25px 线段，画 8 空 6：画段 [0,8]、[14,22]，剩 3px 落在"空"档内被截断
    const segments = buildDashSegments(0, 0, 25, 0, [8, 6]);
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual([0, 0, 8, 0]);
    expect(segments[1]).toEqual([14, 0, 22, 0]);

    // 段落都在线段内部且互不相交
    const drawn = segments.reduce((sum, [ax, , bx]) => sum + (bx - ax), 0);
    expect(drawn).toBeLessThanOrEqual(25);
  });

  it('buildDashSegments：斜线按单位向量投影切段', () => {
    const segments = buildDashSegments(0, 0, 6, 8, [5, 5]); // 长度 10
    expect(segments.length).toBe(1);
    const [ax, ay, bx, by] = segments[0];
    expect(ax).toBe(0);
    expect(ay).toBe(0);
    expect(bx).toBeCloseTo(3, 6);
    expect(by).toBeCloseTo(4, 6);
  });

  it('buildDashSegments：零长线段不产生段落', () => {
    expect(buildDashSegments(3, 3, 3, 3, [4, 4])).toEqual([]);
  });
});

describe('范围圈纯函数', () => {
  const catalog = {
    buildings: [
      { id: 'gauss_turret', combat_range: 5 },
      { id: 'tesla_tower', power_range: 4 },
      { id: 'jammer_tower', combat_range: 8 },
      { id: 'wind_turbine' },
    ],
  } as unknown as CatalogView;

  const makeBuilding = (functions?: BuildingFunctionModules): Building => ({
    id: 'b-1',
    type: 'gauss_turret',
    owner_id: 'p-1',
    position: { x: 3, y: 3, z: 0 },
    hp: 100,
    max_hp: 100,
    level: 1,
    vision_range: 6,
    runtime: {
      params: {
        energy_consume: 3,
        energy_generate: 0,
        capacity: 0,
        maintenance_cost: { minerals: 0, energy: 0 },
        footprint: { width: 1, height: 1 },
      },
      functions,
      state: 'running',
    },
  });

  it('resolveGhostRangeCircles：combat_range/power_range 各出一圈，无范围字段不画', () => {
    expect(resolveGhostRangeCircles(catalog, 'gauss_turret')).toEqual([{ kind: 'combat', radiusTiles: 5 }]);
    expect(resolveGhostRangeCircles(catalog, 'tesla_tower')).toEqual([{ kind: 'power', radiusTiles: 4 }]);
    expect(resolveGhostRangeCircles(catalog, 'wind_turbine')).toEqual([]);
    expect(resolveGhostRangeCircles(catalog, 'unknown_type')).toEqual([]);
    expect(resolveGhostRangeCircles(catalog, undefined)).toEqual([]);
    expect(resolveGhostRangeCircles(undefined, 'gauss_turret')).toEqual([]);
  });

  it('resolveGhostRangeCircles：零/负半径防御性忽略', () => {
    const zeroCatalog = {
      buildings: [{ id: 'broken', combat_range: 0, power_range: -1 }],
    } as unknown as CatalogView;
    expect(resolveGhostRangeCircles(zeroCatalog, 'broken')).toEqual([]);
  });

  it('resolveSelectedCombatRange：已放置防御建筑读 runtime.functions.combat.range', () => {
    expect(resolveSelectedCombatRange(makeBuilding({ combat: { attack: 15, range: 5 } }))).toBe(5);
    expect(resolveSelectedCombatRange(makeBuilding({ power_grid: { wireless_range: 4 } }))).toBeUndefined();
    expect(resolveSelectedCombatRange(makeBuilding(undefined))).toBeUndefined();
    expect(resolveSelectedCombatRange(makeBuilding({ combat: { attack: 0, range: 0 } }))).toBeUndefined();
    expect(resolveSelectedCombatRange(null)).toBeUndefined();
    expect(resolveSelectedCombatRange(undefined)).toBeUndefined();
  });

  it('buildDashArcSegments：空 pattern 退化为闭合整圆', () => {
    const segments = buildDashArcSegments(10, 20, 30, []);
    expect(segments.length).toBeGreaterThanOrEqual(24);
    const [firstX, firstY] = [segments[0][0], segments[0][1]];
    const [, , lastX, lastY] = segments[segments.length - 1];
    // 首尾闭合（末段终点 = 首段起点）
    expect(lastX).toBeCloseTo(firstX, 6);
    expect(lastY).toBeCloseTo(firstY, 6);
    // 所有点都在圆周上
    for (const [ax, ay, bx, by] of segments) {
      expect(Math.hypot(ax - 10, ay - 20)).toBeCloseTo(30, 6);
      expect(Math.hypot(bx - 10, by - 20)).toBeCloseTo(30, 6);
    }
  });

  it('buildDashArcSegments：虚线产生空隙，画段总弧长小于整圆', () => {
    const solid = buildDashArcSegments(0, 0, 20, []);
    const dashed = buildDashArcSegments(0, 0, 20, [8, 6]);
    expect(dashed.length).toBeLessThan(solid.length);
    expect(dashed.length).toBeGreaterThan(0);
    // 画段都在圆周上
    for (const [ax, ay] of dashed) {
      expect(Math.hypot(ax, ay)).toBeCloseTo(20, 6);
    }
  });

  it('buildDashArcSegments：零半径/全 0 pattern 防御', () => {
    expect(buildDashArcSegments(0, 0, 0, [8, 6])).toEqual([]);
    expect(buildDashArcSegments(0, 0, -3, [8, 6])).toEqual([]);
    // 全 0 pattern 退化为整圆（不死循环）
    const solid = buildDashArcSegments(0, 0, 10, [0, 0]);
    expect(solid.length).toBeGreaterThanOrEqual(24);
  });
});

describe('单位楔形与朝向', () => {
  it('unitWedgePoints：顶点朝正上，尾部分叉内凹（能读出朝向）', () => {
    const points = unitWedgePoints(10);
    // 4 个顶点：tip (0,-r)、右后、内凹、左后
    expect(points.length).toBe(8);
    expect(points[0]).toBe(0);
    expect(points[1]).toBe(-10); // tip 在最上方
    const minY = Math.min(...points.filter((_, i) => i % 2 === 1));
    expect(points[1]).toBe(minY);
    // 左右对称
    expect(points[2]).toBeCloseTo(-points[6], 6);
    expect(points[3]).toBeCloseTo(points[7], 6);
  });

  it('resolveUnitDirection：移动中朝 target_pos', () => {
    const dir = resolveUnitDirection(
      { position: { x: 1, y: 1, z: 0 }, is_moving: true, target_pos: { x: 4, y: 5, z: 0 } },
      { x: 0, y: -1 },
      () => null,
    );
    expect(dir.x).toBeCloseTo(3 / 5, 6);
    expect(dir.y).toBeCloseTo(4 / 5, 6);
  });

  it('resolveUnitDirection：无移动时朝 attack_target，都无则保留 fallback', () => {
    const dir = resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: false, attack_target: 'b1' },
      { x: 0, y: -1 },
      (id) => (id === 'b1' ? { x: 5, y: 2 } : null),
    );
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.y).toBeCloseTo(0, 6);

    const fallback = { x: 0.6, y: -0.8 };
    expect(resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: false },
      fallback,
      () => null,
    )).toBe(fallback);
    // 目标与本格重合时也保留 fallback
    expect(resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: true, target_pos: { x: 2, y: 2, z: 0 } },
      fallback,
      () => null,
    )).toBe(fallback);
  });
});

describe('HP 弧参数', () => {
  it('满血/无数据不绘制；受伤才绘制', () => {
    expect(hpArcParams(100, 100).visible).toBe(false);
    expect(hpArcParams(undefined, 100).visible).toBe(false);
    expect(hpArcParams(50, 0).visible).toBe(false);
    expect(hpArcParams(50, 100).visible).toBe(true);
  });

  it('ratio 截断到 [0,1]；颜色满血绿、半血黄、残血红', () => {
    expect(hpArcParams(120, 100).ratio).toBe(1);
    expect(hpArcParams(-10, 100).ratio).toBe(0);
    expect(hpArcParams(100, 100).color).toBe(0x69db7c);
    expect(hpArcParams(50, 100).color).toBe(0xffd43b);
    expect(hpArcParams(0, 100).color).toBe(0xe03131);
    // 中间值单调：75% 的绿度高于 25%
    const high = hpArcParams(75, 100).color;
    const low = hpArcParams(25, 100).color;
    expect((high >> 8) & 0xff).toBeGreaterThan((low >> 8) & 0xff);
  });
});

describe('遮挡排序键', () => {
  it('buildingSortKey：取 footprint 底行 y（结构向上溢出，底行大者后画压前）', () => {
    expect(buildingSortKey(3, 1)).toBe(4);
    expect(buildingSortKey(3, 2)).toBe(5);
    // 同列上下两个 1 高建筑：北侧（y 小）先画
    expect(buildingSortKey(2, 1)).toBeLessThan(buildingSortKey(3, 1));
  });

  it('unitSortKey：显示位置像素 y → 小数 tile y（支持平滑移动中的帧间值）', () => {
    expect(unitSortKey(16, 8)).toBe(2);
    expect(unitSortKey(20, 8)).toBeCloseTo(2.5, 6);
    // 防御：tileSize 异常时不产生 Infinity/NaN
    expect(Number.isFinite(unitSortKey(10, 0))).toBe(true);
  });

  it('建筑与单位同键空间：单位在高建筑北侧（y 更小）先画被遮挡，南侧后画压建筑', () => {
    // 1×1 塔 footprint y=5（底行键 6）；单位中心 y=4.5（北侧）→ 4.5 < 6 先画
    const towerKey = buildingSortKey(5, 1);
    expect(unitSortKey(4.5 * 8, 8)).toBeLessThan(towerKey);
    // 单位走到南侧 y=6.5 → 后画压塔底座
    expect(unitSortKey(6.5 * 8, 8)).toBeGreaterThan(towerKey);
  });
});

describe('地块 hover 轻量高亮状态机', () => {
  it('inspect 模式悬停即亮，返回原 tile 引用', () => {
    const tile = { x: 3, y: 4 };
    expect(resolveTileHoverHighlight(tile, { kind: 'inspect' }, false)).toBe(tile);
  });

  it('move/attack 模式同样给高亮（准星叠加在其上）', () => {
    const tile = { x: 1, y: 2 };
    expect(resolveTileHoverHighlight(tile, { kind: 'move', unitId: 'u1' }, false)).toBe(tile);
    expect(resolveTileHoverHighlight(tile, { kind: 'attack', unitId: 'u1' }, false)).toBe(tile);
  });

  it('build 模式不叠加（幽灵 footprint 承担悬停反馈）', () => {
    expect(resolveTileHoverHighlight(
      { x: 1, y: 2 },
      { kind: 'build', buildingType: 'assembler', direction: 'east' },
      false,
    )).toBeNull();
  });

  it('overview 或无 hover 时隐藏', () => {
    expect(resolveTileHoverHighlight({ x: 1, y: 2 }, { kind: 'inspect' }, true)).toBeNull();
    expect(resolveTileHoverHighlight(null, { kind: 'inspect' }, false)).toBeNull();
  });
});

describe('工地进度与资源贴花', () => {
  it('constructionProgress：remaining/total 可算时返回比例，缺数据返回 null', () => {
    expect(constructionProgress({ state: 'completed' })).toBe(1);
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 30, total_ticks: 100 })).toBeCloseTo(0.7, 6);
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 0, total_ticks: 100 })).toBe(1);
    expect(constructionProgress({ state: 'pending' })).toBeNull();
    expect(constructionProgress({ state: 'in_progress' })).toBeNull();
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 5, total_ticks: 0 })).toBeNull();
  });

  it('resourceDecalLayout：同 kind 同形（确定性），3 片晶簇 + 底托', () => {
    const first = resourceDecalLayout('iron_ore', 12);
    const second = resourceDecalLayout('iron_ore', 12);
    expect(first).toEqual(second);
    expect(first.shards.length).toBe(3);
    // 晶簇尖端在底边上方（负 y），底托扁椭圆
    for (const shard of first.shards) {
      expect(shard[5]).toBeLessThan(0);
    }
    expect(first.baseRadiusX).toBeGreaterThan(first.baseRadiusY);
    // 不同 kind 形状不同
    expect(resourceDecalLayout('coal', 12)).not.toEqual(first);
  });

  it('entityAnimPhase：确定性且落在 [0, 2π)', () => {
    expect(entityAnimPhase('bldg-1')).toBe(entityAnimPhase('bldg-1'));
    expect(entityAnimPhase('bldg-1')).not.toBe(entityAnimPhase('bldg-2'));
    for (const id of ['a', 'bb', 'wind-3', '特斯拉']) {
      const phase = entityAnimPhase(id);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
    }
  });
});
