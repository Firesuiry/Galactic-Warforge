/**
 * 环境声床 + 动态配乐状态机（第 23 轮 3A 音频分支）。
 *
 * 纯函数只负责「画面状态 → 想要的声音」：
 * - 声床：行星贴地 = 风（随高度减弱）+ 基地机械嗡鸣（随运行中建筑数线性增强，上限 −18 dB）；
 *   中空 = 只剩风；全球视角 / 恒星系页 = 轨道低频。
 * - 配乐：三档——探索/建设（calm）、紧张（黑雾被激怒 / 威胁等级高 / 敌军逼近）、
 *   交战（最近 10s 有己方参与的战斗事件）。交战结束 15s 后回落。
 *
 * 实际播放/交叉淡化在 engine/audio.ts（setAmbient / setMusic），这里只管状态与电平。
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

export interface AmbientState {
  name: AmbientName | null;
  /** 线性电平（0..1），已含各层叠加上限。 */
  level: number;
}

/** 风的最高电平（贴地满档）。 */
const WIND_MAX_LEVEL = 1;
/** 中空及以上风的残留比例（只留一层底噪）。 */
const WIND_HIGH_ALTITUDE_LEVEL = 0.35;
/** 基地嗡鸣上限：−18 dB。 */
export const FACTORY_MAX_DB = -18;
/** 嗡鸣满档对应的运行中建筑数。 */
export const FACTORY_FULL_BUILDINGS = 40;

/** 高度 → 风电平系数（贴地 1 → 高度 60 起 0.35）。 */
export function windLevelForAltitude(altitude: number): number {
  const t = Math.max(0, Math.min(1, altitude / 60));
  return WIND_MAX_LEVEL * (1 - t) + WIND_HIGH_ALTITUDE_LEVEL * t;
}

/** 运行中建筑数 → 嗡鸣电平（0 → −∞，40 → −18 dB，线性 dB）。 */
export function factoryLevelForBuildings(runningBuildings: number): number {
  if (runningBuildings <= 0) return 0;
  const t = Math.min(1, runningBuildings / FACTORY_FULL_BUILDINGS);
  const db = FACTORY_MAX_DB * t;
  return 10 ** (db / 20);
}

/**
 * 画面状态 → 声床。
 * - 恒星系页 / 行星全球视角：轨道低频（space），电平 1；
 * - 行星贴地 / 中空：风（电平随高度）+ 嗡鸣（按运行建筑数）。
 *   风与嗡鸣共用 ambient 总线（两条采样不能同时挂在同一个 name 上），
 *   所以这里按「谁更响」选主导声，电平取两者较大值——契约要求的是「随状态变化」，
 *   听感上贴地时风与机械此起彼伏，不出现两条声床互打架。
 */
export function resolveAmbient(input: AmbientInput): AmbientState {
  if (input.page === 'system') return { name: 'space', level: 1 };
  if (input.page === 'other') return { name: null, level: 0 };
  if (input.altitude > 190) return { name: 'space', level: 1 };
  // 风垫底、机械叠上去：两条采样挂同一个 ambient 总线会互相打架，所以取「更响的那条」
  // 当主导声（机械明显起来时切到 factory），电平取两者较大值。
  const wind = windLevelForAltitude(input.altitude);
  const factory = factoryLevelForBuildings(input.runningBuildings);
  const mixLevel = Math.max(wind, factory);
  if (factory > wind * 1.2) return { name: 'factory', level: mixLevel };
  return { name: 'wind', level: mixLevel };
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
