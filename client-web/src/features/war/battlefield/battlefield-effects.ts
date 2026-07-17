/**
 * 太空战特效纯逻辑：特效对象池 + 战斗事件 → 特效指令映射。
 *
 * 不依赖 Pixi：池只管理特效生命周期（spawn/advance/done/槽位复用），
 * 渲染绑定在 battlefield-scene。server 是 tick 粒度，这里做"事件触发的演出"：
 * 事件到达即 spawn 一次性特效，ticker 里 advance 推进，完成后由场景回收视图。
 */

import type { BattleEvent } from '@/engine/battle-events';
import type { SpaceBattleReport } from '@shared/types';

import type { BattlefieldPoint } from '@/features/war/battlefield/battlefield-model';

/** 各特效默认生命周期（ms）。 */
export const MISSILE_FLIGHT_MS = 500;
export const EXPLOSION_MS = 700;
export const EXPLOSION_BIG_MS = 1100;
export const INTERCEPT_FLASH_MS = 320;
export const DAMAGE_FLOAT_MS = 900;

export interface MissileEffectSpec {
  kind: 'missile';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs?: number;
}

export interface ExplosionEffectSpec {
  kind: 'explosion';
  x: number;
  y: number;
  /** 击毁级大爆炸：更大半径/更多火花/更久。 */
  big?: boolean;
  /** 自定义扩散半径（默认 big ? 46 : 26；导弹命中闪光用更小值）。 */
  radius?: number;
  durationMs?: number;
}

export interface InterceptFlashEffectSpec {
  kind: 'intercept_flash';
  x: number;
  y: number;
  durationMs?: number;
}

export interface DamageFloatEffectSpec {
  kind: 'damage_float';
  x: number;
  y: number;
  text: string;
  durationMs?: number;
}

export type BattleEffectSpec =
  | MissileEffectSpec
  | ExplosionEffectSpec
  | InterceptFlashEffectSpec
  | DamageFloatEffectSpec;

export type BattleEffectKind = BattleEffectSpec['kind'];

export interface BattleEffect {
  /** 池内自增 id（复用槽位时 id 不复用）。 */
  id: number;
  spec: BattleEffectSpec;
  elapsedMs: number;
  durationMs: number;
  /** [0,1] 线性进度。 */
  progress: number;
  done: boolean;
}

function defaultDuration(spec: BattleEffectSpec): number {
  switch (spec.kind) {
    case 'missile':
      return MISSILE_FLIGHT_MS;
    case 'explosion':
      return spec.big ? EXPLOSION_BIG_MS : EXPLOSION_MS;
    case 'intercept_flash':
      return INTERCEPT_FLASH_MS;
    case 'damage_float':
      return DAMAGE_FLOAT_MS;
  }
}

/**
 * 特效对象池：active 列表 + 已完成槽位复用（free 列表里的 effect 对象
 * 在下次 spawn 时被覆盖重用，避免高频事件下持续分配）。
 */
export class BattleEffectPool {
  private activeEffects: BattleEffect[] = [];
  private freeEffects: BattleEffect[] = [];
  private nextId = 1;

  spawn(spec: BattleEffectSpec): BattleEffect {
    const durationMs = Math.max(spec.durationMs ?? defaultDuration(spec), 1);
    const slot = this.freeEffects.pop();
    if (slot) {
      slot.id = this.nextId;
      slot.spec = spec;
      slot.elapsedMs = 0;
      slot.durationMs = durationMs;
      slot.progress = 0;
      slot.done = false;
      this.nextId += 1;
      this.activeEffects.push(slot);
      return slot;
    }
    const effect: BattleEffect = {
      id: this.nextId,
      spec,
      elapsedMs: 0,
      durationMs,
      progress: 0,
      done: false,
    };
    this.nextId += 1;
    this.activeEffects.push(effect);
    return effect;
  }

  /**
   * 推进所有存活特效；返回本帧刚完成的特效（场景据此回收视图/
   * 触发二级演出，如导弹命中的小爆炸）。完成槽位移入 free 列表。
   */
  advance(dtMs: number): BattleEffect[] {
    const completed: BattleEffect[] = [];
    const step = Math.max(dtMs, 0);
    const survivors: BattleEffect[] = [];
    this.activeEffects.forEach((effect) => {
      if (effect.done) {
        this.freeEffects.push(effect);
        return;
      }
      effect.elapsedMs += step;
      effect.progress = Math.min(effect.elapsedMs / effect.durationMs, 1);
      if (effect.elapsedMs >= effect.durationMs) {
        effect.done = true;
        completed.push(effect);
        this.freeEffects.push(effect);
        return;
      }
      survivors.push(effect);
    });
    this.activeEffects = survivors;
    return completed;
  }

  active(): readonly BattleEffect[] {
    return this.activeEffects;
  }

  clear(): void {
    this.freeEffects.push(...this.activeEffects);
    this.activeEffects = [];
  }
}

/** 事件 → 特效的位置解析上下文（由场景用当前标记布局实现）。 */
export interface BattleEffectContext {
  resolve(entityId: string | undefined | null): BattlefieldPoint | null;
  /** 敌方齐射的发射方不在 payload 里：给 (x, y) 附近最近的敌对阵营参考点。 */
  nearestHostile(x: number, y: number): BattlefieldPoint | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asReport(value: unknown): SpaceBattleReport | null {
  if (value && typeof value === 'object') {
    return value as SpaceBattleReport;
  }
  return null;
}

/**
 * 把一条战斗事件映射为一组特效指令；无法定位（相关标记不在图上）时返回空数组。
 *
 * - missile_salvo_fired：发射舰队 → 目标的导弹轨迹；source=enemy_force 时
 *   方向反过来（最近敌方标记 → 被打舰队）。
 * - point_defense_intercept：被保护目标处的拦截闪光。
 * - battle_report_generated：目标处爆炸 + 伤害飘字；target_destroyed 时大爆炸。
 * - damage_applied / entity_destroyed：不映射视觉特效（击毁演出已由
 *   battle_report_generated.target_destroyed 承担，避免同帧重复演出）。
 */
export function specsFromBattleEvent(
  event: BattleEvent,
  context: BattleEffectContext,
): BattleEffectSpec[] {
  const { payload } = event;

  if (event.type === 'missile_salvo_fired') {
    const fleetId = asString(payload.fleet_id);
    if (payload.source === 'enemy_force') {
      const target = context.resolve(fleetId);
      if (!target) {
        return [];
      }
      const from = context.nearestHostile(target.x, target.y);
      if (!from) {
        return [];
      }
      return [{ kind: 'missile', fromX: from.x, fromY: from.y, toX: target.x, toY: target.y }];
    }
    const from = context.resolve(fleetId);
    const to = context.resolve(asString(payload.target_id));
    if (!from || !to) {
      return [];
    }
    return [{ kind: 'missile', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }];
  }

  if (event.type === 'point_defense_intercept') {
    const position = context.resolve(asString(payload.target_id))
      ?? context.resolve(asString(payload.fleet_id));
    if (!position) {
      return [];
    }
    return [{ kind: 'intercept_flash', x: position.x, y: position.y }];
  }

  if (event.type === 'battle_report_generated') {
    const report = asReport(payload.report);
    if (!report) {
      return [];
    }
    const target = context.resolve(report.target_id);
    if (!target) {
      return [];
    }
    const specs: BattleEffectSpec[] = [
      { kind: 'explosion', x: target.x, y: target.y, big: report.target_destroyed === true },
    ];
    const damage = report.target_strength_loss ?? 0;
    if (damage > 0) {
      specs.push({ kind: 'damage_float', x: target.x, y: target.y - 12, text: `-${damage}` });
    }
    return specs;
  }

  return [];
}
