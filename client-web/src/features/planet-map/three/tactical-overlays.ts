import * as THREE from 'three';

import type { TilePoint } from '../model';
import { surfaceOffset } from '@shared/surface';
import type { RangeCircleSpec } from '../range-circles';
import { RANGE_CIRCLE_COLORS } from '../range-circles';
import { normalTile, surfaceTileSize, tileFrame, tileNormal } from './projection';
import { circleLoop } from './surface-ribbon';
import { DASH_RING, dashFlowPhase, dashedRingGeometry, radialDiscGeometry } from './vfx/range-ring';

/**
 * 3D 行星面的战术叠加层（第 20 轮 R20-B，契约 D4）：
 *
 * - 射程圈：建造 ghost 的 combat_range / power_range、选中防御建筑的攻击射程；
 *   贴地色带 + 极淡填充盘，与补给光环同款（`circleLoop` / `ribbonGeometry`）。
 * - 侦测点：`runtime.detections[].detected_positions` 的贴地橙色脉冲圆环。
 * - 施工进度：脚手架上方朝相机的细进度条（Sprite + Canvas，进度取 remaining/total）。
 *
 * 性能约定：几何按「半径」缓存、mesh 按 key 复用；ghost 移动只改朝向四元数，
 * 不重建几何。所有对象在 `dispose()` 里释放（场景 destroy 调用）。
 */

/**
 * 射程圈线宽（格）与不透明度：与补给光环同一画法（细虚线 + 极淡径向渐变）。
 * 3A 画质起射程圈与补给光环共用 `vfx/range-ring` 的虚线参数（线宽 ≤ .06 格）。
 */
export const RANGE_CIRCLE_WIDTH_TILES = DASH_RING.width;
export const RANGE_CIRCLE_OPACITY = 0.62;
export const RANGE_CIRCLE_FILL_OPACITY = DASH_RING.fillEdge;

/** 侦测点圆环配色、脉冲周期（秒）与尺寸（格）。 */
export const DETECTION_COLOR = '#ffa53d';
export const DETECTION_PULSE_SECONDS = 1.6;
export const DETECTION_OPACITY = 0.62;

/** 进度条配色与尺寸（格）。 */
export const CONSTRUCTION_BAR_BG = '#252b33';
export const CONSTRUCTION_BAR_FG = '#7df7b0';
export const CONSTRUCTION_BAR_WIDTH_TILES = 0.8;
export const CONSTRUCTION_BAR_HEIGHT_TILES = 0.08;
/** 进度条离地高度（格）：脚手架立柱 0.65 格 + 顶部留白。 */
export const CONSTRUCTION_BAR_LIFT_TILES = 0.82;

/**
 * 半径（tile）→ 球面角半径。世界长度 = radiusTiles × 格宽；弧度 = 世界长度 / 球半径
 * （同死端红杠注释：偏移量是弧度，不是格数）。
 */
export function rangeCircleAngle(radiusTiles: number, faceSize: number, radius: number): number {
  if (!(radiusTiles > 0) || !(faceSize > 0) || !(radius > 0)) return 0;
  return (radiusTiles * surfaceTileSize(radius, faceSize)) / radius;
}

/**
 * 贴球面圆环的朝向：把规范系（圆心 +Z、东 +X、南 −Y）转到该格的（东/南/法线）基底。
 * 规范系是左手系，目标系同样是左手系（south = east × normal），所以映射仍是纯旋转。
 */
export function circleQuaternion(tile: TilePoint, faceSize: number): THREE.Quaternion {
  const { normal, east, south } = tileFrame(tile, faceSize);
  const basis = new THREE.Matrix4().makeBasis(east, south.clone().negate(), normal);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/**
 * 占地中心格：footprint 各格法线取平均再落回 tile。
 * 不能直接对展开图坐标取平均（跨面时坐标不连续），也不能用 `surfaceOffset` 的分数步进
 * （它按整数步循环，0.5 会被当成 1 格）。
 */
export function footprintCenterTile(origin: TilePoint, footprint: { width: number; height: number }, faceSize: number): TilePoint {
  const width = Math.max(1, Math.round(footprint.width)), height = Math.max(1, Math.round(footprint.height));
  const sum = new THREE.Vector3();
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    sum.add(tileNormal(surfaceOffset(origin, dx, dy, faceSize), faceSize));
  }
  return normalTile(sum.normalize(), faceSize);
}

/** 施工进度（remaining/total，与状态行同一口径）。 */
export function constructionBarProgress(task: { state: string; remaining_ticks?: number; total_ticks?: number }): number | null {
  if (task.state === 'completed') return 1;
  if (task.total_ticks === undefined || task.total_ticks <= 0 || task.remaining_ticks === undefined) return null;
  return Math.min(Math.max(1 - task.remaining_ticks / task.total_ticks, 0), 1);
}

/** 侦测点脉冲相位（0–1，确定性：同格同相位，截图可复现）。 */
export function detectionPhase(tile: TilePoint): number {
  let hash = 2166136261;
  for (const value of [Math.round(tile.x), Math.round(tile.y)]) {
    hash = (hash ^ (value & 0xffff)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 1000) / 1000;
}

export interface RangeCircleItem {
  /** 复用 key（ghost 用类型、选中用建筑 id）：同一 key 只改朝向，不重建 mesh。 */
  key: string;
  /** 圆心（tile，可为小数：占地中心）。 */
  center: TilePoint;
  spec: RangeCircleSpec;
}

/**
 * 射程圈叠加层。几何按半径缓存；mesh 按 item.key 复用，移动只更新四元数。
 * `sync([])` 清空（退出建造模式 / 取消选中）。
 */
export class RangeCircleOverlay {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, { holder: THREE.Group; edge: THREE.Mesh; fill: THREE.Mesh; radius: number; kind: RangeCircleSpec['kind']; base?: THREE.Quaternion; normal?: THREE.Vector3 }>();
  private readonly geometries = new Map<string, { edge: THREE.BufferGeometry; fill: THREE.BufferGeometry }>();
  private readonly materials: Record<RangeCircleSpec['kind'], { edge: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial }>;
  private faceSize = 0;
  private flow = 0;

  constructor(private readonly radius: number) {
    this.group.name = 'range-circles';
    // 填充用顶点色 alpha（中心 0 → 边缘 .05），材质本身 opacity = 1。
    const make = (color: string) => ({
      edge: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: RANGE_CIRCLE_OPACITY, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      fill: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, toneMapped: false }),
    });
    this.materials = { combat: make(RANGE_CIRCLE_COLORS.combat), power: make(RANGE_CIRCLE_COLORS.power) };
  }

  private geometry(spec: RangeCircleSpec) {
    const key = `${spec.kind}:${spec.radiusTiles}`;
    let cached = this.geometries.get(key);
    if (cached) return cached;
    const ts = surfaceTileSize(this.radius, this.faceSize);
    const angle = rangeCircleAngle(spec.radiusTiles, this.faceSize, this.radius);
    // 规范系：圆心 +Z、东 +X、南 −Y（与 circleQuaternion 的基底一致）。
    const loop = circleLoop(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), angle, 128);
    cached = {
      edge: dashedRingGeometry(loop, this.radius + ts * .07, Math.max(ts * RANGE_CIRCLE_WIDTH_TILES / 2, .012), ts, spec.radiusTiles),
      fill: radialDiscGeometry(loop, new THREE.Vector3(0, 0, 1), this.radius + ts * .045, RANGE_CIRCLE_FILL_OPACITY),
    };
    this.geometries.set(key, cached);
    return cached;
  }

  sync(items: RangeCircleItem[], faceSize: number) {
    if (faceSize !== this.faceSize) {
      this.faceSize = faceSize;
      for (const geometry of this.geometries.values()) { geometry.edge.dispose(); geometry.fill.dispose(); }
      this.geometries.clear();
      // 半径角度随格宽变化：已有 mesh 的几何作废，全部重建。
      for (const entry of this.meshes.values()) { entry.holder.removeFromParent(); }
      this.meshes.clear();
    }
    const live = new Set(items.map(item => item.key));
    for (const [key, entry] of this.meshes) {
      if (live.has(key)) continue;
      entry.holder.removeFromParent();
      this.meshes.delete(key);
    }
    for (const item of items) {
      if (!(item.spec.radiusTiles > 0) || !(faceSize > 0)) continue;
      let entry = this.meshes.get(item.key);
      if (entry && (entry.radius !== item.spec.radiusTiles || entry.kind !== item.spec.kind)) {
        entry.holder.removeFromParent();
        this.meshes.delete(item.key);
        entry = undefined;
      }
      if (!entry) {
        const geometry = this.geometry(item.spec);
        const material = this.materials[item.spec.kind];
        const holder = new THREE.Group();
        const fill = new THREE.Mesh(geometry.fill, material.fill);
        const edge = new THREE.Mesh(geometry.edge, material.edge);
        fill.renderOrder = 10; edge.renderOrder = 11;
        holder.add(fill, edge);
        this.group.add(holder);
        entry = { holder, edge, fill, radius: item.spec.radiusTiles, kind: item.spec.kind };
        this.meshes.set(item.key, entry);
      }
      entry.holder.quaternion.copy(circleQuaternion(item.center, faceSize));
      entry.base = entry.holder.quaternion.clone();
      entry.normal = tileNormal(item.center, faceSize);
    }
  }

  /** 虚线流动（与补给光环同一相位；冻结时由场景传固定相位）。 */
  animate(seconds: number, frozen: boolean): void {
    const phase = dashFlowPhase(seconds, frozen);
    const swing = (phase - 0.5) * 0.09;
    this.flow = swing;
    for (const entry of this.meshes.values()) {
      if (!entry.base) continue;
      entry.holder.quaternion.setFromAxisAngle(entry.normal!, this.flow).multiply(entry.base);
    }
  }

  dispose() {
    for (const entry of this.meshes.values()) entry.holder.removeFromParent();
    this.meshes.clear();
    for (const geometry of this.geometries.values()) { geometry.edge.dispose(); geometry.fill.dispose(); }
    this.geometries.clear();
    this.materials.combat.edge.dispose(); this.materials.combat.fill.dispose();
    this.materials.power.edge.dispose(); this.materials.power.fill.dispose();
    this.group.removeFromParent();
  }
}

/**
 * 侦测点叠加层：贴地橙色圆环，周期 1.6s 向外扩散淡出；冻结/减弱动效时静止。
 * 圆环几何与材质全场共享，脉冲只改 mesh 缩放。
 */
export class DetectionOverlay {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.RingGeometry(.34, .5, 40);
  private readonly material = new THREE.MeshBasicMaterial({ color: DETECTION_COLOR, transparent: true, opacity: DETECTION_OPACITY, depthWrite: false, side: THREE.DoubleSide });
  private readonly entries = new Map<string, { holder: THREE.Group; mesh: THREE.Mesh; phase: number }>();
  private tileSize = 1;

  constructor(private readonly radius: number) {
    this.group.name = 'detection-marks';
  }

  sync(positions: TilePoint[], faceSize: number) {
    this.tileSize = surfaceTileSize(this.radius, faceSize);
    const live = new Set<string>();
    for (const position of positions) {
      const tile = { x: Math.round(position.x), y: Math.round(position.y) };
      const key = `${tile.x}:${tile.y}`;
      if (live.has(key)) continue;
      live.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        const holder = new THREE.Group();
        const mesh = new THREE.Mesh(this.geometry, this.material);
        // RingGeometry 在 XY 平面；绕 X 转 −90° 后法线朝局部 +Y（= 格法线）。
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 12;
        holder.add(mesh);
        const { normal, east, south } = tileFrame(tile, faceSize);
        holder.position.copy(normal).multiplyScalar(this.radius + this.tileSize * .05);
        holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
        this.group.add(holder);
        entry = { holder, mesh, phase: detectionPhase(tile) };
        this.entries.set(key, entry);
      }
      entry.mesh.scale.setScalar(this.tileSize * .8);
    }
    for (const [key, entry] of this.entries) {
      if (live.has(key)) continue;
      entry.holder.removeFromParent();
      this.entries.delete(key);
    }
  }

  /** 脉冲：圆环从 0.55 格扩散到 0.9 格并保持半透明；暂停时固定在中间态。 */
  animate(seconds: number, paused: boolean) {
    for (const entry of this.entries.values()) {
      const phase = paused ? .45 : ((seconds / DETECTION_PULSE_SECONDS) + entry.phase) % 1;
      entry.mesh.scale.setScalar(this.tileSize * (.55 + .35 * phase));
    }
  }

  dispose() {
    for (const entry of this.entries.values()) entry.holder.removeFromParent();
    this.entries.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

export interface ConstructionProgressItem {
  id: string;
  tile: TilePoint;
  progress: number | null;
}

/**
 * 施工进度条：脚手架上方朝相机的 Sprite（Canvas 纹理），宽 0.8 格、高 0.08 格。
 * 只有进度可算（remaining/total 齐全）时显示；进度量化到 1/64 才重绘画布。
 */
export class ConstructionProgressOverlay {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; drawn: number }>();

  constructor(private readonly radius: number) {
    this.group.name = 'construction-progress';
  }

  private draw(canvas: HTMLCanvasElement, progress: number) {
    const context = canvas.getContext('2d');
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = CONSTRUCTION_BAR_BG;
    context.globalAlpha = .9;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
    context.fillStyle = CONSTRUCTION_BAR_FG;
    context.fillRect(1, 1, Math.max(0, Math.round((width - 2) * progress)), height - 2);
  }

  sync(items: ConstructionProgressItem[], faceSize: number) {
    const ts = surfaceTileSize(this.radius, faceSize);
    const live = new Set<string>();
    for (const item of items) {
      if (item.progress === null) continue;
      live.add(item.id);
      let entry = this.entries.get(item.id);
      if (!entry) {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 16;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 22;
        this.group.add(sprite);
        entry = { sprite, canvas, texture, drawn: -1 };
        this.entries.set(item.id, entry);
      }
      const drawn = Math.round(item.progress * 64) / 64;
      if (drawn !== entry.drawn) {
        this.draw(entry.canvas, drawn);
        entry.texture.needsUpdate = true;
        entry.drawn = drawn;
      }
      entry.sprite.scale.set(ts * CONSTRUCTION_BAR_WIDTH_TILES, ts * CONSTRUCTION_BAR_HEIGHT_TILES, 1);
      const normal = tileNormal(item.tile, faceSize);
      entry.sprite.position.copy(normal).multiplyScalar(this.radius + ts * CONSTRUCTION_BAR_LIFT_TILES);
    }
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      entry.sprite.removeFromParent();
      entry.texture.dispose();
      entry.sprite.material.dispose();
      this.entries.delete(id);
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.sprite.removeFromParent();
      entry.texture.dispose();
      entry.sprite.material.dispose();
    }
    this.entries.clear();
    this.group.removeFromParent();
  }
}
