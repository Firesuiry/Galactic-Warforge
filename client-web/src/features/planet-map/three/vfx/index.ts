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
import { tileNormal, surfaceTileSize } from '../projection';
import { VFX_QUALITY, type VfxQualitySettings } from './common';
import { ParticleSystem } from './particles';
import { CombatVfx } from './combat-vfx';
import { combatVfxFromEvent, type CombatPointLike } from './combat-vfx-specs';
import { IndustryEmitters, registerBuildingType } from './emitters';
import { ConstructionFlash, HoloMaterials } from './construction-holo';
import { ensureAtlas } from './atlas';

/** 冻结下的固定时间（秒）：所有动画停在这个相位。 */
export const FROZEN_TIME = 1.35;

export interface VfxLayerOptions {
  radius: number;
  scale: () => number;
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
  private readonly emitters: IndustryEmitters;
  private readonly settings: VfxQualitySettings;
  private readonly frozen: boolean;
  private readonly reducedMotion: boolean;
  private sources: ActivitySource[] = [];
  private time = 0;

  constructor(private readonly parent: THREE.Object3D, options: VfxLayerOptions) {
    this.settings = VFX_QUALITY[options.quality];
    this.frozen = options.frozen;
    this.reducedMotion = options.reducedMotion;
    ensureAtlas();
    this.particles = new ParticleSystem(parent, this.settings);
    this.combat = new CombatVfx(parent, this.particles, this.settings.dynamicLights);
    this.shake = new CameraShake(options.shakeEnabled ?? (() => !options.frozen && !options.reducedMotion));
    this.emitters = new IndustryEmitters(this.particles, this.settings, options.scale, options.radius);
    this.constructionFlash = new ConstructionFlash(parent, options.radius, options.scale);
  }

  get qualitySettings(): VfxQualitySettings { return this.settings; }

  /** 权威活动源（`collectActivity` 的输出）：工业氛围只认这里的 active 标记。 */
  setActivity(data: PlanetThreeData): ActivitySource[] {
    for (const building of Object.values(data.planet.buildings ?? {})) registerBuildingType(building.id, building.type);
    this.sources = collectActivity(data);
    return this.sources;
  }

  /** 战斗事件 → 视觉（保持 `specsFromCombatEvent` 的事件口径）。 */
  combatEvent(event: BattleEvent, resolve: (id: string | undefined | null) => CombatPointLike | null, camera: THREE.Camera, center: THREE.Vector3): void {
    const specs = combatVfxFromEvent(event, resolve);
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

  /** 每帧推进（`dt` 秒；冻结时内部固定时间）。 */
  update(dt: number, cameraHeight: number, faceSize: number): void {
    if (this.frozen) {
      this.time = FROZEN_TIME;
    } else if (!this.reducedMotion) {
      this.time += Math.max(0, dt);
    }
    this.combat.update(this.frozen ? 0 : dt, this.time, cameraHeight);
    this.shake.update(this.frozen ? 0 : dt);
    this.holo.setTime(this.time);
    this.constructionFlash.update(this.frozen ? 0 : dt);
    this.emitters.update(this.sources, dt, this.time, faceSize, this.frozen);
  }

  /** 施工完成的一次闪光（场景在任务消失时调用）。 */
  completeConstruction(tile: { x: number; y: number }, faceSize: number): void {
    const normal = tileNormal(tile, faceSize);
    this.constructionFlash.spawn(normal.clone().multiplyScalar(0), normal);
  }

  /** 当前时间（秒，冻结下固定）。 */
  get currentTime(): number { return this.time; }

  /** 诊断：粒子/战斗对象计数。 */
  stats() {
    return { time: this.time, particles: this.particles.counts(), combat: this.combat.counts(), emitters: this.emitters.activeEmitters };
  }

  dispose(): void {
    this.combat.dispose();
    this.particles.dispose();
    this.constructionFlash.dispose();
    this.holo.dispose();
    this.shake.clear();
    void this.parent;
    void surfaceTileSize;
  }
}
