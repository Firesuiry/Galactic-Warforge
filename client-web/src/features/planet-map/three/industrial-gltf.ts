import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import type { UnitFaction } from '../rts-commands';

import { FACTION, GLOW } from './palette';

/**
 * 现成 3D 模型库：两批素材。
 *
 * - Kenney CC0（City Kit Industrial + Space Kit，`city/`、`space/`，见 public/assets/models/THIRD_PARTY.md）：
 *   有彩贴图，进场景靠 `TINT` 的**光乘系数**压到本作阵营色；
 * - Sketchfab CC-BY（`sketchfab/`，见 `client-web/public/assets/models/sketchfab/THIRD_PARTY.md`）：
 *   规整阶段已把贴图去饱和到 35%、均值拉到中灰，进场景直接**乘阵营主色**（`palette.FACTION`），
 *   发光件（emissive 贴图平均亮度 > 阈值）换成阵营发光色。
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
  /** 内置附挂件（士兵的步枪）：模板阶段用程序化几何挂上去，不额外加载 GLB。
   * `at` 是主体包围盒的相对坐标（0..1），尺寸按主体高度换算。 */
  attach?: 'rifle';
  /**
   * 贴图已按本作口径预处理过（去饱和 + 均值归一，见 `develop_tools/sketchfab/normalize.mjs`）：
   * 底色直接乘阵营主色，而不是 Kenney 的「光乘系数」。
   */
  tinted?: 'palette';
}

/**
 * 建筑映射：键是服务端 `building.type`，只覆盖原来走通用 `factory()` 兜底的类型。
 * 已经有专属程序化模型的类型（研究站、矿机、熔炉、带子、分拣器、炮塔、发电、仓储、
 * 物流站等）继续用程序化模型，不进这张表。
 */
export const BUILDING_GLTF: Record<string, GltfModelSpec> = {
  // —— Kenney CC0（City Kit Industrial / Space Kit）——
  assembling_machine_mk1: { file: 'city/building-b.glb' },
  assembling_machine_mk2: { file: 'city/building-e.glb' },
  assembling_machine_mk3: { file: 'city/building-d.glb' },
  recomposing_assembler: { file: 'city/building-c.glb' },
  chemical_plant: { file: 'city/building-l.glb' },
  quantum_chemical_plant: { file: 'city/building-m.glb' },
  barracks: { file: 'city/building-a.glb' },
  supply_station: { file: 'city/building-g.glb' },

  water_pump: { file: 'city/water-tower.glb' },
  automatic_piler: { file: 'space/barrels.glb' },


  em_rail_ejector: { file: 'space/rocket_baseA.glb' },
  jammer_tower: { file: 'space/machine_wireless.glb' },
  signal_tower: { file: 'space/satelliteDish_detailed.glb' },
  orbital_collector: { file: 'space/machine_generator.glb' },
  planetary_shield_generator: { file: 'space/structure_detailed.glb' },

  // —— Sketchfab CC-BY（规整后已按本作口径去饱和，直接乘阵营主色）——
  airfield: { file: 'sketchfab/airfield.glb', tinted: 'palette' },
  artificial_star: { file: 'sketchfab/artificial_star.glb', tinted: 'palette' },
  ray_receiver: { file: 'sketchfab/ray_receiver.glb', tinted: 'palette' },
  vehicle_factory: { file: 'sketchfab/vehicle_factory.glb', tinted: 'palette' },
  // 没换的：battlefield_analysis_base / matrix_lab（俯视读不出功能）、mining_machine（是钻探车）、
  // em_rail_ejector（规整后只剩一根线）、barracks（条纹平板读不出兵营）——见 tmp/3a-models/report2.md。
  accumulator: { file: 'sketchfab/accumulator.glb', tinted: 'palette' },
  oil_extractor: { file: 'sketchfab/oil_extractor.glb', tinted: 'palette' },
  oil_refinery: { file: 'sketchfab/oil_refinery.glb', tinted: 'palette' },
  storage_tank: { file: 'sketchfab/storage_tank.glb', tinted: 'palette' },
  tesla_tower: { file: 'sketchfab/tesla_tower.glb', tinted: 'palette' },
  thermal_power_plant: { file: 'sketchfab/thermal_power_plant.glb', tinted: 'palette' },
  vertical_launching_silo: { file: 'sketchfab/vertical_launching_silo.glb', tinted: 'palette' },
  // 五种炮塔的 GLB 带 `turret-barrel` 子节点（炮管朝 +Z），场景按最近敌人写它的 rotation.y。
  gauss_turret: { file: 'sketchfab/gauss_turret.glb', tinted: 'palette' },
  laser_turret: { file: 'sketchfab/laser_turret.glb', tinted: 'palette' },
  missile_turret: { file: 'sketchfab/missile_turret.glb', tinted: 'palette' },
  plasma_turret: { file: 'sketchfab/plasma_turret.glb', tinted: 'palette' },
  sr_plasma_turret: { file: 'sketchfab/plasma_turret.glb', tinted: 'palette' },
  anti_air_turret: { file: 'sketchfab/anti_air_turret.glb', tinted: 'palette' },
};

/**
 * 单位映射：键是服务端 `unit.type`。
 *
 * 不在表里的类型继续用程序化模型：
 * - `logistics_bot` / `transport_robot`：场景按名字找 `logistics-bot-cargo` /
 *   `transport-robot-cargo` 节点做载货显隐与逐单位上色，还依赖转子动画；
 * - `ship` 之外的星图标记沿用同一份 GLB。
 */
export const UNIT_GLTF: Record<string, GltfModelSpec> = {
  // —— Sketchfab CC-BY（第 23 轮 3A models 分支）——
  // 尺寸系数按 plan2 §8 口径：executor 1.1 格、mecha 1.0、车辆 .8、步兵/工兵 .55、无人机 .5。
  // 每个模型的「正面」由 `GltfModelSpec.yaw` 统一到 +Z（画廊与转台核对，见 tmp/3a-models/report2.md）。
  executor: { file: 'sketchfab/executor.glb', scale: 1.1, tinted: 'palette' },
  mecha: { file: 'sketchfab/mecha.glb', scale: 1.0, yaw: Math.PI / 2, tinted: 'palette' },
  soldier: { file: 'sketchfab/soldier.glb', scale: 0.55, attach: 'rifle', tinted: 'palette' },
  worker: { file: 'sketchfab/worker.glb', scale: 0.55, tinted: 'palette' },
  scout: { file: 'sketchfab/scout.glb', scale: 0.8, tinted: 'palette' },
  attack_drone: { file: 'sketchfab/attack_drone.glb', scale: 0.5, tinted: 'palette' },
  artillery: { file: 'sketchfab/artillery.glb', scale: 0.8, tinted: 'palette' },
  missile_vehicle: { file: 'sketchfab/missile_vehicle.glb', scale: 0.8, yaw: Math.PI / 2, tinted: 'palette' },
  repair_vehicle: { file: 'sketchfab/repair_vehicle.glb', scale: 0.8, yaw: Math.PI, tinted: 'palette' },
  supply_truck: { file: 'sketchfab/supply_truck.glb', scale: 0.8, yaw: Math.PI, tinted: 'palette' },
  dark_fog: { file: 'sketchfab/dark_fog.glb', scale: 0.8, tinted: 'palette' },
  // 物流无人机/运输船在场景里统一按 `'ship'` 渲染（planet-three-scene 的 runtime.logistics_drones /
  // logistics_ships 共用一个类型），星图上的舰队标记用 `'cargo_ship'`。
  ship: { file: 'sketchfab/ship.glb', scale: 0.8, tinted: 'palette' },
  cargo_ship: { file: 'sketchfab/cargo_ship.glb', scale: 0.8, tinted: 'palette' },
};

const ROOT = '/assets/models/';
// Sketchfab 那批 GLB 用 EXT_meshopt_compression 压缩（25 MB → 21 MB），GLTFLoader 必须配解码器。
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** 阵营涂装：与 `IndustrialModels` 的 UNIT_FINISH 同义（己方白蓝、敌方橙、黑雾紫/暗红）。 */
type TintKey = UnitFaction | 'own-building' | 'enemy-building';
/**
 * 底色系数。Kenney City Kit 的墙体是中性灰（colormap 里约 #8e95b3 / #667a99），
 * 直接搬进场景会比现有「白陶瓷」暗一档，所以己方建筑把底色提亮到 >1（线性空间允许），
 * 只留深灰窗与结构线，深灰占比才压得住。
 *
 * 光乘系数不够：屋顶在 colormap 里是最深的一档灰，乘 1.5 仍偏暗，俯视时整栋读成「未通电」。
 * 所以己方建筑再叠一个亮度下限（`MIN_BRIGHTNESS`），把深灰抬到中灰偏白，同时保留明暗层次。
 */
const TINT: Record<TintKey, { body: [number, number, number]; accent: number }> = {
  'own-building': { body: [1.5, 1.5, 1.52], accent: 0x2fc4e8 },
  'enemy-building': { body: [1.3, 1.02, 0.9], accent: 0xff720d },
  own: { body: [1.18, 1.18, 1.2], accent: 0x2fc4e8 },
  enemy: { body: [1.14, 0.86, 0.78], accent: 0xff720d },
  fog_neutral: { body: [0.72, 0.66, 0.88], accent: 0x7d5cff },
  fog_hostile: { body: [0.72, 0.4, 0.4], accent: 0xff2a2a },
};
const FACTION_KEYS: TintKey[] = ['own', 'enemy', 'fog_neutral', 'fog_hostile'];
/** 己方建筑暗部抬升：材质带 colormap 时 `color` 是白的，暗度全来自贴图，
 * 光乘系数压不住深灰屋顶（俯视时主视觉面就是屋顶）。这里给己方建筑加一层很弱的
 * 常量自发光，把最暗的一档抬到中灰，白墙不变——只是把「黑块」变成「深灰块」。 */
const OWN_LIFT = 0x565e68;

interface Prepared {
  /** 已居中、底部贴 Y=0、按阵营上色的模板。 */
  group: THREE.Group;
  size: THREE.Vector3;
}

const templates = new Map<string, Map<TintKey, Prepared>>();
/** 阵营识别件：建筑正面的窄发光条（不是地面圆环——地面环会被读成选中框）。 */
const accentGeometry = new THREE.BoxGeometry(1, 1, 1);
/** 士兵步枪：全场共用一个几何/材质（合批后只多 1 个绘制调用）。 */
const rifleGeometry = new THREE.BoxGeometry(1, 1, 1);
let rifleShared: THREE.MeshStandardMaterial | undefined;
function rifleMaterial() {
  rifleShared ??= new THREE.MeshStandardMaterial({ color: 0x26363e, roughness: 0.5, metalness: 0.6 });
  return rifleShared;
}
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
 * 士兵的步枪：按**模板局部坐标**拼三个方块（枪身 / 枪管 / 弹匣），由 `instantiateUnit` 挂到
 * 已缩放的实例上——这样尺寸跟着模板包围盒走，不会撑大归一化包围盒，也不用再加载一个 GLB。
 */
function rifleMesh(size: THREE.Vector3): THREE.Group {
  const rifle = new THREE.Group();
  const material = rifleMaterial();
  const stock = new THREE.Mesh(rifleGeometry, material);
  stock.scale.set(size.y * 0.1, size.y * 0.1, size.y * 0.42);
  const barrel = new THREE.Mesh(rifleGeometry, material);
  barrel.scale.set(size.y * 0.045, size.y * 0.045, size.y * 0.3);
  barrel.position.set(0, size.y * 0.02, size.y * 0.34);
  const magazine = new THREE.Mesh(rifleGeometry, material);
  magazine.scale.set(size.y * 0.06, size.y * 0.16, size.y * 0.08);
  magazine.position.set(0, -size.y * 0.11, size.y * 0.02);
  rifle.add(stock, barrel, magazine);
  // 端在身前：宇航员模型正面朝 +Z，枪管朝前上方伸出轮廓外，等距视角下才读得出来。
  rifle.position.set(size.x * 0.12, size.y * 0.42, size.z * 0.42);
  rifle.rotation.set(-0.12, 0.2, -0.18);
  for (const mesh of rifle.children) { mesh.castShadow = true; mesh.receiveShadow = true; }
  return rifle;
}

/**
 * 模板准备：转成标准材质（Kenney Space Kit 是 unlit，进场景没有明暗会像贴纸）、
 * 按阵营乘底色、居中落地。只在加载时做一次。
 *
 * 同一个源材质在一份模板里只克隆一次：`batchStatic` 按材质归并，
 * 每个网格各克隆一份材质的话合并会失效，绘制调用会翻好几倍。
 */
/**
 * 模板准备：转成标准材质（Kenney Space Kit 是 unlit，进场景没有明暗会像贴纸）、
 * 按阵营乘底色、居中落地。只在加载时做一次。
 *
 * 同一个源材质在一份模板里只克隆一次：`batchStatic` 按材质归并，
 * 每个网格各克隆一份材质的话合并会失效，绘制调用会翻好几倍。
 */
/**
 * Sketchfab 素材的阵营涂装色（sRGB）：底色直接取 `palette.FACTION.<阵营>.ceramic`，
 * 发光件取 `palette.GLOW`。贴图在规整阶段已去饱和到 35%、均值拉到中灰，所以这里
 * 是「乘主色」而不是 Kenney 的「光乘系数」。
 */
const PALETTE_TINT: Record<TintKey, { armor: string; glow: string }> = {
  'own-building': { armor: FACTION.own.ceramic, glow: GLOW.own },
  'enemy-building': { armor: FACTION.enemy.ceramic, glow: GLOW.enemy },
  own: { armor: FACTION.own.ceramic, glow: GLOW.own },
  enemy: { armor: FACTION.enemy.ceramic, glow: GLOW.enemy },
  fog_neutral: { armor: FACTION.fog.ceramic, glow: GLOW.fog },
  // 黑雾敌对单位用暗红装甲（与 UNIT_PAINT.fog_hostile 同口径）。
  fog_hostile: { armor: '#6e2228', glow: '#ff4444' },
};

/** 发光件判定阈值：emissive 贴图 8×8 采样平均亮度 > 8 才算真发光件。
 * 很多作者把整张 albedo 塞进 emissive 槽（整张全黑或整张全亮），只按 `emissiveFactor > 0`
 * 判会把整机染成发光色（画廊里 accumulator / gauss_turret / missile_turret 踩过）。 */
const EMISSIVE_MEAN_THRESHOLD = 20;

/** 4×4 采样 emissive 贴图的平均亮度（0–255）。跨域/未解码的贴图返回 0。 */
function emissiveMean(map: THREE.Texture): number {
  const image = map.image as (HTMLImageElement | ImageBitmap | undefined);
  if (!image || typeof document === 'undefined') return 0;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(image as CanvasImageSource, 0, 0, 8, 8);
    const { data } = context.getImageData(0, 0, 8, 8);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4);
  } catch {
    return 0;
  }
}

/**
 * `palette` 涂装（Sketchfab 素材）：底色**直接乘阵营主色**（贴图已去饱和到 35%、
 * 均值拉到中灰），发光件换成阵营发光色。
 *
 * 发光件判定见 `EMISSIVE_MEAN_THRESHOLD`：只有「有 emissive 贴图且确实亮」的材质才换发光色，
 * 其余一律上装甲色——否则作者把 albedo 塞进 emissive 槽的模型会整机染色。
 */
function preparePalette(scene: THREE.Object3D, faction: TintKey): Prepared {
  const root = scene.clone(true);
  const host = new THREE.Box3().setFromObject(root);
  const size = host.getSize(new THREE.Vector3());
  const center = host.getCenter(new THREE.Vector3());
  const { armor, glow } = PALETTE_TINT[faction];
  const armorColor = new THREE.Color(armor);
  const glowColor = new THREE.Color(glow);
  const materials = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = object.material as THREE.Material;
    let material = materials.get(source);
    if (!material) {
      material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        // 底色一律是阵营装甲色：发光件只额外点亮自发光。整机换成发光色的话，
        // 贴图把发光面铺满全身的模型（dark_fog 的躯体、accumulator 的罐体）会整台变色。
        material.color.copy(armorColor);
        const emissiveMap = (source as THREE.MeshStandardMaterial).emissiveMap;
        const glowing = Boolean(emissiveMap) && emissiveMean(emissiveMap as THREE.Texture) > EMISSIVE_MEAN_THRESHOLD;
        if (glowing) {
          material.emissive.copy(glowColor);
          material.emissiveIntensity = 2.2;
        } else {
          material.emissive.setRGB(0, 0, 0);
          material.emissiveIntensity = 0;
        }
        // 规整阶段已把 roughness 压到 0.45–0.75、metalness ≤ 0.35；这里只保证不出现全金属黑块。
        material.metalness = Math.min(material.metalness, 0.35);
        material.roughness = Math.max(0.45, Math.min(material.roughness, 0.75));
      }
      if (material instanceof THREE.MeshStandardMaterial) {
        for (const map of [material.map, material.emissiveMap]) {
          if (map) map.colorSpace = THREE.SRGBColorSpace;
        }
      }
      materials.set(source, material);
    }
    object.material = material;
    // 合并静态网格要求所有几何的属性集合一致：统一成 position/normal/uv（且都是 Float32）。
    const geometry = object.geometry as THREE.BufferGeometry;
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    }
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = geometry.getAttribute(name);
      if (!attribute) continue;
      if (!(attribute.array instanceof Float32Array) || (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        geometry.setAttribute(name, floatify(attribute as THREE.BufferAttribute));
      }
    }
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
  });
  root.position.set(-center.x, -host.min.y, -center.z);
  const wrapper = new THREE.Group();
  wrapper.add(root);
  return { group: wrapper, size };
}

/** 把顶点属性统一成 Float32 非交错数组。
 * meshopt 压缩的 GLB 里 UV 常是 Uint16 归一化、位置也可能是量化整数；`StaticBatches` 按
 * position/normal/uv 合并几何时要求各实例的属性数组类型一致，否则 mergeGeometries 直接失败
 * （worker / cargo_ship 就是这样，合批退化成逐网格绘制）。 */
function floatify(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const itemSize = attribute.itemSize;
  const array = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let k = 0; k < itemSize; k++) array[i * itemSize + k] = attribute.getComponent(i, k);
  }
  // `normalized` 也必须一致：否则 mergeGeometries 仍会拒绝（worker 的 uv 是归一化 Uint16）。
  return new THREE.BufferAttribute(array, itemSize, false);
}

function prepare(scene: THREE.Object3D, tint: readonly [number, number, number], raiseDark: boolean): Prepared {
  const root = scene.clone(true);
  // 先量主体：附挂件不参与归一化，否则一把枪会把整个人缩小。
  const host = new THREE.Box3().setFromObject(root);
  const size = host.getSize(new THREE.Vector3());
  const center = host.getCenter(new THREE.Vector3());
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
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.multiply(new THREE.Color(...tint));
        if (raiseDark) {
          material.emissive.setHex(OWN_LIFT);
          material.emissiveIntensity = 1;
        }
      }
      materials.set(source, material);
    }
    object.material = material;
    // 合并静态网格要求所有几何的属性集合一致：统一成 position/normal/uv（且都是 Float32）。
    const geometry = object.geometry as THREE.BufferGeometry;
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    }
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = geometry.getAttribute(name);
      if (!attribute) continue;
      if (!(attribute.array instanceof Float32Array) || (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        geometry.setAttribute(name, floatify(attribute as THREE.BufferAttribute));
      }
    }
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
  });
  root.position.set(-center.x, -host.min.y, -center.z);
  const wrapper = new THREE.Group();
  wrapper.add(root);
  return { group: wrapper, size };
}

/** 模板键：主体文件 + 附挂件（同主体不同附挂件要分开缓存，否则士兵会拿到工兵的模板）。 */
function templateKey(spec: GltfModelSpec) {
  return spec.attach ? `${spec.file}+${spec.attach}` : spec.file;
}

async function prepareSpec(spec: GltfModelSpec, building: boolean) {
  const key = templateKey(spec);
  if (templates.has(key)) return;
  const scene = (await loader.loadAsync(ROOT + spec.file)).scene;
  const variants = new Map<TintKey, Prepared>();
  for (const faction of FACTION_KEYS) {
    // Sketchfab 素材：贴图已预处理，直接按调色板乘阵营主色。
    if (spec.tinted === 'palette') { variants.set(faction, preparePalette(scene, faction)); continue; }
    // 只有己方**建筑**提亮暗部（屋顶在俯视时是主视觉面）；敌方/黑雾与单位保持原本的明暗对比。
    variants.set(faction, prepare(scene, TINT[faction].body, building && faction === 'own'));
  }
  templates.set(key, variants);
}

/** 加载建筑/单位用到的全部 GLB；重复调用返回同一个 promise。
 *
 * `?procedural-models` 跳过加载，用来做「程序化模型 / 现成模型」同机位对照
 * （固定机位脚本 `scripts/playtest-shots/models.mjs` 靠它拍修前图，不用切分支）。 */
export function preloadIndustrialGltf(): Promise<void> {
  if (!loading && new URLSearchParams(window.location.search).has('procedural-models')) loading = Promise.resolve();
  if (!loading) {
    const specs = new Map<string, { spec: GltfModelSpec; building: boolean }>();
    for (const spec of Object.values(BUILDING_GLTF)) specs.set(templateKey(spec), { spec, building: true });
    for (const spec of Object.values(UNIT_GLTF)) specs.set(templateKey(spec), { spec, building: false });
    loading = Promise.all([...specs.values()].map(({ spec, building }) => prepareSpec(spec, building))).then(() => undefined);
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
  const prepared = spec && templates.get(templateKey(spec))?.get(own ? 'own' : 'enemy');
  if (!spec || !prepared) return null;
  const group = fit(prepared, spec, width * 0.86, depth * 0.86);
  group.name = `gltf-${type}`;
  // 阵营识别：正面的窄发光条（不是地面圆环——圆环会被读成选中框）。几何与材质全场共用，
  // 静态合批后每阵营只多 1 个绘制调用。
  // accent 挂在**已缩放**的组下，所以尺寸用模板自身的局部包围盒，不能用占地（占地已被 group.scale 吃掉）。
  const accent = new THREE.Mesh(accentGeometry, accentMaterial(TINT[own ? 'own-building' : 'enemy-building'].accent));
  accent.scale.set(prepared.size.x * 0.26, prepared.size.y * 0.05, prepared.size.z * 0.04);
  accent.position.set(0, prepared.size.y * 0.42, prepared.size.z * 0.51);
  accent.castShadow = false;
  accent.receiveShadow = false;
  group.add(accent);
  return group;
}

/** 同步实例化单位模型：涂装按阵营取材质变体，同样不写共享材质。 */
export function instantiateUnit(type: string, faction: UnitFaction): THREE.Group | null {
  const spec = UNIT_GLTF[type];
  const prepared = spec && templates.get(templateKey(spec))?.get(faction);
  if (!spec || !prepared) return null;
  const group = fitUnit(prepared, spec);
  group.name = `gltf-unit-${type}`;
  if (spec.attach === 'rifle') group.add(rifleMesh(prepared.size));
  return group;
}
