import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { UnitFaction } from '../rts-commands';

/**
 * 现成 3D 模型（Kenney CC0，见 public/assets/models/THIRD_PARTY.md）。
 *
 * 同步 API：`IndustrialModels.building()` / `unit()` 每帧可能被调用，所以这里把「异步加载」
 * 和「同步实例化」彻底分开：
 * - `preloadIndustrialGltf()` 在场景起来时加载一次（模块级单例，多个场景共用）；
 * - `instantiateBuilding()` / `instantiateUnit()` 同步返回克隆，没加载完返回 null，调用方回退程序化模型。
 *
 * 每个模型只在加载时做一次「居中 + 落地 + 材质按阵营克隆」的准备工作，
 * 之后所有实例都 clone 这份模板：几何与材质在实例间共享，静态合批（StaticBatches）
 * 才能按 geometry/material 归并成 InstancedMesh。
 */

export interface GltfModelSpec {
  /** public/assets/models/ 下的相对路径（含扩展名）。 */
  file: string;
  /** 归一化后再乘的尺寸系数（默认 1）。 */
  scale?: number;
  /** 绕 Y 的朝向修正（弧度，默认 0）。 */
  yaw?: number;
}

/** 建筑：键是服务端 `building.type`。 */
export const BUILDING_GLTF: Record<string, GltfModelSpec> = {
  assembling_machine_mk1: { file: 'city/building-a.glb' },
  assembling_machine_mk2: { file: 'city/building-b.glb' },
  assembling_machine_mk3: { file: 'city/building-c.glb' },
  chemical_plant: { file: 'city/building-l.glb' },
  quantum_chemical_plant: { file: 'city/building-m.glb' },
  recomposing_assembler: { file: 'city/building-k.glb' },
  barracks: { file: 'city/building-h.glb' },
  vehicle_factory: { file: 'city/building-f.glb' },
  supply_station: { file: 'city/building-p.glb' },
  airfield: { file: 'space/hangar_largeA.glb' },
  ray_receiver: { file: 'space/satelliteDish_large.glb' },
  em_rail_ejector: { file: 'space/rocket_baseA.glb' },
  planetary_shield_generator: { file: 'space/gate_complex.glb' },
  jammer_tower: { file: 'space/machine_wireless.glb' },
  signal_tower: { file: 'space/satelliteDish_detailed.glb' },
  orbital_collector: { file: 'space/machine_generatorLarge.glb' },
  water_pump: { file: 'city/water-tower.glb' },
  automatic_piler: { file: 'city/shipping-container-a.glb' },
  artificial_star: { file: 'space/structure_detailed.glb' },
};

/** 单位/飞船：键是服务端 `unit.type`。 */
export const UNIT_GLTF: Record<string, GltfModelSpec> = {
  worker: { file: 'space/astronautA.glb' },
  soldier: { file: 'space/astronautB.glb' },
  scout: { file: 'space/rover.glb' },
  attack_drone: { file: 'space/craft_speederA.glb' },
  logistics_drone: { file: 'space/craft_cargoA.glb' },
  logistics_ship: { file: 'space/craft_cargoB.glb' },
  logistics_bot: { file: 'space/craft_speederC.glb' },
  transport_robot: { file: 'space/craft_speederB.glb' },
};

const ROOT = '/assets/models/';
const loader = new GLTFLoader();

/** 单位涂装：与工业模型库的 UNIT_FINISH 同义（己方白蓝、敌方橙、黑雾紫/暗红）。 */
const FACTION_TINT: Record<UnitFaction | 'building_own' | 'building_enemy', { body: number; accent: number }> = {
  building_own: { body: 0xffffff, accent: 0x24b7dc },
  building_enemy: { body: 0xffb9a2, accent: 0xff720d },
  own: { body: 0xffffff, accent: 0x24b7dc },
  enemy: { body: 0xffb9a2, accent: 0xff720d },
  fog_neutral: { body: 0x8a7fb0, accent: 0x7d5cff },
  fog_hostile: { body: 0x7d3a3a, accent: 0xff2a2a },
};

interface Prepared {
  /** 已居中、底部贴 Y=0 的模板（未缩放）。 */
  group: THREE.Group;
  size: THREE.Vector3;
}

interface Variant {
  own: Prepared;
  enemy: Prepared;
}

const variants = new Map<string, Variant>();
/** 单位按四个阵营各留一份材质变体（材质共享，不能逐实例改色）。 */
const unitVariants = new Map<string, Map<UnitFaction, Prepared>>();
const specs = new Map<string, GltfModelSpec>();
const accentGeometry = new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2);
const accents = new Map<number, THREE.MeshStandardMaterial>();
let loading: Promise<void> | undefined;

function accentMaterial(color: number): THREE.MeshStandardMaterial {
  let material = accents.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 4, roughness: 0.3, metalness: 0.2 });
    accents.set(color, material);
  }
  return material;
}

/**
 * 材质准备：Kenney 太空包用 `KHR_materials_unlit`（GLTFLoader 给 MeshBasicMaterial，
 * 没有明暗，进场景会像贴纸），换成标准材质保留贴图与底色；城市包是标准材质但
 * roughness 缺省为 1（全哑光），压到 0.62 让高光接近现有工业件。
 *
 * 每个阵营各克隆一份材质再上色：模板之间互不影响，实例之间继续共享（合批靠它）。
 */
function prepare(scene: THREE.Object3D, tint: number): Prepared {
  const root = scene.clone(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = object.material as THREE.Material;
    const material = source instanceof THREE.MeshBasicMaterial
      ? new THREE.MeshStandardMaterial({ color: source.color.clone(), map: source.map, roughness: 0.55, metalness: 0.25, side: source.side })
      : (source as THREE.MeshStandardMaterial).clone();
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = Math.max(0.45, material.roughness);
      material.metalness = Math.min(material.metalness, 0.35);
      material.color.multiply(new THREE.Color(tint));
    }
    object.material = material;
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
  if (variants.has(file)) return;
  const gltf = await loader.loadAsync(ROOT + file);
  const own = prepare(gltf.scene, FACTION_TINT.building_own.body);
  const enemy = prepare(gltf.scene, FACTION_TINT.building_enemy.body);
  variants.set(file, { own, enemy });
  const byFaction = new Map<UnitFaction, Prepared>();
  for (const faction of ['own', 'enemy', 'fog_neutral', 'fog_hostile'] as UnitFaction[]) {
    byFaction.set(faction, faction === 'own' ? own : faction === 'enemy' ? enemy : prepare(gltf.scene, FACTION_TINT[faction].body));
  }
  unitVariants.set(file, byFaction);
}

/** 加载建筑/单位用到的全部 GLB；重复调用返回同一个 promise。 */
export function preloadIndustrialGltf(): Promise<void> {
  if (!loading) {
    for (const [type, spec] of Object.entries(BUILDING_GLTF)) specs.set(`building:${type}`, spec);
    for (const [type, spec] of Object.entries(UNIT_GLTF)) specs.set(`unit:${type}`, spec);
    const files = [...new Set([...specs.values()].map((spec) => spec.file))];
    loading = Promise.all(files.map(prepareFile)).then(() => undefined);
  }
  return loading;
}

export function gltfLoaded(): boolean {
  return variants.size > 0;
}

function fit(prepared: Prepared, spec: GltfModelSpec, width: number, depth: number, scale: number): THREE.Group {
  const group = cloneSkinned(prepared.group);
  const s = Math.min(width / Math.max(prepared.size.x, 1e-4), depth / Math.max(prepared.size.z, 1e-4)) * (spec.scale ?? 1) * scale;
  group.scale.setScalar(s);
  if (spec.yaw) group.rotateY(spec.yaw);
  return group;
}

/**
 * 同步实例化建筑模型：没加载完或该类型没有现成模型时返回 null。
 * `width/depth` 是局部单位下的占地（`footprint * .86`），模型按包围盒等比缩进去，
 * 高度不额外拉伸——5×5 的基站不会被放大成 25 格。
 */
export function instantiateBuilding(type: string, width: number, depth: number, own: boolean): THREE.Group | null {
  const spec = BUILDING_GLTF[type];
  const prepared = spec && variants.get(spec.file);
  if (!spec || !prepared) return null;
  const group = fit(prepared[own ? 'own' : 'enemy'], spec, width, depth, 1);
  group.name = `gltf-${type}`;
  // 阵营识别：地面发光环。所有 GLB 建筑共用同一份几何与材质，静态合批后每阵营只多 1 个绘制调用。
  const accent = new THREE.Mesh(accentGeometry, accentMaterial(FACTION_TINT[own ? 'building_own' : 'building_enemy'].accent));
  accent.scale.set(width / group.scale.x, 1, depth / group.scale.z);
  accent.position.y = 0.012;
  accent.receiveShadow = false;
  group.add(accent);
  return group;
}

/** 同步实例化单位模型：涂装按阵营取材质变体，同样不写共享材质。 */
export function instantiateUnit(type: string, faction: UnitFaction): THREE.Group | null {
  const spec = UNIT_GLTF[type];
  const prepared = spec && unitVariants.get(spec.file)?.get(faction);
  if (!spec || !prepared) return null;
  const group = fit(prepared, spec, 1, 1, 1);
  group.name = `gltf-unit-${type}`;
  return group;
}
