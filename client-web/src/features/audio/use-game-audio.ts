/**
 * 游戏音效挂接层（战斗侧）：App 级 hook 订阅战斗事件总线，把瞬时战斗事件
 * 映射为音效。
 *
 * 挂载一次（AppShell）：StrictMode 双挂载会先 cleanup 再挂，任何时候只有
 * 一个活跃订阅；同帧批量事件由 engine/audio 的限流器合并。
 *
 * 空间化（第 23 轮）：事件带格坐标时按距画面中心的球面距离衰减、按屏幕 x 声相；
 * 服务端事件缺坐标（damage_applied / salvo 只有实体 id）时，从场景快照里按 id
 * 反查位置（resolveTile 由 AppShell 注入，读当前行星场景缓存）。
 */

import { useEffect } from 'react';

import { sfx } from '@/engine/audio';
import { payloadTile, subscribeBattleEvents, type BattleEvent } from '@/engine/battle-events';
import { fireSoundForTurret } from '@/features/audio/ambient-music';
import {
  battleAttackerId,
  battleTargetId,
  getBattleEntityIndex,
  resolveEntityTile,
  resolveEntityType,
} from '@/features/audio/battle-context';
import { OFFSCREEN_SPATIAL, spatialForTile, type TilePoint } from '@/features/audio/spatial';

/**
 * 事件里能拿到的格坐标：总线锚点（emitBattleEvent 从 payload 提取）→ payload 原样
 * → 由 resolveTile 按实体 id 反查。服务端 damage_applied / salvo 只带实体 id，
 * 后两条兜底是它们的路径；都查不到时按「画面外」（−12 dB、无声相）播放。
 */
function eventTile(event: BattleEvent, resolveTile: (id: string | undefined) => TilePoint | null): TilePoint | null {
  if (event.tile) return event.tile;
  const fromPayload = payloadTile(event.payload.position)
    ?? payloadTile(event.payload.target_pos)
    ?? payloadTile(event.payload.from);
  if (fromPayload) return fromPayload;
  // 攻击方优先，其次目标（damage_applied 两侧都可能是画面内实体）。
  return resolveTile(battleAttackerId(event)) ?? resolveTile(battleTargetId(event));
}

/**
 * 战斗事件 → 音效映射（纯函数，便于测试）：
 * - missile_salvo_fired → 导弹开火（发射音）
 * - point_defense_intercept → 拦截咔哒
 * - battle_report_generated → 爆炸（report.target_destroyed 时大爆炸）
 * - entity_destroyed → 大爆炸
 * - damage_applied → 开火音（按攻击方炮塔类型）+ 命中；己方开火与敌方开火都响
 *   （音效是玩家自己的战场感知，和受袭 toast 不同）
 */
export function playBattleEventAudio(
  event: BattleEvent,
  resolveTile?: (id: string | undefined) => TilePoint | null,
  resolveType?: (id: string | undefined) => string | undefined,
): void {
  const tile = eventTile(event, resolveTile ?? resolveTileHook);
  // 有坐标按距离/声相；反查不到（实体不在相机窗口）按画面外 −12 dB、无声相。
  const spatial = spatialForTile(tile) ?? OFFSCREEN_SPATIAL;
  switch (event.type) {
    case 'missile_salvo_fired':
      sfx.fireMissile(spatial);
      break;
    case 'point_defense_intercept':
      sfx.intercept(spatial);
      break;
    case 'battle_report_generated': {
      const report = event.payload.report as { target_destroyed?: boolean } | undefined;
      sfx.explosion(report?.target_destroyed === true, spatial);
      break;
    }
    case 'entity_destroyed':
      sfx.explosion(true, spatial);
      break;
    case 'damage_applied': {
      // 开火音按攻击方炮塔类型（总线字段 → payload → 场景反查）；黑雾/舰队用通用开火音。
      const attackerType = event.attackerType
        ?? (typeof event.payload.attacker_type === 'string' ? event.payload.attacker_type : undefined)
        ?? (resolveType ?? resolveTypeHook)(battleAttackerId(event));
      const fire = fireSoundForTurret(attackerType);
      sfx[fire](spatial);
      sfx.hit(spatial);
      break;
    }
    default:
      break;
  }
}

/** 场景反查钩子：AppShell 注入（当前行星场景快照里的实体位置/类型）。 */
let resolveTileHook: (id: string | undefined) => TilePoint | null = (id) => resolveEntityTile(id, getBattleEntityIndex());
let resolveTypeHook: (id: string | undefined) => string | undefined = (id) => resolveEntityType(id, getBattleEntityIndex());

export function setBattleAudioResolvers(hooks: {
  tile?: (id: string | undefined) => TilePoint | null;
  type?: (id: string | undefined) => string | undefined;
}) {
  if (hooks.tile) resolveTileHook = hooks.tile;
  if (hooks.type) resolveTypeHook = hooks.type;
}

export function resetBattleAudioResolversForTests() {
  resolveTileHook = (id) => resolveEntityTile(id, getBattleEntityIndex());
  resolveTypeHook = (id) => resolveEntityType(id, getBattleEntityIndex());
}

/** App 级游戏音效 hook：订阅战斗事件总线，卸载时退订。 */
export function useGameAudio(): void {
  useEffect(() => subscribeBattleEvents((event) => playBattleEventAudio(event, resolveTileHook, resolveTypeHook)), []);
}
