/**
 * 游戏音效挂接层（战斗侧）：App 级 hook 订阅战斗事件总线，把瞬时战斗事件
 * 映射为程序化音效。
 *
 * 挂载一次（AppShell）：StrictMode 双挂载会先 cleanup 再挂，任何时候只有
 * 一个活跃订阅；同帧批量事件由 engine/audio 的限流器合并。
 */

import { useEffect } from 'react';

import { sfx } from '@/engine/audio';
import { subscribeBattleEvents, type BattleEvent } from '@/engine/battle-events';

/**
 * 战斗事件 → 音效映射（纯函数，便于测试）：
 * - missile_salvo_fired → 发射音
 * - point_defense_intercept → 拦截咔哒
 * - battle_report_generated → 爆炸（report.target_destroyed 时大爆炸）
 * - entity_destroyed → 大爆炸
 * - damage_applied → 不映射（击毁演出已由战报承担，避免同帧叠音）
 */
export function playBattleEventAudio(event: BattleEvent): void {
  switch (event.type) {
    case 'missile_salvo_fired':
      sfx.fire();
      break;
    case 'point_defense_intercept':
      sfx.intercept();
      break;
    case 'battle_report_generated': {
      const report = event.payload.report as { target_destroyed?: boolean } | undefined;
      sfx.explosion(report?.target_destroyed === true);
      break;
    }
    case 'entity_destroyed':
      sfx.explosion(true);
      break;
    default:
      break;
  }
}

/** App 级游戏音效 hook：订阅战斗事件总线，卸载时退订。 */
export function useGameAudio(): void {
  useEffect(() => subscribeBattleEvents(playBattleEventAudio), []);
}
