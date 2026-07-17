/**
 * 行星地图战斗特效纯逻辑：damage_applied 事件 → 特效指令映射 + 特效对象池。
 *
 * 不依赖 Pixi：池只管理特效生命周期（spawn/advance/done/槽位复用），
 * 渲染绑定在 planet-scene。模式与 battlefield-effects 一致，但坐标系/粒度
 * 按行星场景（tile 像素坐标、建筑/单位节点）独立实现，不与太空战共用池。
 */

import type { BattleEvent } from '@/engine/battle-events';

/** 各特效默认生命周期（ms）。 */
export const FIRE_FLASH_MS = 200;
export const PLANET_DAMAGE_FLOAT_MS = 800;
export const HIT_FLASH_MS = 150;

/** 开火闪光配色基调：防御塔类岔开（黄白），普通单位青白。 */
export type FireTone = 'unit' | 'defense';

/** 伤害飘字配色基调：敌方受击红色系，己方受击橙色系。 */
export type HitTone = 'enemy_hit' | 'own_hit';

export interface FireFlashEffectSpec {
  kind: 'fire_flash';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tone: FireTone;
  durationMs?: number;
}

export interface PlanetDamageFloatEffectSpec {
  kind: 'damage_float';
  x: number;
  y: number;
  text: string;
  tone: HitTone;
  durationMs?: number;
}

export interface HitFlashEffectSpec {
  kind: 'hit_flash';
  /** 受击节点 id：场景据此对节点做 alpha 脉冲（节点中途销毁则丢弃）。 */
  targetId: string;
  durationMs?: number;
}

export type PlanetEffectSpec =
  | FireFlashEffectSpec
  | PlanetDamageFloatEffectSpec
  | HitFlashEffectSpec;

export type PlanetEffectKind = PlanetEffectSpec['kind'];

export interface PlanetEffect {
  /** 池内自增 id（复用槽位时 id 不复用）。 */
  id: number;
  spec: PlanetEffectSpec;
  elapsedMs: number;
  durationMs: number;
  /** [0,1] 线性进度。 */
  progress: number;
  done: boolean;
}

function defaultDuration(spec: PlanetEffectSpec): number {
  switch (spec.kind) {
    case 'fire_flash':
      return FIRE_FLASH_MS;
    case 'damage_float':
      return PLANET_DAMAGE_FLOAT_MS;
    case 'hit_flash':
      return HIT_FLASH_MS;
  }
}

/**
 * 特效对象池：active 列表 + 已完成槽位复用（free 列表里的 effect 对象
 * 在下次 spawn 时被覆盖重用，避免高频事件下持续分配）。
 */
export class PlanetEffectPool {
  private activeEffects: PlanetEffect[] = [];
  private freeEffects: PlanetEffect[] = [];
  private nextId = 1;

  spawn(spec: PlanetEffectSpec): PlanetEffect {
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
    const effect: PlanetEffect = {
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
   * 恢复受击节点 alpha）。完成槽位移入 free 列表。
   */
  advance(dtMs: number): PlanetEffect[] {
    const completed: PlanetEffect[] = [];
    const step = Math.max(dtMs, 0);
    const survivors: PlanetEffect[] = [];
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

  active(): readonly PlanetEffect[] {
    return this.activeEffects;
  }

  clear(): void {
    this.freeEffects.push(...this.activeEffects);
    this.activeEffects = [];
  }
}

/** 事件 → 特效的位置解析上下文（由场景用当前实体节点树实现）。 */
export interface PlanetEffectContext {
  /**
   * 把实体 id 解析为场景世界坐标与归属/节点类型；
   * 解析不到（不在当前视口实体树里，如敌方兵力 marker）返回 null。
   */
  resolve(entityId: string | undefined | null): PlanetEffectPoint | null;
}

export interface PlanetEffectPoint {
  x: number;
  y: number;
  /** 相对当前玩家的归属：own=己方，enemy=非己方。 */
  owner: 'own' | 'enemy';
  /** 节点类型：建筑（防御塔等）或单位。 */
  kind: 'building' | 'unit';
}

/**
 * 显式声明防御塔类的 attacker_type（行星炮塔事件通常不带 attacker_type，
 * 此时由 resolve 出的节点类型兜底：建筑节点即防御塔配色）。
 */
const DEFENSE_ATTACKER_TYPES: ReadonlySet<string> = new Set([
  'turret',
  'defense',
  'defense_tower',
]);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 把一条战斗事件映射为一组行星特效指令；目标解析不到（不在图上）时返回空数组。
 *
 * 仅消费 damage_applied：
 * - 攻击方→目标一道开火闪光（attacker 解析不到时省略，其余演出不受影响）；
 * - 目标处 -{damage} 伤害飘字（damage 缺失/<=0 时省略）；
 * - 目标节点受击闪白（alpha 脉冲）。
 * entity_destroyed 不做演出：击毁由实体增量同步自然消失承担。
 */
export function specsFromPlanetBattleEvent(
  event: BattleEvent,
  context: PlanetEffectContext,
): PlanetEffectSpec[] {
  if (event.type !== 'damage_applied') {
    return [];
  }
  const { payload } = event;

  const target = context.resolve(asString(payload.target_id));
  if (!target) {
    return [];
  }

  const specs: PlanetEffectSpec[] = [];

  const attackerType = asString(payload.attacker_type);
  const attacker = context.resolve(asString(payload.attacker_id));
  if (attacker) {
    const defense = (attackerType !== undefined && DEFENSE_ATTACKER_TYPES.has(attackerType))
      || attacker.kind === 'building';
    specs.push({
      kind: 'fire_flash',
      fromX: attacker.x,
      fromY: attacker.y,
      toX: target.x,
      toY: target.y,
      tone: defense ? 'defense' : 'unit',
    });
  }

  const damage = asNumber(payload.damage);
  if (damage !== undefined && damage > 0) {
    specs.push({
      kind: 'damage_float',
      x: target.x,
      y: target.y - 10,
      text: `-${damage}`,
      tone: target.owner === 'own' ? 'own_hit' : 'enemy_hit',
    });
  }

  specs.push({ kind: 'hit_flash', targetId: asString(payload.target_id)! });
  return specs;
}
