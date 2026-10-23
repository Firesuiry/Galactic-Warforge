/**
 * 矿脉露头（第 23 轮 3A 画质地表分支）。
 *
 * 从 `industrial-models.ts` 的 `resource()` 迁出并重做：按资源 kind 区分造型与材质——
 * 铁矿（锈红褐岩 + 金属闪点）、铜矿（青绿铜锈 + 橙铜）、煤（黑亮块）、石矿（浅色岩）、
 * 硅矿（半透明淡蓝晶簇）、钛矿（银蓝晶体）、原油（深色油池 + 虹彩）、水/硫酸（液池）、
 * 原木（树）、植物燃料（灌木）、其它稀有矿（按 `itemColor()` 取色的晶体变体）。
 *
 * 约束（与旧 `resource()` 相同）：
 * - 同 kind 共享几何与材质（模块级缓存，Instanced/StaticBatches 可合批），不逐实例克隆；
 * - 按位置确定性摆放（同一资源每次重建完全一致）；
 * - 只做表现：拾取仍打在数学球面上（场景按 `userData.tile` 拾取，这里不参与）；
 * - 液面虹彩/微光是时间的纯函数：`setOreDepositTime(0)`（冻结）即固定相位。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getItemColorValue } from '../item-colors';
import { preloadRockMeshes, type RockMeshAsset } from './terrain/rock-meshes';

const UP = new THREE.Vector3(0, 1, 0);

export type OreKind = 'rock' | 'crystal' | 'liquid' | 'tree' | 'bush';

export interface OreProfile {
  kind: OreKind;
  /** 岩石 / 树干 / 液池底色（hex）。 */
  base: string;
  /** 晶体 / 闪点 / 树冠色（hex）。 */
  accent: string;
  /** 粗糙度、金属度（岩石用）。 */
  roughness: number;
  metalness: number;
  /** 晶体是否半透明（硅/钛/稀有晶簇）。 */
  translucent?: boolean;
  /** 液面是否虹彩（原油）。 */
  iridescent?: boolean;
  /** 自发光强度（硫酸/晶体微光）。 */
  glow?: number;
}

/**
 * kind → 造型档案。键是服务端 `resource.kind`（目录物品 ID），
 * 正则兜底顺序从具体到宽泛，未知稀有矿走 `rare`。
 */
const PROFILES: Record<string, OreProfile> = {
  // 岩石类底色在扫描岩石的 albedo 上再乘一次：比纯色亮一档，避免在新光照下读成黑块。
  iron_ore: { kind: 'rock', base: '#7d5540', accent: '#c9a273', roughness: 0.82, metalness: 0.25 },
  copper_ore: { kind: 'rock', base: '#566f5f', accent: '#b98a55', roughness: 0.78, metalness: 0.30 },
  coal: { kind: 'rock', base: '#24272c', accent: '#4a5058', roughness: 0.55, metalness: 0.18 },
  stone_ore: { kind: 'rock', base: '#8f948a', accent: '#b6b8ab', roughness: 0.95, metalness: 0.04 },
  silicon_ore: { kind: 'crystal', base: '#41636d', accent: '#9fd8e0', roughness: 0.18, metalness: 0.12, translucent: true, glow: 0.35 },
  titanium_ore: { kind: 'rock', base: '#6a7486', accent: '#c3d2e4', roughness: 0.42, metalness: 0.55 },
  crude_oil: { kind: 'liquid', base: '#140b1c', accent: '#3a2a55', roughness: 0.07, metalness: 0.45, iridescent: true },
  water: { kind: 'liquid', base: '#2c6f86', accent: '#7fd0e0', roughness: 0.1, metalness: 0.05 },
  sulfuric_acid: { kind: 'liquid', base: '#7d8f22', accent: '#c9e04a', roughness: 0.12, metalness: 0.08, glow: 0.5 },
  log: { kind: 'tree', base: '#58402e', accent: '#3f5a32', roughness: 0.9, metalness: 0 },
  plant_fuel: { kind: 'bush', base: '#42502c', accent: '#6b7f3e', roughness: 0.92, metalness: 0 },
};

/** 稀有/未列出的晶体变体：颜色走客户端物品配色表。 */
function rareProfile(kind: string): OreProfile {
  const color = getItemColorValue(kind, '#c9a7ff');
  return { kind: 'crystal', base: '#3a3446', accent: color, roughness: 0.22, metalness: 0.3, translucent: true, glow: 0.45 };
}

export function oreProfile(kind: string): OreProfile {
  const exact = PROFILES[kind];
  if (exact) return exact;
  if (/oil/.test(kind)) return PROFILES.crude_oil;
  if (/water|acid|fluid|steam/.test(kind)) return kind.includes('acid') ? PROFILES.sulfuric_acid : PROFILES.water;
  if (/log|wood/.test(kind)) return PROFILES.log;
  if (/plant|bush|leaf|fiber/.test(kind)) return PROFILES.plant_fuel;
  if (/iron/.test(kind)) return PROFILES.iron_ore;
  if (/copper/.test(kind)) return PROFILES.copper_ore;
  if (/coal|graphite/.test(kind)) return PROFILES.coal;
  if (/stone|rock|ore/.test(kind)) return PROFILES.stone_ore;
  return rareProfile(kind);
}

/** 时间 uniform：液面虹彩与晶体微光共用一个（冻结时写 0）。 */
const oreTime = { value: 0 };

/** 冻结/恢复：场景每帧调用（与草摆同一个时间源）。 */
export function setOreDepositTime(seconds: number) {
  oreTime.value = seconds;
}

function hash(x: number, y: number, salt: number) {
  let value = Math.imul(x + 191, 374761393) ^ Math.imul(y + 733, 668265263) ^ Math.imul(salt + 59, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function color(hex: string) {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

/** 把一组已烘焙变换的几何合并成一份（同 kind 共享，减少绘制调用）。 */
function merge(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts.map(part => part.index ? part.toNonIndexed() : part), false);
  parts.forEach(part => part.dispose());
  return merged ?? new THREE.BufferGeometry();
}

function baked(geometry: THREE.BufferGeometry, position: [number, number, number], scale: [number, number, number], rotation: [number, number, number]) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** 扫描岩石（Poly Haven CC0，见 terrain/rock-meshes.ts）就绪后供矿点复用：
 *  同 kind 的矿座由 2–3 块真实岩石网格拼成，不再用多面体堆。异步加载，未就绪时回退。 */
let scannedRocks: RockMeshAsset[] = [];
let scannedPromise: Promise<RockMeshAsset[]> | null = null;

/** 场景构造时调用一次：岩石就绪后重建矿点（签名不变也要重建）。 */
export function preloadOreRocks(onReady?: () => void) {
  if (!scannedPromise) {
    scannedPromise = preloadRockMeshes().then((assets) => {
      scannedRocks = assets;
      if (assets.length) onReady?.();
      return assets;
    }).catch(() => []);
  }
  return scannedPromise;
}

/** 用扫描岩石网格拼一组岩块（归一化到高 1、底面 y=0，再按 variant 摆位/缩放）。 */
function scannedRockGeometry(variant: number, count: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < count; index++) {
    const asset = scannedRocks[(variant + index) % scannedRocks.length];
    // 扫描网格自带平滑法线（真实岩石的起伏）；保留 uv 以便同组合并，材质不贴图。
    const source = asset.geometry.index ? asset.geometry.toNonIndexed() : asset.geometry.clone();
    // 扫描网格归一化到「高 1、宽约 1–2.8」：主块取 0.30 高、副块 0.13–0.20 高，贴地摆放。
    const size = index === 0 ? 0.34 : 0.16 + hash(variant, index, 11) * 0.08;
    const angle = index * 2.399963 + hash(variant, index, 3) * 0.6;
    const spread = index === 0 ? 0 : 0.17 + hash(variant, index, 7) * 0.10;
    parts.push(baked(
      source,
      [Math.cos(angle) * spread, 0, Math.sin(angle) * spread],
      // 横向收窄、竖向拉高：扫描岩石原始比例很扁（宽 2.3 : 高 1），照搬会读成一块石板。
      [size * (0.55 + hash(variant, index, 17) * 0.20), size * (1.45 + hash(variant, index, 13) * 0.45), size * (0.55 + hash(variant, index, 23) * 0.20)],
      [0, hash(variant, index, 19) * Math.PI * 2, 0],
    ));
  }
  return merge(parts);
}

/** 金属闪点：主岩块表面撒一层微小八面体（同几何合并，仍是一次绘制）。 */
function sparkleGeometry(variant: number, count: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < count; index++) {
    const angle = hash(variant, index, 61) * Math.PI * 2;
    const radius = 0.06 + hash(variant, index, 67) * 0.22;
    const size = 0.012 + hash(variant, index, 71) * 0.016;
    parts.push(baked(
      new THREE.OctahedronGeometry(1, 0),
      [Math.cos(angle) * radius, 0.10 + hash(variant, index, 73) * 0.22, Math.sin(angle) * radius],
      [size, size, size],
      [hash(variant, index, 79) * 3, angle, hash(variant, index, 83) * 3],
    ));
  }
  return merge(parts);
}

/** 不规则岩块群：7 块压扁的二十面体，按 variant 确定性摆位（扫描岩石未就绪时的回退）。 */
function rockGeometry(variant: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 7; index++) {
    const angle = index * 2.399963 + hash(variant, index, 3) * 0.6;
    const spread = index === 0 ? 0 : 0.10 + hash(variant, index, 7) * 0.20;
    const size = index === 0 ? 0.30 : 0.09 + hash(variant, index, 11) * 0.13;
    parts.push(baked(
      new THREE.IcosahedronGeometry(1, 0),
      [Math.cos(angle) * spread, size * (index === 0 ? 0.34 : 0.24), Math.sin(angle) * spread],
      [size, size * (index === 0 ? 0.72 : 0.5 + hash(variant, index, 13) * 0.3), size * (0.75 + hash(variant, index, 17) * 0.4)],
      [hash(variant, index, 19) * 0.9, angle, hash(variant, index, 23) * 0.9],
    ));
  }
  return merge(parts);
}

/** 晶簇：5 根锥柱，根部略粗，向中心倾斜。 */
function crystalGeometry(variant: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 5; index++) {
    const angle = index * 2.399963 + hash(variant, index, 29) * 0.7;
    const spread = index === 0 ? 0 : 0.07 + hash(variant, index, 31) * 0.10;
    const height = index === 0 ? 0.40 : 0.16 + hash(variant, index, 37) * 0.16;
    const width = index === 0 ? 0.11 : 0.05 + hash(variant, index, 41) * 0.045;
    parts.push(baked(
      new THREE.CylinderGeometry(0, width, height, 5),
      [Math.cos(angle) * spread, height * 0.5 + 0.01, Math.sin(angle) * spread],
      [1, 1, 1],
      [Math.cos(angle) * 0.22, angle, Math.sin(angle) * 0.22],
    ));
  }
  return merge(parts);
}

/** 液池：不规则圆盘，边缘略起伏（矿点不会读成一口标准圆井）。 */
function poolGeometry(variant: number) {
  const geometry = new THREE.CircleGeometry(0.46, 22);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index);
    const radius = Math.hypot(x, y);
    if (radius < 0.01) continue;
    const wobble = 0.9 + hash(variant, index, 43) * 0.18;
    positions.setXY(index, x * wobble, y * wobble);
  }
  geometry.computeVertexNormals();
  // 平放到地面：CircleGeometry 在 XY 平面，绕 X 轴 -90°。
  return baked(geometry, [0, 0.006, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
}

function treeGeometry(variant: number) {
  const parts: THREE.BufferGeometry[] = [
    baked(new THREE.CylinderGeometry(0.045, 0.07, 0.42, 6), [0, 0.21, 0], [1, 1, 1], [0, hash(variant, 1, 47) * 0.3, 0]),
  ];
  for (let index = 0; index < 3; index++) {
    parts.push(baked(
      new THREE.ConeGeometry(0.20 - index * 0.045, 0.26, 7),
      [0, 0.42 + index * 0.13, 0], [1, 1, 1], [0, hash(variant, index, 53) * Math.PI, 0],
    ));
  }
  return merge(parts);
}

function bushGeometry(variant: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 4; index++) {
    const angle = index * 2.399963;
    const size = 0.13 + hash(variant, index, 59) * 0.08;
    parts.push(baked(
      new THREE.IcosahedronGeometry(1, 0),
      [Math.cos(angle) * 0.11, size * 0.62, Math.sin(angle) * 0.11],
      [size, size * 0.78, size],
      [0, angle, 0],
    ));
  }
  return merge(parts);
}

const depletedCache = new Map<string, THREE.MeshStandardMaterial>();
function depletedMaterial(kind: string, profile: OreProfile) {
  const cached = depletedCache.get(kind);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color: color(profile.base).multiplyScalar(0.42),
    roughness: 1, metalness: 0, flatShading: true,
  });
  material.name = `ore-${kind}-depleted`;
  depletedCache.set(kind, material);
  return material;
}

interface OreAssets {
  base: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  baseGeometry: THREE.BufferGeometry;
  accentGeometry: THREE.BufferGeometry;
}

const assetCache = new Map<string, OreAssets>();
const VARIANTS = 3;

function materialFor(profile: OreProfile, accent: boolean) {
  const hex = accent ? profile.accent : profile.base;
  const material = new THREE.MeshStandardMaterial({
    color: color(hex),
    roughness: accent && profile.kind === 'crystal' ? Math.min(profile.roughness, 0.2) : profile.roughness,
    metalness: accent && profile.kind === 'crystal' ? Math.max(profile.metalness, 0.3) : profile.metalness,
    // 岩石用扫描网格的平滑法线（真实起伏），不再 flatShading——否则网格细节被切成多边形块面。
    flatShading: profile.kind === 'bush',
    transparent: Boolean(profile.translucent),
    opacity: profile.translucent ? 0.82 : 1,
    emissive: profile.glow ? color(hex) : new THREE.Color(0x000000),
    emissiveIntensity: profile.glow ?? 0,
  });
  if (profile.kind === 'liquid') {
    // 液面：低粗糙 + 高光；原油虹彩与酸液微光都在着色器里按 oreTime 推进。
    material.roughness = profile.roughness;
    material.metalness = profile.metalness;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.swOreTime = oreTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 swOreWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nswOreWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float swOreTime;\nvarying vec3 swOreWorld;')
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          ${profile.iridescent ? `
          // 原油虹彩：薄膜干涉的近似（两层不同频率的色相带），缓慢漂移。
          float swOreSheen = sin(swOreWorld.x * 21.0 + swOreTime * 0.22) * 0.5 + 0.5;
          float swOreSheen2 = sin(swOreWorld.z * 33.0 - swOreTime * 0.17 + swOreSheen * 2.4) * 0.5 + 0.5;
          totalEmissiveRadiance += vec3(0.10, 0.16, 0.30) * swOreSheen * swOreSheen2;
          ` : `
          // 酸液微光：低频脉动（冻结时 swOreTime = 0，固定相位）。
          totalEmissiveRadiance *= 0.7 + 0.3 * sin(swOreWorld.x * 9.0 + swOreWorld.z * 7.0 + swOreTime * 0.9);
          `}
        `);
    };
    material.customProgramCacheKey = () => `ore-liquid-${profile.iridescent ? 'oil' : 'acid'}-v1`;
  }
  if (accent && profile.kind === 'rock' && profile.metalness >= 0.2) {
    // 金属闪点：小块八面体，给一点自发光当作「金属反光」，暗面也能读到。
    material.emissive = color(hex);
    material.emissiveIntensity = 0.22;
  }
  if (!accent && profile.kind === 'rock' && scannedRocks.length) {
    // 岩石类矿座用扫描岩石的 albedo 做细节（逐像素石纹），阵营色由 material.color 乘上去；
    // 几何合并后 UV 来自不同网格，纹理只当噪声用，不需要对齐。
    // 合并后的 UV 是各网格的原 UV（0..1 一块石头），直接当纹理坐标会把整块石头缩进一个纹素区。
    // 岩石色本身由 material.color 决定，这里只取纹理的低频细节：放大 8 倍重复，避免糊成一块色。
    const detail = scannedRocks[0].material.map;
    if (detail) {
      const tiled = detail.clone();
      tiled.wrapS = tiled.wrapT = THREE.RepeatWrapping;
      tiled.repeat.set(6, 6);
      tiled.needsUpdate = true;
      // map 会乘 material.color：纹理均值 0.31（sRGB→线性后更低），直接乘会把矿点压成黑色。
      // 用「纹理 / 均值」的中性细节图（均值 1），矿点保持 profile 的颜色。
      material.map = neutralizedDetail(tiled);
      material.roughness = Math.max(0.7, profile.roughness);
    }
  }
  material.name = `ore-${accent ? 'accent' : 'base'}`;
  return material;
}

/** 纹理中性化：逐通道除以全图均值，得到均值 ≈ 1 的细节图（不改变材质底色）。 */
function neutralizedDetail(source: THREE.Texture) {
  const image = source.image as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 256, 256);
  const data = context.getImageData(0, 0, 256, 256);
  const sums = [0, 0, 0];
  for (let i = 0; i < data.data.length; i += 4) { sums[0] += data.data[i]; sums[1] += data.data[i + 1]; sums[2] += data.data[i + 2]; }
  const count = data.data.length / 4;
  const means = sums.map(sum => Math.max(1, sum / count));
  for (let i = 0; i < data.data.length; i += 4) {
    // 均值归一到 sRGB 0.9（≈ 线性 0.79）：中性细节图不应把矿点的底色压暗。
    for (let channel = 0; channel < 3; channel++) data.data[i + channel] = Math.min(255, Math.round(data.data[i + channel] * 230 / means[channel]));
  }
  context.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.copy(source.repeat);
  texture.needsUpdate = true;
  return texture;
}

/** 取（并缓存）某 kind 的共享几何与材质；`variant` 决定岩块摆位。 */
export function oreAssets(kind: string, variant = 0): OreAssets {
  const profile = oreProfile(kind);
  const key = `${kind}:${variant % VARIANTS}`;
  const cached = assetCache.get(key);
  if (cached) return cached;
  let baseGeometry: THREE.BufferGeometry;
  let accentGeometry: THREE.BufferGeometry;
  switch (profile.kind) {
    case 'crystal':
      baseGeometry = rockGeometry(variant);
      accentGeometry = crystalGeometry(variant);
      break;
    case 'liquid':
      baseGeometry = rockGeometry(variant + 1);
      accentGeometry = poolGeometry(variant);
      break;
    case 'tree':
      baseGeometry = treeGeometry(variant);
      accentGeometry = treeGeometry(variant);
      break;
    case 'bush':
      baseGeometry = bushGeometry(variant);
      accentGeometry = bushGeometry(variant);
      break;
    default:
      // 岩石类（铁/铜/煤/石/钛）：扫描岩石网格做矿座，金属类再撒一层闪点。
      if (scannedRocks.length) {
        baseGeometry = scannedRockGeometry(variant, 3);
        // 金属矿（铁/铜/钛）：矿座 + 表面闪点；非金属（石/煤）：矿座 + 一小块伴生岩。
        accentGeometry = profile.metalness >= 0.2
          ? sparkleGeometry(variant, 30)
          : scannedRockGeometry(variant + 2, 1);
      } else {
        baseGeometry = rockGeometry(variant);
        accentGeometry = rockGeometry(variant + 2);
      }
      break;
  }
  const assets = { base: materialFor(profile, false), accent: materialFor(profile, true), baseGeometry, accentGeometry };
  assetCache.set(key, assets);
  return assets;
}

export interface OreDepositOptions {
  /** 按位置派生变体（同一矿点每次重建一致）。 */
  variant?: number;
  /** 建筑占地内：只保留贴地的矿层（压低露头，不遮带面/分拣臂）。 */
  covered?: boolean;
  /** 枯竭：去掉晶簇/液面，只留塌陷的暗色岩层。 */
  depleted?: boolean;
}

/**
 * 生成一个矿脉露头（局部单位 = 1 格，地面在 y = 0）。调用方负责贴球面与缩放；
 * 返回的 Group 名称保留 `industrial-resource-<kind>`（旧测试/调试按名字找）。
 */
export function createOreDeposit(kind: string, options: OreDepositOptions = {}): THREE.Group {
  const profile = oreProfile(kind);
  const variant = Math.abs(Math.round(options.variant ?? 0));
  const assets = oreAssets(kind, variant);
  const group = new THREE.Group();
  group.name = `industrial-resource-${kind}`;
  const base = new THREE.Mesh(assets.baseGeometry, assets.base);
  base.castShadow = true; base.receiveShadow = true;
  group.add(base);
  if (!options.depleted) {
    const accent = new THREE.Mesh(assets.accentGeometry, assets.accent);
    accent.castShadow = profile.kind !== 'liquid';
    accent.receiveShadow = true;
    if (profile.kind === 'liquid') {
      // 液池比岩座更贴近地面；略抬高避免与地表 z-fighting。
      accent.position.y = 0.012;
    } else if (profile.kind === 'crystal') {
      accent.position.y = 0.05;
    }
    group.add(accent);
  }
  if (options.depleted) {
    // 枯竭：整体压暗、压扁（塌陷的采空面）。用枯竭专用材质（同 kind 共享，
    // 不逐实例克隆材质——合批要求同类实例共享材质对象）。
    group.scale.set(1, 0.42, 1);
    const depleted = depletedMaterial(kind, profile);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = depleted;
    });
  }
  if (options.covered) {
    // 建筑占地内：露头压低成地表矿层，不遮挡带面与分拣臂；移除建筑即恢复。
    group.scale.y *= 0.1;
  }
  group.userData.oreKind = profile.kind;
  return group;
}

/** 释放模块级共享几何/材质（场景销毁时调用；正在使用的实例必须先移除）。 */
export function disposeOreDeposits() {
  for (const assets of assetCache.values()) {
    assets.baseGeometry.dispose();
    assets.accentGeometry.dispose();
    assets.base.dispose();
    assets.accent.dispose();
  }
  assetCache.clear();
  for (const material of depletedCache.values()) material.dispose();
  depletedCache.clear();
}

export { UP as ORE_UP };
