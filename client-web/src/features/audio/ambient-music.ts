/**
 * 环境声床 + 动态配乐状态机（第 23 轮 3A 音频分支）。
 *
 * 纯函数只负责「画面状态 → 想要的声音」：
 * - 声床：行星贴地 = 风（随高度减弱）+ 基地机械嗡鸣（随运行中建筑数线性增强，上限 −18 dB）
 *   两路同时播放；中空以上风淡出、轨道低频淡入；全球视角 / 恒星系页 = 只剩轨道低频。
 * - 配乐：三档——探索/建设（calm）、紧张（黑雾被激怒 / 威胁等级高 / 敌军逼近）、
 *   交战（最近 10s 有己方参与的战斗事件）。交战结束 15s 后回落。
 *
 * 实际播放/交叉淡化在 engine/audio.ts（setAmbientLayers / setMusic），这里只管状态与电平。
 */

import type { AmbientName, MusicName } from '@/engine/audio';

export type AudioPage = 'planet' | 'system' | 'other';

export interface AmbientInput {
  page: AudioPage;
  /** 行星页相机高度（其它页面忽略）。 */
  altitude: number;
  /** 载入区域里运行中的建筑数。 */
  runningBuildings: number;
}

export interface AmbientLayer {
  name: AmbientName;
  /** 线性电平（0..1），已含交叉淡化与各层上限。 */
  level: number;
}

export interface AmbientState {
  /** 同时播放的声床层：贴地是风 + 基地嗡鸣两路，中空起叠上轨道低频。 */
  layers: AmbientLayer[];
}

/** 风的最高电平（贴地满档）。 */
const WIND_MAX_LEVEL = 1;
/** 中空及以上风的残留比例（只留一层底噪）。 */
const WIND_HIGH_ALTITUDE_LEVEL = 0.35;
/** 基地嗡鸣上限：−18 dB。 */
export const FACTORY_MAX_DB = -18;
/** 嗡鸣满档对应的运行中建筑数。 */
export const FACTORY_FULL_BUILDINGS = 40;
/** 风 → 轨道低频交叉淡化的起点高度（中空偏上）。 */
export const SPACE_CROSSFADE_START_ALTITUDE = 120;
/** 完全进入轨道声床的高度（与 globalView 阈值同口径）。 */
export const SPACE_VIEW_ALTITUDE = 190;

/** 高度 → 风电平系数（贴地 1 → 高度 60 起 0.35；不含与轨道声床的交叉淡化）。 */
export function windLevelForAltitude(altitude: number): number {
  const t = Math.max(0, Math.min(1, altitude / 60));
  return WIND_MAX_LEVEL * (1 - t) + WIND_HIGH_ALTITUDE_LEVEL * t;
}

/** 高度 → 轨道低频电平（120 以下 0，190 起 1，线性交叉淡化）。 */
export function spaceLevelForAltitude(altitude: number): number {
  if (altitude <= SPACE_CROSSFADE_START_ALTITUDE) return 0;
  const t = (altitude - SPACE_CROSSFADE_START_ALTITUDE) / (SPACE_VIEW_ALTITUDE - SPACE_CROSSFADE_START_ALTITUDE);
  return Math.min(1, Math.max(0, t));
}

/** 运行中建筑数 → 嗡鸣电平（0 → −∞，40 → −18 dB，线性 dB）。 */
export function factoryLevelForBuildings(runningBuildings: number): number {
  if (runningBuildings <= 0) return 0;
  const t = Math.min(1, runningBuildings / FACTORY_FULL_BUILDINGS);
  const db = FACTORY_MAX_DB * t;
  return 10 ** (db / 20);
}

/**
 * 画面状态 → 声床层（可同时多层，引擎里各自一路 GainNode）：
 * - 恒星系页：只有轨道低频；
 * - 行星贴地 / 中空：风（电平随高度减弱）+ 基地嗡鸣（随运行中建筑数线性增强，
 *   上限 −18 dB）两路同时播放，各自增益；
 * - 高度 120–190 之间：风线性淡出、轨道低频线性淡入（交叉淡化）；
 * - 其它页：静默（空数组）。
 */
export function resolveAmbient(input: AmbientInput): AmbientState {
  if (input.page === 'system') return { layers: [{ name: 'space', level: 1 }] };
  if (input.page === 'other') return { layers: [] };
  const space = spaceLevelForAltitude(input.altitude);
  if (space >= 1) return { layers: [{ name: 'space', level: 1 }] };
  const layers: AmbientLayer[] = [];
  const wind = windLevelForAltitude(input.altitude) * (1 - space);
  if (wind > 0) layers.push({ name: 'wind', level: wind });
  const factory = factoryLevelForBuildings(input.runningBuildings);
  if (factory > 0) layers.push({ name: 'factory', level: factory });
  if (space > 0) layers.push({ name: 'space', level: space });
  return { layers };
}

/** 配乐状态输入。 */
export interface MusicInput {
  /** 黑雾被激怒（dark_fog_provoked 后处于敌对期）。 */
  darkFogHostile: boolean;
  /** 行星威胁等级（PlanetRuntimeView.threat_level）。 */
  threatLevel: number;
  /** 最近一次己方参与的战斗事件时间（ms，performance 时基；无则 null）。 */
  lastCombatAt: number | null;
  /** 当前时间（ms，performance 时基）。 */
  now: number;
}

/** 交战状态保持窗口：最近 10s 内有己方战斗。 */
export const COMBAT_WINDOW_MS = 10_000;
/** 交战结束 → 回落的延迟。 */
export const COMBAT_FALLOFF_MS = 15_000;
/** 威胁等级进入「紧张」的阈值。 */
export const TENSE_THREAT_LEVEL = 3;

/**
 * 配乐状态机（纯函数）：
 * - 最近 10s 有战斗 → combat；
 * - 战斗结束后 15s 内仍保持 combat（回落延迟），之后按紧张度回落；
 * - 紧张：黑雾敌对 / 威胁等级 ≥ 3；
 * - 否则 calm。
 */
export function resolveMusic(input: MusicInput): MusicName {
  const sinceCombat = input.lastCombatAt === null ? Infinity : input.now - input.lastCombatAt;
  if (sinceCombat <= COMBAT_WINDOW_MS + COMBAT_FALLOFF_MS) return 'combat';
  if (input.darkFogHostile || input.threatLevel >= TENSE_THREAT_LEVEL) return 'tense';
  return 'calm';
}

/** 音效名 → 炮塔建筑类型（开火音按炮塔区分）。 */
export function fireSoundForTurret(buildingType: string | undefined): 'fireGauss' | 'fireLaser' | 'fireMissile' | 'firePlasma' | 'fireGeneric' {
  if (!buildingType) return 'fireGeneric';
  if (buildingType.includes('gauss') || buildingType.includes('rail')) return 'fireGauss';
  if (buildingType.includes('laser')) return 'fireLaser';
  if (buildingType.includes('missile') || buildingType.includes('artillery')) return 'fireMissile';
  if (buildingType.includes('plasma') || buildingType.includes('implosion')) return 'firePlasma';
  return 'fireGeneric';
}
