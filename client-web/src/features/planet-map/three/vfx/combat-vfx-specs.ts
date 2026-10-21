/**
 * 战斗演出指令（C2 扩展，3A 画质 vfx 分支）。
 *
 * 纯函数：BattleEvent + 实体解析 → 特效指令列表（位置已由场景侧解析成 world 组局部坐标）。
 * 与 `combat-effects.ts` 的 `specsFromCombatEvent` 同口径：**事件来源与上限不变**，
 * 这里只负责把同一批事件展开成粒子/贴花/光照层的发射参数。
 *
 * 新增的事件口径（不虚构、不改服务端）：
 * - damage_applied：枪口焰 + 曳光 + 命中火花 + 地面焦痕 + 护盾菲涅尔气泡；
 * - entity_destroyed：火球 + 烟 + 碎片 + 冲击波 + 闪光 + 残骸冒烟。
 */

import type { BattleEvent } from '@/engine/battle-events';

import type { FireTone, HitTone, Vec3Like } from '../combat-effects';
import { rand, randSigned } from './common';
import { PARTICLE_STYLES, type ParticleStyle } from './particles';

export type CombatPointLike = Vec3Like & { owner: 'own' | 'enemy' | 'darkfog'; kind: 'building' | 'unit' };

/** 枪口/曳光配色（与 `FIRE_TONE_COLORS` 同源，换成线性 RGB 供粒子用）。 */
export const FIRE_TINTS: Record<FireTone, [number, number, number]> = {
  unit: [0.55, 0.94, 1],
  defense: [1, 0.83, 0.49],
  darkfog: [1, 0.36, 0.36],
};

export const HIT_TINTS: Record<HitTone, [number, number, number]> = {
  own_hit: [1, 0.7, 0.33],
  enemy_hit: [1, 0.42, 0.42],
};

/** 一条粒子发射指令（场景侧把它交给 ParticleSystem）。 */
export interface VfxBurst {
  style: ParticleStyle;
  /** 发射点（world 组局部坐标，球面半径处）。 */
  at: Vec3Like;
  /** 表面法线（单位向量）。 */
  normal: Vec3Like;
  /** 速度（格/秒，沿法线与切向）。 */
  velocity: Vec3Like;
  count: number;
  life: number;
  scale: number;
  spread: number;
  seed: number;
  tint: [number, number, number];
}

/** 地面焦痕贴花（淡出）。 */
export interface VfxDecal { at: Vec3Like; normal: Vec3Like; size: number; life: number }

/** 点光源闪光（点光源池 ≤ 档位上限）。 */
export interface VfxLight { at: Vec3Like; color: number; intensity: number; life: number; distance: number }

/** 冲击波环（贴地网格环，扩开淡出）。 */
export interface VfxShockwave { at: Vec3Like; normal: Vec3Like; size: number; life: number }

/** 曳光条（拉伸 billboard，从 from 到 to）。 */
export interface VfxTracer { from: Vec3Like; to: Vec3Like; color: number; life: number; width: number }

export interface CombatVfxSpecs {
  bursts: VfxBurst[];
  decals: VfxDecal[];
  lights: VfxLight[];
  shockwaves: VfxShockwave[];
  tracers: VfxTracer[];
}

const EMPTY: CombatVfxSpecs = { bursts: [], decals: [], lights: [], shockwaves: [], tracers: [] };

function normalOf(point: Vec3Like): { x: number; y: number; z: number } {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

function add(a: Vec3Like, n: Vec3Like, amount: number): Vec3Like {
  return { x: a.x + n.x * amount, y: a.y + n.y * amount, z: a.z + n.z * amount };
}

/** 切向基（与法线正交的两个单位向量）。 */
function tangentBasis(normal: Vec3Like): [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] {
  const { x: nx, y: ny, z: nz } = normal;
  const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = Math.abs(nx) < 0.9 ? 0 : 1;
  let tx = ny * 0 - nz * ay, ty = nz * ax - nx * 0, tz = nx * ay - ny * ax;
  const length = Math.hypot(tx, ty, tz) || 1;
  tx /= length; ty /= length; tz /= length;
  const ux = ny * tz - nz * ty, uy = nz * tx - nx * tz, uz = nx * ty - ny * tx;
  return [{ x: tx, y: ty, z: tz }, { x: ux, y: uy, z: uz }];
}

/**
 * damage_applied → 枪口焰、曳光、命中火花、焦痕、护盾气泡。
 * 目标解析不到时不演出（与 `specsFromCombatEvent` 同一前置条件）。
 */
export function combatVfxFromEvent(
  event: BattleEvent,
  resolve: (id: string | undefined | null) => CombatPointLike | null,
): CombatVfxSpecs {
  const { payload } = event;
  if (event.type !== 'damage_applied' && event.type !== 'entity_destroyed') return EMPTY;
  const targetId = typeof payload.target_id === 'string' ? payload.target_id
    : typeof payload.entity_id === 'string' ? payload.entity_id : undefined;
  const target = resolve(targetId);
  if (!target) return EMPTY;
  const seed = event.seq * 7919 + (targetId ? targetId.length * 31 : 0);
  const normal = normalOf(target);

  if (event.type === 'damage_applied') {
    const specs: CombatVfxSpecs = { bursts: [], decals: [], lights: [], shockwaves: [], tracers: [] };
    const attacker = resolve(typeof payload.attacker_id === 'string' ? payload.attacker_id : undefined);
    const attackerType = typeof payload.attacker_type === 'string' ? payload.attacker_type : undefined;
    const tone: FireTone = attacker?.owner === 'darkfog' ? 'darkfog'
      : attacker && (attacker.kind === 'building' || attackerType === 'turret' || attackerType === 'defense' || attackerType === 'defense_tower') ? 'defense'
        : 'unit';
    const tint = FIRE_TINTS[tone];
    if (attacker) {
      const muzzleNormal = normalOf(attacker);
      const [, muzzleSide] = tangentBasis(muzzleNormal);
      // 枪口焰：短命火花团，沿朝向目标的切向喷出。
      specs.bursts.push({
        style: PARTICLE_STYLES.spark,
        at: add(attacker, muzzleNormal, 0.06),
        normal: muzzleNormal,
        velocity: { x: muzzleSide.x * 1.6, y: muzzleSide.y * 1.6, z: muzzleSide.z * 1.6 },
        count: 4, life: 0.16, scale: 0.9, spread: 1.4, seed, tint,
      });
      specs.bursts.push({
        style: PARTICLE_STYLES.flash,
        at: add(attacker, muzzleNormal, 0.08),
        normal: muzzleNormal,
        velocity: { x: 0, y: 0, z: 0 },
        count: 1, life: 0.1, scale: 0.7, spread: 0, seed: seed + 1, tint,
      });
      specs.lights.push({ at: add(attacker, muzzleNormal, 0.25), color: tone === 'darkfog' ? 0xff4a4a : tone === 'defense' ? 0xffd37c : 0x8befff, intensity: 9, life: 0.12, distance: 3.2 });
      // 曳光：枪口 → 命中点（弯曲弹道的直线近似，长度即两点距离）。
      specs.tracers.push({
        from: add(attacker, muzzleNormal, 0.1), to: add(target, normal, 0.1),
        color: tone === 'darkfog' ? 0xff5d5d : tone === 'defense' ? 0xffd37c : 0x8befff,
        life: 0.22, width: 0.05,
      });
    }
    // 命中火花：沿目标法线喷出，向四周飞散。
    specs.bursts.push({
      style: PARTICLE_STYLES.spark,
      at: add(target, normal, 0.08),
      normal,
      velocity: { x: normal.x * 2.4, y: normal.y * 2.4, z: normal.z * 2.4 },
      count: 6, life: 0.32, scale: 1, spread: 2.2, seed: seed + 2, tint: HIT_TINTS[target.owner === 'own' ? 'own_hit' : 'enemy_hit'],
    });
    specs.bursts.push({
      style: PARTICLE_STYLES.smoke,
      at: add(target, normal, 0.1),
      normal,
      velocity: { x: normal.x * 0.5, y: normal.y * 0.5, z: normal.z * 0.5 },
      count: 2, life: 0.7, scale: 0.55, spread: 0.8, seed: seed + 3, tint: [0.5, 0.5, 0.5],
    });
    // 地面焦痕：只落在建筑/单位脚下的地面（命中点即表面点）。
    specs.decals.push({ at: add(target, normal, 0.005), normal, size: 0.42, life: 2.6 });
    const shieldAbsorbed = typeof payload.shield_absorbed === 'number' ? payload.shield_absorbed : 0;
    if (shieldAbsorbed > 0) {
      // 护盾：菲涅尔气泡的视觉由 shader 网格负责（scene 侧），这里给一层青色能量散点。
      specs.bursts.push({
        style: PARTICLE_STYLES.holo,
        at: add(target, normal, 0.32),
        normal,
        velocity: { x: normal.x * 0.4, y: normal.y * 0.4, z: normal.z * 0.4 },
        count: 10, life: 0.5, scale: 1.1, spread: 2.6, seed: seed + 4, tint: [0.4, 0.9, 1],
      });
    }
    return specs;
  }

  // entity_destroyed：火球 + 烟 + 碎片 + 冲击波 + 闪光 + 残骸冒烟。
  const scale = target.kind === 'building' ? 1.6 : 1;
  const specs: CombatVfxSpecs = { bursts: [], decals: [], lights: [], shockwaves: [], tracers: [] };
  specs.bursts.push({
    style: PARTICLE_STYLES.fire, at: add(target, normal, 0.12), normal,
    velocity: { x: normal.x * 0.5, y: normal.y * 0.5, z: normal.z * 0.5 },
    count: Math.round(44 * scale), life: 0.9, scale: scale, spread: 2.4, seed, tint: [1, 1, 1],
  });
  specs.bursts.push({
    style: PARTICLE_STYLES.smoke, at: add(target, normal, 0.2), normal,
    velocity: { x: normal.x * 0.4, y: normal.y * 0.4, z: normal.z * 0.4 },
    count: Math.round(20 * scale), life: 2.4, scale: scale, spread: 1.3, seed: seed + 1, tint: [0.72, 0.72, 0.72],
  });
  specs.bursts.push({
    style: PARTICLE_STYLES.debris, at: add(target, normal, 0.16), normal,
    velocity: { x: normal.x * 1.5, y: normal.y * 1.5, z: normal.z * 1.5 },
    count: Math.round(12 * scale), life: 1.2, scale: scale * 1.6, spread: 4.0, seed: seed + 2, tint: [1, 1, 1],
  });
  // 中心闪光只留一点：爆炸的层次靠火球/烟/碎片，一个大白球会把它们全糊掉。
  specs.bursts.push({
    style: PARTICLE_STYLES.flash, at: add(target, normal, 0.12), normal,
    velocity: { x: 0, y: 0, z: 0 },
    count: 1, life: 0.12, scale: 0.55 * scale, spread: 0, seed: seed + 3, tint: [1, 0.9, 0.7],
  });
  specs.shockwaves.push({ at: add(target, normal, 0.04), normal, size: 2.6 * scale, life: 0.55 });
  specs.lights.push({ at: add(target, normal, 0.6), color: 0xffb066, intensity: 26 * scale, life: 0.28, distance: 6 * scale });
  specs.decals.push({ at: add(target, normal, 0.004), normal, size: 1.1 * scale, life: 6 });
  return specs;
}

/** 残骸冒烟：随时间衰减的烟（残骸存在期间周期性发射）。 */
export function wreckSmoke(at: Vec3Like, normal: Vec3Like, seed: number, age: number): VfxBurst | null {
  if (age > 4.2) return null;
  const fade = 1 - age / 4.2;
  return {
    style: PARTICLE_STYLES.smoke,
    at: add(at, normal, 0.18), normal,
    velocity: { x: normal.x * 0.45, y: normal.y * 0.45, z: normal.z * 0.45 },
    count: 2, life: 1.4 + fade, scale: 0.7 + (1 - fade) * 0.6, spread: 0.5,
    seed: seed + Math.floor(age * 10), tint: [0.4, 0.4, 0.4],
  };
}

/** 确定性抖动（单位方向的小扰动，供枪口/命中点使用）。 */
export function jitterDirection(normal: Vec3Like, seed: number, amount: number): Vec3Like {
  const [t1, t2] = tangentBasis(normal);
  const a = randSigned(seed, 11) * amount, b = randSigned(seed, 12) * amount;
  const x = normal.x + t1.x * a + t2.x * b, y = normal.y + t1.y * a + t2.y * b, z = normal.z + t1.z * a + t2.z * b;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/** 随机方向（供测试核对确定性）。 */
export function deterministicSample(seed: number): number {
  return rand(seed, 3);
}
