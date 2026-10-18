import * as THREE from 'three';

import type { TilePoint } from '../model';
import { directionVector, type CardinalDirection } from '../logistics-direction';
import { tileFrame, tileNormal } from './projection';

/**
 * 建造 ghost 的贴地细箭头：**几何直接画**（细杆 + 三角箭头），不再用纹理。
 *
 * 试玩 1017 反馈：旧版是一张 0.82 格的粗 chevron 纹理，近景里读成一块发光的色块，
 * 看不出流向。DSP 的放置预览是一条贴地的细箭头——杆很细、末端一个三角头。
 * 现在几何就是「细杆四边形 + 三角形箭头」，宽 ≤ 0.12 格，任何缩放下都不会糊成色块；
 * 纹理/取放文字徽章那套（旧 `ghost-arrow-texture`）整体删除。
 *
 * 几何全部躺在局部 XZ 平面：+X = 箭头指向、+Y = 格法线、+Z = 横向。
 * 贴到格上时用 `ghostArrowTransform`（基底 +X=东、+Y=格法线、+Z=南，再绕 Y 转朝向）。
 */

export interface GhostArrowTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface GhostArrowOptions {
  /** 格在世界坐标里的边长（`surfaceTileSize`）。 */
  size: number;
  /** 抬离地面的高度（格宽比例）：贴着地表画，避免 z-fighting。 */
  lift?: number;
}

/** 传送带 ghost 箭头（格宽倍数，相对未缩放的整格）：细杆 + 三角头。 */
export const GHOST_ARROW_SHAPE = {
  /** 箭头总长（格）。 */
  length: .82,
  /** 杆宽（格）：必须 ≤ .12——细箭头。 */
  shaftWidth: .06,
  /** 三角头长度（格）。 */
  headLength: .2,
  /** 三角头半宽（格）：箭头头总宽 .16 格。 */
  headHalfWidth: .09,
} as const;

/**
 * 分拣器贴地箭头（格宽倍数）：**贯穿前后各半格**，从取货端（-0.5）指到放货端（+0.5）。
 * 杆宽 .06 格，远细于旧版 0.62 格粗 chevron，近景里读成「一条线 + 一个箭头头」。
 */
export const SORTER_GHOST_ARROW_SHAPE = {
  /** 尾端沿朝向的位置（格，负 = 背面/取货侧）。 */
  tail: -.5,
  /** 尖端沿朝向的位置（格，正 = 正面/放货侧）。 */
  tip: .5,
  shaftWidth: .06,
  headLength: .16,
  headHalfWidth: .09,
} as const;

/** 三角箭头 + 细杆的贴地几何；尺寸以 `size`（格宽）为单位。 */
function arrowGeometry(
  size: number,
  shape: { shaftWidth: number; headLength: number; headHalfWidth: number },
  tail: number,
  tip: number,
): THREE.BufferGeometry {
  const shaftHalf = (shape.shaftWidth * size) / 2;
  const headHalf = shape.headHalfWidth * size;
  const headStart = tip - shape.headLength * size;
  const x0 = tail;
  const x1 = headStart;
  // 杆（两个三角）+ 箭头头（一个三角），全部在 y=0 的局部平面上。
  const positions = [
    x0, 0, -shaftHalf, x1, 0, -shaftHalf, x1, 0, shaftHalf,
    x0, 0, -shaftHalf, x1, 0, shaftHalf, x0, 0, shaftHalf,
    x1, 0, -headHalf, tip, 0, 0, x1, 0, headHalf,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // 平铺几何只需要「面朝 +Y」的法线；材质是 MeshBasicMaterial，法线只供调试/包围盒使用。
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    Array.from({ length: positions.length / 3 }, () => [0, 1, 0]).flat(),
    3,
  ));
  return geometry;
}

/**
 * 传送带/朝向建筑的贴地细箭头（局部 XZ 平面，中心在格心）。
 *
 * `scale` 只缩**长度与箭头头长度**，杆宽/箭头头宽度保持 .06/.18 格——单纯等比缩到
 * .5 倍后箭头会细到亚像素，地表的绿/黄色细线反而看不见。
 */
export function ghostArrowGeometry(size: number, scale = 1): THREE.BufferGeometry {
  const length = GHOST_ARROW_SHAPE.length * size * scale;
  return arrowGeometry(
    size,
    {
      shaftWidth: GHOST_ARROW_SHAPE.shaftWidth,
      headLength: GHOST_ARROW_SHAPE.headLength * scale,
      headHalfWidth: GHOST_ARROW_SHAPE.headHalfWidth,
    },
    -length / 2,
    length / 2,
  );
}

/**
 * 分拣器贴地箭头：从背面取货端（-0.5 格）贯穿到正面放货端（+0.5 格）。
 * 位置永远在格心（不再像旧版分拣器那样把两支箭头 `along` 推到前后半格分开）。
 */
export function sorterGhostArrowGeometry(size: number): THREE.BufferGeometry {
  return arrowGeometry(
    size,
    {
      shaftWidth: SORTER_GHOST_ARROW_SHAPE.shaftWidth,
      headLength: SORTER_GHOST_ARROW_SHAPE.headLength,
      headHalfWidth: SORTER_GHOST_ARROW_SHAPE.headHalfWidth,
    },
    SORTER_GHOST_ARROW_SHAPE.tail * size,
    SORTER_GHOST_ARROW_SHAPE.tip * size,
  );
}

/**
 * 箭头贴到 `(tile, direction)` 上的位置与姿态。
 *
 * 姿态用建筑模型同一套基底（局部 +X = 东、+Y = 格法线、+Z = 南）贴住格平面，
 * 再绕格法线把局部 +X 转到 direction——四个朝向的箭头都平铺在同一平面上，
 * 从上方俯视都是正对可见的，不存在侧对的朝向。
 */
export function ghostArrowTransform(
  tile: TilePoint,
  direction: CardinalDirection,
  faceSize: number,
  radius: number,
  { size, lift = 0 }: GhostArrowOptions,
): GhostArrowTransform {
  const normal = tileNormal(tile, faceSize);
  const { east, south } = tileFrame(tile, faceSize);
  const vector = directionVector(direction);
  const position = normal.clone().multiplyScalar(radius + size * lift);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-vector.y, vector.x)));
  return { position, quaternion };
}
