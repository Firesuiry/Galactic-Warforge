import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { directionVector, type CardinalDirection } from '../logistics-direction';
import { tileFrame, tileNormal, surfaceTileSize } from './projection';
import { GHOST_LABEL_SCALE, ghostArrowGeometry, ghostArrowTransform, ghostLabelOffset } from './ghost-arrow';

const DIRECTIONS: CardinalDirection[] = ['north', 'east', 'south', 'west'];
const FACE_SIZE = 16;
const RADIUS = 100;
const TILES = [{ x: 4, y: 4 }, { x: 0, y: 0 }, { x: 15, y: 7 }, { x: 31, y: 20 }];

/** 箭头几何在局部坐标里的「面法线」（PlaneGeometry 绕局部 X 转 -90° 后朝局部 +Y）。 */
const LOCAL_NORMAL = new THREE.Vector3(0, 1, 0);
/** 箭头几何在局部坐标里的「指向」（纹理 chevron 指向 +U = 局部 +X）。 */
const LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);

describe('建造 ghost 箭头几何', () => {
  it('几何本身就是平铺的四边形：面法线朝局部 +Y、chevron 的 +U 沿局部 +X', () => {
    const geometry = ghostArrowGeometry(1);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    expect(position.count).toBe(4);
    for (let i = 0; i < position.count; i += 1) {
      // 四个顶点共面于局部 XZ 平面（y 恒为 0），面法线朝局部 +Y。
      expect(position.getY(i)).toBeCloseTo(0, 9);
      expect(normal.getY(i)).toBeCloseTo(1, 9);
    }
    // u=1 的顶点在局部 +X 一侧：纹理里的 chevron 指向 +U，因此箭头指向局部 +X。
    let maxU = -1, maxX = -Infinity;
    for (let i = 0; i < position.count; i += 1) if (uv.getX(i) > maxU) { maxU = uv.getX(i); maxX = position.getX(i); }
    for (let i = 0; i < position.count; i += 1) expect(position.getX(i)).toBeLessThanOrEqual(maxX + 1e-9);
    expect(maxX).toBeGreaterThan(0);
  });

  it('四个朝向的箭头都平铺在格平面里（不立起来侧对相机）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    for (const tile of TILES) {
      const normal = tileNormal(tile, FACE_SIZE);
      for (const direction of DIRECTIONS) {
        const { quaternion } = ghostArrowTransform(tile, direction, FACE_SIZE, RADIUS, { size, lift: .1 });
        const world = LOCAL_NORMAL.clone().applyQuaternion(quaternion);
        // 箭头所在平面的法线 = 格法线：整支箭头躺在格平面内。
        expect(world.dot(normal)).toBeCloseTo(1, 6);
        // 反向验证：不转的 PlaneGeometry（局部 XY 平面，法线局部 +Z）贴上去后法线与格法线
        // 垂直（|dot|≈0），朝北/南时整条箭头侧对相机、从上方看消失。
        expect(Math.abs(new THREE.Vector3(0, 0, 1).dot(normal))).toBeLessThan(.99);
      }
    }
  });

  it('箭头指向 = 该方向的格内向量（东 +x / 南 +y）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    for (const tile of TILES) {
      const { east, south } = tileFrame(tile, FACE_SIZE);
      for (const direction of DIRECTIONS) {
        const { quaternion } = ghostArrowTransform(tile, direction, FACE_SIZE, RADIUS, { size });
        const forward = LOCAL_FORWARD.clone().applyQuaternion(quaternion);
        const vector = directionVector(direction);
        const expected = east.clone().multiplyScalar(vector.x).addScaledVector(south, vector.y).normalize();
        expect(forward.dot(expected)).toBeCloseTo(1, 6);
      }
    }
  });

  it('lift 抬离地面、along 沿朝向推离格心（分拣器前后半格）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    const tile = { x: 4, y: 4 };
    const normal = tileNormal(tile, FACE_SIZE);
    const { east, south } = tileFrame(tile, FACE_SIZE);
    const base = ghostArrowTransform(tile, 'north', FACE_SIZE, RADIUS, { size, lift: .1 }).position;
    expect(base.distanceTo(normal.clone().multiplyScalar(RADIUS + size * .1))).toBeCloseTo(0, 6);

    // 分拣器：取货端（背面）与放货端（正面）各推离格心 0.26 格，方向相反。
    const to = ghostArrowTransform(tile, 'north', FACE_SIZE, RADIUS, { size, lift: .18, along: .26 }).position;
    const from = ghostArrowTransform(tile, 'south', FACE_SIZE, RADIUS, { size, lift: .18, along: .26 }).position;
    const toOffset = to.clone().sub(normal.clone().multiplyScalar(RADIUS + size * .18));
    const fromOffset = from.clone().sub(normal.clone().multiplyScalar(RADIUS + size * .18));
    expect(toOffset.dot(south)).toBeCloseTo(-.26 * size, 4); // 北 = -south
    expect(fromOffset.dot(south)).toBeCloseTo(.26 * size, 4);
    expect(toOffset.length()).toBeCloseTo(.26 * size, 4);
    expect(toOffset.clone().add(fromOffset).length()).toBeLessThan(1e-6);
    expect(east.length()).toBeCloseTo(1, 9);
  });

  it('「取」/「放」标签摆在箭头尖端之外、且明显小于箭头（试玩 1017 K4-04）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    const arrowHalf = size * .82 * .62 * .5; // 分拣器箭头尖端离箭头中心的距离
    const offset = ghostLabelOffset(size, .62, .26);
    // 标签中心离格心的距离 = 箭头中心偏移 + 越过尖端；标签内缘仍要在尖端之外。
    expect(offset - .26 * size).toBeGreaterThan(arrowHalf);
    expect(offset - .26 * size - GHOST_LABEL_SCALE * size * .5).toBeGreaterThanOrEqual(arrowHalf);
    // 标签尺寸约为箭头边长的 1/3（旧版 0.3 格 ≈ 箭头大小，会把箭头整个盖住）。
    expect(GHOST_LABEL_SCALE).toBeLessThan(.82 * .62 * .5);
  });

  it('scale 只缩箭头尺寸，不改位置/姿态（分拣器两支缩到 0.62）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    const tile = { x: 4, y: 4 };
    const full = ghostArrowGeometry(size);
    const small = ghostArrowGeometry(size, .62);
    full.computeBoundingBox();
    small.computeBoundingBox();
    const span = (geometry: THREE.PlaneGeometry) => geometry.boundingBox!.max.clone().sub(geometry.boundingBox!.min);
    expect(span(small).x / span(full).x).toBeCloseTo(.62, 6);
    expect(span(small).y / span(full).y).toBeCloseTo(.62, 6);
    // 平铺后高度（局部 Y）应为 0：四边形躺在局部 XZ 平面。
    expect(span(small).y).toBeLessThan(1e-6);
    expect(span(small).z).toBeGreaterThan(0);

    // 姿态/位置不含 scale（transform API 里根本没有 scale 参数）：两支只缩几何的箭头
    // 落在同一处、同一姿态，靠 `along` 分开。
    const { position, quaternion } = ghostArrowTransform(tile, 'east', FACE_SIZE, RADIUS, { size });
    const mesh = (scale: number) => {
      const built = new THREE.Mesh(ghostArrowGeometry(size, scale));
      built.position.copy(position);
      built.quaternion.copy(quaternion);
      return built;
    };
    expect(mesh(.62).position.distanceTo(mesh(1).position)).toBeCloseTo(0, 9);
    expect(Math.abs(mesh(.62).quaternion.dot(mesh(1).quaternion))).toBeCloseTo(1, 9);
  });
});
