import * as THREE from 'three';
import { AtmosphereShell, SkyDome } from './atmosphere';
import type { PlanetRenderQuality } from './render-quality';

/**
 * 空间背景（第 23 轮 3A 画质重写）：旧的星云球 + 星点 + additive 边缘光壳
 * 由 `atmosphere.ts` 的物理天空穹顶与散射壳取代。
 *
 * - `sky`：贴地天空 / 太空背景（按相机高度过渡，含太阳圆盘、眩光与星点），挂 scene；
 * - `shell`：全球视角的散射壳（半径 1.025R），挂 world（随星球旋转，太阳相对相机固定）。
 *
 * 保留 `createSpace` 这个入口名：场景只关心「拿到天空与大气壳」。
 */
export function createSpace(radius: number, sunDirection: THREE.Vector3, quality: PlanetRenderQuality) {
  const sky = new SkyDome(quality);
  sky.setSunDirection(sunDirection);
  const shell = new AtmosphereShell(radius, sunDirection);
  return { sky, shell };
}
