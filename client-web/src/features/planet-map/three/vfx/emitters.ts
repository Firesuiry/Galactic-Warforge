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

import { surfaceOffset } from '@shared/surface';
import type { ActivitySource } from '../industrial-activity';
import { tileFrame, tileNormal } from '../projection';
import { rand, smoothstep, type VfxQualitySettings } from './common';
import { PARTICLE_STYLES, type ParticleBurst, type ParticleStyle, type ParticleSystem } from './particles';

/**
 * 局部发射口：x/z 为格内偏移（格），y 为离地高度（**世界单位**）。
 * 建筑模型按占地归一化，3×3 熔炉实测高 1.35 世界单位；用「格」当高度（×0.386）
 * 会把发射口埋进模型内部，粒子全被自身挡住（vfx 分支实测「熔炉不冒烟」就是这个）。
 */
export interface EmitterOffset { x: number; y: number; z: number }

/** 类型 → 发射口偏移表（按 `collectActivity` 的 kind 分组）。 */
export const EMITTER_OFFSETS: Record<string, EmitterOffset> = {
  // 发射口在模型顶面（世界单位；实测 3×3 熔炉模型顶面离地约 0.64）。
  arc_smelter: { x: 0, y: 0.64, z: 0 },
  plane_smelter: { x: 0, y: 0.62, z: 0 },
  smelter: { x: 0, y: 0.62, z: 0 },
  // 火电：烟囱在顶部。
  thermal_power_plant: { x: 0.1, y: 0.85, z: -0.1 },
  mini_fusion_power_plant: { x: 0, y: 0.7, z: -0.1 },
  // 化工 / 炼油：塔顶白色蒸汽。
  chemical_plant: { x: 0, y: 0.8, z: 0 },
  oil_refinery: { x: 0.1, y: 0.85, z: -0.05 },
  // 采矿机：钻头下方扬尘（贴地）。
  mining_machine: { x: 0, y: 0.18, z: 0.1 },
  advanced_mining_machine: { x: 0, y: 0.22, z: 0.1 },
  // 装配台：焊接点在顶面偏前侧。
  assembling_machine_mk1: { x: 0.2, y: 0.52, z: 0.2 },
  assembling_machine_mk2: { x: 0.2, y: 0.52, z: 0.2 },
  assembling_machine_mk3: { x: 0.2, y: 0.52, z: 0.2 },
  // 研究站：全息塔顶。
  matrix_lab: { x: 0, y: 0.6, z: 0 },
  research_station: { x: 0, y: 0.6, z: 0 },
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
  // 尺寸按「远景也要读得出在运转」定：industry-overview 机位（高度约 10 格）下
  // 一格 ≈ 12 px，烟团要 1–2 格宽才看得见（0.55 格的基础烟 × 2.6 ≈ 1.4 格）。
  heat: profile(
    { style: PARTICLE_STYLES.fire, count: 4, life: 0.5, scale: 2.0, speed: 1.1, tint: [1, 1, 1] },
    { style: PARTICLE_STYLES.spark, count: 3, life: 0.6, scale: 1.6, speed: 2.0, tint: [1, 0.9, 0.7] },
    { style: PARTICLE_STYLES.smoke, count: 2, life: 1.8, scale: 2.6, speed: 0.55, tint: [0.62, 0.62, 0.62] },
  ),
  // 发电：烟柱。
  energy: profile(
    { style: PARTICLE_STYLES.smoke, count: 3, life: 2.6, scale: 2.8, speed: 0.8, tint: [0.72, 0.74, 0.76] },
  ),
  // 采矿：尘土 + 碎屑。
  mining: profile(
    { style: PARTICLE_STYLES.dust, count: 3, life: 1.1, scale: 2.2, speed: 0.45, tint: [1, 1, 1] },
    { style: PARTICLE_STYLES.debris, count: 2, life: 0.5, scale: 1.4, speed: 1.2, tint: [1, 1, 1] },
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

/** 冻结预发射补的轮数（稳态截面的长度 ≈ PRIME_ROUNDS × interval）。 */
export const PRIME_ROUNDS = 6;

/** 单帧最多补发的窗口数（掉帧/暂停恢复时防止一次写几千个粒子）。 */
export const MAX_CATCHUP_WINDOWS = 4;

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
  /**
   * 冻结模式下的预发射：画面停在「正在运转」的固定相位。
   * 存的是已预发射的**活动源签名**（不是 bool）——场景构造时数据还没到，第一帧 `sources` 为空；
   * 用 bool 会把「空集合」当成已预发射，之后数据到了也永远不发射（夹具里熔炉不冒烟）。
   */
  private primed = '';
  private readonly scale: () => number;
  private readonly radius: number;

  constructor(
    private readonly particles: ParticleSystem,
    private readonly settings: VfxQualitySettings,
    scale: () => number,
    radius: number,
    /** 格 → 场景 world 组局部单位法线（与建筑模型同一套投影）。 */
    private readonly normalOf: (tile: { x: number; y: number }) => THREE.Vector3 = (tile) => tileNormal(tile, 1),
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
        return profile({ style: PARTICLE_STYLES.steam, count: 3, life: 2.0, scale: 2.4, speed: 0.7, tint: [1, 1, 1] });
      }
      return INDUSTRY_PROFILES.heat;
    }
    if (kind === 'energy') return INDUSTRY_PROFILES.energy;
    if (kind === 'mining') return INDUSTRY_PROFILES.mining;
    if (ASSEMBLER_TYPES.test(buildingType)) {
      return { rate: 1.1, styles: [{ style: PARTICLE_STYLES.weld, count: 3, life: 0.45, scale: 1.6, speed: 1.4, tint: [1, 1, 1] }] };
    }
    if (RESEARCH_TYPES.test(buildingType)) {
      return { rate: 1.4, styles: [{ style: PARTICLE_STYLES.holo, count: 2, life: 1.6, scale: 1.8, speed: 0.5, tint: [1, 1, 1] }] };
    }
    return null;
  }

  /**
   * 逐帧推进：`sources` 是当前帧的权威活动源（已含 active 标记），
   * `frozen` 时所有相位固定（不发射新粒子，场景侧用固定时间一次预发射）。
   */
  update(sources: readonly ActivitySource[], dt: number, time: number, faceSize: number, frozen: boolean): void {
    if (!this.settings.industry) return;
    if (frozen) {
      // 冻结：每个活动源集合只预发射一次（确定性相位），让夹具截图能看到「在运转」的烟/火；
      // 之后不再发射，画面保持静止。集合变化（数据晚到 / 运行状态变化）时按新集合再预发射一次。
      const signature = sources.map((source) => source.id).join('|');
      if (signature !== this.primed) {
        this.primed = signature;
        this.emitFor(sources, time, faceSize, 1.0);
      }
      return;
    }
    this.primed = '';
    const tileSize = this.scale();
    for (const source of sources) {
      const profile = this.profileOf(source);
      if (!profile) continue;
      const key = source.id;
      let state = this.states.get(key);
      if (!state) {
        state = { lastPhase: 0, seed: hashString(key) };
        this.states.set(key, state);
      }
      const interval = INDUSTRY_INTERVAL / Math.max(0.1, profile.rate / 3.2);
      const phase = time / interval;
      // 窗口不是 1：慢刷新/掉帧时 `phase - lastPhase` 可能是 7.3，按窗口逐轮补发，
      // 且单帧补发上限（防暂停后恢复时一次写几千个）。旧写法 `lastPhase = phase` 会丢掉
      // 中间窗口，但相位对齐没问题——真正的坑在冻结预发射之外：`time` 从 0 起跳时
      // `lastPhase = 0` 会让第一次发射晚一个窗口，这里统一从「上一个窗口」开始。
      const windows = Math.floor(phase - state.lastPhase);
      if (windows < 1) continue;
      state.lastPhase += Math.min(windows, MAX_CATCHUP_WINDOWS);
      this.emitSource(source, profile, state.seed + Math.floor(time * 1000), faceSize, tileSize);
    }
    // 清掉已消失的设备（暂停/拆除/枯竭）：状态表不能无限增长。
    if (this.states.size > sources.length) {
      const live = new Set(sources.map((source) => source.id));
      for (const key of this.states.keys()) if (!live.has(key)) this.states.delete(key);
    }
  }

  /**
   * 一次性的冻结预发射：按发射间隔往回补 `PRIME_ROUNDS` 轮（相位确定）。
   * 只补一轮的话画面上只有 6 个粒子，看不出「稳定运转」；补几轮才是烟柱的稳态截面，
   * 且发射时刻固定 → 冻结截图逐帧一致。
   */
  private emitFor(sources: readonly ActivitySource[], time: number, faceSize: number, factor: number): void {
    const tileSize = this.scale();
    for (const source of sources) {
      const profile = this.profileOf(source);
      if (!profile) continue;
      if (!this.states.has(source.id)) this.states.set(source.id, { lastPhase: 0, seed: hashString(source.id) });
      const interval = INDUSTRY_INTERVAL / Math.max(0.1, profile.rate / 3.2);
      for (let round = 0; round < PRIME_ROUNDS; round++) {
        const at = time - round * interval;
        if (at <= 0) break;
        this.emitSource(source, profile, hashString(source.id) + round * 7919, faceSize, tileSize * factor, at);
      }
    }
  }

  /** 某个活动源的发射口与样式（类型未登记 / 无表现时返回 null）。 */
  private profileOf(source: ActivitySource): IndustryProfile | null {
    if (source.kind === 'cargo' || source.kind === 'flight') return null;
    if (!source.active || !source.buildingId) return null;
    const type = buildingTypeOf(source);
    if (!IndustryEmitters.offsetFor(type)) return null;
    return IndustryEmitters.profileFor(source.kind, type);
  }

  private emitSource(source: ActivitySource, profile: IndustryProfile, seed: number, faceSize: number, tileSize: number, at?: number): void {
    const type = buildingTypeOf(source);
    const offset = IndustryEmitters.offsetFor(type);
    if (!offset) return;
    // 发射点必须落在**该建筑所占格**上：活动源给的是锚点格，多格建筑的炉口在占地中心，
    // 直接用锚点法线会把烟柱甩到隔壁格（vfx 分支实测）。
    const footprint = buildingFootprints.get(source.buildingId ?? '');
    const center = footprint && (footprint.width > 1 || footprint.height > 1)
      ? surfaceOffset(source.position, (footprint.width - 1) / 2, (footprint.height - 1) / 2, faceSize)
      : source.position;
    // 发射口的世界坐标必须用**场景的 `normal(x, y)`**（含局部曲面/图集偏移），
    // 不能用 `tileNormal` 的原始球面法线——后者与场景里模型的位置差几格，
    // 烟柱会飘到建筑旁边（vfx 分支实测）。
    // 高度是世界单位：直接加在球半径上（乘格宽会把发射口压回模型里）。
    const base = this.normalOf(center).clone().multiplyScalar(this.radius + offset.y);
    // 格内偏移：用该格的东西/南向基底（不是任意切向），建筑的「正面」才是 +Z 方向。
    const { east, south } = tileFrame(center, faceSize);
    base.addScaledVector(east, offset.x * tileSize).addScaledVector(south, offset.z * tileSize);
    const normal = base.clone().normalize();
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
      this.particles.emit(style.style, burst, at);
    }
  }

  /** 当前登记的发射器数量（测试/诊断）。 */
  get activeEmitters(): number { return this.states.size; }

}

/** 场景侧给活动源带上建筑类型与占地（`collectActivity` 的 source 不带这两项）。 */
const buildingTypes = new Map<string, string>();
const buildingFootprints = new Map<string, { width: number; height: number }>();
export function registerBuildingType(buildingId: string, type: string, footprint?: { width: number; height: number }): void {
  buildingTypes.set(buildingId, type);
  if (footprint) buildingFootprints.set(buildingId, footprint);
}
function buildingTypeOf(source: ActivitySource): string {
  return buildingTypes.get(source.buildingId ?? '') ?? '';
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
