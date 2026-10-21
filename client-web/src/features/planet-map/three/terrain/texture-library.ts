/**
 * 地表纹理库（第 23 轮 3A 画质地表分支）。
 *
 * 素材：`client-web/public/assets/textures/terrain/`（ambientCG CC0，1K → 1024² webp），
 * 见该目录 `THIRD_PARTY.md`。每层两张图：
 * - `*_albedo.webp`（sRGB，RGBA8 以便 WebGL2 按 sRGB 上传）；
 * - `*_packed.webp`：R = 法线 x，G = 法线 y（OpenGL 约定），B = 粗糙度，A = 高度。
 *
 * 加载后画进一张 `DataArrayTexture`（一层一张 1024² 图），着色器里用 `texture(sampler2DArray, …)`
 * 按群落层号取样——比 N 个 sampler2D 省采样器槽位，也便于在同一材质里混 5–8 层。
 * 纹理未就绪时（首帧、离线夹具）着色器按层号用程序化近似色，不会出现白/黑地形。
 */
import * as THREE from 'three';

export const TERRAIN_LAYER_NAMES = [
  'moss_grass', 'grass', 'volcanic_soil', 'gravel', 'mud', 'sand_mud',
  'basalt', 'lichen_rock', 'snow', 'ice', 'lava',
] as const;
export type TerrainLayerName = typeof TERRAIN_LAYER_NAMES[number];
export const TERRAIN_LAYER = Object.fromEntries(TERRAIN_LAYER_NAMES.map((name, index) => [name, index])) as Record<TerrainLayerName, number>;

/** 程序化近似色：纹理未加载时用（与 albedo 的平均色一致，避免闪白）。 */
export const TERRAIN_LAYER_TINT: [number, number, number][] = [
  [0.30, 0.35, 0.17], // moss_grass
  [0.36, 0.44, 0.16], // grass
  [0.33, 0.29, 0.21], // volcanic_soil
  [0.35, 0.31, 0.27], // gravel
  [0.31, 0.27, 0.18], // mud
  [0.58, 0.51, 0.38], // sand_mud
  [0.14, 0.14, 0.15], // basalt
  [0.30, 0.32, 0.21], // lichen_rock
  [0.86, 0.89, 0.93], // snow
  [0.62, 0.76, 0.80], // ice
  [0.62, 0.22, 0.10], // lava
];

export interface TerrainTextures {
  /** 每层 RGBA：albedo.rgb（sRGB 编码）+ 占位 alpha。 */
  albedo: THREE.DataArrayTexture;
  /** 每层 RGBA：法线 xy、粗糙度、高度（线性）。 */
  packed: THREE.DataArrayTexture;
  /** 真实像素（原地更新：纹理对象与 GPU 上传分开，便于「占位 → 真实」只上传一次）。 */
  albedoPixels: Uint8Array;
  packedPixels: Uint8Array;
  /** 岩浆自发光（层号 = `TERRAIN_LAYER.lava` 的层；单独一张 2D 图）。 */
  lavaEmissive: THREE.Texture | null;
  ready: boolean;
  dispose(): void;
}

const SIZE = 1024;
const BASE = `${import.meta.env.BASE_URL ?? '/'}assets/textures/terrain`;

/** 线性 0..1 → sRGB 字节（占位层与真实 albedo 一样按 sRGB 编码存放）。 */
function srgbByte(value: number) {
  const linear = Math.min(1, Math.max(0, value));
  return Math.round((linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055) * 255);
}

/** 占位层写进整块数组的指定层（albedo 是 sRGB 字节，占位色按 sRGB 编码）。 */
function tintLayer(target: Uint8Array, layer: number, rgb: [number, number, number]) {
  const offset = layer * SIZE * SIZE * 4;
  const [r, g, b] = rgb.map(srgbByte);
  for (let i = offset; i < offset + SIZE * SIZE * 4; i += 4) {
    target[i] = r; target[i + 1] = g; target[i + 2] = b; target[i + 3] = 255;
  }
}

function placeholderPacked(rough: number, height: number) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128; data[i + 1] = 128; data[i + 2] = Math.round(rough * 255); data[i + 3] = Math.round(height * 255);
  }
  return data;
}

/** 程序化占位层：纹理加载完成前/失败时的安全底色（与真实 albedo 平均色同量级）。 */
export function createPlaceholderTerrainTextures(): TerrainTextures {
  const layers = TERRAIN_LAYER_NAMES.length;
  const albedoData = new Uint8Array(SIZE * SIZE * 4 * layers);
  const packedData = new Uint8Array(SIZE * SIZE * 4 * layers);
  const roughness = [0.92, 0.9, 0.88, 0.9, 0.9, 0.86, 0.8, 0.85, 0.72, 0.4, 0.62];
  TERRAIN_LAYER_NAMES.forEach((_, layer) => {
    tintLayer(albedoData, layer, TERRAIN_LAYER_TINT[layer]);
    packedData.set(placeholderPacked(roughness[layer], 0.5), layer * SIZE * SIZE * 4);
  });
  const albedo = new THREE.DataArrayTexture(albedoData, SIZE, SIZE, layers);
  albedo.format = THREE.RGBAFormat; albedo.type = THREE.UnsignedByteType;
  // 必须是 sRGB：纹理存储不可变（texStorage3D），首帧就以 SRGB8_ALPHA8 分配，
  // 之后原地换真实像素也继续走 sRGB 解码；先线性后改 sRGB 会得到「发灰发白」的地表。
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.minFilter = THREE.LinearMipmapLinearFilter; albedo.magFilter = THREE.LinearFilter;
  albedo.generateMipmaps = true; albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping; albedo.needsUpdate = true;
  const packed = new THREE.DataArrayTexture(packedData, SIZE, SIZE, layers);
  packed.format = THREE.RGBAFormat; packed.type = THREE.UnsignedByteType;
  packed.colorSpace = THREE.NoColorSpace;
  packed.minFilter = THREE.LinearMipmapLinearFilter; packed.magFilter = THREE.LinearFilter;
  packed.generateMipmaps = true; packed.wrapS = packed.wrapT = THREE.RepeatWrapping; packed.needsUpdate = true;
  return {
    albedo, packed, albedoPixels: albedoData, packedPixels: packedData, lavaEmissive: null, ready: false,
    dispose() { albedo.dispose(); packed.dispose(); },
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`纹理加载失败：${url}`));
    image.src = url;
  });
}

/** 把一张 webp 画进指定层。canvas 统一按「不转换色彩空间」读回原始字节：
 * albedo 的 sRGB 编码保留，由纹理的 SRGBColorSpace 交给 GPU 解码。 */
function drawLayer(image: HTMLImageElement, target: Uint8Array, layer: number) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingEnabled = true;
  context.drawImage(image, 0, 0, SIZE, SIZE);
  const pixels = context.getImageData(0, 0, SIZE, SIZE).data;
  target.set(pixels, layer * SIZE * SIZE * 4);
}

/**
 * 异步加载全部地表层。返回的纹理对象立即可用（先占位层），加载完成后原地换数据。
 * `onReady` 在真实纹理写入后调用一次（调用方据此触发材质刷新/重建 mipmap）。
 */
export async function loadTerrainTextures(onReady?: (textures: TerrainTextures) => void): Promise<TerrainTextures> {
  const textures = createPlaceholderTerrainTextures();
  const albedoData = textures.albedoPixels;
  const packedData = textures.packedPixels;
  const jobs: Promise<void>[] = [];
  TERRAIN_LAYER_NAMES.forEach((name, layer) => {
    jobs.push(loadImage(`${BASE}/${name}_albedo.webp`).then((image) => drawLayer(image, albedoData, layer)));
    jobs.push(loadImage(`${BASE}/${name}_packed.webp`).then((image) => drawLayer(image, packedData, layer)));
  });
  try {
    await Promise.all(jobs);
  } catch (error) {
    // 缺图时保留占位层：画面仍有正确群落色，只是没有细节。
    console.warn('[terrain] 地表纹理加载不完整，使用占位层', error);
    return textures;
  }
  // 真实 albedo 与占位层同为 sRGB 字节；纹理已按 SRGB8_ALPHA8 分配，直接原地更新像素。
  textures.albedo.needsUpdate = true;
  textures.packed.needsUpdate = true;
  // 共享的 DataArrayTexture 已拿到真实像素；所有已建材质重新编译以启用 sRGB 上传。
  textures.ready = true;
  try {
    const emissive = await loadImage(`${BASE}/lava_emissive.webp`);
    const texture = new THREE.Texture(emissive);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    textures.lavaEmissive = texture;
  } catch {
    textures.lavaEmissive = null;
  }
  onReady?.(textures);
  return textures;
}
