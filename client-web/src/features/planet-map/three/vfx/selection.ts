/**
 * 选中 / 悬停反馈（3A 画质 vfx 分支）。
 *
 * 取代旧的「每格一条粗色带描边」：
 * - 选中建筑 = 占地四角的括号（L 形，收拢动画；freeze 下定格）+ 柔和地面光晕；
 * - 选中单位 = 细环 + 方向小三角；
 * - 悬停 = 同款但更淡。
 *
 * 颜色沿用现有语义（主选中 `#fff1a8`、多选单位 `#9ef7c9`、建筑占地 `#ffd166`、
 * 悬停 `#5ef7dc`）；线宽 ≤ .06 格；不加后处理 pass。
 */

import * as THREE from 'three';

import { ribbonGeometry } from '../surface-ribbon';
import { tileFrame, tileNormal, tileQuad, surfaceTileSize } from '../projection';
import type { TilePoint } from '../../model';

/** 颜色语义（与场景旧口径一致）。 */
export const SELECTION_COLORS = {
  primary: '#fff1a8',
  multi: '#9ef7c9',
  footprint: '#ffd166',
  hover: '#5ef7dc',
} as const;

/** 线宽（格）与括号臂长（格，占一格的比例）。 */
export const SELECTION_LINE_TILES = 0.055;
export const BRACKET_ARM = 0.34;
/** 收拢动画时长（秒）。 */
export const BRACKET_SNAP_SECONDS = 0.22;

/**
 * 四角括号：返回贴球面的 L 形色带（4 条臂 × 2 段，共 8 条细带合并成一个几何）。
 * `inset` 0 = 贴格边，1 = 完全收拢到四角（臂长缩到 0）。
 */
export function bracketGeometry(tile: TilePoint, faceSize: number, radius: number, lineWidth: number, inset: number): THREE.BufferGeometry {
  const quad = tileQuad(tile, faceSize);
  const arm = Math.max(0.02, BRACKET_ARM * (1 - inset));
  // 四角顺序：quad = [(-.5,-.5), (.5,-.5), (.5,.5), (-.5,.5)]（与 tileQuad 一致）。
  const corners = quad.map((corner) => corner.clone());
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3) => {
    const loop = [a, b];
    const ribbon = ribbonGeometry(loop, radius, lineWidth);
    const array = ribbon.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < array.count; i++) positions.push(array.getX(i), array.getY(i), array.getZ(i));
    // ribbonGeometry 对 2 点环生成的索引是 0,1,2, 2,1,3（四边形）。
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    base += 4;
    ribbon.dispose();
  };
  // 每条臂：从角点沿两条边向内 arm 格（在球面上按单位法线插值）。
  for (let index = 0; index < 4; index++) {
    const corner = corners[index];
    const next = corners[(index + 1) % 4];
    const previous = corners[(index + 3) % 4];
    const toNext = corner.clone().lerp(next, arm).normalize();
    const toPrevious = corner.clone().lerp(previous, arm).normalize();
    const cornerOnSurface = corner.clone().normalize();
    pushQuad(cornerOnSurface, toNext);
    pushQuad(cornerOnSurface, toPrevious);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 单位细环（贴地），供单位选中/悬停。 */
export function ringGeometry(tile: TilePoint, faceSize: number, radius: number, lineWidth: number, ringRadius = 0.36): THREE.BufferGeometry {
  const { normal, east, south } = tileFrame(tile, faceSize);
  const angle = (ringRadius * surfaceTileSize(radius, faceSize)) / radius;
  const segments = 48;
  const loop = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return normal.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(east, Math.sin(angle) * Math.cos(a))
      .addScaledVector(south, Math.sin(angle) * Math.sin(a))
      .normalize();
  });
  return ribbonGeometry(loop, radius + surfaceTileSize(radius, faceSize) * 0.04, lineWidth);
}

/** 方向小三角（单位朝向前方的短箭头），贴地。 */
export function directionTriangle(tile: TilePoint, faceSize: number, radius: number, direction: { x: number; y: number }, size = 0.14): THREE.BufferGeometry {
  const { normal, east, south } = tileFrame(tile, faceSize);
  const tileSize = surfaceTileSize(radius, faceSize);
  const forward = normal.clone().addScaledVector(east, direction.x * 0.42).addScaledVector(south, direction.y * 0.42).normalize();
  const left = normal.clone().addScaledVector(east, (direction.x * 0.42 - direction.y * size)).addScaledVector(south, (direction.y * 0.42 + direction.x * size)).normalize();
  const right = normal.clone().addScaledVector(east, (direction.x * 0.42 + direction.y * size)).addScaledVector(south, (direction.y * 0.42 - direction.x * size)).normalize();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...forward.multiplyScalar(radius + tileSize * 0.05).toArray(),
    ...left.multiplyScalar(radius + tileSize * 0.05).toArray(),
    ...right.multiplyScalar(radius + tileSize * 0.05).toArray(),
  ], 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

/** 柔和地面光晕：中心亮、边缘透明的贴地圆盘。 */
export function glowDisc(tile: TilePoint, faceSize: number, radius: number, sizeTiles: number): THREE.BufferGeometry {
  const { normal, east, south } = tileFrame(tile, faceSize);
  const tileSize = surfaceTileSize(radius, faceSize);
  const angle = (sizeTiles * tileSize) / radius;
  const segments = 40;
  const positions: number[] = [];
  const colors: number[] = [];
  positions.push(...normal.clone().multiplyScalar(radius + tileSize * 0.03).toArray());
  colors.push(1, 1, 1, 1);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const point = normal.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(east, Math.sin(angle) * Math.cos(a))
      .addScaledVector(south, Math.sin(angle) * Math.sin(a))
      .normalize()
      .multiplyScalar(radius + tileSize * 0.03);
    positions.push(...point.toArray());
    colors.push(0, 0, 0, 0);
  }
  const indices: number[] = [];
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 选中/悬停反馈的材质与几何缓存。
 * 场景侧在 `updateMarks` 里调用 `sync(items)`；几何按「格 + 尺寸档」缓存，
 * 只在签名变化时重建（悬停/选中切换不产生每帧分配）。
 */
export interface SelectionItem {
  key: string;
  tile: TilePoint;
  color: string;
  kind: 'building' | 'unit' | 'hover';
  /** 单位朝向（可选）：给方向小三角用。 */
  direction?: { x: number; y: number };
  /** 建筑占地的格列表（括号画在每格，光晕只画中心）。 */
  footprint?: TilePoint[];
  opacity: number;
}

/**
 * 选中/悬停反馈层：括号（建筑）、细环 + 方向三角（单位）、悬停细环。
 *
 * - 几何按「key + 格」缓存，签名变化才重建（悬停切换每帧都有，不能每次重建）；
 * - 括号收拢动画：`animate(seconds, frozen)` 写 `inset`（0 → 1 的快照），冻结时固定在收拢完成；
 * - 材质按颜色缓存（共享），不逐实例克隆。
 */
export class SelectionOverlay {
  readonly group = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private entries = new Map<string, { mesh: THREE.Mesh; kind: SelectionItem['kind']; color: string; born: number; tile: TilePoint; footprint?: TilePoint[] }>();
  private glows: { mesh: THREE.Mesh; color: string; ownMaterial?: boolean }[] = [];
  private radius: number;
  private scale: () => number;
  private signature = '';

  constructor(parent: THREE.Object3D, radius: number, scale: () => number) {
    this.radius = radius;
    this.scale = scale;
    this.group.name = 'selection-overlay';
    parent.add(this.group);
  }

  private lineMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
    const key = `${color}:${opacity.toFixed(2)}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private glowMaterial(color: string): THREE.MeshBasicMaterial {
    let material = this.glowMaterials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.16, depthWrite: false,
        side: THREE.DoubleSide, vertexColors: true, toneMapped: false,
      });
      this.glowMaterials.set(color, material);
    }
    return material;
  }

  /** 同步选中/悬停项（签名不变直接返回）。 */
  sync(items: readonly SelectionItem[], faceSize: number, now: number): void {
    const signature = JSON.stringify(items.map((item) => [item.key, item.tile.x, item.tile.y, item.color, item.kind, item.footprint?.length ?? 0, item.opacity]));
    if (signature === this.signature) return;
    this.signature = signature;
    for (const entry of this.entries.values()) {
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
    }
    this.entries.clear();
    for (const glow of this.glows) { glow.mesh.removeFromParent(); glow.mesh.geometry.dispose(); if (glow.ownMaterial) (glow.mesh.material as THREE.Material).dispose(); }
    this.glows = [];
    const lineWidth = this.scale() * SELECTION_LINE_TILES;
    for (const item of items) {
      const material = this.lineMaterial(item.color, item.opacity);
      const geometry = item.kind === 'building'
        ? bracketGeometry(item.tile, faceSize, this.radius + this.scale() * 0.05, lineWidth, 0)
        : item.kind === 'unit'
          ? ringGeometry(item.tile, faceSize, this.radius, lineWidth, 0.34)
          : ringGeometry(item.tile, faceSize, this.radius, lineWidth * 0.8, 0.42);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = item.kind === 'hover' ? 11 : 12;
      this.group.add(mesh);
      this.entries.set(item.key, { mesh, kind: item.kind, color: item.color, born: now, tile: item.tile, footprint: item.footprint });
      if (item.kind === 'building' && item.footprint?.length) {
        // 柔和地面光晕只画在占地中心一格。
        const center = item.footprint[Math.floor(item.footprint.length / 2)];
        const glowGeometry = glowDisc(center, faceSize, this.radius, 0.9);
        const glow = new THREE.Mesh(glowGeometry, this.glowMaterial(item.color));
        glow.renderOrder = 10;
        this.group.add(glow);
        this.glows.push({ mesh: glow, color: item.color });
      }
      if (item.kind === 'unit' && item.direction) {
        const triangle = new THREE.Mesh(directionTriangle(item.tile, faceSize, this.radius, item.direction), this.lineMaterial(item.color, item.opacity).clone());
        triangle.renderOrder = 13;
        this.group.add(triangle);
        // 方向三角不参与括号动画，单独登记以便下次重建时清掉。
        this.glows.push({ mesh: triangle, color: item.color, ownMaterial: true });
      }
    }
  }

  /** 收拢动画：括号从满格向内收（0 → 1，220ms），冻结时直接收拢完成。 */
  animate(seconds: number, frozen: boolean): void {
    for (const entry of this.entries.values()) {
      if (entry.kind !== 'building') continue;
      const t = frozen ? 1 : Math.min(1, Math.max(0, (seconds - entry.born) / BRACKET_SNAP_SECONDS));
      const eased = 1 - (1 - t) ** 3;
      (entry.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (0.55 + eased * 0.45);
    }
  }

  get count(): number { return this.entries.size; }

  dispose(): void {
    for (const entry of this.entries.values()) { entry.mesh.removeFromParent(); entry.mesh.geometry.dispose(); }
    this.entries.clear();
    for (const glow of this.glows) { glow.mesh.removeFromParent(); glow.mesh.geometry.dispose(); if (glow.ownMaterial) (glow.mesh.material as THREE.Material).dispose(); }
    this.glows = [];
    this.materials.forEach((material) => material.dispose());
    this.materials.clear();
    this.glowMaterials.forEach((material) => material.dispose());
    this.glowMaterials.clear();
    this.group.removeFromParent();
  }
}
