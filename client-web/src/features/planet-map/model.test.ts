import type { PlanetView } from '@shared/types';

import {
  buildSceneWindow,
  canonicalTileIndex,
  centerCameraAxisOffset,
  clampCameraAxisOffset,
  getBuildingDisplayName,
  getViewportTileBounds,
  isWrapAxisEnabled,
  mergeRecentEvents,
  normalizeWrappedAxisOffset,
  resolveCameraAxisOffset,
  resolveFocusCameraAxisOffset,
  resolveHomeTile,
  resolveSelectionAtTile,
  summarizeEvent,
  wrapMod,
} from '@/features/planet-map/model';

function createPlanetFixture(): PlanetView {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 4,
    map_height: 4,
    tick: 18,
    terrain: [
      ['buildable', 'buildable', 'buildable', 'water'],
      ['buildable', 'buildable', 'buildable', 'water'],
      ['blocked', 'buildable', 'buildable', 'lava'],
      ['buildable', 'buildable', 'buildable', 'buildable'],
    ],
    buildings: {
      'miner-1': {
        id: 'miner-1',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 5,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 2, height: 1 },
          },
          state: 'running',
        },
      },
    },
    units: {
      'worker-1': {
        id: 'worker-1',
        type: 'worker',
        owner_id: 'p1',
        position: { x: 0, y: 3, z: 0 },
        hp: 20,
        max_hp: 20,
        attack: 2,
        defense: 1,
        attack_range: 1,
        move_range: 2,
        vision_range: 4,
        is_moving: false,
      },
    },
    resources: [
      {
        id: 'iron-1',
        planet_id: 'planet-1-1',
        kind: 'iron_ore',
        behavior: 'finite',
        position: { x: 0, y: 0, z: 0 },
        remaining: 900,
        current_yield: 3,
      },
    ],
  };
}

describe('planet map model helpers', () => {
  it('resolveHomeTile 优先返回自有建筑，其次自有单位，都没有返回 null', () => {
    const planet = createPlanetFixture();

    expect(resolveHomeTile(planet, 'p1')).toEqual({ x: 1, y: 1 });

    const noBuilding = { ...planet, buildings: {} };
    expect(resolveHomeTile(noBuilding, 'p1')).toEqual({ x: 0, y: 3 });

    expect(resolveHomeTile(planet, 'p2')).toBeNull();
    expect(resolveHomeTile(noBuilding, 'p2')).toBeNull();
  });

  it('按建筑、单位、资源优先级解析地块选中对象', () => {
    const planet = createPlanetFixture();

    expect(resolveSelectionAtTile(planet, 1, 1)).toMatchObject({
      kind: 'building',
      id: 'miner-1',
    });
    expect(resolveSelectionAtTile(planet, 2, 1)).toMatchObject({
      kind: 'building',
      id: 'miner-1',
    });
    expect(resolveSelectionAtTile(planet, 0, 3)).toMatchObject({
      kind: 'unit',
      id: 'worker-1',
    });
    expect(resolveSelectionAtTile(planet, 0, 0)).toMatchObject({
      kind: 'resource',
      id: 'iron-1',
    });
  });

  it('合并事件时按 tick 倒序去重', () => {
    const merged = mergeRecentEvents(
      [
        {
          event_id: 'evt-1',
          tick: 10,
          event_type: 'entity_created',
          visibility_scope: 'p1',
          payload: {},
        },
      ],
      [
        {
          event_id: 'evt-2',
          tick: 12,
          event_type: 'tick_completed',
          visibility_scope: 'all',
          payload: { tick: 12 },
        },
        {
          event_id: 'evt-1',
          tick: 10,
          event_type: 'entity_created',
          visibility_scope: 'p1',
          payload: { entity_id: 'miner-1' },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].event_id).toBe('evt-2');
    expect(summarizeEvent(merged[0])).toContain('tick 12');
  });

  it('已知类型和状态摘要走中文翻译，未知值回退原值', () => {
    expect(getBuildingDisplayName(undefined, 'planetary_logistics_station')).toBe(
      '行星物流站',
    );

    expect(
      summarizeEvent({
        event_id: 'evt-3',
        tick: 13,
        event_type: 'building_state_changed',
        visibility_scope: 'p1',
        payload: {
          building_id: 'miner-1',
          prev_state: 'idle',
          next_state: 'running',
        },
      }),
    ).toContain('空闲 -> 运行中');

    expect(getBuildingDisplayName(undefined, 'unknown_building')).toBe(
      'unknown_building',
    );
  });
});

describe('相机小图居中与钳位', () => {
  it('centerCameraAxisOffset：小图轴取视口中心', () => {
    expect(centerCameraAxisOffset(384, 1440)).toBe(528);
    expect(centerCameraAxisOffset(384, 1080)).toBe(348);
    // 大图轴公式同样成立（调用方只在 worldPx < viewportPx 时使用）
    expect(centerCameraAxisOffset(2000, 1440)).toBe(-280);
  });

  it('clampCameraAxisOffset：小图轴钳在"地图中心不出视口"范围内', () => {
    // 世界 384px < 视口 1440px：offset ∈ [center-720, center+720] = [-192, 1248]
    expect(clampCameraAxisOffset(384, 1440, 528)).toBe(528); // 居中不动
    expect(clampCameraAxisOffset(384, 1440, 62)).toBe(62); // 范围内保留拖拽结果
    expect(clampCameraAxisOffset(384, 1440, -500)).toBe(-192); // 左向越界 → 钳住
    expect(clampCameraAxisOffset(384, 1440, 2000)).toBe(1248); // 右向越界 → 钳住
  });

  it('clampCameraAxisOffset：大图轴不钳（自由拖拽）', () => {
    expect(clampCameraAxisOffset(16000, 1440, -8000)).toBe(-8000);
    expect(clampCameraAxisOffset(16000, 1440, 32)).toBe(32);
  });

  it('resolveFocusCameraAxisOffset：小图轴聚焦退化为居中，大图轴聚焦目标', () => {
    expect(resolveFocusCameraAxisOffset(384, 1440, 900)).toBe(528);
    expect(resolveFocusCameraAxisOffset(16000, 1440, -1200)).toBe(-1200);
  });
});

describe('环绕渲染（toroidal wrap）', () => {
  it('wrapMod：非负取模', () => {
    expect(wrapMod(-4, 1000)).toBe(996);
    expect(wrapMod(-1000, 1000)).toBe(0);
    expect(wrapMod(-1001, 1000)).toBe(999);
    expect(wrapMod(5, 1000)).toBe(5);
    expect(wrapMod(1005, 1000)).toBe(5);
    expect(wrapMod(7, 0)).toBe(7); // size<=0 原样返回（防御）
  });

  it('isWrapAxisEnabled：世界像素大于视口才启用环绕', () => {
    expect(isWrapAxisEnabled(8000, 960)).toBe(true);
    expect(isWrapAxisEnabled(960, 960)).toBe(false);
    expect(isWrapAxisEnabled(800, 960)).toBe(false);
  });

  it('normalizeWrappedAxisOffset：映射到 (margin-worldPx, margin] 且周期等价', () => {
    expect(normalizeWrappedAxisOffset(8000, 32)).toBe(32); // 区间内不动
    expect(normalizeWrappedAxisOffset(8000, 100)).toBe(100 - 8000);
    expect(normalizeWrappedAxisOffset(8000, -16000)).toBe(0);
    expect(normalizeWrappedAxisOffset(8000, -7968)).toBe(32); // -7968 + 8000
    // 任意输入都落在 (32-8000, 32]
    for (const value of [0, 31.5, -7968, -7969, 12345, -987654]) {
      const next = normalizeWrappedAxisOffset(8000, value);
      expect(next).toBeGreaterThan(32 - 8000);
      expect(next).toBeLessThanOrEqual(32);
    }
  });

  it('resolveCameraAxisOffset：环绕轴归一化、小图轴维持钳位', () => {
    expect(resolveCameraAxisOffset(8000, 960, -9000)).toBe(-1000);
    expect(resolveCameraAxisOffset(384, 1440, -500)).toBe(-192); // 小图轴旧钳位
  });

  it('canonicalTileIndex：映射到以 cut 为起点的周期内', () => {
    expect(canonicalTileIndex(2, 996, 1000)).toBe(1002);
    expect(canonicalTileIndex(998, 996, 1000)).toBe(998);
    expect(canonicalTileIndex(996, 996, 1000)).toBe(996);
    expect(canonicalTileIndex(5, -4, 1000)).toBe(5);
    expect(canonicalTileIndex(998, -4, 1000)).toBe(-2);
    // 映射结果恒在 [cut, cut+size)
    expect(canonicalTileIndex(0, 996, 1000)).toBe(1000);
  });

  it('getViewportTileBounds：环绕轴保留 unwrapped 范围，中心取模回真实 tile', () => {
    const bigPlanet = {
      ...createPlanetFixture(),
      map_width: 1000,
      map_height: 1000,
    };
    const bounds = getViewportTileBounds(
      bigPlanet,
      { offsetX: 32, offsetY: -7992, zoomIndex: 6 },
      8,
      960,
      640,
    );
    expect(bounds.wrapX).toBe(true);
    expect(bounds.wrapY).toBe(true);
    expect(bounds.minX).toBe(-4); // floor(-32/8)，不再钳到 0
    expect(bounds.maxX).toBe(115);
    expect(bounds.minY).toBe(999); // floor(7992/8)
    expect(bounds.maxY).toBe(1078);
    expect(bounds.centerX).toBeCloseTo(55.5);
    expect(bounds.centerY).toBeCloseTo(38.5); // (999+1078)/2=1038.5 → mod 1000
    expect(bounds.mapWidth).toBe(1000);
  });

  it('getViewportTileBounds：小地图（世界<视口）不启用环绕，维持钳位', () => {
    const bounds = getViewportTileBounds(
      createPlanetFixture(), // 4×4
      { offsetX: 400, offsetY: 400, zoomIndex: 6 },
      8,
      960,
      640,
    );
    expect(bounds.wrapX).toBe(false);
    expect(bounds.wrapY).toBe(false);
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(3);
  });

  it('buildSceneWindow：环绕轴跨接缝时整轴拉取，未跨接缝维持原窗口', () => {
    const bigPlanet = {
      ...createPlanetFixture(),
      map_width: 1000,
      map_height: 1000,
    };
    // offsetX=32 → 可见范围 [-4, 115]，左侧跨接缝
    const crossing = buildSceneWindow(
      bigPlanet,
      { offsetX: 32, offsetY: -4000, zoomIndex: 6 },
      8,
      960,
      640,
    );
    expect(crossing.x).toBe(0);
    expect(crossing.width).toBe(1000);
    expect(crossing.y).toBeGreaterThanOrEqual(0);
    expect(crossing.height).toBeLessThan(1000);

    // 视口完全在地图内部 → 不跨接缝，窗口走原有 padding/对齐逻辑
    const inside = buildSceneWindow(
      bigPlanet,
      { offsetX: -4000, offsetY: -4000, zoomIndex: 6 },
      8,
      960,
      640,
    );
    expect(inside.width).toBeLessThan(1000);
    expect(inside.x).toBeGreaterThan(0);
    expect(inside.x + inside.width).toBeLessThanOrEqual(1000);
  });
});
