import * as THREE from 'three';

import type { TilePoint } from '../model';
import { directionVector, type CardinalDirection } from '../logistics-direction';
import { tileFrame, tileNormal } from './projection';

/**
 * 建造 ghost 的朝向箭头几何：一个**平铺在格平面**上的 chevron 四边形。
 *
 * 与 logistics-marks 的顶面箭头（合并成一个 mesh 的批量绘制）不同，ghost 只有
 * 1–2 支、每帧随悬停格重建，单独成 mesh 更直接；但朝向推导必须与顶面箭头同源：
 * 纹理里的 chevron 指向局部 +U（局部 +X），所以四边形必须躺在**格平面**里，
 * 再把局部 +X 转到 direction。
 *
 * 踩坑：`PlaneGeometry` 默认躺在局部 XY 平面（竖着的）。不转就贴到格上时，
 * 朝北/南的箭头会立起来侧对相机——从上方看整条消失（传送带朝北时 ghost 上
 * 根本没有箭头）。绕局部 X 转 -90° 让它平铺在局部 XZ 平面，再用「+X=东、
 * +Y=格法线、+Z=南」的基底贴到格上即可。
 */

export interface GhostArrowTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface GhostArrowOptions {
  /** 格在世界坐标里的边长（`surfaceTileSize`）。 */
  size: number;
  /** 抬离地面的高度（格宽比例）：分拣器 ghost 抬得更高，压在建筑顶面之上。 */
  lift?: number;
  /** 沿 direction 推离格心的距离（格宽比例）：分拣器两支各推 0.26 格，不叠成叉。 */
  along?: number;
}

/** 贴格平面的箭头四边形（局部 +X = 箭头指向、+Y = 格法线）。 */
export function ghostArrowGeometry(size: number, scale = 1) {
  const geometry = new THREE.PlaneGeometry(size * .82 * scale, size * .82 * scale);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * 箭头贴到 `(tile, direction)` 上的位置与姿态。
 *
 * 姿态用建筑模型同一套基底（局部 +X = 东、+Y = 格法线、+Z = 南）贴住格平面，
 * 再绕格法线把纹理里的 chevron（局部 +X）转到 direction——因此四个朝向的箭头
 * 都平铺在同一平面上，从上方俯视都是正对可见的，不存在侧对的朝向。
 */
export function ghostArrowTransform(
  tile: TilePoint,
  direction: CardinalDirection,
  faceSize: number,
  radius: number,
  { size, lift = 0, along = 0 }: GhostArrowOptions,
): GhostArrowTransform {
  const normal = tileNormal(tile, faceSize);
  const { east, south } = tileFrame(tile, faceSize);
  const vector = directionVector(direction);
  const position = normal.clone().multiplyScalar(radius + size * lift);
  if (along) position.addScaledVector(east, vector.x * along * size).addScaledVector(south, vector.y * along * size);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-vector.y, vector.x)));
  return { position, quaternion };
}
