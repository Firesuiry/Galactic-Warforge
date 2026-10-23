/**
 * 战斗音效的实体反查上下文（第 23 轮 3A 音频，第二轮）。
 *
 * 服务端的 damage_applied / missile_salvo_fired / point_defense_intercept 只带实体 id，
 * 没有格坐标也没有 owner：音效要空间化、配乐要判断「己方参与」，都得回到当前行星
 * 的建筑/单位里按 id 反查。行星页每来一帧窗口数据就把索引换掉（这里只存纯数据，
 * 不持有 React 状态），AppShell 注入的 resolver 与音频场景 hook 都读同一份。
 *
 * 索引只覆盖**相机窗口内**的实体（/scene 的返回范围）：查不到的实体按「画面外」处理，
 * 不去猜坐标（猜错会让爆炸声出现在屏幕错误的一侧）。
 */

import type { BattleEvent } from '@/engine/battle-events';
import { getBuildingList, getUnitList, type PlanetRenderView } from '@/features/planet-map/model';
import type { TilePoint } from '@/features/audio/spatial';

export interface BattleEntityRef {
  ownerId: string;
  /** 建筑类型 / 单位类型（damage_applied 没带 attacker_type 时按炮塔区分开火音）。 */
  type: string;
  tile: TilePoint;
}

export type BattleEntityIndex = ReadonlyMap<string, BattleEntityRef>;

const EMPTY_INDEX: BattleEntityIndex = new Map();

/** 行星窗口数据 → id 索引（建筑与单位合并；单位同 id 覆盖建筑，实际不会重名）。 */
export function buildBattleEntityIndex(planet: PlanetRenderView | undefined): BattleEntityIndex {
  if (!planet) return EMPTY_INDEX;
  const index = new Map<string, BattleEntityRef>();
  for (const building of getBuildingList(planet)) {
    index.set(building.id, {
      ownerId: building.owner_id,
      type: building.type,
      tile: { x: Math.round(building.position.x), y: Math.round(building.position.y) },
    });
  }
  for (const unit of getUnitList(planet)) {
    index.set(unit.id, {
      ownerId: unit.owner_id,
      type: unit.type,
      tile: { x: Math.round(unit.position.x), y: Math.round(unit.position.y) },
    });
  }
  return index;
}

/** 事件里的字符串字段（缺省 / 非字符串 → undefined）。 */
function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 攻击方实体 id（总线已提取，payload 原样兜底）。 */
export function battleAttackerId(event: BattleEvent): string | undefined {
  return event.attackerId ?? stringField(event.payload, 'attacker_id');
}

/** 目标实体 id（payload.target_id / entity_destroyed.entity_id）。 */
export function battleTargetId(event: BattleEvent): string | undefined {
  return stringField(event.payload, 'target_id') ?? stringField(event.payload, 'entity_id');
}

/** 按实体 id 反查格坐标；查不到返回 null（调用方按「画面外」处理）。 */
export function resolveEntityTile(id: string | undefined, index: BattleEntityIndex): TilePoint | null {
  if (!id) return null;
  return index.get(id)?.tile ?? null;
}

/** 按实体 id 反查类型（开火音按炮塔类型区分）。 */
export function resolveEntityType(id: string | undefined, index: BattleEntityIndex): string | undefined {
  if (!id) return undefined;
  return index.get(id)?.type;
}

/**
 * 战斗事件是否「己方参与」：
 * - payload 直接带 attacker_owner / target_owner（舰队战事件有）；
 * - 否则按 attacker_id / target_id 反查实体归属（行星战斗事件没有 owner 字段）；
 * - 再退回事件类型语义：己方舰队齐射（source ≠ enemy_force）与战报生成算己方参与。
 */
export function battleOwnInvolvement(
  event: BattleEvent,
  playerId: string,
  index: BattleEntityIndex,
): boolean {
  if (!playerId) return false;
  const attackerOwner = stringField(event.payload, 'attacker_owner');
  const targetOwner = stringField(event.payload, 'target_owner');
  if (attackerOwner === playerId || targetOwner === playerId) return true;
  const attacker = index.get(battleAttackerId(event) ?? '');
  const target = index.get(battleTargetId(event) ?? '');
  if (attacker?.ownerId === playerId || target?.ownerId === playerId) return true;
  if (event.type === 'missile_salvo_fired' && event.payload.source !== 'enemy_force') return true;
  return event.type === 'battle_report_generated';
}

// ---------- 模块级「当前行星索引」（行星页挂载时写入，卸载清空） ----------

let currentIndex: BattleEntityIndex = EMPTY_INDEX;

export function setBattleEntityIndex(index: BattleEntityIndex | null) {
  currentIndex = index ?? EMPTY_INDEX;
}

export function getBattleEntityIndex(): BattleEntityIndex {
  return currentIndex;
}

/** 测试用：清空当前索引。 */
export function resetBattleEntityIndexForTests() {
  currentIndex = EMPTY_INDEX;
}
