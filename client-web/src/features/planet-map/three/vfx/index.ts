/**
 * 3A 画质 vfx 层总入口：把粒子、战斗视觉、工业氛围、施工全息、选中反馈、
 * 镜头震动组合成一个场景可调用的模块。
 *
 * 场景侧的接入面（只在这里，不散落）：
 * - 构造：`new VfxLayer(world, { radius, scale, quality, frozen, reducedMotion })`
 * - 数据：`setActivity(sources)`（权威活动源）、`setConstruction(tasks)`（施工任务）
 * - 事件：`combatEvent(event, resolve)`（战斗事件总线）
 * - 每帧：`update(dt, time, cameraHeight)`；渲染前后 `shake.apply(camera)` / restore
 * - 销毁：`dispose()`
 *
 * 冻结（`?freeze=1`）下时间固定为 `FROZEN_TIME`，所有粒子/扫描线/虚线停在固定相位。
 */

import * as THREE from 'three';

import type { BattleEvent } from '@/engine/battle-events';
import type { PlanetRenderQuality } from '../render-quality';
import { CameraShake, shakeFromExplosion } from '../camera-shake';
import { collectActivity, type ActivitySource } from '../industrial-activity';
import type { PlanetThreeData } from '../../planet-three-scene';
import { getBuildingFootprint } from '../../model';
import { surfaceTileSize } from '../projection';
import { VFX_QUALITY, type VfxQualitySettings } from './common';
import { ParticleSystem } from './particles';
import { CombatVfx } from './combat-vfx';
import { combatVfxFromEvent, type CombatPointLike } from './combat-vfx-specs';
import { IndustryEmitters, registerBuildingType } from './emitters';
import { ConstructionFlash, ConstructionHolo, HoloMaterials, type HoloTask } from './construction-holo';
import { SelectionOverlay, type SelectionItem } from './selection';
import { SupplyAuraLayer, supplyAurasFrom, type SupplyAuraItem } from './supply-aura';
import { ensureAtlas } from './atlas';
import { applyFixturePhase, type FixtureContext } from './fixture-hooks';

/** 冻结下的固定时间（秒）：所有动画停在这个相位。 */
export const FROZEN_TIME = 1.35;

export interface VfxLayerOptions {
  radius: number;
  scale: () => number;
  /** 建筑模型工厂（`IndustrialModels`，与实物共享几何）。 */
  models: { building(type: string, width: number, depth: number, own: boolean): THREE.Object3D };
  /** 建筑**占地**（格）：模型按占地归一化，发射口高度要按同一份占地算（1×1 与 3×3 模型高度差 3 倍）。 */
  footprintOf?: (buildingId: string) => { width: number; height: number } | undefined;
  /** 格 → 世界组局部单位法线。 */
  normalOf: (tile: { x: number; y: number }) => THREE.Vector3;
  quality: PlanetRenderQuality;
  frozen: boolean;
  reducedMotion: boolean;
  /** 爆炸震动的门控（freeze / reduced-motion 时由场景传 false）。 */
  shakeEnabled?: () => boolean;
}

export class VfxLayer {
  readonly particles: ParticleSystem;
  readonly combat: CombatVfx;
  readonly shake: CameraShake;
  readonly holo = new HoloMaterials();
  readonly constructionFlash: ConstructionFlash;
  readonly construction: ConstructionHolo;
  readonly selection: SelectionOverlay;
  readonly auras: SupplyAuraLayer;
  private readonly emitters: IndustryEmitters;
  private readonly settings: VfxQualitySettings;
  private readonly frozen: boolean;
  private readonly reducedMotion: boolean;
  private sources: ActivitySource[] = [];
  private time = 0;
  /** 冻结相位（夹具可覆盖；每帧 update 都用它，避免被 animate 循环重置）。 */
  private frozenPhase = FROZEN_TIME;
  /** 上一帧的相机高度（夹具推进短命对象时沿用，避免淡出距离跳变）。 */
  private lastCameraHeight = 1;

  constructor(private readonly parent: THREE.Object3D, options: VfxLayerOptions) {
    this.settings = VFX_QUALITY[options.quality];
    this.frozen = options.frozen;
    this.reducedMotion = options.reducedMotion;
    ensureAtlas();
    this.particles = new ParticleSystem(parent, this.settings, this.frozen);
    this.combat = new CombatVfx(parent, this.particles, this.settings.dynamicLights, options.scale);
    this.shake = new CameraShake(options.shakeEnabled ?? (() => !options.frozen && !options.reducedMotion));
    this.emitters = new IndustryEmitters(this.particles, this.settings, options.scale, options.radius, options.normalOf, options.footprintOf);
    this.constructionFlash = new ConstructionFlash(parent, options.radius, options.scale);
    this.construction = new ConstructionHolo(parent, options.models, this.holo, options.radius, options.scale, this.constructionFlash, options.normalOf);
    this.selection = new SelectionOverlay(parent, options.radius, options.scale);
    this.auras = new SupplyAuraLayer(options.radius);
    parent.add(this.auras.group);
  }

  /** 补给光环（运行/停机语义不变，画法换成细虚线 + 极淡渐变）。 */
  syncAuras(items: readonly SupplyAuraItem[], faceSize: number): void {
    this.auras.sync(items, faceSize);
  }

  /** 选中/悬停反馈（括号 / 细环 / 方向三角）。 */
  syncSelection(items: readonly SelectionItem[], faceSize: number, now: number): void {
    this.selection.sync(items, faceSize, now);
  }

  /** 施工全息（目标模型 + 按进度溶解）。 */
  syncConstruction(tasks: readonly HoloTask[], faceSize: number): void {
    this.construction.sync(tasks, faceSize);
  }

  get qualitySettings(): VfxQualitySettings { return this.settings; }

  /**
   * 权威活动源（`collectActivity` 的输出）：工业氛围只认这里的 active 标记。
   * `enabled` 是场景当前的图层开关（建筑层关掉时不冒烟）。
   */
  setActivity(data: PlanetThreeData, enabled: { buildings?: boolean; power?: boolean } = {}): ActivitySource[] {
    for (const building of Object.values(data.planet.buildings ?? {})) registerBuildingType(building.id, building.type, getBuildingFootprint(building));
    this.sources = collectActivity(data).filter((source) => {
      if (source.kind === 'energy') return enabled.power !== false;
      if (source.kind === 'cargo' || source.kind === 'flight') return false;
      return enabled.buildings !== false;
    });
    return this.sources;
  }

  /** 战斗事件 → 视觉（保持 `specsFromCombatEvent` 的事件口径）。 */
  combatEvent(event: BattleEvent, resolve: (id: string | undefined | null) => CombatPointLike | null, camera: THREE.Camera, center: THREE.Vector3): void {
    const specs = combatVfxFromEvent(event, resolve);
    // 冻结（`?freeze=1` / 截图夹具）下战斗事件不演出：画面必须是时间的纯函数，
    // 否则每来一条事件就多一批永久存在的粒子（实测冻结夹具里粒子池被灌满）。
    if (this.frozen || this.reducedMotion) return;
    this.combat.spawn(specs);
    // 爆炸按距画面中心的距离与规模触发震动。
    for (const wave of specs.shockwaves) {
      const point = new THREE.Vector3(wave.at.x, wave.at.y, wave.at.z);
      const distance = point.distanceTo(center);
      const strength = shakeFromExplosion(wave.size, distance, 26);
      if (strength > 0.02) this.shake.add(strength, 320 + wave.size * 90);
    }
    void camera;
  }

  /** 世界尺度：粒子尺寸（格）→ 屏幕像素的换算系数。 */
  setWorldScale(pixelScale: number, tileSize: number): void {
    this.particles.setWorldScale(pixelScale, tileSize);
    // 曳光的远景像素下限用同一换算系数。
    this.combat.setPixelScale(pixelScale);
  }

  /** 相机（曳光 billboard 用）；场景在构造后与 resize 时各调一次即可。 */
  setCamera(camera: THREE.Camera): void {
    this.combat.setCamera(camera);
  }

  /** 每帧推进（`dt` 秒；冻结时内部固定时间）。 */
  update(dt: number, cameraHeight: number, faceSize: number): void {
    if (this.frozen) {
      this.time = this.frozenPhase;
    } else if (!this.reducedMotion) {
      this.time += Math.max(0, dt);
    }
    // 冻结下**不推进**曳光/焦痕/冲击波/点光源的寿命：画面必须停在固定相位（硬约束 §2.3）。
    // 夹具按相位注入时先显式 `update(AGE)` 推进到目标相位，之后每帧 dt=0 保持不变。
    this.lastCameraHeight = cameraHeight;
    this.combat.update(this.frozen ? 0 : dt, this.time, cameraHeight);
    this.shake.update(dt);
    this.holo.setTime(this.time);
    this.constructionFlash.update(this.frozen ? 0 : dt);
    // 夹具排错：粒子批是否可见/时间/纹理。
    (this as unknown as { _debug?: unknown })._debug = this.particles.debugInfo();
    this.selection.animate(this.time, this.frozen);
    this.auras.animate(this.time, this.frozen);
    this.emitters.update(this.sources, dt, this.time, faceSize, this.frozen);
  }

  /**
   * 夹具定格：把**短命对象**（曳光/焦痕/冲击波/点光源）推进指定秒数。
   * 冻结时 `update()` 的 dt 恒为 0（画面必须是时间的纯函数），只有夹具需要把它们
   * 停在「爆发后 N 秒」的样子。
   */
  advanceTimed(dt: number): void {
    this.combat.update(Math.max(0, dt), this.time, this.lastCameraHeight);
  }

  /**
   * 夹具定格：把 VFX 时钟拨到指定相位（冻结截图用；真机不调用）。
   * 粒子/曳光/冲击波都按 `uTime` 解析求值，拨时钟后立刻处于该相位。
   */
  setFrozenPhase(seconds: number): void {
    this.frozenPhase = seconds;
    this.time = seconds;
    this.particles.setTime(seconds);
    this.combat.setTime(seconds);
    this.holo.setTime(seconds);
  }

  /** 夹具：按相位注入合成特效（见 `fixture-hooks.ts`）。 */
  applyFixturePhase(phase: string, seconds: number | undefined, context: FixtureContext): number {
    return applyFixturePhase(this, phase, seconds, context);
  }

  /** 当前时间（秒，冻结下固定）。 */
  get currentTime(): number { return this.time; }

  /** 诊断：粒子/战斗对象计数。 */
  stats() {
    return { time: this.time, particles: this.particles.counts(), combat: this.combat.counts(), emitters: this.emitters.activeEmitters, sources: this.sources.length, debug: this.particles.debugInfo() };
  }

  dispose(): void {
    this.combat.dispose();
    this.particles.dispose();
    this.constructionFlash.dispose();
    this.construction.dispose();
    this.selection.dispose();
    this.auras.dispose();
    this.holo.dispose();
    this.shake.clear();
    void this.parent;
    void surfaceTileSize;
  }
}
