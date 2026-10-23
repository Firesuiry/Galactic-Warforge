import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Building } from '@shared/types';
import { groundBuildingMap, sorterArmPose, sorterGripPoint, sorterSpan, SORTER_HANG, SORTER_GHOST_COLOR, SORTER_PIVOT_Y, SorterRigs } from './sorter-rig';
import { poseAt } from './sorter-animation';
import { getBuildingFootprint, toTilePoint } from '../model';
import { ROTATION_FACING, OPPOSITE_DIRECTION } from '../logistics-direction';

const FACE = 16;

/** 分拣器：rotation=90 → 正面（放货端）朝东，背面（取货端）朝西。 */
function sorter(x: number, y: number, rotation: number | string = 90, range = 3, state = 'running', id = 'sorter'): Building {
  return {
    id, type: 'sorter_mk1', position: { x, y, z: 0 }, owner_id: 'p', rotation: rotation as Building['rotation'],
    runtime: { state }, sorter: { cycle_ticks: 6, range },
  } as unknown as Building;
}
function belt(id: string, x: number, y: number, output = 'east', input = 'west', elevation = 0, owner = 'p', type = 'conveyor_belt_mk1'): Building {
  return { id, type, position: { x, y, z: 0 }, owner_id: owner,
    runtime: { state: 'running' }, conveyor: { input, output, ...(elevation ? { elevation } : {}) } } as unknown as Building;
}
function machine(id: string, x: number, y: number, owner = 'p', width = 1, height = 1, ports: string[] = ['both']): Building {
  return { id, type: 'arc_smelter', position: { x, y, z: 0 }, owner_id: owner, storage: {},
    runtime: { params: { footprint: { width, height },
      io_ports: ports.map((direction, index) => ({ id: `p${index}`, direction, offset: { x: 0, y: 0 }, capacity: 1 })) } } } as unknown as Building;
}
function ground(buildings: Building[]) { return groundBuildingMap(buildings, FACE); }
const spanOf = (buildings: Building[], range?: number) => sorterSpan(sorter(8, 8), ground(buildings), FACE, range);

describe('sorterSpan (real endpoints, contract §4.1)', () => {
  it('finds a belt on each side along the facing axis', () => {
    const span = spanOf([belt('west', 7, 8), belt('east', 9, 8)]);
    expect(span.pickup).toEqual({ steps: 1, kind: 'belt', depth: 1 });
    expect(span.drop).toEqual({ steps: 1, kind: 'belt', depth: 1 });
  });

  it('measures step distance up to the range cap (all tiers range 3)', () => {
    const span = spanOf([belt('west', 5, 8), belt('east', 11, 8)], 3);
    expect(span.pickup).toMatchObject({ steps: 3, kind: 'belt' });
    expect(span.drop).toMatchObject({ steps: 3, kind: 'belt' });
    // range=1 时看不到 3 格外的带子。
    expect(spanOf([belt('west', 5, 8), belt('east', 11, 8)], 1)).toEqual({ pickup: { steps: 1, kind: null, depth: 1 }, drop: { steps: 1, kind: null, depth: 1 } });
    // range 上限 3：传 10 也只扫 3 格。
    expect(spanOf([belt('west', 5, 8), belt('east', 11, 8)], 10).pickup.steps).toBe(3);
  });

  it('does not end on enemy buildings, splitters or elevated belts', () => {
    // 敌方带子：整条轴视为断头。
    expect(spanOf([belt('west', 7, 8, 'east', 'west', 0, 'enemy'), belt('east', 9, 8)]).pickup.kind).toBeNull();
    // 分流器不是分拣器端点（服务端 sorterFindEndpoint 只排除分流器）。
    const splitter = { ...belt('splitter', 7, 8), type: 'splitter',
      splitter: { input_directions: ['east'], output_directions: ['west'], input_cursor: 0, output_cursor: 0, transferred_items: 0, last_transfer_tick: 0 } } as Building;
    expect(spanOf([splitter]).pickup.kind).toBeNull();
    // 高架带不占地面：不挡地面端点，也不算地面端点。
    expect(spanOf([belt('high', 7, 8, 'east', 'west', 2)]).pickup.kind).toBeNull();
    // 高架带压在地面带上方时，分拣器只接地面带。
    const stacked = spanOf([belt('high', 7, 8, 'east', 'west', 2), belt('ground', 7, 8, 'east', 'west')]);
    expect(stacked.pickup).toMatchObject({ kind: 'belt', steps: 1 });
  });

  it('follows the server endpoint rules (sorterFindEndpoint parity)', () => {
    // 集装机带 conveyor、不是分流器 → 服务端照接，是带子端点。
    const piler = { ...belt('piler', 9, 8), type: 'automatic_piler' } as Building;
    expect(spanOf([piler]).drop).toEqual({ steps: 1, kind: 'belt', depth: 1 });
    // 停机/未运行的带子：两端都不接。
    expect(spanOf([{ ...belt('idle', 7, 8), runtime: { state: 'no_power' } } as Building]).pickup.kind).toBeNull();
    // 放货端：带子输出正对分拣器（output=west）时不收这一侧插入；取货端不挑朝向。
    expect(spanOf([belt('back', 9, 8, 'west', 'east')]).drop.kind).toBeNull();
    expect(spanOf([belt('back', 7, 8, 'east', 'west'), belt('away', 9, 8, 'east', 'west')]).drop.kind).toBe('belt');
    expect(spanOf([belt('toward', 7, 8, 'west', 'east')]).pickup.kind).toBe('belt');
    // 放货端：显式 input 是转弯侧（north）时只收北侧，不收西侧来的分拣器。
    expect(spanOf([belt('turn', 9, 8, 'east', 'north')]).drop.kind).toBeNull();
    // 建筑端点要有仓储 + 对应方向的 IO 口：取货要 output/both，放货要 input/both。
    expect(spanOf([machine('out', 7, 8, 'p', 1, 1, ['output'])]).pickup.kind).toBe('building');
    expect(spanOf([machine('in', 7, 8, 'p', 1, 1, ['input'])]).pickup.kind).toBeNull();
    expect(spanOf([machine('in', 9, 8, 'p', 1, 1, ['input'])]).drop.kind).toBe('building');
    expect(spanOf([machine('none', 9, 8, 'p', 1, 1, [])]).drop.kind).toBeNull();
    const monitor = { id: 'monitor', type: 'traffic_monitor', position: { x: 9, y: 8, z: 0 }, owner_id: 'p', runtime: { params: {} } } as unknown as Building;
    expect(spanOf([monitor]).drop.kind).toBeNull();
    // 地基、配送器、z>0 叠层不登记地面格：分拣器越过它们继续找到后面的带子。
    const foundation = { id: 'f', type: 'foundation', position: { x: 9, y: 8, z: 0 }, owner_id: 'p', runtime: { params: {} } } as unknown as Building;
    const stackedLayer = { ...machine('layer', 9, 8), position: { x: 9, y: 8, z: 1 } } as Building;
    expect(spanOf([foundation, stackedLayer, belt('east', 10, 8)]).drop).toEqual({ steps: 2, kind: 'belt', depth: 1 });
  });

  it('reports a multi-tile building endpoint with its along-axis depth', () => {
    // 3×3 熔炉占 9:7..11:9：分拣器在 (8,8) 朝东，第一步落在熔炉占地内。
    expect(spanOf([machine('furnace', 9, 7, 'p', 3, 3)]).drop).toEqual({ steps: 1, kind: 'building', depth: 3 });
    // 沿南北轴时 depth 取 footprint.height（rotation=0 → 取货端在南 (8,9)）。
    expect(sorterSpan(sorter(8, 8, 0), ground([machine('tall', 7, 8, 'p', 3, 3)]), FACE).pickup)
      .toEqual({ steps: 1, kind: 'building', depth: 3 });
    // 2 格外的 1×1 机器。
    expect(spanOf([machine('far', 10, 8)]).drop).toEqual({ steps: 2, kind: 'building', depth: 1 });
  });

  it('maps every rotation to the contract facing (front = drop, back = pickup)', () => {
    for (let turns = 0; turns < 4; turns++) {
      const rotation = turns * 90;
      const span = sorterSpan(sorter(8, 8, rotation), ground([]), FACE);
      expect(span.pickup.steps).toBe(1);
      // 背面 = 正面反向：用两格不同位置的端点验证方向。
      const facing = ROTATION_FACING[turns];
      const back = OPPOSITE_DIRECTION[facing];
      const offsets: Record<string, { x: number; y: number }> = { north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 } };
      const drop = { x: 8 + offsets[facing].x, y: 8 + offsets[facing].y };
      const pickup = { x: 8 + offsets[back].x, y: 8 + offsets[back].y };
      // 放货带沿朝向继续往前流（不朝回指向分拣器，否则这一侧不收插入）。
      const spanWithBelts = sorterSpan(sorter(8, 8, rotation), ground([belt('drop', drop.x, drop.y, facing, back), belt('pickup', pickup.x, pickup.y)]), FACE);
      expect(spanWithBelts.drop.kind, `rotation=${rotation} drop`).toBe('belt');
      expect(spanWithBelts.pickup.kind, `rotation=${rotation} pickup`).toBe('belt');
    }
  });

  it('expands footprints from the position origin (matching the scene footprint helper)', () => {
    const map = ground([machine('furnace', 4, 4, 'p', 2, 2)]);
    expect(map.get('4:4')?.id).toBe('furnace');
    expect(map.get('5:5')?.id).toBe('furnace');
    expect(map.get('4:5')?.id).toBe('furnace');
    const footprint = getBuildingFootprint(machine('furnace', 4, 4, 'p', 2, 2));
    expect(toTilePoint(machine('furnace', 4, 4).position)).toEqual({ x: 4, y: 4 });
    expect(footprint).toEqual({ width: 2, height: 2 });
  });
});

describe('sorterGripPoint / sorterArmPose (gate swing)', () => {
  it('puts the belt grip on the belt centreline and the building grip just inside its wall', () => {
    expect(sorterGripPoint({ steps: 1, kind: 'belt', depth: 1 }).distance).toBe(1);
    expect(sorterGripPoint({ steps: 3, kind: 'belt', depth: 1 }).distance).toBe(3);
    const small = sorterGripPoint({ steps: 1, kind: 'building', depth: 1 });
    const large = sorterGripPoint({ steps: 1, kind: 'building', depth: 3 });
    // 建筑：外壁（.5）内侧一点；占地越大收得越多（上限 .35）。
    expect(small.distance).toBeGreaterThan(.5);
    expect(small.distance).toBeLessThan(1);
    expect(large.distance).toBeGreaterThanOrEqual(small.distance);
    expect(large.distance).toBeLessThanOrEqual(.5 + .35 + 1e-9);
    // 没接上的一端按 1 格画（.78）并低于带面抓取点。
    const missing = sorterGripPoint({ steps: 1, kind: null, depth: 1 });
    expect(missing.distance).toBe(.78);
    expect(missing.height).toBeLessThan(small.height);
  });

  it('swing 0 = pickup side, swing 1 = drop side, swing .5 = above the axle', () => {
    const span = { pickup: { steps: 1, kind: 'belt', depth: 1 } as const, drop: { steps: 1, kind: 'belt', depth: 1 } as const };
    const pickup = sorterArmPose(span, { swing: 0, lift: 1 });
    const drop = sorterArmPose(span, { swing: 1, lift: 1 });
    const top = sorterArmPose(span, { swing: .5, lift: 1 });
    // 取货端在 −X（背面），放货端在 +X（正面）。
    expect(pickup.wrist.x).toBeLessThan(0);
    expect(drop.wrist.x).toBeGreaterThan(0);
    // swing=.5：腕轴在横轴正上方（x≈0）且高于横轴。
    expect(Math.abs(top.wrist.x)).toBeLessThan(1e-6);
    expect(top.wrist.y).toBeGreaterThan(pickup.wrist.y);
    expect(top.wrist.y).toBeGreaterThan(drop.wrist.y);
    // 腕轴比夹爪下的物品中心高 SORTER_HANG。
    expect(pickup.wrist.y - SORTER_HANG).toBeCloseTo(pickup.wrist.y - SORTER_HANG, 6);
    // 臂长 = 轴心到腕轴的距离。
    expect(pickup.length).toBeCloseTo(pickup.wrist.distanceTo(new THREE.Vector2(0, SORTER_PIVOT_Y)), 6);
  });

  it('dips the claw when lift drops and stretches the arm with the real endpoint distance', () => {
    const near = { pickup: { steps: 1, kind: 'belt', depth: 1 } as const, drop: { steps: 1, kind: 'belt', depth: 1 } as const };
    const far = { pickup: { steps: 3, kind: 'belt', depth: 1 } as const, drop: { steps: 1, kind: 'belt', depth: 1 } as const };
    const raised = sorterArmPose(near, { swing: 0, lift: 1 });
    const lowered = sorterArmPose(near, { swing: 0, lift: 0 });
    expect(lowered.wrist.y).toBeLessThan(raised.wrist.y);
    // 端点更远：取货端的水平半径与臂长都更大。
    expect(Math.abs(sorterArmPose(far, { swing: 0, lift: 1 }).wrist.x)).toBeGreaterThan(Math.abs(raised.wrist.x));
    expect(sorterArmPose(far, { swing: 0, lift: 1 }).length).toBeGreaterThan(raised.length);
  });
});

describe('SorterRigs', () => {
  it('keeps a fixed draw count no matter how many sorters there are', () => {
    const rigs = new SorterRigs();
    const one = [sorter(8, 8, 90, 3, 'running', 'a')];
    const many = Array.from({ length: 7 }, (_, index) => sorter(4 + index * 2, 8, 90, 3, 'running', `s${index}`));
    rigs.refresh(one, [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    const draws = rigs.group.children.length;
    expect(draws).toBeGreaterThan(0);
    rigs.refresh(many, [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    // 固定 13 个 InstancedMesh（静态件 + 动态件各一组）。
    expect(draws).toBe(13);
    expect(rigs.group.children.length).toBe(draws);
    for (const child of rigs.group.children) expect(child).toBeInstanceOf(THREE.InstancedMesh);
    // 每台分拣器的实例数按部件常量扩展。
    const rod = rigs.group.children.find(child => child.name === 'sorter-rod') as THREE.InstancedMesh;
    expect(rod.count).toBe(4 * many.length);
    rigs.dispose();
  });

  it('does not rebuild when the layout signature is unchanged', () => {
    const rigs = new SorterRigs();
    const sorters = [sorter(8, 8)], buildings = [sorter(8, 8), belt('west', 7, 8), belt('east', 9, 8)];
    expect(rigs.refresh(sorters, buildings, FACE, 100, 10)).toBe(true);
    const mesh = rigs.group.children[0];
    expect(rigs.refresh(sorters, buildings, FACE, 100, 20)).toBe(false);
    expect(rigs.group.children[0]).toBe(mesh);
    // 端点布局变化 → 重建。
    expect(rigs.refresh(sorters, [sorter(8, 8), belt('west', 7, 8)], FACE, 100, 30)).toBe(true);
    expect(rigs.group.children[0]).not.toBe(mesh);
    rigs.dispose();
  });

  it('refresh([]) does not throw and clears every mesh (regression: empty sorter list)', () => {
    const rigs = new SorterRigs();
    rigs.refresh([sorter(8, 8)], [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    expect(rigs.group.children.length).toBeGreaterThan(0);
    expect(() => rigs.refresh([], [], FACE, 100, 11)).not.toThrow();
    expect(rigs.group.children).toHaveLength(0);
    expect(() => rigs.animate(.1, true)).not.toThrow();
    expect(() => rigs.refresh([], [], FACE, 100, 12)).not.toThrow();
    expect(rigs.group.children).toHaveLength(0);
    rigs.dispose();
  });

  it('resolves a hit back to the exact sorter building via instanceId', () => {
    const rigs = new SorterRigs();
    const sorters = [sorter(8, 8, 90, 3, 'running', 'a'), sorter(12, 8, 90, 3, 'running', 'b')];
    rigs.refresh(sorters, [belt('west', 7, 8), belt('east', 9, 8), belt('west2', 11, 8), belt('east2', 13, 8)], FACE, 100, 10);
    const plate = rigs.group.children.find(child => child.name === 'sorter-plate') as THREE.InstancedMesh;
    // 每台 1 个底板实例。
    expect(plate.count).toBe(2);
    const hit = (instanceId: number) => ({ object: plate, instanceId, distance: 1, point: new THREE.Vector3() });
    expect(rigs.resolveHit(hit(0))).toEqual({ tile: { x: 8, y: 8 }, id: 'a' });
    expect(rigs.resolveHit(hit(1))).toEqual({ tile: { x: 12, y: 8 }, id: 'b' });
    // 非本 group 的 mesh / 越界 instanceId 不返回建筑。
    expect(rigs.resolveHit({ object: new THREE.Mesh(), instanceId: 0, distance: 1, point: new THREE.Vector3() })).toBeNull();
    expect(rigs.resolveHit(hit(99))).toBeNull();
    expect(rigs.inspect('a')?.span.drop.kind).toBe('belt');
    expect(rigs.inspect('missing')).toBeNull();
    rigs.dispose();
  });

  it('freezes the arm while the sorter is not running', () => {
    const rigs = new SorterRigs();
    const sorters = [sorter(8, 8, 90, 3, 'no_power', 'a')];
    rigs.refresh(sorters, [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    const before = rigs.inspect('a')!.arm;
    rigs.animate(1.5, true);
    const after = rigs.inspect('a')!.arm;
    expect(after.wrist.x).toBeCloseTo(before.wrist.x, 6);
    expect(after.wrist.y).toBeCloseTo(before.wrist.y, 6);
    // 运行中的分拣器在接到搬运记录后会动。
    const running = new SorterRigs();
    const active = sorter(8, 8, 90, 3, 'running', 'a');
    active.sorter!.last_transfer = { tick: 10, sequence: 1, source_id: 'w', target_id: 'e', source_position: { x: 7, y: 8, z: 0 }, target_position: { x: 9, y: 8, z: 0 }, item_id: 'iron_ore', quantity: 1 };
    running.refresh([active], [active, belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    const start = running.inspect('a')!.arm.wrist.x;
    for (let index = 0; index < 20; index++) running.animate(.05, true);
    expect(running.inspect('a')!.arm.wrist.x).not.toBeCloseTo(start, 3);
    running.dispose();
    rigs.dispose();
  });

  it('ghost mode uses translucent green materials and shows both endpoint statuses', () => {
    const ghost = new SorterRigs({ ghost: true });
    ghost.refresh([sorter(8, 8, 90, 3, 'running', 'a')], [belt('west', 7, 8)], FACE, 100, 0);
    expect(ghost.group.name).toBe('sorter-rig-ghost');
    const materials = ghost.group.children.map(child => (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial);
    expect(materials.every(material => material.transparent)).toBe(true);
    const ceramic = materials.find(material => 'opacity' in material && material.opacity === .6) as THREE.MeshStandardMaterial;
    expect(ceramic.color.getHexString()).toBe(new THREE.Color('#b4ffd6').getHexString());
    expect(SORTER_GHOST_COLOR).toBe('#7df7b0');
    // 一端接上（取货带）、一端没接：底板两端的端点座分别是绿/红。
    const dock = ghost.group.children.find(child => child.name === 'sorter-dock') as THREE.InstancedMesh;
    expect(dock.count).toBe(2);
    const colors = [0, 1].map(index => { const color = new THREE.Color(); dock.getColorAt(index, color); return color.getHexString(); });
    expect(colors[0]).toBe(new THREE.Color(SORTER_GHOST_COLOR).getHexString());
    expect(colors[1]).toBe(new THREE.Color('#ff6b6b').getHexString());
    // ghost 的 payload 始终显示（夹爪下挂一个预览方块）。
    ghost.animate(.4, true);
    expect(ghost.inspect('a')!.pose).toBeTruthy();
    ghost.dispose();
  });

  it('staticPose pins the arm and stops the motion timeline (thumbnail mode)', () => {
    // 缩略图用：摆臂收拢在取货端、夹爪抬起，`animate` 不推进（同一张图每次渲染都一致）。
    const rigs = new SorterRigs({ staticPose: { swing: 0, lift: 1, carrying: false } });
    rigs.refresh([sorter(8, 8, 90, 3, 'running', 'a')], [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    const first = rigs.inspect('a')!.arm;
    rigs.animate(1.5, true);
    const after = rigs.inspect('a')!.arm;
    expect(after.wrist.x).toBeCloseTo(first.wrist.x, 6);
    expect(after.wrist.y).toBeCloseTo(first.wrist.y, 6);
    // 取货端（局部 −X）抬起：腕轴在左半边、高于横轴。
    expect(first.wrist.x).toBeLessThan(0);
    expect(first.wrist.y).toBeGreaterThan(SORTER_PIVOT_Y);
    // 换个静态姿势（摆到头顶）会立刻写进实例矩阵。
    const overhead = new SorterRigs({ staticPose: { swing: .5, lift: 1, carrying: false } });
    overhead.refresh([sorter(8, 8, 90, 3, 'running', 'a')], [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    expect(overhead.inspect('a')!.arm.wrist.y).toBeGreaterThan(first.wrist.y);
    rigs.dispose(); overhead.dispose();
  });

  it('dispose removes the group and disposes resources', () => {
    const rigs = new SorterRigs(), world = new THREE.Group();
    world.add(rigs.group);
    rigs.refresh([sorter(8, 8)], [belt('west', 7, 8), belt('east', 9, 8)], FACE, 100, 10);
    rigs.dispose();
    expect(world.children).toHaveLength(0);
    expect(rigs.group.children).toHaveLength(0);
  });

  it('shares the same motion timeline as poseAt for the ghost preview', () => {
    // ghost 姿态只由 ghostTime 推进，与真实分拣器数据无关。
    const ghost = new SorterRigs({ ghost: true });
    ghost.refresh([sorter(8, 8)], [], FACE, 100, 0);
    const start = ghost.inspect('sorter')!.pose;
    ghost.animate(.4, true);
    const moved = ghost.inspect('sorter')!.pose;
    expect(moved.swing).not.toBe(start.swing);
    expect(moved).toEqual(poseAt((.4 / 1.6) % 1));
    ghost.dispose();
  });
});

const pbrState = vi.hoisted(() => ({ ready: false }));
vi.mock('./industrial-materials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./industrial-materials')>();
  const THREE = await import('three');
  return {
    ...actual,
    industrialMaterialsReady: () => pbrState.ready || actual.industrialMaterialsReady(),
    createPbrMaterial: (family: Parameters<typeof actual.createPbrMaterial>[0], color: string,
      parameters: Parameters<typeof actual.createPbrMaterial>[2]) =>
      pbrState.ready
        ? new THREE.MeshStandardMaterial({ ...parameters, color, normalMap: new THREE.DataTexture(new Uint8Array(4), 1, 1) })
        : actual.createPbrMaterial(family, color, parameters),
  };
});

describe('sorter PBR upgrade (M3)', () => {
  it('swaps arm materials once textures are ready without changing layout or progress', () => {
    const rigs = new SorterRigs();
    rigs.refresh([sorter(8, 8)], ground([belt('west', 7, 8), belt('east', 9, 8)]), FACE, 100, 0);
    const materialsOf = () => (rigs as unknown as { materials: Record<string, THREE.Material> }).materials;
    const before = { ...materialsOf() };
    const alloy = before.alloy as THREE.MeshStandardMaterial;
    expect(alloy).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(alloy.normalMap).toBeNull();
    expect(rigs.upgradeMaterials()).toBe(false);
    expect(materialsOf().alloy).toBe(before.alloy);
    const pose = rigs.inspect('sorter')!.pose;
    pbrState.ready = true;
    try {
      expect(rigs.upgradeMaterials()).toBe(true);
      const after = materialsOf();
      expect(after.alloy).not.toBe(before.alloy);
      expect((after.alloy as THREE.MeshStandardMaterial).normalMap).toBeTruthy();
      expect(after.light.uuid).toBe(before.light.uuid);
      // 布局与搬运进度不变（只是换了材质并重建实例网格）。
      expect(rigs.inspect('sorter')!.pose).toEqual(pose);
      expect(rigs.group.getObjectByName('sorter-plate')).toBeTruthy();
      expect(rigs.upgradeMaterials()).toBe(false);
    } finally { pbrState.ready = false; }
    rigs.dispose();
  });
});
