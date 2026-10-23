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
import { tileFrame, tileNormal, surfaceTileSize } from '../projection';
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
export const BRACKET_ARM = 0.22;
/** 括号相对建筑模型的外扩（模型按占地 ×.86 建，括号略外一圈才不贴模型边）。 */
export const BRACKET_SPAN = 0.9;
/** 收拢动画时长（秒）。 */
export const BRACKET_SNAP_SECONDS = 0.22;

/** 括号围住的尺寸（格）：`tile` 是**占地中心**，`width/height` 是占地格数。 */
export interface BracketFootprint { width: number; height: number }

/**
 * 四角括号：以**占地中心**为圆心、按整块占地尺寸画在四角（不是逐格）。
 *
 * 旧实现把每格当成一个独立的 1×1 括号（`tileQuad(tile)`），场景侧传入的是占地**原点**
 * （`position` 是左上角），于是 3×3/5×5 的括号整体偏到左上角两格之外。这里改成
 * 「中心格 + 占地尺寸」：4 条臂 × 2 段，共 8 条细带合并成一个几何。
 * `inset` 0 = 贴占地边，1 = 完全收拢到四角（臂长缩到 0）。
 */
export function bracketGeometry(
  center: TilePoint, faceSize: number, radius: number, lineWidth: number, inset: number,
  footprint: BracketFootprint = { width: 1, height: 1 },
): THREE.BufferGeometry {
  const { normal, east, south } = tileFrame(center, faceSize);
  // 一格在**展开图坐标**里的角尺寸：一个面 90° 摊到 faceSize 格。不能用 `surfaceTileSize`
  // （它除以 √2，是「最窄格」的物理宽度，拿来做格子步进会让 3×3 的括号只盖住 2 格）。
  const tileAngle = Math.PI / (2 * faceSize);
  const width = Math.max(1, footprint.width), height = Math.max(1, footprint.height);
  const halfW = width * 0.5 * BRACKET_SPAN * tileAngle;
  const halfH = height * 0.5 * BRACKET_SPAN * tileAngle;
  // 臂长按较小边缩放：1×1 = .22 格、5×5 ≈ 1.1 格；太长会连成一个整框、读不出「四角括号」。
  const arm = Math.max(0.06, Math.min(width, height) * BRACKET_ARM * (1 - inset)) * tileAngle;
  const at = (u: number, v: number) => normal.clone()
    .addScaledVector(east, u).addScaledVector(south, v).normalize();
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ribbon = ribbonGeometry([a, b], radius, lineWidth);
    const array = ribbon.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < array.count; i++) positions.push(array.getX(i), array.getY(i), array.getZ(i));
    // ribbonGeometry 对 2 点环生成的索引是 0,1,2, 2,1,3（四边形）。
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    base += 4;
    ribbon.dispose();
  };
  // 四角（u,v）：(-1,-1) (1,-1) (1,1) (-1,1)；每条臂沿边向内收。
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const corner = at(u * halfW, v * halfH);
    const armH = corner.clone().addScaledVector(east, -Math.sign(u) * arm).normalize();
    const armV = corner.clone().addScaledVector(south, -Math.sign(v) * arm).normalize();
    pushQuad(corner, armH);
    pushQuad(corner, armV);
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
  /** 建筑 = 占地**中心格**（`footprintCenterTile`），单位/悬停 = 实体所在格。 */
  tile: TilePoint;
  color: string;
  kind: 'building' | 'unit' | 'hover';
  /** 单位朝向（可选）：给方向小三角用。 */
  direction?: { x: number; y: number };
  /** 建筑占地格列表（地面光晕按它铺满整块；括号尺寸取 `footprintSize`）。 */
  footprint?: TilePoint[];
  /** 建筑占地格数（括号按整块画，1×1/3×3/5×5 各一档）。 */
  footprintSize?: BracketFootprint;
  opacity: number;
}

/**
 * 选中/悬停反馈层：括号（建筑）、细环 + 方向三角（单位）、悬停细环。
 *
 * - 建筑只生成**一个**括号网格：中心 = 占地中心格、尺寸 = 占地 ×.86 外扩少量；
 * - 几何在签名变化时重建（悬停切换每帧都有，不能每次重建）；
 * - 括号收拢动画：`animate(seconds, frozen)` 写不透明度（0 → 1 的快照），冻结时固定在收拢完成；
 * - 材质按颜色缓存（共享），不逐实例克隆。
 */
export class SelectionOverlay {
  readonly group = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private entries = new Map<string, { mesh: THREE.Mesh; kind: SelectionItem['kind']; color: string; born: number; tile: TilePoint; footprint?: TilePoint[]; footprintSize?: BracketFootprint }>();
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
    const signature = JSON.stringify(items.map((item) => [item.key, item.tile.x, item.tile.y, item.color, item.kind, item.footprint?.length ?? 0, item.footprintSize?.width ?? 0, item.footprintSize?.height ?? 0, item.opacity]));
    if (signature === this.signature) return;
    this.signature = signature;
    for (const entry of this.entries.values()) {
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
    }
    this.entries.clear();
    for (const glow of this.glows) { glow.mesh.removeFromParent(); glow.mesh.geometry.dispose(); if (glow.ownMaterial) (glow.mesh.material as THREE.Material).dispose(); }
    this.glows = [];
    for (const item of items) {
      const material = this.lineMaterial(item.color, item.opacity);
      // 线宽必须按世界单位（不是格）：格宽在 288 格面上只有 0.386，0.055 格 ≈ 0.02 世界单位，
      // 色带贴地几乎看不见。取「0.02 格 → 世界」并留一点下限。
      const worldWidth = Math.max(this.scale() * 0.02, 0.006);
      const geometry = item.kind === 'building'
        ? bracketGeometry(item.tile, faceSize, this.radius + this.scale() * 0.05, worldWidth, 0, item.footprintSize)
        : item.kind === 'unit'
          ? ringGeometry(item.tile, faceSize, this.radius, worldWidth, 0.34)
          : ringGeometry(item.tile, faceSize, this.radius, worldWidth * 0.8, 0.42);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = item.kind === 'hover' ? 11 : 12;
      this.group.add(mesh);
      this.entries.set(item.key, { mesh, kind: item.kind, color: item.color, born: now, tile: item.tile, footprint: item.footprint, footprintSize: item.footprintSize });
      if (item.kind === 'building' && item.footprint?.length) {
        // 柔和地面光晕：盖住整个占地（中心在最暗处，边缘极淡），不是一格小圆。
        const span = Math.sqrt(item.footprint.length) * 0.75;
        const glowGeometry = glowDisc(item.tile, faceSize, this.radius, Math.max(0.9, span));
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
