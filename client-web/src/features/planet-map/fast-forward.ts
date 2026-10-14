/**
 * 狂飙模式 / 快进的展示层纯函数（无副作用，便于单测）。
 *
 * 表单 → 请求载荷的转换、停止原因中文化、结果文案都放这里；
 * 组件只负责渲染与调用 API。
 */

import type { AdvanceRequest, AdvanceResponse, AdvanceStoppedReason } from '@shared/types';
import type { GameSummary } from '@shared/game';

/** 面板标题里写明的快捷键（与 use-planet-rts-hotkeys 保持一致）。 */
export const DEBUG_PANEL_HOTKEY_LABEL = 'Ctrl+Shift+D';

export interface AdvanceStopOnForm {
  gameOver: boolean;
  underAttack: boolean;
  criticalAlert: boolean;
}

export type AdvanceTargetMode = 'ticks' | 'to_tick';

export interface AdvanceFormState {
  mode: AdvanceTargetMode;
  /** 文本而不是 number：输入框允许中间态（空串 / 正在输入），校验在提交时做。 */
  ticks: string;
  toTick: string;
  stopOn: AdvanceStopOnForm;
}

/** 默认表单：按 tick 数推进 500 tick，三个停止条件全开。 */
export function defaultAdvanceForm(): AdvanceFormState {
  return {
    mode: 'ticks',
    ticks: '500',
    toTick: '',
    stopOn: { gameOver: true, underAttack: true, criticalAlert: true },
  };
}

/**
 * 表单 → 请求载荷。返回 `{ request }` 或 `{ error }`（校验失败时给出中文原因）。
 * 停止条件三项默认 true，只有取消勾选才发 false。
 */
export function buildAdvanceRequest(
  form: AdvanceFormState,
  currentTick: number,
): { request: AdvanceRequest } | { error: string } {
  const request: AdvanceRequest = {
    stop_on: {
      game_over: form.stopOn.gameOver,
      under_attack: form.stopOn.underAttack,
      critical_alert: form.stopOn.criticalAlert,
    },
  };
  if (form.mode === 'ticks') {
    const ticks = Number.parseInt(form.ticks, 10);
    if (!Number.isFinite(ticks) || ticks <= 0 || String(ticks) !== form.ticks.trim()) {
      return { error: 'tick 数必须是正整数' };
    }
    request.ticks = ticks;
  } else {
    const toTick = Number.parseInt(form.toTick, 10);
    if (!Number.isFinite(toTick) || toTick <= currentTick || String(toTick) !== form.toTick.trim()) {
      return { error: `目标 tick 必须是大于当前 tick（${currentTick}）的整数` };
    }
    request.to_tick = toTick;
  }
  return { request };
}

const STOPPED_REASON_LABELS: Record<AdvanceStoppedReason, string> = {
  reached: '到达目标',
  game_over: '对局结束',
  under_attack: '我方受袭',
  critical_alert: '关键警报',
  cancelled: '已取消',
};

export function translateAdvanceStoppedReason(reason: string): string {
  return STOPPED_REASON_LABELS[reason as AdvanceStoppedReason] ?? reason;
}

/** 结果短文案：「停在 tick 612（我方受袭）」。 */
export function describeAdvanceResult(result: AdvanceResponse): string {
  return `停在 tick ${result.end_tick}（${translateAdvanceStoppedReason(result.stopped_reason)}）`;
}

/**
 * 当前操作者是否是 admin（决定快进控件可用）。
 * role 取自 GET /games/current 的 players[]，与大厅页同口径。
 */
export function isAdminPlayer(game: GameSummary | undefined, playerId: string): boolean {
  if (!game || !playerId) {
    return false;
  }
  return game.players.find((player) => player.player_id === playerId)?.role === 'admin';
}

/** 本局非 bot 玩家数（与大厅页显示口径一致）。 */
export function humanPlayerCount(game: GameSummary | undefined): number {
  if (!game) {
    return 0;
  }
  return game.players.filter((player) => !player.bot).length;
}
