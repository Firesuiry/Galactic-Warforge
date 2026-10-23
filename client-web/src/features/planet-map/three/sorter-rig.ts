import * as THREE from 'three';
import type { Building } from '@shared/types';
import type { TilePoint } from '../model';
import { getBuildingFootprint, toTilePoint } from '../model';
import { getItemColorValue } from '../item-colors';
import { createPbrMaterial, industrialMaterialsReady, onIndustrialMaterialsReady } from './industrial-materials';
import { surfaceOffset } from '@shared/surface';
import { occupiesGround, tierColor } from '../logistics-tier';
import { OPPOSITE_DIRECTION, ROTATION_FACING, rotationTurns, stepTile, type CardinalDirection } from '../logistics-direction';
import { BELT_BASE_LIFT, BELT_BODY_BOTTOM, BELT_DECK_TOP } from './conveyor-geometry';
import { conveyorAllowedInputs } from '../sorter-filter';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import { SorterMotion, poseAt, type SorterPose } from './sorter-animation';

/**
 * 门控（道闸）式分拣器（第 19 轮契约 §4.1，DSP 口径）。
 *
 * 造型：一条贴地的石墨底板从取货端格边伸到放货端格边；本格中心立一对陶瓷叉形侧板（闸座），
 * 横轴上挂双平行摆臂，摆臂在**竖直面内**从取货端翻过头顶落到放货端（像道闸的闸杆）。
 * 摆臂前段伸缩，臂端夹爪始终朝下，物品方块挂在夹爪下。
 *
 * 局部系（单位 cell）：原点 = 分拣器格心、带体基准高度（地面 = `BELT_BODY_BOTTOM`），
 * `+X` = 放货端（正面），`−X` = 取货端（背面），`+Y` 法线，`+Z` 横向。
 *
 * 端点来自真实布局：沿朝向前后各扫 `range` 格，第一个被占的格就是端点（与服务端
 * `sorterFindEndpoint` 同口径，见 `findEnd`）。带子 = 带子中心线；建筑 = 建筑外壁内侧一点。
 * 没接上的一端按 1 格画、灯条变暗。底板只占本格（DSP 的机座就是 1 格，跨 2–3 格伸长的是摆臂）。
 *
 * 全部分拣器共用十几个 InstancedMesh（静态件只在布局变化时写，动态件逐帧写），
 * 分拣器再多也只有固定的 draw 数。
 */

/** 摆臂横轴高度（带体基准坐标，地面 −.02）。 */
export const SORTER_PIVOT_Y = .33;
/** 夹爪腕轴 → 物品中心的垂距。 */
export const SORTER_HANG = .155;
/** 夹爪下的物品方块边长（与带上方块同一量级）。 */
export const SORTER_PAYLOAD = .22;
/** 夹爪悬停高度（取/放点上方），悬停时指尖高过带上物品。 */
const HOVER = .14;
/** 物品中心的取/放高度：带子 = 坐在带面上；建筑 = 外壁中段。 */
const GRIP_BELT = BELT_DECK_TOP + SORTER_PAYLOAD / 2;
const GRIP_BUILDING = .3;
const GROUND = BELT_BODY_BOTTOM;
/**
 * 建筑端点：模型按占地 .86 缩放，外壁离占地边界 ≈ 0.07 × 占地格数；机体本身还会再往里收一点，
 * 夹爪探进外壁 .12（上限 .35），读起来是「伸进机器口里取/放」，而不是悬在占地边上。
 */
const BUILDING_INSET = .07;
const BUILDING_REACH = .12;
const BUILDING_REACH_MAX = .35;

export type SorterEndKind = 'belt' | 'building' | null;
export interface SorterEnd { steps: number; kind: SorterEndKind; /** 端点建筑沿轴的占地格数。 */ depth: number }
export interface SorterSpan { pickup: SorterEnd; drop: SorterEnd }

/**
 * 地面占用：格 → 建筑（footprint 展开），与服务端 `TileBuilding` 同口径：
 * 高架带（`BeltLayers`）、地基（地形修饰，不占格）、物流配送器与其它 `z > 0` 叠层都不登记。
 */
export function groundBuildingMap(buildings: readonly Building[], faceSize: number) {
  const map = new Map<string, Building>();
  for (const building of buildings) {
    if (!occupiesGround(building)) continue;
    const footprint = getBuildingFootprint(building);
    for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
      const tile = surfaceOffset(toTilePoint(building.position), dx, dy, faceSize);
      map.set(`${tile.x}:${tile.y}`, building);
    }
  }
  return map;
}

const DEAD_END: SorterEnd = { steps: 1, kind: null, depth: 1 };

/**
 * 沿一个方向找端点，逐条对齐服务端 `sorterFindEndpoint`：跳过空格，第一个被占格就是端点——
 * 敌方 → 断头；传送带类（含集装机）须运行中且不是分流器，放货端还要求该格接受这一侧插入；
 * 其它建筑须有仓储且有对应方向的 IO 口（取 = output/both，放 = input/both），否则断头。
 */
function findEnd(origin: TilePoint, owner: string, selfId: string, direction: CardinalDirection, range: number,
  ground: ReadonlyMap<string, Building>, faceSize: number, side: 'pickup' | 'drop'): SorterEnd {
  let cursor = { tile: origin, direction };
  for (let step = 1; step <= range; step++) {
    cursor = stepTile(cursor.tile, cursor.direction, faceSize);
    const hit = ground.get(`${cursor.tile.x}:${cursor.tile.y}`);
    if (!hit || hit.id === selfId) continue;
    if (hit.owner_id !== owner) return DEAD_END;
    if (hit.conveyor) {
      if (hit.splitter || (hit.runtime?.state && hit.runtime.state !== 'running')) return DEAD_END;
      if (side === 'drop' && !conveyorAllowedInputs(hit.conveyor).has(OPPOSITE_DIRECTION[cursor.direction])) return DEAD_END;
      return { steps: step, kind: 'belt', depth: 1 };
    }
    const wanted = side === 'pickup' ? 'output' : 'input';
    const ports = hit.storage ? hit.runtime?.params?.io_ports ?? [] : [];
    if (!ports.some(port => port.direction === wanted || port.direction === 'both')) return DEAD_END;
    const footprint = getBuildingFootprint(hit);
    const axis = direction === 'east' || direction === 'west' ? footprint.width : footprint.height;
    return { steps: step, kind: 'building', depth: axis };
  }
  return DEAD_END;
}

export function sorterFacing(rotation: Building['rotation'] | number | undefined): CardinalDirection {
  return ROTATION_FACING[rotationTurns(rotation)] ?? 'north';
}

export function sorterSpan(building: Pick<Building, 'id' | 'position' | 'rotation' | 'owner_id' | 'sorter'>,
  ground: ReadonlyMap<string, Building>, faceSize: number, range = building.sorter?.range ?? 1): SorterSpan {
  const facing = sorterFacing(building.rotation);
  const origin = toTilePoint(building.position);
  const reach = Math.max(1, Math.min(3, range));
  return {
    pickup: findEnd(origin, building.owner_id, building.id, OPPOSITE_DIRECTION[facing], reach, ground, faceSize, 'pickup'),
    drop: findEnd(origin, building.owner_id, building.id, facing, reach, ground, faceSize, 'drop'),
  };
}

/** 端点 → 取/放点（沿轴距离 + 物品中心高度）。 */
export function sorterGripPoint(end: SorterEnd): { distance: number; height: number } {
  if (end.kind === 'building') return { distance: end.steps - .5 + Math.min(BUILDING_REACH_MAX, BUILDING_INSET * end.depth + BUILDING_REACH), height: GRIP_BUILDING };
  if (end.kind === 'belt') return { distance: end.steps, height: GRIP_BELT };
  return { distance: .78, height: GRIP_BELT };
}

export interface SorterArmPose {
  /** 腕轴位置（局部 x/y）。 */
  wrist: THREE.Vector2;
  /** 摆臂角（绕 +Z，0 = 指向放货端）与长度（横轴 → 腕轴）。 */
  angle: number;
  length: number;
}

/**
 * 摆臂几何：物品中心沿「取货点 → 翻过头顶 → 放货点」的弧线走（φ = π(1 − swing)），
 * 两侧水平半径各自等于到端点的距离，顶点高度按两侧平均臂长定（短跨度时是正圆，臂长基本不变）。
 */
export function sorterArmPose(span: SorterSpan, pose: Pick<SorterPose, 'swing' | 'lift'>,
  out: SorterArmPose = { wrist: new THREE.Vector2(), angle: 0, length: 0 }): SorterArmPose {
  const pickup = sorterGripPoint(span.pickup), drop = sorterGripPoint(span.drop);
  const phi = Math.PI * (1 - THREE.MathUtils.clamp(pose.swing, 0, 1));
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const end = cos < 0 ? pickup : drop;
  const apex = THREE.MathUtils.clamp((pickup.distance + drop.distance) / 2 - SORTER_HANG, .4, 1.2);
  const x = end.distance * cos;
  const ground = 1 - sin;
  const y = SORTER_PIVOT_Y + apex * sin + (end.height - SORTER_PIVOT_Y) * ground + HOVER * pose.lift * ground;
  out.wrist.set(x, y + SORTER_HANG);
  const dy = out.wrist.y - SORTER_PIVOT_Y;
  out.angle = Math.atan2(dy, x);
  out.length = Math.hypot(x, dy);
  return out;
}

type MaterialKey = 'graphite' | 'ceramic' | 'alloy' | 'light' | 'dock' | 'payload';
type GeometryKey = 'box' | 'cylinder' | 'prism';
interface PartSpec { geometry: GeometryKey; material: MaterialKey; dynamic: boolean; shadow: boolean }

/** 静态件（布局变化才重写）与动态件（逐帧）分开成两组 InstancedMesh。 */
const PARTS = {
  plate: { geometry: 'box', material: 'graphite', dynamic: false, shadow: true },
  strip: { geometry: 'box', material: 'light', dynamic: false, shadow: false },
  dock: { geometry: 'box', material: 'dock', dynamic: false, shadow: true },
  pointer: { geometry: 'prism', material: 'light', dynamic: false, shadow: false },
  ceramic: { geometry: 'box', material: 'ceramic', dynamic: false, shadow: true },
  cheekCap: { geometry: 'cylinder', material: 'ceramic', dynamic: false, shadow: true },
  hub: { geometry: 'cylinder', material: 'alloy', dynamic: false, shadow: true },
  axleCap: { geometry: 'cylinder', material: 'light', dynamic: false, shadow: false },
  sleeve: { geometry: 'box', material: 'alloy', dynamic: true, shadow: true },
  stripe: { geometry: 'box', material: 'light', dynamic: true, shadow: false },
  rod: { geometry: 'box', material: 'graphite', dynamic: true, shadow: true },
  wrist: { geometry: 'cylinder', material: 'alloy', dynamic: true, shadow: true },
  payload: { geometry: 'box', material: 'payload', dynamic: true, shadow: true },
} satisfies Record<string, PartSpec>;
type PartName = keyof typeof PARTS;
/** 每台分拣器各部件的实例数。 */
const COUNTS: Record<PartName, number> = { plate: 1, strip: 2, dock: 2, pointer: 1, ceramic: 3, cheekCap: 2, hub: 1, axleCap: 2,
  sleeve: 3, stripe: 2, rod: 4, wrist: 1, payload: 1 };
const PART_NAMES = Object.keys(PARTS) as PartName[];

const DOCK_COLOR = '#95a4ab';
const DIM_LIGHT = '#59646a';
export const SORTER_GHOST_COLOR = '#7df7b0';
const GHOST_WARN = '#ffd166';
const GHOST_MISSING = '#ff6b6b';

interface Rig {
  building: Building;
  span: SorterSpan;
  frame: THREE.Matrix4;
  motion: SorterMotion;
  tile: TilePoint;
}

export interface SorterRigOptions { ghost?: boolean }

export class SorterRigs {
  readonly group = new THREE.Group();
  private readonly geometries: Record<GeometryKey, THREE.BufferGeometry>;
  private materials: Record<MaterialKey, THREE.Material>;
  /** 当前金属件是否已用上 PBR 贴图（构造时未就绪 → 贴图就绪后 `upgradeMaterials()` 换一次）。 */
  private pbr = false;
  private meshes = new Map<PartName, THREE.InstancedMesh>();
  private rigs: Rig[] = [];
  private readonly motions = new Map<string, SorterMotion>();
  private signature = '';
  private ghostTime = 0;
  private readonly scratch = { matrix: new THREE.Matrix4(), local: new THREE.Matrix4(), position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(), scale: new THREE.Vector3(), euler: new THREE.Euler(),
    arm: { wrist: new THREE.Vector2(), angle: 0, length: 0 } as SorterArmPose };
  /** 灯色/物品色缓存：逐帧 setColorAt 不再每次 new Color。 */
  private readonly colors = new Map<string, THREE.Color>();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly options: SorterRigOptions = {}) {
    this.group.name = options.ghost ? 'sorter-rig-ghost' : 'sorter-rigs';
    const cylinder = new THREE.CylinderGeometry(.5, .5, 1, 18); cylinder.rotateX(Math.PI / 2);
    this.geometries = { box: new THREE.BoxGeometry(1, 1, 1), cylinder, prism: prismGeometry() };
    this.pbr = !options.ghost && industrialMaterialsReady();
    this.materials = this.buildMaterials();
    // 贴图异步就绪：原地换金属材质并重建实例网格。
    if (!this.pbr) onIndustrialMaterialsReady(() => this.upgradeMaterials());
  }

  /**
   * 分拣臂材质。PBR 贴图是异步加载的：构造时多半还没就绪，先给纯色；
   * 场景在贴图加载完成后调 `upgradeMaterials()` 原地换掉（并重建实例网格）。
   * ghost 永远是半透明绿，不贴图。
   */
  private buildMaterials(): Record<MaterialKey, THREE.Material> {
    const ghost = this.options.ghost;
    // ghost 三档明度（深绿杆件 / 中绿合金 / 浅绿闸座）：纯一色半透明绿在绿色地表上会糊成一团（试玩 1018）。
    const solid = (parameters: THREE.MeshStandardMaterialParameters, ghostColor: string, opacity: number) => ghost
      ? new THREE.MeshStandardMaterial({ color: ghostColor, roughness: .5, metalness: .1, transparent: true, opacity, depthWrite: false })
      : new THREE.MeshStandardMaterial(parameters);
    // 分拣臂金属 + 关节暗色（3A 画质 §7）：PBR 贴图就绪时用拉丝钛/石墨板的真实材质。
    const pbr = (family: 'alloy' | 'graphite', parameters: THREE.MeshStandardMaterialParameters, ghostColor: string, opacity: number) =>
      (!ghost && createPbrMaterial(family, String(parameters.color), parameters, 1)) || solid(parameters, ghostColor, opacity);
    return {
      graphite: pbr('graphite', { color: '#2b363c', roughness: .5, metalness: .45 }, '#0d3a26', .78),
      ceramic: pbr('alloy', { color: '#e3e8e1', roughness: .44, metalness: .1 }, '#b4ffd6', .6),
      // 粗糙度压到 .46：太光滑时太阳高光会冲过 bloom 阈值，屏幕某一侧的机械臂整片发白。
      alloy: pbr('alloy', { color: '#8d9da4', roughness: .46, metalness: .6 }, '#45c987', .7),
      // 档位灯：不受光照，按实例色（档位色）显示，亮度压在 bloom 阈值下。
      light: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: ghost, opacity: ghost ? .8 : 1, depthWrite: !ghost }),
      // 端点小座：实例色（正常 = 合金灰；ghost = 绿/黄/红表示端点接没接上）。
      dock: ghost
        ? new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .75, depthWrite: false, toneMapped: false })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .48, metalness: .5 }),
      payload: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .72, metalness: .05, transparent: ghost, opacity: ghost ? .6 : 1 }),
    };
  }

  /** PBR 贴图加载完成后调用：换掉金属材质并重建实例网格（布局/搬运进度不变）。返回是否换了材质。 */
  upgradeMaterials(): boolean {
    if (this.options.ghost || this.pbr || !industrialMaterialsReady()) return false;
    this.pbr = true;
    const next = this.buildMaterials();
    const current = this.materials;
    // 只替换金属件（graphite / ceramic / alloy）；灯条、端点座、物品块与贴图无关，继续复用。
    for (const key of ['graphite', 'ceramic', 'alloy'] as const) {
      current[key].dispose();
      current[key] = next[key];
    }
    if (this.rigs.length) { this.rebuildMeshes(); this.writeStatic(); this.writeDynamic(); }
    return true;
  }

  /**
   * 同步布局与权威快照。`sorters` 只含要画的分拣器；`buildings` 用于找端点（地面占用）。
   * 布局签名不变时只同步搬运记录（不重建实例）。返回 true 表示实例被重建。
   */
  refresh(sorters: readonly Building[], buildings: readonly Building[] | ReadonlyMap<string, Building>, faceSize: number, radius: number, tick = 0,
    range?: (building: Building) => number): boolean {
    // 场景每次 setData 预先算好一张地面占用图传进来（实物与 ghost 共用），避免悬停时反复展开 3000 座建筑。
    const ground = buildings instanceof Map ? buildings : groundBuildingMap(buildings as readonly Building[], faceSize);
    const spans = sorters.map(building => sorterSpan(building, ground, faceSize, range?.(building)));
    const signature = JSON.stringify([faceSize, radius, sorters.map((building, index) => [building.id, building.type, building.position,
      building.rotation, building.runtime?.state === 'running', spans[index]])]);
    sorters.forEach((building, index) => {
      let motion = this.motions.get(building.id);
      if (!motion) { motion = new SorterMotion(); this.motions.set(building.id, motion); }
      // 往返周期按服务端口径随跨度变长：cycle_ticks × max(1, 取端步数 + 放端步数 − 1)。
      if (!this.options.ghost) motion.sync(building, tick, undefined, Math.max(1, spans[index].pickup.steps + spans[index].drop.steps - 1));
    });
    if (signature === this.signature) {
      this.rigs.forEach((rig, index) => { rig.building = sorters[index]; });
      return false;
    }
    this.signature = signature;
    const alive = new Set(sorters.map(building => building.id));
    for (const id of [...this.motions.keys()]) if (!alive.has(id)) this.motions.delete(id);
    const size = surfaceTileSize(radius, faceSize);
    this.rigs = sorters.map((building, index) => {
      const tile = toTilePoint(building.position);
      const normal = tileNormal(tile, faceSize);
      const { east, south } = tileFrame(tile, faceSize);
      // rotation=0 正面朝北（−Z）：局部 +X 转到朝向方向 → 绕 Y 转 (90° − rotation)。
      const yaw = (90 - Number(building.rotation ?? 0)) * Math.PI / 180;
      const frame = new THREE.Matrix4().makeBasis(east, normal, south)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .premultiply(new THREE.Matrix4().makeTranslation(normal.clone().multiplyScalar(radius + size * BELT_BASE_LIFT)))
        .multiply(new THREE.Matrix4().makeScale(size, size, size));
      return { building, span: spans[index], frame, motion: this.motions.get(building.id)!, tile };
    });
    this.rebuildMeshes();
    this.writeStatic();
    this.writeDynamic();
    return true;
  }

  /** 逐帧：推进节拍并写动态件。`active=false`（冻结/减弱动效）时保持原姿态。 */
  animate(delta: number, active = true) {
    if (!this.rigs.length) return;
    if (this.options.ghost) this.ghostTime += active ? delta : 0;
    else for (const rig of this.rigs) rig.motion.advance(delta, active && rig.building.runtime?.state === 'running');
    this.writeDynamic();
  }

  resolveHit(hit: THREE.Intersection): { tile: TilePoint; id: string } | null {
    if (hit.instanceId == null || !(hit.object instanceof THREE.InstancedMesh) || hit.object.parent !== this.group) return null;
    const owner = (hit.object.userData.owners as Int32Array | undefined)?.[hit.instanceId];
    const rig = owner === undefined ? undefined : this.rigs[owner];
    return rig ? { tile: { ...rig.tile }, id: rig.building.id } : null;
  }

  /** 测试/诊断：某台分拣器当前姿态与跨度。 */
  inspect(id: string) {
    const rig = this.rigs.find(candidate => candidate.building.id === id);
    if (!rig) return null;
    const pose = this.poseOf(rig);
    return { span: rig.span, pose, arm: sorterArmPose(rig.span, pose) };
  }

  dispose() {
    this.clearMeshes();
    Object.values(this.geometries).forEach(geometry => geometry.dispose());
    Object.values(this.materials).forEach(material => material.dispose());
    this.group.removeFromParent();
  }

  private poseOf(rig: Rig): SorterPose {
    return this.options.ghost ? poseAt((this.ghostTime / 1.6) % 1) : rig.motion.pose();
  }

  private clearMeshes() {
    for (const mesh of this.meshes.values()) { mesh.dispose(); mesh.removeFromParent(); }
    this.meshes.clear();
  }

  private rebuildMeshes() {
    this.clearMeshes();
    if (!this.rigs.length) return;
    for (const name of PART_NAMES) {
      const spec = PARTS[name];
      const count = COUNTS[name] * this.rigs.length;
      const mesh = new THREE.InstancedMesh(this.geometries[spec.geometry], this.materials[spec.material], count);
      mesh.name = `sorter-${name}`;
      mesh.castShadow = spec.shadow && !this.options.ghost;
      mesh.receiveShadow = !this.options.ghost;
      mesh.frustumCulled = false;
      if (spec.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.options.ghost) mesh.renderOrder = 20;
      const owners = new Int32Array(count);
      for (let index = 0; index < count; index++) owners[index] = Math.floor(index / COUNTS[name]);
      mesh.userData.owners = owners;
      this.meshes.set(name, mesh);
      this.group.add(mesh);
    }
  }

  /** 写一个实例：局部中心/尺寸/欧拉角 → 世界矩阵（乘分拣器自己的局部系）。 */
  private put(name: PartName, rig: number, slot: number, center: [number, number, number], size: [number, number, number], rotationZ = 0) {
    const mesh = this.meshes.get(name)!;
    const { matrix, local, position, rotation, scale, euler } = this.scratch;
    rotation.setFromEuler(euler.set(0, 0, rotationZ));
    local.compose(position.set(...center), rotation, scale.set(Math.max(1e-4, size[0]), Math.max(1e-4, size[1]), Math.max(1e-4, size[2])));
    matrix.multiplyMatrices(this.rigs[rig].frame, local);
    mesh.setMatrixAt(rig * COUNTS[name] + slot, matrix);
  }

  private hide(name: PartName, rig: number, slot: number) {
    this.meshes.get(name)!.setMatrixAt(rig * COUNTS[name] + slot, this.hidden);
  }

  private color(name: PartName, rig: number, slot: number, hex: string) {
    let color = this.colors.get(hex);
    if (!color) { color = new THREE.Color(hex); this.colors.set(hex, color); }
    this.meshes.get(name)!.setColorAt(rig * COUNTS[name] + slot, color);
  }

  private writeStatic() {
    if (!this.meshes.size) return;
    this.rigs.forEach((rig, index) => {
      const { pickup, drop } = rig.span;
      const connected = pickup.kind !== null && drop.kind !== null;
      const tier = tierColor(rig.building.type);
      const light = this.options.ghost ? (connected ? SORTER_GHOST_COLOR : GHOST_WARN) : connected ? tier : DIM_LIGHT;
      // 底板只占本格（DSP 的分拣器机座就是 1 格，跨 2–3 格时伸长的是摆臂，不是底座）。
      const start = -.47, end = .47, length = end - start, middle = 0;
      this.put('plate', index, 0, [middle, GROUND + .015, 0], [length, .03, .34]);
      for (const [slot, z] of [[0, .172], [1, -.172]] as const) {
        this.put('strip', index, slot, [middle, GROUND + .022, z], [length - .06, .014, .014]);
        this.color('strip', index, slot, light);
      }
      // 底板两端的小座：ghost 里按这一侧的端点接没接上分别着色（绿 / 红）。
      for (const [slot, x, side] of [[0, start + .025, pickup], [1, end - .025, drop]] as const) {
        this.put('dock', index, slot, [x, GROUND + .03, 0], [.05, .05, .36]);
        this.color('dock', index, slot, this.options.ghost ? (side.kind ? SORTER_GHOST_COLOR : GHOST_MISSING) : DOCK_COLOR);
      }
      // 放货端三角：一眼看出流向（取 → 放）。
      this.put('pointer', index, 0, [end - .13, GROUND + .036, 0], [.12, .012, .17]);
      this.color('pointer', index, 0, light);
      // 闸座：底座块 + 一对叉形侧板（侧板顶端是圆头，横轴从中间穿过）。
      this.put('ceramic', index, 0, [0, GROUND + .06, 0], [.24, .06, .3]);
      const cheekBottom = GROUND + .09, cheekHeight = SORTER_PIVOT_Y - cheekBottom;
      for (const [slot, z] of [[1, .1], [2, -.1]] as const) this.put('ceramic', index, slot, [0, cheekBottom + cheekHeight / 2, z], [.16, cheekHeight, .035]);
      for (const [slot, z] of [[0, .1], [1, -.1]] as const) this.put('cheekCap', index, slot, [0, SORTER_PIVOT_Y, z], [.16, .16, .035]);
      this.put('hub', index, 0, [0, SORTER_PIVOT_Y, 0], [.1, .1, .165]);
      for (const [slot, z] of [[0, .1235], [1, -.1235]] as const) {
        this.put('axleCap', index, slot, [0, SORTER_PIVOT_Y, z], [.064, .064, .012]);
        this.color('axleCap', index, slot, light);
      }
    });
    for (const name of PART_NAMES) {
      if (PARTS[name].dynamic) continue;
      const mesh = this.meshes.get(name)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // 动态件（摆臂/夹爪）逐帧在动：包围球取底板的再外扩 1.6 格（最长臂展 + 物品），拾取不随摆角丢失。
    const plate = this.meshes.get('plate')!.boundingSphere!;
    const reach = (this.rigs[0]?.frame.getMaxScaleOnAxis() ?? 1) * 1.6;
    for (const name of PART_NAMES) {
      if (!PARTS[name].dynamic) continue;
      this.meshes.get(name)!.boundingSphere = new THREE.Sphere(plate.center.clone(), plate.radius + reach);
    }
  }

  private writeDynamic() {
    if (!this.meshes.size) return;
    this.rigs.forEach((rig, index) => {
      const pose = this.poseOf(rig);
      const arm = sorterArmPose(rig.span, pose, this.scratch.arm);
      const connected = rig.span.pickup.kind !== null && rig.span.drop.kind !== null;
      const light = this.options.ghost ? SORTER_GHOST_COLOR : connected ? tierColor(rig.building.type) : DIM_LIGHT;
      // 双平行摆臂：合金套筒（定长）+ 石墨伸缩杆（到腕轴），套筒顶上一道档位色灯条。
      const along = (distance: number): [number, number] => [Math.cos(arm.angle) * distance, SORTER_PIVOT_Y + Math.sin(arm.angle) * distance];
      const rodStart = .3, rodEnd = Math.max(rodStart + .01, arm.length - .02);
      // 跨格长臂（2–3 格）按长度加粗伸缩杆，否则远看只剩一根细线；相邻格的短臂保持原截面。
      const reachBeyond = Math.min(1.6, Math.max(0, arm.length - 1));
      const rodHeight = .04 + reachBeyond * .016, rodDepth = .026 + reachBeyond * .01;
      const liftX = -Math.sin(arm.angle) * .035, liftY = Math.cos(arm.angle) * .035;
      for (const [pair, z] of [[0, .05], [1, -.05]] as const) {
        const [sx, sy] = along(.18);
        this.put('sleeve', index, pair, [sx, sy, z], [.3, .065, .038], arm.angle);
        this.put('stripe', index, pair, [sx + liftX, sy + liftY, z], [.22, .008, .022], arm.angle);
        this.color('stripe', index, pair, light);
        const [rx, ry] = along((rodStart + rodEnd) / 2);
        this.put('rod', index, pair, [rx, ry, z], [rodEnd - rodStart, rodHeight, rodDepth], arm.angle);
      }
      // 腕轴 + 始终朝下的夹爪（壳体 + 两指），物品挂在两指之间。
      const { wrist } = arm;
      this.put('wrist', index, 0, [wrist.x, wrist.y, 0], [.044, .044, .14]);
      this.put('sleeve', index, 2, [wrist.x, wrist.y - .045, 0], [.28, .05, .12]);
      for (const [slot, x] of [[2, .125], [3, -.125]] as const) this.put('rod', index, slot, [wrist.x + x, wrist.y - .105, 0], [.022, .1, .1]);
      if (pose.carrying || this.options.ghost) {
        this.put('payload', index, 0, [wrist.x, wrist.y - SORTER_HANG, 0], [SORTER_PAYLOAD, SORTER_PAYLOAD, SORTER_PAYLOAD]);
        this.color('payload', index, 0, this.options.ghost ? '#ffffff' : getItemColorValue(pose.itemId ?? ''));
        if (this.options.ghost && !pose.carrying) this.hide('payload', index, 0);
      } else this.hide('payload', index, 0);
    });
    for (const name of PART_NAMES) {
      if (!PARTS[name].dynamic) continue;
      const mesh = this.meshes.get(name)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** 底板上的流向三角（局部 +X 指向放货端），单位尺寸。 */
function prismGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.5, -.5); shape.lineTo(.5, 0); shape.lineTo(-.5, .5); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  // Extrude 沿 +Z 拉伸：转成「XZ 平面上的三角、沿 Y 有厚度」，中心归零。
  geometry.translate(0, 0, -.5);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
