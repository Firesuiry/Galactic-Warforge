import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StatusLights, statusLightColor, statusLightIntensity, statusLightState } from './status-lights';
import { STATUS_LIGHT } from './palette';

const FACE = 288;
const RADIUS = 100;
/** 1 格在世界/图层空间里的边长（与 `surfaceTileSize` 同口径）。 */
const TILE = RADIUS * Math.PI / (2 * FACE) / Math.SQRT2;

/** 一个「图层」组（对应场景里的 buildings 图层），建筑组挂在它下面，组已带格位缩放。 */
function layer() {
  const group = new THREE.Group();
  group.name = 'buildings';
  group.updateMatrixWorld(true);
  return group;
}

/** 建筑根：与 `place()` 同口径——位置在球面上、朝向由格框给出、缩放 = tileScale。 */
function building(parent: THREE.Object3D, x: number, z = 0, y = RADIUS) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.scale.setScalar(TILE);
  parent.add(root);
  return root;
}

/** 建筑本体：一个 0.6×h×0.6 的盒子（局部单位 = 格）。 */
function body(root: THREE.Object3D, height: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.6), new THREE.MeshBasicMaterial());
  mesh.position.y = height / 2;
  root.add(mesh);
  root.updateWorldMatrix(true, true);
  return mesh;
}

function setup(rotated = false) {
  const world = new THREE.Group(), layerGroup = layer();
  world.add(layerGroup);
  if (rotated) world.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
  world.updateMatrixWorld(true);
  return { world, layerGroup };
}

describe('building status lights', () => {
  it('maps authoritative runtime states to three light states only', () => {
    expect(statusLightState('running')).toBe('running');
    expect(statusLightState('no_power')).toBe('noPower');
    expect(statusLightState('error')).toBe('noPower');
    for (const state of ['idle', 'paused', 'unconfigured', 'blocked', 'input_shortage', undefined]) {
      expect(statusLightState(state)).toBe('idle');
    }
    expect(statusLightColor('running')).toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
    expect(statusLightColor('idle')).toBe(Number.parseInt(STATUS_LIGHT.idle.slice(1), 16));
    expect(statusLightColor('noPower')).toBe(Number.parseInt(STATUS_LIGHT.noPower.slice(1), 16));
  });

  it('blinks only the no-power light and freezes at a fixed phase', () => {
    expect(statusLightIntensity('running', 3.3)).toBe(1);
    expect(statusLightIntensity('idle', 7.7)).toBe(1);
    expect(statusLightIntensity('noPower', 0, true)).toBe(statusLightIntensity('noPower', 9.9, true));
    const samples = [0, 0.2, 0.4, 0.8, 1.2].map(time => statusLightIntensity('noPower', time));
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(Math.min(...samples)).toBeLessThan(0.4);
  });

  it('keeps one instanced draw pair and switches every state pair by writing instance colors only', () => {
    const { layerGroup } = setup();
    const rootA = building(layerGroup, 0); body(rootA, 0.9);
    const rootB = building(layerGroup, 1); body(rootB, 0.9);
    const lights = new StatusLights(() => TILE);
    const entries = [
      { id: 'a', type: 'arc_smelter', state: 'running', root: rootA, width: 3, height: 3 },
      { id: 'b', type: 'wind_turbine', state: 'idle', root: rootB, width: 2, height: 2 },
    ];
    expect(lights.refresh(entries, layerGroup)).toBe(true);
    expect(lights.group.children.filter(child => child instanceof THREE.InstancedMesh)).toHaveLength(2);
    lights.update(0);
    expect(lights.colorAt(0)).toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
    expect(lights.colorAt(1)).toBe(Number.parseInt(STATUS_LIGHT.idle.slice(1), 16));
    const bulbs = lights.group.getObjectByName('status-light-bulbs') as THREE.InstancedMesh;
    const matrixVersion = bulbs.instanceMatrix.version;
    // 六种状态转移都必须写颜色（H2：旧实现 refresh 先写 states，update 永远判不出变化）。
    const transitions: [string, string, string][] = [
      ['a', 'running', 'idle'], ['a', 'idle', 'running'],
      ['a', 'running', 'no_power'], ['a', 'no_power', 'running'],
      ['a', 'idle', 'no_power'], ['a', 'no_power', 'idle'],
    ];
    for (const [id, from, to] of transitions) {
      entries[0].state = from; lights.refresh(entries, layerGroup); lights.update(1.0);
      const before = lights.colorAt(0);
      entries[0].state = to;
      expect(lights.refresh(entries, layerGroup)).toBe(false);
      // 缺电红灯按闪烁强度调暗，其余常亮灯就是调色板原色；两种都必须是新灯态的颜色。
      lights.update(1.0);
      expect(lights.stateOf(id)).toBe(statusLightState(to));
      const after = lights.colorAt(0)!;
      expect(after).not.toBe(before);
      const expected = statusLightState(to);
      if (expected === 'noPower') expect(after).not.toBe(Number.parseInt(STATUS_LIGHT.running.slice(1), 16));
      else expect(after).toBe(Number.parseInt(STATUS_LIGHT[expected].slice(1), 16));
      // 只改颜色：实例矩阵没有重传。
      expect(bulbs.instanceMatrix.version).toBe(matrixVersion);
    }
    // 移除一栋建筑才重建实例。
    expect(lights.refresh(entries.slice(0, 1), layerGroup)).toBe(true);
    expect(lights.count).toBe(1);
    lights.dispose();
  });

  it('places the bulb on the building roof in layer space, once, regardless of world rotation', () => {
    for (const rotated of [false, true]) {
      const { layerGroup } = setup(rotated);
      const root = building(layerGroup, 2, -1);
      const roof = body(root, 0.9);
      const lights = new StatusLights(() => TILE);
      lights.refresh([{ id: 'a', type: 'headquarters', state: 'running', root, width: 5, height: 5 }], layerGroup);
      const bulb = lights.positionAt(0)!;
      // 灯位与建筑的相对位置：在图层空间里算，世界旋转不影响。
      const expected = new THREE.Vector3(0, 0.9 + 0.05, 0)
        .applyMatrix4(root.matrix).applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 1));
      const center = new THREE.Vector3(0, 0.9, 0).applyMatrix4(root.matrix);
      // 灯在顶面上方：与楼顶中心的距离 = 水平偏移（≤ 0.6 格）+ 间隙（0.05 格）。
      expect(bulb.distanceTo(center)).toBeLessThan(0.6);
      expect(bulb.y).toBeGreaterThan(center.y);
      // 与建筑顶面的竖直距离 < 0.5 格（H1 回归：之前灯珠离建筑约半个星球）。
      const topLocal = new THREE.Vector3(0, 0.9, 0).applyMatrix4(root.matrix);
      expect(bulb.distanceTo(topLocal)).toBeLessThan(0.5);
      // 世界空间里也不漂移：灯与楼顶在世界坐标下的距离同样 < 0.5 格。
      layerGroup.updateWorldMatrix(true, true);
      const worldBulb = bulb.clone().applyMatrix4(layerGroup.matrixWorld);
      const worldTop = topLocal.clone().applyMatrix4(layerGroup.matrixWorld);
      expect(worldBulb.distanceTo(worldTop)).toBeLessThan(0.5);
      // 旋转世界后实例矩阵不需要重写（灯随图层一起转）。
      const bulbs = lights.group.getObjectByName('status-light-bulbs') as THREE.InstancedMesh;
      const version = bulbs.instanceMatrix.version;
      setup(rotated).world.updateMatrixWorld(true);
      expect(bulbs.instanceMatrix.version).toBe(version);
      lights.dispose();
      expect(roof).toBeDefined();
      expect(expected).toBeDefined();
    }
  });

  it('syncs only own, modelled buildings and attaches the group to the given layer', () => {
    const { layerGroup } = setup();
    const own = building(layerGroup, 0); body(own, 1);
    const lights = new StatusLights(() => TILE);
    const groups = new Map([['own', own]]);
    const buildings = [
      { id: 'own', type: 'arc_smelter', owner_id: 'p', position: { x: 0, y: 0, z: 0 }, runtime: { state: 'running' } },
      { id: 'enemy', type: 'arc_smelter', owner_id: 'q', position: { x: 1, y: 0, z: 0 }, runtime: { state: 'running' } },
    ] as never;
    expect(lights.sync(buildings, 'p', id => groups.get(id), layerGroup)).toBe(true);
    expect(lights.count).toBe(1);
    expect(lights.group.parent).toBe(layerGroup);
    // 每帧只在真正写过颜色时上传缓冲（L1）：稳定帧不置 needsUpdate。
    lights.update(0);
    const bulbs = lights.group.getObjectByName('status-light-bulbs') as THREE.InstancedMesh;
    const version = bulbs.instanceColor!.version;
    lights.update(0.5);
    expect(bulbs.instanceColor!.version).toBe(version);
    lights.dispose();
  });
});
