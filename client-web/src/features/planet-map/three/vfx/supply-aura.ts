/**
 * 补给光环（重画版）：细虚线环 + 极淡径向渐变，替代旧的「粗薄荷绿实心环」。
 *
 * - 运行 / 停机颜色语义不变（`SUPPLY_AURA_COLORS`）；停机环不流动。
 * - 几何按「格 + 半径档」缓存；同半径的多个补给站共用几何（只换朝向）。
 * - 冻结时相位固定、不呼吸。
 */

import * as THREE from 'three';

import { circleLoop } from '../surface-ribbon';
import { surfaceTileSize, tileFrame } from '../projection';
import type { TilePoint } from '../../model';
import {
  DASH_RING,
  SUPPLY_AURA_COLORS,
  createDashRingMaterial,
  createRadialFillMaterial,
  dashFlowPhase,
  dashedRingGeometry,
  radialDiscGeometry,
} from './range-ring';

export interface SupplyAuraItem {
  x: number;
  y: number;
  radiusTiles: number;
  color: string;
  /** 运行中（虚线流动）；停机为 false（静止）。 */
  running: boolean;
}

const SEGMENTS = 128;

/**
 * 补给光环层：几何按半径缓存，mesh 按「格:半径:颜色」复用。
 * `sync(items)` 重建集合；`animate(seconds, frozen)` 只改朝向（虚线流动）。
 */
export class SupplyAuraLayer {
  readonly group = new THREE.Group();
  private readonly geometries = new Map<string, { edge: THREE.BufferGeometry; fill: THREE.BufferGeometry }>();
  private readonly materials = new Map<string, { edge: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial }>();
  private readonly entries = new Map<string, { holder: THREE.Group; tile: TilePoint; running: boolean; radiusTiles: number; normal: THREE.Vector3; base: THREE.Quaternion }>();
  private faceSize = 0;
  private signature = '';

  constructor(private readonly radius: number) {
    this.group.name = 'supply-auras';
  }

  private materialsFor(color: string) {
    let material = this.materials.get(color);
    if (!material) {
      material = { edge: createDashRingMaterial(color, DASH_RING.opacity), fill: createRadialFillMaterial(color) };
      this.materials.set(color, material);
    }
    return material;
  }

  private geometryFor(item: SupplyAuraItem) {
    const key = `${this.faceSize}:${item.radiusTiles}`;
    let cached = this.geometries.get(key);
    if (cached) return cached;
    const ts = surfaceTileSize(this.radius, this.faceSize);
    const angle = (item.radiusTiles * ts) / this.radius;
    const loop = circleLoop(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), angle, SEGMENTS);
    cached = {
      edge: dashedRingGeometry(loop, this.radius + ts * 0.07, Math.max(ts * DASH_RING.width / 2, 0.012), ts, item.radiusTiles),
      fill: radialDiscGeometry(loop, new THREE.Vector3(0, 0, 1), this.radius + ts * 0.045, DASH_RING.fillEdge),
    };
    this.geometries.set(key, cached);
    return cached;
  }

  sync(items: readonly SupplyAuraItem[], faceSize: number): void {
    if (faceSize !== this.faceSize) {
      this.faceSize = faceSize;
      for (const geometry of this.geometries.values()) { geometry.edge.dispose(); geometry.fill.dispose(); }
      this.geometries.clear();
      for (const entry of this.entries.values()) entry.holder.removeFromParent();
      this.entries.clear();
      this.signature = '';
    }
    const signature = JSON.stringify(items.map((item) => [item.x, item.y, item.radiusTiles, item.color, item.running]));
    if (signature === this.signature) return;
    this.signature = signature;
    const live = new Set<string>();
    for (const item of items) {
      const key = `${item.x}:${item.y}:${item.radiusTiles}:${item.color}`;
      live.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        const geometry = this.geometryFor(item);
        const materials = this.materialsFor(item.color);
        const holder = new THREE.Group();
        const fill = new THREE.Mesh(geometry.fill, materials.fill);
        const edge = new THREE.Mesh(geometry.edge, materials.edge);
        fill.renderOrder = 9;
        edge.renderOrder = 11;
        holder.add(fill, edge);
        const { normal, east, south } = tileFrame({ x: item.x, y: item.y }, faceSize);
        holder.position.copy(normal).multiplyScalar(this.radius);
        const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, south.clone().negate(), normal));
        holder.quaternion.copy(base);
        this.group.add(holder);
        entry = { holder, tile: { x: item.x, y: item.y }, running: item.running, radiusTiles: item.radiusTiles, normal, base };
        this.entries.set(key, entry);
      }
      entry.running = item.running;
    }
    for (const [key, entry] of this.entries) {
      if (live.has(key)) continue;
      entry.holder.removeFromParent();
      this.entries.delete(key);
    }
  }

  /** 虚线流动：整体绕该格法线缓慢旋转（不重建几何）；冻结时固定相位。 */
  animate(seconds: number, frozen: boolean): void {
    const phase = dashFlowPhase(seconds, frozen);
    const swing = (phase - 0.5) * 0.09;
    for (const entry of this.entries.values()) {
      if (!entry.running) { entry.holder.quaternion.copy(entry.base); continue; }
      entry.holder.quaternion.setFromAxisAngle(entry.normal, swing).multiply(entry.base);
    }
  }

  get count(): number { return this.entries.size; }

  dispose(): void {
    for (const entry of this.entries.values()) entry.holder.removeFromParent();
    this.entries.clear();
    for (const geometry of this.geometries.values()) { geometry.edge.dispose(); geometry.fill.dispose(); }
    this.geometries.clear();
    for (const material of this.materials.values()) { material.edge.dispose(); material.fill.dispose(); }
    this.materials.clear();
    this.group.removeFromParent();
  }
}

/** 补给光环条目构造（与旧 `updateStaticMarks` 同一判定口径）。 */
export function supplyAurasFrom(
  buildings: Iterable<{ id: string; type: string; owner_id: string; hp: number; position: { x: number; y: number }; runtime?: { state?: string } }>,
  units: Iterable<{ type: string; owner_id: string; hp: number; position: { x: number; y: number } }>,
  playerId: string | undefined,
  radiusOf: (type: string, kind: 'building' | 'unit') => number,
): SupplyAuraItem[] {
  const auras: SupplyAuraItem[] = [];
  for (const building of buildings) {
    const radius = radiusOf(building.type, 'building');
    if (building.owner_id === playerId && building.hp > 0 && radius > 0) {
      auras.push({
        x: building.position.x, y: building.position.y, radiusTiles: radius,
        color: building.runtime?.state === 'running' ? SUPPLY_AURA_COLORS.running : SUPPLY_AURA_COLORS.stopped,
        running: building.runtime?.state === 'running',
      });
    }
  }
  for (const unit of units) {
    const radius = radiusOf(unit.type, 'unit');
    if (unit.owner_id === playerId && unit.hp > 0 && unit.type === 'supply_truck' && radius > 0) {
      auras.push({
        x: Math.round(unit.position.x), y: Math.round(unit.position.y), radiusTiles: radius,
        color: SUPPLY_AURA_COLORS.truck, running: true,
      });
    }
  }
  return auras;
}

