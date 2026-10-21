import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { UnitFaction } from '../rts-commands';

/**
 * 现成 3D 模型库（Kenney CC0：City Kit Industrial + Space Kit，见 public/assets/models/THIRD_PARTY.md）。
 *
 * 为什么要这一层：`IndustrialModels.building()` / `unit()` 是同步 API，每帧可能被调用，
 * 而 GLB 加载是异步的。这里把两件事彻底分开：
 * - `preloadIndustrialGltf()`：场景起来时加载一次（模块级单例，所有场景共用同一份模板）；
 * - `instantiateBuilding()` / `instantiateUnit()`：同步返回克隆，没加载完返回 null，
 *   调用方回退现有程序化模型。加载完成后场景调用 `IndustrialModels.reloadTemplates()` 重建一次。
 *
 * 材质：Kenney 的 GLB 里材质是共享的（Space Kit 还用 `KHR_materials_unlit`），
 * 直接改色会污染模板和别的实例。这里在**加载时**按阵营各准备一份模板，
 * 每份模板的材质是独立克隆；实例之间再共享这份阵营材质，静态合批（StaticBatches）
 * 才能按 geometry/material 归并成 InstancedMesh。
 */

export interface GltfModelSpec {
  /** public/assets/models/ 下的相对路径。 */
  file: string;
  /** 归一化之后的尺寸系数（默认 1）。 */
  scale?: number;
  /** 绕 Y 的朝向修正（弧度，默认 0）。 */
  yaw?: number;
}

/**
 * 建筑映射：键是服务端 `building.type`，只覆盖原来走通用 `factory()` 兜底的类型。
 * 已经有专属程序化模型的类型（研究站、矿机、熔炉、带子、分拣器、炮塔、发电、仓储、
 * 物流站等）继续用程序化模型，不进这张表。
 */
export const BUILDING_GLTF: Record<string, GltfModelSpec> = {
  assembling_machine_mk1: { file: 'city/building-b.glb' },
  assembling_machine_mk2: { file: 'city/building-e.glb' },
  assembling_machine_mk3: { file: 'city/building-d.glb' },
  recomposing_assembler: { file: 'city/building-c.glb' },
  chemical_plant: { file: 'city/building-l.glb' },
  quantum_chemical_plant: { file: 'city/building-m.glb' },
  barracks: { file: 'city/building-s.glb' },
  supply_station: { file: 'city/building-p.glb' },
  vehicle_factory: { file: 'city/building-f.glb' },
  water_pump: { file: 'city/water-tower.glb' },
  automatic_piler: { file: 'city/shipping-container-a.glb' },
  airfield: { file: 'space/hangar_largeA.glb' },
  ray_receiver: { file: 'space/satelliteDish_large.glb' },
  em_rail_ejector: { file: 'space/rocket_baseA.glb' },
  jammer_tower: { file: 'space/machine_wireless.glb' },
  signal_tower: { file: 'space/satelliteDish_detailed.glb' },
  orbital_collector: { file: 'space/machine_generator.glb' },
  planetary_shield_generator: { file: 'space/structure_detailed.glb' },
  artificial_star: { file: 'space/gate_complex.glb', scale: 1.15 },
};

/**
 * 单位映射：键是服务端 `unit.type`。
 *
 * 不在这里的类型继续用程序化模型，原因是它们有模型外的契约或没有合适素材：
 * - `logistics_bot` / `transport_robot`：场景按名字找 `logistics-bot-cargo` /
 *   `transport-robot-cargo` 节点做载货显隐与逐单位上色，还依赖转子动画；
 * - `mecha` / `executor`：Kenney 两个包里没有机甲；评估过 Quaternius「Ultimate Space Kit」
 *   的 CC0 机甲（狐/蛙驾驶）与 poly.pizza 上的 CC-BY 机甲，风格与「白陶瓷 + 蓝橙发光」
 *   的洁净工业风冲突，故保留程序化模型（见 tmp/models-report.md 遗留问题）；
 * - `artillery` / `missile_vehicle` / `repair_vehicle` / `supply_truck`：Kenney Car Kit 的
 *   车辆带彩色 colormap，与本作阵营涂装冲突，且没有军用底盘。
 */
export const UNIT_GLTF: Record<string, GltfModelSpec> = {
  worker: { file: 'space/astronautA.glb', scale: 0.8 },
  soldier: { file: 'space/astronautB.glb', scale: 0.8 },
  scout: { file: 'space/rover.glb', scale: 1.05 },
  attack_drone: { file: 'space/craft_speederA.glb', scale: 1.5 },
  logistics_drone: { file: 'space/craft_cargoA.glb', scale: 1.6 },
  logistics_ship: { file: 'space/craft_cargoB.glb', scale: 1.6 },
};

const ROOT = '/assets/models/';
const loader = new GLTFLoader();

/** 阵营涂装：与 `IndustrialModels` 的 UNIT_FINISH 同义（己方白蓝、敌方橙、黑雾紫/暗红）。 */
type TintKey = UnitFaction | 'own-building' | 'enemy-building';
const TINT: Record<TintKey, { body: number; accent: number }> = {
  'own-building': { body: 0xffffff, accent: 0x2fc4e8 },
  'enemy-building': { body: 0xffb9a2, accent: 0xff720d },
  own: { body: 0xffffff, accent: 0x2fc4e8 },
  enemy: { body: 0xffb9a2, accent: 0xff720d },
  fog_neutral: { body: 0x9c92c0, accent: 0x7d5cff },
  fog_hostile: { body: 0x8f4a4a, accent: 0xff2a2a },
};
const FACTION_KEYS: TintKey[] = ['own', 'enemy', 'fog_neutral', 'fog_hostile'];

interface Prepared {
  /** 已居中、底部贴 Y=0、按阵营上色的模板。 */
  group: THREE.Group;
  size: THREE.Vector3;
}

const templates = new Map<string, Map<TintKey, Prepared>>();
const accentGeometry = new THREE.RingGeometry(0.44, 0.5, 28).rotateX(-Math.PI / 2);
const accentMaterials = new Map<number, THREE.MeshStandardMaterial>();
let loading: Promise<void> | undefined;

function accentMaterial(color: number): THREE.MeshStandardMaterial {
  let material = accentMaterials.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.2, roughness: 0.3, metalness: 0.2 });
    accentMaterials.set(color, material);
  }
  return material;
}

/**
 * 模板准备：转成标准材质（Kenney Space Kit 是 unlit，进场景没有明暗会像贴纸）、
 * 按阵营乘底色、居中落地。只在加载时做一次。
 *
 * 同一个源材质在一份模板里只克隆一次：`batchStatic` 按材质归并，
 * 每个网格各克隆一份材质的话合并会失效，绘制调用会翻好几倍。
 */
function prepare(scene: THREE.Object3D, tint: number): Prepared {
  const root = scene.clone(true);
  const materials = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = object.material as THREE.Material;
    let material = materials.get(source);
    if (!material) {
      if (source instanceof THREE.MeshBasicMaterial) {
        material = new THREE.MeshStandardMaterial({ color: source.color.clone(), map: source.map, side: source.side, roughness: 0.55, metalness: 0.2 });
      } else {
        material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          // 城市包 roughness 缺省 1（全哑光），压到接近现有工业件的高光。
          material.roughness = Math.max(0.5, Math.min(material.roughness, 0.68));
          material.metalness = Math.min(material.metalness, 0.3);
        }
      }
      if (material instanceof THREE.MeshStandardMaterial) material.color.multiply(new THREE.Color(tint));
      materials.set(source, material);
    }
    object.material = material;
    // 合并静态网格要求所有几何的属性集合一致：统一成 position/normal/uv。
    const geometry = object.geometry as THREE.BufferGeometry;
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
  });
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  const wrapper = new THREE.Group();
  wrapper.add(root);
  return { group: wrapper, size };
}

async function prepareFile(file: string) {
  if (templates.has(file)) return;
  const gltf = await loader.loadAsync(ROOT + file);
  const variants = new Map<TintKey, Prepared>();
  for (const key of FACTION_KEYS) variants.set(key, prepare(gltf.scene, TINT[key].body));
  templates.set(file, variants);
}

/** 加载建筑/单位用到的全部 GLB；重复调用返回同一个 promise。
 *
 * `?procedural-models` 跳过加载，用来做「程序化模型 / 现成模型」同机位对照
 * （固定机位脚本 `scripts/playtest-shots/models.mjs` 靠它拍修前图，不用切分支）。 */
export function preloadIndustrialGltf(): Promise<void> {
  if (!loading && new URLSearchParams(window.location.search).has('procedural-models')) loading = Promise.resolve();
  if (!loading) {
    const files = [...new Set([...Object.values(BUILDING_GLTF), ...Object.values(UNIT_GLTF)].map((spec) => spec.file))];
    loading = Promise.all(files.map(prepareFile)).then(() => undefined);
  }
  return loading;
}

/** 模型是否已就绪（同步查询，供调用方决定要不要重建模板）。 */
export function gltfReady(): boolean {
  return templates.size > 0;
}

function fit(prepared: Prepared, spec: GltfModelSpec, width: number, depth: number): THREE.Group {
  const group = prepared.group.clone(true);
  const scale = Math.min(width / Math.max(prepared.size.x, 1e-4), depth / Math.max(prepared.size.z, 1e-4)) * (spec.scale ?? 1);
  group.scale.setScalar(scale);
  if (spec.yaw) group.rotateY(spec.yaw);
  return group;
}

/** 单位按「最长边」归一化到 1 cell 的 `.62`（现有程序化单位约 0.6×0.55，见 gallery 比例尺），
 * 再乘 `spec.scale` 微调：人形小、飞行器长。 */
function fitUnit(prepared: Prepared, spec: GltfModelSpec): THREE.Group {
  const group = prepared.group.clone(true);
  const scale = 0.62 / Math.max(prepared.size.x, prepared.size.z, 1e-4) * (spec.scale ?? 1);
  group.scale.setScalar(scale);
  if (spec.yaw) group.rotateY(spec.yaw);
  return group;
}

/**
 * 同步实例化建筑模型：没加载完或该类型没有现成模型时返回 null（调用方回退程序化模型）。
 *
 * `width/depth` 是局部单位下的占地（`footprint * .86`）：模型按包围盒等比缩进占地内，
 * 高度不额外拉伸，所以 5×5 的基站不会被放大成 25 格。
 */
export function instantiateBuilding(type: string, width: number, depth: number, own: boolean): THREE.Group | null {
  const spec = BUILDING_GLTF[type];
  const prepared = spec && templates.get(spec.file)?.get(own ? 'own' : 'enemy');
  if (!spec || !prepared) return null;
  const group = fit(prepared, spec, width * 0.86, depth * 0.86);
  group.name = `gltf-${type}`;
  // 阵营识别：地面发光环。几何与材质全场共用，静态合批后每阵营只多 1 个绘制调用。
  const accent = new THREE.Mesh(accentGeometry, accentMaterial(TINT[own ? 'own-building' : 'enemy-building'].accent));
  accent.scale.set(width / group.scale.x, 1, depth / group.scale.z);
  accent.position.y = 0.008;
  group.add(accent);
  return group;
}

/** 同步实例化单位模型：涂装按阵营取材质变体，同样不写共享材质。 */
export function instantiateUnit(type: string, faction: UnitFaction): THREE.Group | null {
  const spec = UNIT_GLTF[type];
  const prepared = spec && templates.get(spec.file)?.get(faction);
  if (!spec || !prepared) return null;
  const group = fitUnit(prepared, spec);
  group.name = `gltf-unit-${type}`;
  return group;
}
