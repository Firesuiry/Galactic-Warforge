/**
 * 工业氛围发射器（3A 画质 vfx 分支）：只用 `collectActivity` 的权威数据。
 *
 * 数据 → 发射（信息诚实 §2.1）：设备暂停 / 缺电 / 矿点枯竭时对应活动源根本不存在，
 * 这里也就不会发射；不存在「为了好看凭空冒烟」的路径。
 *
 * 每种建筑有一个**局部坐标发射点表**（类型 → 发射口位置，单位 = 格，+Y 为表面法线方向，
 * +Z 为建筑正面）。表里没有的类型按占地中心顶部发射。
 */

import * as THREE from 'three';

import type { ActivitySource } from '../industrial-activity';
import { rand, smoothstep, type VfxQualitySettings } from './common';
import { PARTICLE_STYLES, type ParticleBurst, type ParticleStyle, type ParticleSystem } from './particles';

/** 局部发射口（格）：x/z 为格内偏移，y 为离地高度。 */
export interface EmitterOffset { x: number; y: number; z: number }

/** 类型 → 发射口偏移表（按 `collectActivity` 的 kind 分组）。 */
export const EMITTER_OFFSETS: Record<string, EmitterOffset> = {
  // 熔炉：炉口在正面偏上，火从炉口喷出。
  arc_smelter: { x: 0, y: 0.62, z: 0.34 },
  plane_smelter: { x: 0, y: 0.58, z: 0.32 },
  smelter: { x: 0, y: 0.6, z: 0.32 },
  // 火电：烟囱在顶部后侧。
  thermal_power_plant: { x: 0.18, y: 1.05, z: -0.22 },
  mini_fusion_power_plant: { x: 0, y: 0.9, z: -0.2 },
  // 化工 / 炼油：塔顶白色蒸汽。
  chemical_plant: { x: 0, y: 0.95, z: 0 },
  oil_refinery: { x: 0.12, y: 1.0, z: -0.1 },
  // 采矿机：钻头下方扬尘。
  mining_machine: { x: 0, y: 0.28, z: 0.1 },
  advanced_mining_machine: { x: 0, y: 0.3, z: 0.1 },
  // 装配台：焊接点偏前侧。
  assembling_machine_mk1: { x: 0.24, y: 0.5, z: 0.28 },
  assembling_machine_mk2: { x: 0.24, y: 0.5, z: 0.28 },
  assembling_machine_mk3: { x: 0.24, y: 0.5, z: 0.28 },
  // 研究站：全息塔顶。
  matrix_lab: { x: 0, y: 0.92, z: 0 },
  research_station: { x: 0, y: 0.92, z: 0 },
};

/** 建筑类型 → 工业活动表现（kind 来自权威活动源）。 */
export interface IndustryProfile {
  /** 每秒发射次数（high 档）。 */
  rate: number;
  styles: { style: ParticleStyle; count: number; life: number; scale: number; speed: number; tint: [number, number, number] }[];
}

function profile(...styles: IndustryProfile['styles']): IndustryProfile {
  return { rate: 3.2, styles };
}

export const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  // 熔炉运行：炉口火光 + 火花 + 轻烟。
  heat: profile(
    { style: PARTICLE_STYLES.fire, count: 3, life: 0.45, scale: 0.8, speed: 0.9, tint: [1, 1, 1] },
    { style: PARTICLE_STYLES.spark, count: 2, life: 0.5, scale: 0.8, speed: 1.8, tint: [1, 0.9, 0.7] },
    { style: PARTICLE_STYLES.smoke, count: 1, life: 1.4, scale: 0.6, speed: 0.5, tint: [0.42, 0.42, 0.42] },
  ),
  // 发电：烟柱。
  energy: profile(
    { style: PARTICLE_STYLES.smoke, count: 2, life: 2.2, scale: 0.9, speed: 0.8, tint: [0.5, 0.52, 0.54] },
  ),
  // 采矿：尘土 + 碎屑。
  mining: profile(
    { style: PARTICLE_STYLES.dust, count: 2, life: 1.0, scale: 0.8, speed: 0.45, tint: [1, 1, 1] },
    { style: PARTICLE_STYLES.debris, count: 1, life: 0.5, scale: 0.7, speed: 1.2, tint: [1, 1, 1] },
  ),
};

/** 化工/炼油的白色蒸汽：用 heat 的活动源但换样式（类型区分）。 */
const STEAM_TYPES = /chemical_plant|oil_refinery|fractionator|spray_coater/;
/** 装配台焊花。 */
const ASSEMBLER_TYPES = /assembling_machine/;
/** 研究站全息光粒。 */
const RESEARCH_TYPES = /matrix_lab|research_station/;

/** 一次发射的时间窗（秒）：同一活动源在窗口内只发一次，相位由 seed 决定（冻结可复现）。 */
export const INDUSTRY_INTERVAL = 0.28;

interface EmitterState {
  /** 上次发射的相位（0..1，按 interval 计）。 */
  lastPhase: number;
  seed: number;
}

/**
 * 工业氛围：每帧从活动源集合里按固定间隔发射。
 *
 * `active` 集合由场景从 `IndustrialActivity` 的 entries 推导（权威数据）；
 * 调用方传入 `frozen` 时相位固定在 0.5（画面静止且确定）。
 */
export class IndustryEmitters {
  private readonly states = new Map<string, EmitterState>();
  private readonly scale: () => number;
  private readonly radius: number;

  constructor(
    private readonly particles: ParticleSystem,
    private readonly settings: VfxQualitySettings,
    scale: () => number,
    radius: number,
  ) {
    this.scale = scale;
    this.radius = radius;
  }

  /** 设备类型 → 发射口偏移（格）；未登记的类型返回 null（不发射，宁缺毋滥）。 */
  static offsetFor(type: string): EmitterOffset | null {
    return EMITTER_OFFSETS[type] ?? null;
  }

  /** 某种建筑的工业表现（按活动源 kind 与建筑类型细化）。 */
  static profileFor(kind: ActivitySource['kind'], buildingType: string): IndustryProfile | null {
    if (kind === 'heat') {
      if (STEAM_TYPES.test(buildingType)) {
        return profile({ style: PARTICLE_STYLES.steam, count: 2, life: 1.8, scale: 0.8, speed: 0.7, tint: [1, 1, 1] });
      }
      return INDUSTRY_PROFILES.heat;
    }
    if (kind === 'energy') return INDUSTRY_PROFILES.energy;
    if (kind === 'mining') return INDUSTRY_PROFILES.mining;
    if (ASSEMBLER_TYPES.test(buildingType)) {
      return { rate: 1.1, styles: [{ style: PARTICLE_STYLES.weld, count: 2, life: 0.4, scale: 0.8, speed: 1.4, tint: [1, 1, 1] }] };
    }
    if (RESEARCH_TYPES.test(buildingType)) {
      return { rate: 1.4, styles: [{ style: PARTICLE_STYLES.holo, count: 1, life: 1.6, scale: 0.9, speed: 0.5, tint: [1, 1, 1] }] };
    }
    return null;
  }

  /**
   * 逐帧推进：`sources` 是当前帧的权威活动源（已含 active 标记），
   * `frozen` 时所有相位固定（不发射新粒子，场景侧用固定时间一次预发射）。
   */
  update(sources: readonly ActivitySource[], dt: number, time: number, faceSize: number, frozen: boolean): void {
    if (!this.settings.industry) return;
    if (frozen) return;
    const tileSize = this.scale();
    for (const source of sources) {
      if (source.kind === 'cargo' || source.kind === 'flight') continue;
      if (!source.active || !source.buildingId) continue;
      const type = buildingTypeOf(source);
      const offset = IndustryEmitters.offsetFor(type);
      if (!offset) continue;
      const profile = IndustryEmitters.profileFor(source.kind, type);
      if (!profile) continue;
      const key = source.id;
      let state = this.states.get(key);
      if (!state) {
        state = { lastPhase: 0, seed: hashString(key) };
        this.states.set(key, state);
      }
      const interval = INDUSTRY_INTERVAL / Math.max(0.1, profile.rate / 3.2);
      const phase = time / interval;
      if (phase - state.lastPhase < 1) continue;
      state.lastPhase = phase;
      const seed = state.seed + Math.floor(time * 1000);
      const normal = source.normal ?? surfaceNormalOf(source, faceSize);
      const base = new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(this.radius + tileSize * offset.y);
      // 格内偏移：用源位置的法线附近的切向近似（场景侧只给法线/位置，偏移在小尺度上足够）。
      const [t1, t2] = tangentBasis(normal);
      base.addScaledVector(t1, offset.x * tileSize).addScaledVector(t2, offset.z * tileSize);
      for (const [index, style] of profile.styles.entries()) {
        const jitter = rand(seed, index) * 0.6 + 0.7;
        const burst: ParticleBurst = {
          position: base,
          normal: new THREE.Vector3(normal.x, normal.y, normal.z),
          velocity: new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(style.speed * tileSize),
          count: Math.max(1, Math.round(style.count * jitter)),
          life: style.life,
          scale: style.scale,
          spread: 0.7,
          seed: seed + index * 131,
          tint: style.tint,
        };
        this.particles.emit(style.style, burst);
      }
    }
    // 清掉已消失的设备（暂停/拆除/枯竭）：状态表不能无限增长。
    if (this.states.size > sources.length) {
      const live = new Set(sources.map((source) => source.id));
      for (const key of this.states.keys()) if (!live.has(key)) this.states.delete(key);
    }
  }

  /** 当前登记的发射器数量（测试/诊断）。 */
  get activeEmitters(): number { return this.states.size; }
}

/** 场景侧给活动源带上建筑类型（`collectActivity` 的 source 没有类型字段，id 里带 buildingId）。 */
const buildingTypes = new Map<string, string>();
export function registerBuildingType(buildingId: string, type: string): void {
  buildingTypes.set(buildingId, type);
}
function buildingTypeOf(source: ActivitySource): string {
  return buildingTypes.get(source.buildingId ?? '') ?? '';
}

/** 无 normal 的源（cargo/flight 以外基本都有）：用位置方向。 */
function surfaceNormalOf(source: ActivitySource, _faceSize: number): { x: number; y: number; z: number } {
  void _faceSize;
  return { x: source.position.x, y: 0, z: source.position.y };
}

function tangentBasis(normal: { x: number; y: number; z: number }): [THREE.Vector3, THREE.Vector3] {
  const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  const helper = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(n, helper).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  return [t1, t2];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** 确定性发射相位（冻结时用：给定活动源与时间窗，返回 [0,1) 的固定相位）。 */
export function emitterPhase(seed: number, time: number, interval: number): number {
  const raw = (time / interval + rand(seed, 0) * 7) % 1;
  return smoothstep(0, 1, raw);
}
