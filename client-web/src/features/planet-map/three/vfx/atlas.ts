/**
 * 粒子图集：序列帧（`public/assets/vfx/particles.png`，4×4 帧，每帧 128px）。
 *
 * - 行 0：烟团（帧 0–3，外扩变淡）
 * - 行 1：火球（帧 4–7，白热 → 橙 → 暗红）
 * - 行 2：火花（帧 8–11，细长条）
 * - 行 3：闪光（帧 12–15，径向光晕）
 *
 * 图集由 `scripts/gen-vfx-atlas.mjs` 离线生成并入库（程序生成，无第三方素材）。
 * 纹理只在这里加载一次、全场共享；加载失败时粒子退化为无贴图的柔和点（不影响逻辑）。
 */

import * as THREE from 'three';

export type AtlasKind = 'smoke' | 'fire' | 'spark' | 'glow';

/** 每种贴图的帧区间（含首帧、共 4 帧）。 */
export const ATLAS_FRAMES: Record<AtlasKind, { start: number; count: number }> = {
  smoke: { start: 0, count: 4 },
  fire: { start: 4, count: 4 },
  spark: { start: 8, count: 4 },
  glow: { start: 12, count: 4 },
};

export const ATLAS_URL = '/assets/vfx/particles.png';

/** 图集网格（4×4）。生成脚本与本常量必须一致。 */
export const ATLAS_GRID = 4;

let texture: THREE.Texture | null = null;
let pending = false;
const listeners = new Set<(texture: THREE.Texture) => void>();

/** 同步取已加载的图集（未加载完为 null）。 */
export function atlasTexture(): THREE.Texture | null {
  return texture;
}

/** 订阅图集就绪（已就绪立即回调）。返回退订函数。 */
export function onAtlasReady(listener: (texture: THREE.Texture) => void): () => void {
  if (texture) {
    listener(texture);
    return () => {};
  }
  listeners.add(listener);
  ensureAtlas();
  return () => { listeners.delete(listener); };
}

/** 预加载图集（场景构造时调一次；重复调用无副作用）。 */
export function ensureAtlas(): void {
  if (texture || pending || typeof document === 'undefined') return;
  pending = true;
  const loader = new THREE.TextureLoader();
  loader.load(
    ATLAS_URL,
    (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      // 图集按「行优先、左上原点」拼 UV（与 gl_PointCoord 同向）：关掉 three 默认的
      // 垂直翻转，v=0 才是图片第一行，帧索引 row 才能直接当行号用。
      loaded.flipY = false;
      loaded.magFilter = THREE.LinearFilter;
      loaded.minFilter = THREE.LinearMipmapLinearFilter;
      loaded.generateMipmaps = true;
      loaded.needsUpdate = true;
      texture = loaded;
      pending = false;
      for (const listener of listeners) listener(loaded);
      listeners.clear();
    },
    undefined,
    () => {
      // 资源缺失（离线夹具/裁剪构建）：粒子继续用无贴图模式，不报错。
      pending = false;
      listeners.clear();
    },
  );
}

/** 释放（场景 destroy；再次构造会重新加载）。 */
export function disposeAtlas(): void {
  texture?.dispose();
  texture = null;
  pending = false;
  listeners.clear();
}
