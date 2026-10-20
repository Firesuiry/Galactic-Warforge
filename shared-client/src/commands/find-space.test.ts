import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { ApiClient } from '../api.js';
import type {
  Building,
  CatalogView,
  ConstructionTaskView,
  MechaView,
  PlanetRuntimeView,
  PlanetSceneView,
  StateSummary,
  Unit,
} from '../types.js';

import {
  buildBlockedGrid,
  cmdFindSpace,
  distanceToRect,
  findSpaceRects,
  hasOverlap,
  radiusWindow,
  rotatedFootprint,
} from './find-space.js';

const FOOTPRINTS = new Map([
  ['arc_smelter', { width: 3, height: 3 }],
  ['wind_turbine', { width: 2, height: 2 }],
  ['conveyor_belt_mk1', { width: 1, height: 1 }],
]);

function building(id: string, type: string, x: number, y: number, w: number, h: number): Building {
  return {
    id,
    type,
    owner_id: 'p1',
    position: { x, y, z: 0 },
    hp: 100,
    max_hp: 100,
    level: 1,
    vision_range: 1,
    runtime: {
      params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: w, height: h } },
      state: 'running',
    },
  };
}

function unit(id: string, x: number, y: number, domain?: string): Unit {
  return {
    id,
    type: 'mecha',
    owner_id: 'p1',
    position: { x, y, z: 0 },
    hp: 10,
    max_hp: 10,
    attack: 0,
    defense: 0,
    attack_range: 0,
    move_range: 1,
    vision_range: 1,
    ...(domain ? { domain } : {}),
  } as Unit;
}

function task(overrides: Partial<ConstructionTaskView> = {}): ConstructionTaskView {
  return {
    id: 'c-1',
    player_id: 'p1',
    building_type: 'wind_turbine',
    position: { x: 0, y: 0, z: 0 },
    state: 'pending',
    enqueue_tick: 1,
    ...overrides,
  };
}

/** 8×8 全 buildable 的场景。 */
function scene(overrides: Partial<PlanetSceneView> = {}): PlanetSceneView {
  const terrain = Array.from({ length: 8 }, () => new Array<string>(8).fill('buildable'));
  return {
    surface: { topology: 'cube_sphere', face_size: 8 },
    planet_id: 'planet-1-1',
    discovered: true,
    map_width: 8,
    map_height: 8,
    tick: 1,
    bounds: { x: 0, y: 0, width: 8, height: 8 },
    terrain,
    ...overrides,
  } as PlanetSceneView;
}

const mechaView = {
  unit_id: 'u-7', planet_id: 'planet-1-1', operator: 'builder-a', alive: true, respawn_at_tick: 0,
  position: { x: 3, y: 3, z: 0 },
  inventory: {}, inventory_slots_used: 0, inventory_slots_total: 40, operate_range: 18,
  concurrent_tasks: 2, construction_active: 0, construction_pending: 0,
} as MechaView;

function summary(mecha: MechaView | undefined = mechaView): StateSummary {
  return {
    tick: 1,
    active_planet_id: 'planet-1-1',
    surface: { topology: 'cube_sphere', face_size: 8 },
    map_width: 8,
    map_height: 8,
    players: {
      p1: { player_id: 'p1', is_alive: true, resources: { energy: 0 }, mechas: mecha ? [mecha] : [] },
    },
  } as unknown as StateSummary;
}

const catalog = {
  buildings: [
    { id: 'arc_smelter', footprint: { width: 3, height: 3 } },
    { id: 'wind_turbine', footprint: { width: 2, height: 2 } },
    { id: 'conveyor_belt_mk1', footprint: { width: 1, height: 1 } },
  ],
} as unknown as CatalogView;

function fakeApi(options: {
  scene?: PlanetSceneView;
  tasks?: ConstructionTaskView[];
  mecha?: MechaView;
} = {}) {
  const sceneView = options.scene ?? scene();
  const runtime = {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 1,
    threat_level: 0,
    construction_tasks: options.tasks ?? [],
  } as PlanetRuntimeView;
  const calls: string[] = [];
  const api = {
    getAuth: () => ({ playerId: 'p1', issuerId: 'builder-a', issuerType: 'agent' }),
    fetchSummary: async () => { calls.push('summary'); return summary(options.mecha); },
    fetchPlanet: async (planetId: string) => { calls.push('planet'); return { planet_id: planetId, map_width: 8, map_height: 8 }; },
    fetchPlanetScene: async (_planetId: string, params: { x: number; y: number; width: number; height: number }) => {
      calls.push(`scene ${params.x},${params.y} ${params.width}x${params.height}`);
      return sceneView;
    },
    fetchPlanetRuntime: async () => { calls.push('runtime'); return runtime; },
    fetchCatalog: async () => catalog,
  } as unknown as ApiClient;
  return { api, calls };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('find_space 占地与占用', () => {
  it('按实际占地排除建筑，而不是只排锚点', () => {
    const blocked = buildBlockedGrid({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      terrain: scene().terrain,
      buildings: [building('b-1', 'arc_smelter', 2, 2, 3, 3)],
      units: [],
      tasks: [],
      footprints: FOOTPRINTS,
    });
    // 占地 2..4 × 2..4 全被挡，锚点之外也挡。
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        assert.equal(blocked[y][x], true, `(${x},${y}) 应在占地内`);
      }
    }
    assert.equal(blocked[1][1], false);
  });

  it('施工任务按 building_type 的占地排除；高架带只占一格；completed/cancelled 不占位', () => {
    const blocked = buildBlockedGrid({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      terrain: scene().terrain,
      buildings: [],
      units: [],
      tasks: [
        task({ id: 'c-1', building_type: 'wind_turbine', position: { x: 0, y: 0, z: 0 }, state: 'pending' }),
        task({ id: 'c-2', building_type: 'arc_smelter', position: { x: 4, y: 0, z: 0 }, state: 'in_progress', elevation: 2 }),
        task({ id: 'c-3', building_type: 'arc_smelter', position: { x: 0, y: 5, z: 0 }, state: 'cancelled' }),
        task({ id: 'c-4', building_type: 'arc_smelter', position: { x: 4, y: 5, z: 0 }, state: 'completed' }),
      ],
      footprints: FOOTPRINTS,
    });
    assert.equal(blocked[0][0], true);
    assert.equal(blocked[1][1], true);
    assert.equal(blocked[2][0], false);
    // 高架带只占 (4,0)，3×3 占地其余格不算占用。
    assert.equal(blocked[0][4], true);
    assert.equal(blocked[1][4], false);
    assert.equal(blocked[5][0], false);
    assert.equal(blocked[5][4], false);
  });

  it('地面单位占格，空中/轨道单位不占格', () => {
    const blocked = buildBlockedGrid({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      terrain: scene().terrain,
      buildings: [],
      units: [unit('u-1', 1, 1), unit('u-2', 5, 5, 'air'), unit('u-3', 6, 6, 'space')],
      tasks: [],
      footprints: FOOTPRINTS,
    });
    assert.equal(blocked[1][1], true);
    assert.equal(blocked[5][5], false);
    assert.equal(blocked[6][6], false);
  });

  it('地形不是 buildable 的格子排除', () => {
    const terrain = scene().terrain as string[][];
    terrain[4][4] = 'water';
    const blocked = buildBlockedGrid({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      terrain,
      buildings: [],
      units: [],
      tasks: [],
      footprints: FOOTPRINTS,
    });
    assert.equal(blocked[4][4], true);
    assert.equal(blocked[4][3], false);
  });
});

describe('find_space 矩形枚举', () => {
  it('窗口边界：只返回完整落在窗口内的矩形', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 2, y: 2, width: 4, height: 4 },
      blocked,
      size: { width: 3, height: 3 },
      anchor: { x: 2, y: 2 },
      count: 10,
    });
    assert.deepEqual(found.results.map((spot) => [spot.x, spot.y]), [[2, 2], [3, 2], [2, 3], [3, 3]]);
  });

  it('跨立方体球面缝的候选跳过并计数', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 3, height: 3 },
      anchor: { x: 0, y: 0 },
      count: 100,
      faceSize: 8,
    });
    // 8×8 单面里 3×3 的候选全部在面内（x=5 时 5..7 仍在本面）。
    assert.equal(found.skippedSeam, 0);

    // 面尺寸 4：图集 8×8 有 4 个面，x=2..5 的 3 宽矩形跨缝。
    const crossed = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 3, height: 3 },
      anchor: { x: 0, y: 0 },
      count: 100,
      faceSize: 4,
    });
    assert.ok(crossed.skippedSeam > 0);
    for (const spot of crossed.results) {
      assert.ok(spot.x <= 1 || spot.x >= 4, `跨缝矩形不应返回：x=${spot.x}`);
    }
  });

  it('按距锚点升序取前 count 条', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 1, height: 1 },
      anchor: { x: 0, y: 0 },
      count: 3,
    });
    assert.equal(found.results.length, 3);
    assert.deepEqual(found.results.map((spot) => [spot.x, spot.y]), [[0, 0], [1, 0], [0, 1]]);
    assert.ok(found.results[0].distance <= found.results[1].distance);
  });

  it('无解：候选都被占用时返回空', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(true));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 2, height: 2 },
      anchor: { x: 0, y: 0 },
      count: 5,
    });
    assert.equal(found.results.length, 0);
    assert.ok(found.candidates > 0);
  });

  it('--spacing：已选候选的锚点曼哈顿距离 ≥ n', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 1, height: 1 },
      anchor: { x: 0, y: 0 },
      count: 3,
      spacing: 3,
    });
    assert.equal(found.results.length, 3);
    assert.deepEqual([found.results[0].x, found.results[0].y], [0, 0]);
    for (let i = 0; i < found.results.length; i += 1) {
      for (let j = i + 1; j < found.results.length; j += 1) {
        const a = found.results[i];
        const b = found.results[j];
        assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= 3, `${a.x},${a.y} 与 ${b.x},${b.y} 太近`);
      }
    }
  });

  it('--spacing 缺省 0：行为不变（相邻候选全返回）', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 1, height: 1 },
      anchor: { x: 0, y: 0 },
      count: 3,
    });
    assert.deepEqual(found.results.map((spot) => [spot.x, spot.y]), [[0, 0], [1, 0], [0, 1]]);
  });

  it('距机甲与距锚点分开算', () => {
    const blocked = Array.from({ length: 8 }, () => new Array<boolean>(8).fill(false));
    const found = findSpaceRects({
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      search: { x: 0, y: 0, width: 8, height: 8 },
      blocked,
      size: { width: 1, height: 1 },
      anchor: { x: 0, y: 0 },
      mechaAnchor: { x: 7, y: 7 },
      count: 2,
    });
    // 按锚点距离排序；距机甲 = 7+7。
    assert.deepEqual(found.results[0], { x: 0, y: 0, distance: 0, mechaDistance: 10, terrain: 'buildable' });
  });

  it('hasOverlap 识别互相重叠的候选', () => {
    const size = { width: 3, height: 3 };
    assert.equal(hasOverlap([
      { x: 0, y: 0, distance: 0, mechaDistance: 0, terrain: 'buildable' },
      { x: 2, y: 2, distance: 0, mechaDistance: 0, terrain: 'buildable' },
    ], size), true);
    assert.equal(hasOverlap([
      { x: 0, y: 0, distance: 0, mechaDistance: 0, terrain: 'buildable' },
      { x: 3, y: 0, distance: 0, mechaDistance: 0, terrain: 'buildable' },
    ], size), false);
  });

  it('rotation 90/270 交换宽高', () => {
    assert.deepEqual(rotatedFootprint({ width: 2, height: 3 }, '90'), { width: 3, height: 2 });
    assert.deepEqual(rotatedFootprint({ width: 2, height: 3 }, '270'), { width: 3, height: 2 });
    assert.deepEqual(rotatedFootprint({ width: 2, height: 3 }, '180'), { width: 2, height: 3 });
  });

  it('distanceToRect 用最近一格', () => {
    assert.equal(distanceToRect({ x: 0, y: 0 }, { x: 3, y: 4, width: 2, height: 2 }), 5);
    assert.equal(distanceToRect({ x: 4, y: 5 }, { x: 3, y: 4, width: 2, height: 2 }), 0);
  });
});

describe('cmdFindSpace 命令', () => {
  it('机甲周围找 3x3，输出坐标与距离，并请求扩展窗口', async () => {
    const { api, calls } = fakeApi();
    const out = stripAnsi(await cmdFindSpace(['3', '3', '--count', '2'], { api, issuerId: 'builder-a' }));
    // 锚点 (3,3) 落在 (1..3, 1..3) 的 3×3 矩形内，距离 0；按 y、x 升序取前两条。
    assert.match(out, /空地 3x3 @ \(1,1\)\s+距锚点 0\s+距机甲 0/);
    assert.match(out, /空地 3x3 @ \(2,1\)\s+距锚点 0\s+距机甲 0/);
    // 相邻候选重叠时提示 --spacing。
    assert.match(out, /--spacing <n>，建议 3/);
    assert.match(calls.find((call) => call.startsWith('scene')) ?? '', /^scene 0,0 8x8$/);
  });

  it('--near 接受两个位置参数或逗号写法', async () => {
    const { api } = fakeApi();
    const spaced = stripAnsi(await cmdFindSpace(['1', '1', '--near', '6', '6', '--count', '1'], { api }));
    assert.match(spaced, /空地 1x1 @ \(6,6\)/);
    const comma = stripAnsi(await cmdFindSpace(['1', '1', '--near', '6,6', '--count', '1'], { api }));
    assert.match(comma, /空地 1x1 @ \(6,6\)/);
  });

  it('--json 输出结构化结果', async () => {
    const { api } = fakeApi();
    const out = await cmdFindSpace(['2', '2', '--count', '1', '--json'], { api });
    const parsed = JSON.parse(out) as {
      results: Array<{ x: number; y: number; distance: number; mechaDistance: number }>;
      window: { width: number };
      spacing: number;
    };
    assert.equal(parsed.results.length, 1);
    assert.equal(typeof parsed.results[0].distance, 'number');
    assert.equal(typeof parsed.results[0].mechaDistance, 'number');
    assert.equal(parsed.window.width, 8);
    assert.equal(parsed.spacing, 0);
  });

  it('--spacing 生效：3x3 在 8x8 里取分散候选，且不再提示重叠', async () => {
    const { api } = fakeApi();
    const out = stripAnsi(await cmdFindSpace(['3', '3', '--count', '3', '--spacing', '3'], { api }));
    assert.doesNotMatch(out, /候选互相重叠/);
    const spots = [...out.matchAll(/空地 3x3 @ \((\d+),(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.ok(spots.length >= 2);
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const dist = Math.abs(spots[i][0] - spots[j][0]) + Math.abs(spots[i][1] - spots[j][1]);
        assert.ok(dist >= 3, `${spots[i]} 与 ${spots[j]} 距离 ${dist} < 3`);
      }
    }
  });

  it('--near 时同时输出距锚点与距机甲', async () => {
    const { api } = fakeApi();
    const out = stripAnsi(await cmdFindSpace(['1', '1', '--near', '6', '6', '--count', '1'], { api }));
    // 机甲在 (3,3)，锚点 (6,6)：候选 (6,6) 距锚点 0、距机甲 round(√18)=4。
    assert.match(out, /空地 1x1 @ \(6,6\)\s+距锚点 0\s+距机甲 4/);
  });

  it('--spacing 非整数报错', async () => {
    const { api } = fakeApi();
    assert.match(stripAnsi(await cmdFindSpace(['1', '1', '--spacing', 'x'], { api })), /--spacing 必须是非负整数/);
    assert.match(stripAnsi(await cmdFindSpace(['1', '1', '--spacing', '-2'], { api })), /--spacing 必须是非负整数/);
  });

  it('无解时报 ✗ 并说明候选数', async () => {
    const terrain = Array.from({ length: 8 }, () => new Array<string>(8).fill('blocked'));
    const { api } = fakeApi({ scene: scene({ terrain }) });
    const out = stripAnsi(await cmdFindSpace(['2', '2'], { api }));
    assert.match(out, /✗ 没找到 2x2 的空地/);
  });

  it('--radius 越界直接报错', async () => {
    const { api } = fakeApi();
    const out = stripAnsi(await cmdFindSpace(['2', '2', '--radius', '200'], { api }));
    assert.match(out, /--radius 必须在 1\.\.128/);
  });

  it('radiusWindow 按图集尺寸裁剪', () => {
    assert.deepEqual(radiusWindow({ x: 2, y: 2 }, 4, 20, 20), { x: 0, y: 0, width: 9, height: 9 });
    assert.deepEqual(radiusWindow({ x: 18, y: 18 }, 4, 20, 20), { x: 11, y: 11, width: 9, height: 9 });
  });
});
