import * as THREE from 'three';
import type { Building } from '@shared/types';
import { getBuildingFootprint } from '../model';
import { STATUS_LIGHT } from './palette';

/**
 * 状态灯（第 23 轮 3A）：每栋己方建筑头顶一个小发光指示灯，全场 **1 个 InstancedMesh**
 * （+ 1 个光晕 InstancedMesh），状态切换只写 `instanceColor`，不重建静态批。
 *
 * 三态（只取真实运行状态，与缺电角标同源 `runtime.state`）：
 * - 运行 `running` → 青 `#3fe6ff`，常亮；
 * - 空闲 / 缺料（`idle`、`paused`、`unconfigured`、`blocked` 等）→ 琥珀 `#ffb04a`，常亮；
 * - 缺电 `no_power`（及故障 `error`）→ 红 `#ff3b3b`，慢闪（周期 1.6s，冻结时定格在固定相位）。
 *
 * 不做的事：敌方 / 黑雾建筑不挂灯（不暴露对方产线状态）；未探索区域不挂灯。
 *
 * **坐标空间**：实例矩阵写在建筑图层（`layer`）空间里，与 `StaticBatches` 同口径
 * （`inverse(layer.matrixWorld) × root.matrixWorld`）。世界旋转只改 `world` 的朝向，
 * 图层空间里的建筑与灯一起转，所以灯不会脱离建筑，也不必每帧重算矩阵。
 *
 * **位置**：灯珠落在建筑**顶面**（模型包围盒顶）靠一个角的位置；每类建筑用 `LIGHT_OFFSETS`
 * 的 (x, z) 指定在顶面上的相对位置（−1..1，取顶面半宽的比例）。包围盒随转子/扫描臂变化，
 * 塔架类（叶片会扫过）用固定 `top` 覆盖，保证位置稳定。
 */

export type StatusLightState = 'running' | 'idle' | 'noPower';

/**
 * 建筑类型 → 灯在**顶面**上的位置（x / z 是顶面半宽的比例，−1 = 左/后边，1 = 右/前边）。
 * `top` 覆盖包围盒顶（单位格），用于包围盒会被动画件撑大的类型。
 */
const LIGHT_OFFSETS: Record<string, { x: number; z: number; top?: number }> = {
  wind_turbine: { x: 0.55, z: -0.75, top: 1.52 },
  solar_panel: { x: 0.7, z: 0.7 },
  logistics_station: { x: 0.68, z: 0.68 },
  miniature_particle_collider: { x: 0.55, z: 0.55 },
  gun_turret: { x: 0.55, z: 0.55 },
};
const DEFAULT_OFFSET = { x: 0.62, z: 0.62 };
/** 灯珠离顶面的间隙（格）：贴顶但不穿模。 */
const LIGHT_CLEARANCE = 0.05;
/** 包围盒为空（纯组/分拣器占位）时的兜底尺寸（格）。 */
const EMPTY_HALF = 0.4;

export interface StatusLightEntry {
  id: string;
  /** 建筑类型（取偏移表）。 */
  type: string;
  /** 运行态：只认服务端 `runtime.state`。 */
  state?: string;
  /** 建筑在场景里的组（取世界矩阵；组已带格位缩放）。 */
  root: THREE.Object3D;
  /** 占地（格），仅用于签名（占地变化要重算位置）。 */
  width: number;
  height: number;
}

/** 运行态 → 灯态。只按权威 `runtime.state` 判定，不猜。 */
export function statusLightState(state: string | undefined): StatusLightState {
  if (state === 'running') return 'running';
  if (state === 'no_power' || state === 'error') return 'noPower';
  return 'idle';
}

/** 灯态 → 颜色（十六进制）。 */
export function statusLightColor(state: StatusLightState): number {
  const hex = state === 'running' ? STATUS_LIGHT.running : state === 'noPower' ? STATUS_LIGHT.noPower : STATUS_LIGHT.idle;
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** 缺电慢闪：1.6s 周期；冻结时传 `frozen`，相位固定在 0.5（灯亮一半，截图可复现）。 */
export function statusLightIntensity(state: StatusLightState, time: number, frozen = false): number {
  if (state !== 'noPower') return 1;
  if (frozen) return 0.55;
  const phase = (time % 1.6) / 1.6;
  // 方波带 0.15 的软化边，避免频闪。
  return 0.22 + 0.78 * THREE.MathUtils.smoothstep(phase, 0.08, 0.2) * (1 - THREE.MathUtils.smoothstep(phase, 0.5, 0.62));
}

interface Slot { position: THREE.Vector3; bulb: number; halo: number }

/**
 * 状态灯实例集合：一个 `InstancedMesh`（灯珠）+ 一个（光晕）。
 * `sync()` / `refresh()` 只在建筑集合变化时重建实例（静态批不受影响）；`update()` 每帧只改颜色/光晕尺寸。
 * 灯珠几何与材质由本实例持有，`dispose()` 一并释放（多个场景互不影响）。
 */
export class StatusLights {
  readonly group = new THREE.Group();
  private readonly bulbGeometry = new THREE.SphereGeometry(0.5, 8, 6);
  private readonly haloGeometry = new THREE.SphereGeometry(0.5, 8, 6);
  private readonly bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** 光晕：加法混合的半透明球，受 bloom 放大成一个小光点（低档位没有 bloom 也能看清）。 */
  private readonly haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  private bulbs?: THREE.InstancedMesh;
  private halos?: THREE.InstancedMesh;
  private entries: StatusLightEntry[] = [];
  /** 已写进 instanceColor 的灯态（`update()` 据此判断要不要重写）。 */
  private states: StatusLightState[] = [];
  private signature = '';
  private readonly color = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private readonly layerInverse = new THREE.Matrix4();
  private readonly rootLocal = new THREE.Matrix4();
  private readonly rootInverse = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  /** 每盏灯在图层空间里的位置与基础尺寸（refresh 时算一次，逐帧只改颜色/光晕缩放）。 */
  private slots: Slot[] = [];

  constructor(private readonly tileScale: () => number) {
    this.group.name = 'status-lights';
  }

  get count() { return this.entries.length; }
  /** 测试钩子：某栋建筑当前的灯态。 */
  stateOf(id: string): StatusLightState | undefined {
    const index = this.entries.findIndex(entry => entry.id === id);
    return index < 0 ? undefined : this.states[index];
  }
  /** 测试钩子：实例颜色（十六进制）。 */
  colorAt(index: number): number | null {
    if (!this.bulbs || index < 0 || index >= this.entries.length) return null;
    this.bulbs.getColorAt(index, this.color);
    return this.color.getHex();
  }
  /** 测试钩子：实例矩阵位置（图层空间）。 */
  positionAt(index: number): THREE.Vector3 | null {
    if (!this.bulbs || index < 0 || index >= this.entries.length) return null;
    this.bulbs.getMatrixAt(index, this.matrix);
    return new THREE.Vector3().setFromMatrixPosition(this.matrix);
  }

  /**
   * 场景入口：从可见建筑里挑己方、且有模型的，同步灯位与灯态。
   * 灯组挂在 `layer`（建筑图层）下，实例矩阵即图层空间坐标。
   */
  sync(buildings: readonly Building[], playerId: string | undefined, groupOf: (id: string) => THREE.Group | undefined, layer: THREE.Object3D): boolean {
    const entries: StatusLightEntry[] = [];
    for (const building of buildings) {
      if (building.owner_id !== playerId) continue;
      const root = groupOf(building.id);
      if (!root) continue;
      const footprint = getBuildingFootprint(building);
      entries.push({ id: building.id, type: building.type, state: building.runtime?.state, root, width: footprint.width, height: footprint.height });
    }
    if (this.group.parent !== layer) layer.add(this.group);
    return this.refresh(entries, layer);
  }

  /**
   * 同步建筑集合。返回是否重建了实例（新增/移除建筑/占地变化）。
   * 状态变化只记在 `entries` 里，由 `update()` 比较后写 instanceColor。
   */
  refresh(entries: readonly StatusLightEntry[], layer: THREE.Object3D): boolean {
    const signature = entries.map(entry => `${entry.id}:${entry.type}:${entry.width}x${entry.height}`).join('|');
    this.entries = entries.map(entry => ({ ...entry }));
    if (signature === this.signature) return false;
    this.signature = signature;
    this.states = entries.map(entry => statusLightState(entry.state));
    this.disposeMeshes();
    if (!entries.length) { this.slots = []; return true; }
    const bulbs = new THREE.InstancedMesh(this.bulbGeometry, this.bulbMaterial, entries.length);
    bulbs.name = 'status-light-bulbs';
    bulbs.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    bulbs.frustumCulled = false;
    const halos = new THREE.InstancedMesh(this.haloGeometry, this.haloMaterial, entries.length);
    halos.name = 'status-light-halos';
    halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    halos.frustumCulled = false;
    bulbs.castShadow = halos.castShadow = false;
    bulbs.receiveShadow = halos.receiveShadow = false;
    this.bulbs = bulbs; this.halos = halos;
    this.group.add(halos, bulbs);
    const size = this.tileScale();
    // 图层空间 = 建筑自己的坐标空间：世界旋转不改变它，灯随建筑一起转（不必逐帧重算）。
    layer.updateWorldMatrix(true, false);
    this.layerInverse.copy(layer.matrixWorld).invert();
    this.slots = [];
    entries.forEach((entry, index) => {
      entry.root.updateWorldMatrix(true, true);
      this.rootLocal.multiplyMatrices(this.layerInverse, entry.root.matrixWorld);
      // 包围盒换算回建筑局部（模型单位 = 格）：顶面高度与半宽都从这里取。
      this.box.setFromObject(entry.root);
      const empty = this.box.isEmpty();
      this.rootInverse.copy(entry.root.matrixWorld).invert();
      if (!empty) this.box.applyMatrix4(this.rootInverse);
      const offset = LIGHT_OFFSETS[entry.type] ?? DEFAULT_OFFSET;
      const halfX = empty ? EMPTY_HALF : (this.box.max.x - this.box.min.x) / 2;
      const halfZ = empty ? EMPTY_HALF : (this.box.max.z - this.box.min.z) / 2;
      const centerX = empty ? 0 : (this.box.max.x + this.box.min.x) / 2;
      const centerZ = empty ? 0 : (this.box.max.z + this.box.min.z) / 2;
      const top = offset.top ?? (empty ? EMPTY_HALF * 2 : this.box.max.y);
      this.scratch.set(centerX + offset.x * halfX, top + LIGHT_CLEARANCE, centerZ + offset.z * halfZ).applyMatrix4(this.rootLocal);
      this.slots.push({ position: this.scratch.clone(), bulb: size * 0.075, halo: size * 0.2 });
      this.compose(bulbs, index, this.slots[index], this.slots[index].bulb);
      this.compose(halos, index, this.slots[index], this.slots[index].halo);
      this.color.setHex(statusLightColor(this.states[index]));
      bulbs.setColorAt(index, this.color);
      halos.setColorAt(index, this.color.multiplyScalar(0.35));
    });
    bulbs.instanceMatrix.needsUpdate = true; halos.instanceMatrix.needsUpdate = true;
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    return true;
  }

  /**
   * 每帧：只写颜色与光晕尺寸。灯态没变时（且不在缺电闪烁的建筑）不改 GPU 数据。
   * `frozen`：冻结/减弱动效时缺电灯定格在固定相位。
   */
  update(time: number, frozen = false): void {
    const bulbs = this.bulbs, halos = this.halos;
    if (!bulbs || !halos) return;
    let colors = false, haloColors = false, haloMatrices = false;
    for (let index = 0; index < this.entries.length; index++) {
      const next = statusLightState(this.entries[index].state);
      const changed = next !== this.states[index];
      // 常亮灯（运行 / 空闲）只在灯态变化时写一次；只有缺电红灯每帧写颜色与光晕。
      if (!changed && next !== 'noPower') continue;
      if (changed) { this.states[index] = next; colors = true; }
      const intensity = statusLightIntensity(next, time, frozen);
      this.color.setHex(statusLightColor(next)).multiplyScalar(0.15 + 0.85 * intensity);
      bulbs.setColorAt(index, this.color);
      // 光晕随强度缩放：缺电时一明一暗，一眼看出。
      this.compose(halos, index, this.slots[index], this.slots[index].halo * (0.45 + 0.55 * intensity));
      this.color.multiplyScalar(0.35);
      halos.setColorAt(index, this.color);
      haloColors = true; haloMatrices = true;
    }
    if (colors && bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    if (haloColors && halos.instanceColor) halos.instanceColor.needsUpdate = true;
    if (haloMatrices) halos.instanceMatrix.needsUpdate = true;
  }

  /** 写一个实例矩阵（位置 + 统一缩放），复用临时矩阵，不分配。 */
  private compose(mesh: THREE.InstancedMesh, index: number, slot: Slot, scale: number) {
    this.matrix.makeScale(scale, scale, scale);
    this.matrix.setPosition(slot.position);
    mesh.setMatrixAt(index, this.matrix);
  }

  dispose() {
    this.disposeMeshes();
    this.entries = []; this.states = []; this.slots = []; this.signature = '';
    this.bulbGeometry.dispose(); this.haloGeometry.dispose();
    this.bulbMaterial.dispose(); this.haloMaterial.dispose();
    this.group.removeFromParent();
  }

  private disposeMeshes() {
    for (const mesh of [this.bulbs, this.halos]) if (mesh) { mesh.dispose(); mesh.removeFromParent(); }
    this.bulbs = undefined; this.halos = undefined;
  }
}
