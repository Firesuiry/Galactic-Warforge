import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building } from '@shared/types';
import { getItemColorValue } from '../item-colors';
import { IndustrialModels } from './industrial-models';
import { sorterAngles, syncSorterAnimation } from './sorter-animation';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import { StaticBatches } from './static-batches';
import { DynamicBatches } from './dynamic-batches';

const PICKUP = { x: 9, y: 5, z: 0 };
const DROP = { x: 9, y: 3, z: 0 };

interface FixtureOptions {
  /** 建造朝向（rotation=0 时正面/放货端朝北）。 */
  rotation?: number;
  range?: number;
  cycleTicks?: number;
}

function fixture(options: FixtureOptions = {}) {
  const assets = new IndustrialModels();
  const model = assets.building('sorter_mk1', .86, .86, true);
  const size = surfaceTileSize(100, 48);
  const position = { x: 9, y: 4, z: 0 };
  const { normal, east, south } = tileFrame(position, 48);
  model.position.copy(normal).multiplyScalar(100 + size * .025);
  model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
  model.rotateY(-(options.rotation ?? 0) * Math.PI / 180);
  model.scale.multiplyScalar(size);
  // 朝向 0：取货端（背面）在南 +Z，放货端（正面）在北 −Z；朝向 90 时取/放在西/东。
  const eastward = options.rotation === 90;
  const building = {
    id: 'sorter', type: 'sorter_mk1', position, owner_id: 'p1', rotation: String(options.rotation ?? 0) as Building['rotation'],
    runtime: { state: 'running' },
    sorter: {
      cycle_ticks: options.cycleTicks ?? 2, range: options.range ?? 1,
      last_transfer: {
        tick: 50, sequence: 1, source_id: 'source', target_id: 'target',
        source_position: eastward ? { x: 8, y: 4, z: 0 } : { ...PICKUP },
        target_position: eastward ? { x: 10, y: 4, z: 0 } : { ...DROP },
        item_id: 'iron_ore', quantity: 1,
      },
    },
  } as Building;
  const arm = model.getObjectByName('sorter-arm')!;
  const boom = model.getObjectByName('sorter-boom')!;
  const claw = model.getObjectByName('sorter-claw')!;
  const payload = model.getObjectByName('sorter-payload')!;
  const cargo = payload.children[0] as THREE.Mesh;
  return { assets, model, building, arm, boom, claw, payload, cargo, size };
}

/** 以固定步长推进动画，返回逐帧采样（断言不依赖具体 cycle 时长）。 */
function sample(f: ReturnType<typeof fixture>, seconds: number, step = .005) {
  const samples: { yaw: number; clawY: number; visible: boolean }[] = [];
  for (let time = 0; time < seconds; time += step) {
    f.assets.animate(0, step);
    samples.push({ yaw: f.arm.rotation.y, clawY: f.claw.position.y, visible: f.payload.visible });
  }
  return samples;
}

/** 模型贴着球面的「水平方向」：去掉法线分量后的归一化方向。 */
function horizontal(f: ReturnType<typeof fixture>, point: THREE.Vector3) {
  f.model.updateMatrixWorld(true);
  const origin = f.model.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion()));
  const direction = point.clone().sub(origin);
  direction.addScaledVector(normal, -direction.dot(normal));
  return direction.normalize();
}

/** 夹爪在水平面上相对立柱的指向。 */
function armDirection(f: ReturnType<typeof fixture>) {
  f.model.updateMatrixWorld(true);
  return horizontal(f, f.claw.getWorldPosition(new THREE.Vector3()));
}

/** 格心相对分拣器中心的水平方向。 */
function tileDirection(f: ReturnType<typeof fixture>, tile: { x: number; y: number }) {
  const point = tileNormal(tile, 48).multiplyScalar(100 + f.size * .25);
  return horizontal(f, point);
}

describe('DSP sorter arm model', () => {
  it('is a low round-base + column + horizontal boom + claw assembly, all animated nodes marked dynamic', () => {
    const f = fixture();
    for (const name of ['sorter-arm', 'sorter-boom', 'sorter-claw', 'sorter-payload']) {
      const node = f.model.getObjectByName(name);
      expect(node, name).toBeTruthy();
      expect(node!.userData.industrialRotation, name).toEqual({ axis: 'y', speed: 0 });
    }
    // payload 默认隐藏，且材质逐实例独立（动画按物品色写入）。
    expect(f.payload.visible).toBe(false);
    expect(f.cargo.userData.independentMaterial).toBe(true);
    const other = f.assets.building('sorter_mk1', .86, .86, true);
    const otherCargo = other.getObjectByName('sorter-payload')!.children[0] as THREE.Mesh;
    (f.cargo.material as THREE.MeshStandardMaterial).color.set('#123456');
    expect((otherCargo.material as THREE.MeshStandardMaterial).color.getHexString()).not.toBe('123456');

    // 整机很矮（DSP 分拣器远低于熔炉）：局部总高 ≤ .55，且不是两段臂。
    const raw = f.assets.building('sorter_mk1', .86, .86, true);
    raw.position.set(0, 0, 0); raw.quaternion.identity(); raw.scale.set(1, 1, 1); raw.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(raw).max.y).toBeLessThanOrEqual(.55);
    expect(raw.getObjectByName('sorter-shoulder')).toBeUndefined();
    expect(raw.getObjectByName('sorter-wrist')).toBeUndefined();

    f.assets.dispose();
  });

  it('stretches the boom (and moves the claw to the arm end) for longer range sorters', () => {
    for (const range of [1, 2, 3]) {
      const f = fixture({ range });
      syncSorterAnimation(f.model, f.building, 80, 48);
      const length = .55 + (range - 1) * .42;
      expect(f.boom.scale.x).toBeCloseTo(length / .55, 6);
      expect(f.claw.position.x).toBeCloseTo(length, 6);
      f.assets.dispose();
    }
  });
});

describe('authoritative sorter arm swing', () => {
  it('plays one transfer: swings pickup→drop (≈π) and returns, lifting cargo in between', () => {
    const f = fixture();
    syncSorterAnimation(f.model, f.building, 51, 48);
    const samples = sample(f, 2.2);
    const yaws = samples.map(item => item.yaw);
    // 横臂在水平面内往复摆动约 180°。
    expect(Math.abs(Math.max(...yaws) - Math.min(...yaws) - Math.PI)).toBeLessThan(.02);
    // 一个周期后回到取货角（空闲姿态），且指向真实取货端。
    expect(yaws[yaws.length - 1]).toBeCloseTo(Math.min(...yaws), 6);
    expect(armDirection(f).dot(tileDirection(f, PICKUP))).toBeGreaterThan(.999);
    // 同一周期里物品从隐藏 → 夹在爪上 → 放货消失。
    const visible = samples.map(item => item.visible);
    const first = visible.indexOf(true);
    expect(first).toBeGreaterThan(0);
    expect(visible.slice(first, visible.indexOf(false, first)).every(Boolean)).toBe(true);
    expect(visible[visible.length - 1]).toBe(false);
    // 夹爪取/放时下沉 .04，搬运时抬起；yaw 组本身没有位移（整机不上下浮动）。
    expect(Math.min(...samples.map(item => item.clawY))).toBeCloseTo(-.04, 6);
    expect(Math.max(...samples.map(item => item.clawY))).toBeCloseTo(0, 6);
    expect(f.arm.position.y).toBe(0);
    f.assets.dispose();
  });

  it('points at the drop end mid-swing, including a 90° rotated sorter', () => {
    for (const rotation of [0, 90]) {
      const f = fixture({ rotation });
      const transfer = f.building.sorter!.last_transfer!;
      syncSorterAnimation(f.model, f.building, 51, 48);
      let dropAlignment = -1;
      for (let index = 0; index < 450; index++) {
        f.assets.animate(0, .005);
        dropAlignment = Math.max(dropAlignment, armDirection(f).dot(tileDirection(f, transfer.target_position)));
      }
      expect(dropAlignment, `rotation=${rotation}`).toBeGreaterThan(.999);
      // 回摆结束回到取货端。
      expect(armDirection(f).dot(tileDirection(f, transfer.source_position))).toBeGreaterThan(.999);
      f.assets.dispose();
    }
  });

  it('ignores diagonal endpoint positions of multi-tile neighbours (arm stays on the facing axis)', () => {
    // 服务端 last_transfer 记的是端点建筑 position（多格建筑 = 占地左上角）。3×3 熔炉的
    // 「左上角」不在分拣器朝向轴上，旧实现按两点连线取角会把横臂指到建筑角落（约 215°）。
    // 现在角度只由 rotation + 格切向推出，端点坐标再斜也不影响摆幅。
    const sorterTile = { x: 9, y: 4 };
    const front: Record<number, { x: number; y: number }> = {
      0: { x: 9, y: 3 }, 90: { x: 10, y: 4 }, 180: { x: 9, y: 5 }, 270: { x: 8, y: 4 },
    };
    const back: Record<number, { x: number; y: number }> = {
      0: { x: 9, y: 5 }, 90: { x: 8, y: 4 }, 180: { x: 9, y: 3 }, 270: { x: 10, y: 4 },
    };
    for (const rotation of [0, 90, 180, 270]) {
      const f = fixture({ rotation });
      // 端点故意写成斜角（模拟 3×3 熔炉的占地左上角）。
      f.building.sorter!.last_transfer!.source_position = { x: sorterTile.x + 1, y: sorterTile.y + 1, z: 0 };
      f.building.sorter!.last_transfer!.target_position = { x: sorterTile.x + 1, y: sorterTile.y + 1, z: 0 };
      const angles = sorterAngles(f.model, f.building, 48);
      expect(Math.abs(Math.abs(angles.drop - angles.pickup) - Math.PI)).toBeLessThan(1e-9);
      syncSorterAnimation(f.model, f.building, 51, 48);
      let dropAlignment = -1;
      for (let index = 0; index < 500; index++) {
        f.assets.animate(0, .004);
        dropAlignment = Math.max(dropAlignment, armDirection(f).dot(tileDirection(f, front[rotation])));
      }
      expect(dropAlignment, `rotation=${rotation}`).toBeGreaterThan(.999);
      // 回摆结束停在取货端（背面格），而不是端点记录里的斜角。
      expect(armDirection(f).dot(tileDirection(f, back[rotation]))).toBeGreaterThan(.999);
      f.assets.dispose();
    }
  });

  it('does not replay the initial historical transfer', () => {
    const f = fixture();
    // 历史记录（tick 50 的记录在 tick 80 才首次同步）只用来对准空闲姿态，不当成本次活动。
    syncSorterAnimation(f.model, f.building, 80, 48);
    const samples = sample(f, 1.2);
    expect(new Set(samples.map(item => item.yaw)).size).toBe(1);
    expect(samples.every(item => item.visible === false)).toBe(true);
    expect(armDirection(f).dot(tileDirection(f, PICKUP))).toBeGreaterThan(.999);
    f.assets.dispose();
  });

  it('plays a late-but-new transfer (scene data refreshes on SSE events, may lag dozens of ticks)', () => {
    // 1018 联调：数据层只在 SSE 事件后刷新场景，挂机产线里 last_transfer 迟到几十 tick 很常见。
    // 旧实现把「tick 差 > 20」当历史记录跳过 → 机械臂永远不动。
    const f = fixture();
    f.building.sorter!.last_transfer!.tick = 99;
    syncSorterAnimation(f.model, f.building, 100, 48);
    expect(sample(f, 1.6).some(item => item.visible)).toBe(true);
    // 中间若干次没有新记录的刷新（sequence 不变，提前返回但 snapshotTick 前进）。
    for (const tick of [140, 160, 180]) syncSorterAnimation(f.model, f.building, tick, 48);
    // 新记录迟到 50 tick 才到客户端：仍然要播一次。
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 150;
    syncSorterAnimation(f.model, f.building, 200, 48);
    expect(sample(f, 1.6).some(item => item.visible)).toBe(true);
    f.assets.dispose();
  });

  it('rejects stale/future/zero-quantity records like the previous implementation', () => {
    for (const [tick, quantity] of [[80, 1], [49, 1], [50, 0]]) {
      const f = fixture();
      f.building.sorter!.last_transfer!.quantity = quantity;
      syncSorterAnimation(f.model, f.building, tick, 48);
      const samples = sample(f, .8);
      expect(new Set(samples.map(item => item.yaw)).size).toBe(1);
      expect(samples.every(item => item.visible === false)).toBe(true);
      f.assets.dispose();
    }
  });

  it('freezes on no_power (payload hidden) and resumes on a later sequence', () => {
    const f = fixture();
    syncSorterAnimation(f.model, f.building, 50, 48);
    sample(f, .12);
    const frozenYaw = f.arm.rotation.y, frozenClawY = f.claw.position.y;
    f.building.runtime.state = 'no_power';
    syncSorterAnimation(f.model, f.building, 51, 48);
    expect(f.payload.visible).toBe(false);
    const frozen = sample(f, .6);
    expect(frozen.every(item => item.yaw === frozenYaw)).toBe(true);
    expect(frozen.every(item => item.clawY === frozenClawY)).toBe(true);
    expect(frozen.every(item => item.visible === false)).toBe(true);
    f.building.runtime.state = 'running';
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 52;
    syncSorterAnimation(f.model, f.building, 52, 48);
    expect(sample(f, 2.2).some(item => item.visible)).toBe(true);
    f.assets.dispose();
  });

  it('colors the carried payload from last_transfer.item_id', () => {
    const f = fixture();
    f.building.sorter!.last_transfer!.item_id = 'iron_ingot';
    syncSorterAnimation(f.model, f.building, 50, 48);
    const material = f.cargo.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe(getItemColorValue('iron_ingot').slice(1).toLowerCase());
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 51;
    f.building.sorter!.last_transfer!.item_id = 'copper_ingot';
    syncSorterAnimation(f.model, f.building, 51, 48);
    expect(material.color.getHexString()).toBe(getItemColorValue('copper_ingot').slice(1).toLowerCase());
    f.assets.dispose();
  });

  it('uploads moving joints and newly visible cargo through dynamic batches', () => {
    const f = fixture(), layer = new THREE.Group(); layer.add(f.model);
    const statics = new StaticBatches(), dynamics = new DynamicBatches();
    const entries = [{ root: f.model, layer, tile: f.building.position }];
    syncSorterAnimation(f.model, f.building, 51, 48);
    statics.refresh(entries); dynamics.refresh(entries);
    expect(dynamics.stats.anchors).toBe(4);
    // 隐藏的 payload 也保留实例（缩放 0 矩阵），显隐不需要重建批次。
    const instancesFor = (source: THREE.Mesh) => layer.children
      .filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh
        && object.geometry === source.geometry && object.material === source.material)
      .flatMap(mesh => Array.from({ length: mesh.count }, (_, index) => {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix); return matrix;
      }));
    expect(instancesFor(f.cargo).filter(matrix => matrix.determinant() === 0).length).toBeGreaterThan(0);
    // 推进到搬运中段：横臂/夹爪/物品的姿态进入 InstancedMesh。
    for (let index = 0; index < 400 && !f.payload.visible; index++) f.assets.animate(0, .005);
    expect(f.payload.visible).toBe(true);
    expect(dynamics.update()).toBeGreaterThan(0);
    layer.updateMatrixWorld(true);
    for (const name of ['sorter-boom', 'sorter-claw', 'sorter-payload']) {
      const source = f.model.getObjectByName(name)!.children[0] as THREE.Mesh;
      expect(instancesFor(source).some(matrix => matrix.elements.every((value, index) =>
        Math.abs(value - source.matrixWorld.elements[index]) < 0.00001)), name).toBe(true);
    }
    // 放货后物品实例重新缩成 0（隐藏），不残留半空中的货物。
    for (let index = 0; index < 400 && f.payload.visible; index++) f.assets.animate(0, .005);
    expect(f.payload.visible).toBe(false);
    dynamics.dispose(); statics.dispose(); f.assets.dispose();
  });
});
