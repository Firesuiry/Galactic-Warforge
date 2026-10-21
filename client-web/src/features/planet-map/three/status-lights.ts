import * as THREE from 'three';
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
 * 灯在建筑局部坐标里的位置按类型偏移表取（`LIGHT_OFFSETS`），未列出的类型用默认值。
 */

export type StatusLightState = 'running' | 'idle' | 'noPower';

/** 建筑类型 → 灯在局部坐标（1 格 = 1，原点在建筑底面中心）的位置。 */
const LIGHT_OFFSETS: Record<string, [number, number, number]> = {
  headquarters: [0.3, 0.62, 0.3],
  battlefield_analysis_base: [0.3, 0.62, 0.3],
  mining_machine: [0.34, 0.6, 0.12],
  arc_smelter: [0.31, 0.72, 0.24],
  matrix_laboratory: [0.3, 0.62, 0.24],
  wind_turbine: [0.24, 0.42, -0.2],
  tesla_tower: [0.26, 0.36, 0.26],
  solar_panel: [0.34, 0.3, 0.3],
  accumulator: [0.26, 0.36, 0.26],
  logistics_station: [0.3, 1.12, 0.3],
  storage: [0.26, 0.4, 0.26],
  liquid_storage_tank: [0.2, 0.62, 0.16],
  gun_turret: [0.24, 0.32, 0.24],
  oil_refinery: [0.26, 0.5, 0.24],
  assembling_machine_mk1: [0.3, 0.56, 0.3],
  assembling_machine_mk2: [0.3, 0.56, 0.3],
  assembling_machine_mk3: [0.3, 0.56, 0.3],
  spray_coater: [0.3, 0.5, 0.24],
  fractionator: [0.24, 0.42, 0.24],
  miniature_particle_collider: [0.24, 0.44, 0.24],
  traffic_monitor: [0.2, 0.86, 0.16],
};
const DEFAULT_OFFSET: [number, number, number] = [0.28, 0.5, 0.28];

export interface StatusLightEntry {
  id: string;
  /** 建筑类型（取偏移表）。 */
  type: string;
  /** 运行态：只认服务端 `runtime.state`。 */
  state?: string;
  /** 建筑在场景里的组（取世界矩阵；组已带格位缩放）。 */
  root: THREE.Object3D;
  /** 占地（格），灯按占地中心偏置。 */
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

const bulbGeometry = new THREE.SphereGeometry(0.5, 8, 6);
const haloGeometry = new THREE.SphereGeometry(0.5, 8, 6);
const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
/** 光晕：加法混合的半透明球，受 bloom 放大成一个小光点（低档位没有 bloom 也能看清）。 */
const haloMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
  blending: THREE.AdditiveBlending, toneMapped: false,
});

/**
 * 状态灯实例集合：一个 `InstancedMesh`（灯珠）+ 一个（光晕）。
 * `refresh()` 只在建筑集合变化时重建实例（静态批不受影响）；`update()` 每帧只改颜色/光晕尺寸。
 */
export class StatusLights {
  readonly group = new THREE.Group();
  private bulbs?: THREE.InstancedMesh;
  private halos?: THREE.InstancedMesh;
  private entries: StatusLightEntry[] = [];
  private states: StatusLightState[] = [];
  private signature = '';
  private readonly color = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  /** 每盏灯的世界位置与基础尺寸（refresh 时算一次，逐帧只改颜色/光晕缩放）。 */
  private positions: { position: THREE.Vector3; bulb: number; halo: number }[] = [];

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

  /**
   * 同步建筑集合。返回是否重建了实例（新增/移除建筑）。
   * 状态变化只记在 `states` 里，由 `update()` 写 instanceColor。
   */
  refresh(entries: readonly StatusLightEntry[]): boolean {
    const signature = entries.map(entry => `${entry.id}:${entry.type}:${entry.width}x${entry.height}`).join('|');
    this.states = entries.map(entry => statusLightState(entry.state));
    if (signature === this.signature) {
      this.entries = entries.map(entry => ({ ...entry }));
      return false;
    }
    this.signature = signature;
    this.entries = entries.map(entry => ({ ...entry }));
    this.disposeMeshes();
    if (!entries.length) return true;
    const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, entries.length);
    bulbs.name = 'status-light-bulbs';
    bulbs.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    bulbs.frustumCulled = false;
    const halos = new THREE.InstancedMesh(haloGeometry, haloMaterial, entries.length);
    halos.name = 'status-light-halos';
    halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    halos.frustumCulled = false;
    bulbs.castShadow = halos.castShadow = false;
    bulbs.receiveShadow = halos.receiveShadow = false;
    this.bulbs = bulbs; this.halos = halos;
    this.group.add(halos, bulbs);
    const size = this.tileScale();
    this.positions = [];
    entries.forEach((entry, index) => {
      const offset = LIGHT_OFFSETS[entry.type] ?? DEFAULT_OFFSET;
      entry.root.updateWorldMatrix(true, false);
      // 灯挂在建筑根下：位置 = 根矩阵 ×（占地中心的局部偏移）。占地 >1 格时把灯推到角落。
      const local = this.scratch.set(
        offset[0] * Math.max(1, entry.width * 0.62),
        offset[1],
        offset[2] * Math.max(1, entry.height * 0.62),
      );
      const world = new THREE.Vector3().copy(local).applyMatrix4(entry.root.matrixWorld);
      this.positions.push({ position: world, bulb: size * 0.075, halo: size * 0.2 });
      this.compose(bulbs, index, this.positions[index], this.positions[index].bulb);
      this.compose(halos, index, this.positions[index], this.positions[index].halo);
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
    let colors = false;
    for (let index = 0; index < this.entries.length; index++) {
      const next = statusLightState(this.entries[index].state);
      const changed = next !== this.states[index];
      if (changed) { this.states[index] = next; colors = true; }
      // 常亮灯（运行 / 空闲）只在灯态变化时写一次；只有缺电红灯每帧写颜色与光晕。
      if (!changed && next !== 'noPower') continue;
      const intensity = statusLightIntensity(next, time, frozen);
      this.color.setHex(statusLightColor(next)).multiplyScalar(0.15 + 0.85 * intensity);
      bulbs.setColorAt(index, this.color);
      // 光晕随强度缩放：缺电时一明一暗，一眼看出。
      this.compose(halos, index, this.positions[index], this.positions[index].halo * (0.45 + 0.55 * intensity));
      this.color.multiplyScalar(0.35);
      halos.setColorAt(index, this.color);
    }
    if (colors && bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
  }

  /** 写一个实例矩阵（位置 + 统一缩放），复用临时矩阵，不分配。 */
  private compose(mesh: THREE.InstancedMesh, index: number, slot: { position: THREE.Vector3 }, scale: number) {
    this.matrix.makeScale(scale, scale, scale);
    this.matrix.setPosition(slot.position);
    mesh.setMatrixAt(index, this.matrix);
  }

  dispose() {
    this.disposeMeshes();
    this.entries = []; this.states = []; this.positions = []; this.signature = '';
    this.group.removeFromParent();
  }

  private disposeMeshes() {
    for (const mesh of [this.bulbs, this.halos]) if (mesh) { mesh.dispose(); mesh.removeFromParent(); }
    this.bulbs = undefined; this.halos = undefined;
  }
}
