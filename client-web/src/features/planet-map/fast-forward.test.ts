import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEBUG_PANEL_HOTKEY_LABEL,
  buildAdvanceRequest,
  defaultAdvanceForm,
  describeAdvanceResult,
  humanPlayerCount,
  isAdminPlayer,
  translateAdvanceStoppedReason,
  type AdvanceFormState,
} from './fast-forward';
import type { AdvanceResponse } from '@shared/types';
import type { GameSummary } from '@shared/game';

function form(overrides: Partial<AdvanceFormState> = {}): AdvanceFormState {
  return { ...defaultAdvanceForm(), ...overrides };
}

function gameWith(players: GameSummary['players']): GameSummary {
  return {
    map_seed: 'seed',
    enemy_difficulty: 'off',
    victory_mode: 'sandbox',
    max_tick_rate: 10,
    active_planet_id: 'planet-1-1',
    tick: 100,
    started_at: '2026-10-14T00:00:00Z',
    origin: 'new',
    players,
    victory: { declared: false },
  };
}

describe('advance 表单默认值与载荷', () => {
  it('默认：按 tick 数推进 500 tick，三个停止条件全开', () => {
    const defaults = defaultAdvanceForm();
    expect(defaults.mode).toBe('ticks');
    expect(defaults.ticks).toBe('500');
    expect(defaults.stopOn).toEqual({ gameOver: true, underAttack: true, criticalAlert: true });
  });

  it('面板标题里的快捷键是 Ctrl+Shift+D', () => {
    expect(DEBUG_PANEL_HOTKEY_LABEL).toBe('Ctrl+Shift+D');
  });

  it('ticks 形态发 ticks，停止条件默认 true', () => {
    const built = buildAdvanceRequest(form(), 120);
    expect(built).toEqual({
      request: {
        ticks: 500,
        stop_on: { game_over: true, under_attack: true, critical_alert: true },
      },
    });
  });

  it('to_tick 形态发 to_tick，取消勾选的停止条件发 false', () => {
    const built = buildAdvanceRequest(form({
      mode: 'to_tick',
      toTick: '900',
      stopOn: { gameOver: false, underAttack: true, criticalAlert: false },
    }), 120);
    expect(built).toEqual({
      request: {
        to_tick: 900,
        stop_on: { game_over: false, under_attack: true, critical_alert: false },
      },
    });
  });

  it('校验：tick 数必须是正整数，目标 tick 必须大于当前 tick', () => {
    expect(buildAdvanceRequest(form({ ticks: '' }), 0)).toEqual({ error: 'tick 数必须是正整数' });
    expect(buildAdvanceRequest(form({ ticks: '0' }), 0)).toEqual({ error: 'tick 数必须是正整数' });
    expect(buildAdvanceRequest(form({ ticks: '12abc' }), 0)).toEqual({ error: 'tick 数必须是正整数' });
    expect(buildAdvanceRequest(form({ mode: 'to_tick', toTick: '120' }), 120)).toEqual({
      error: '目标 tick 必须是大于当前 tick（120）的整数',
    });
    expect(buildAdvanceRequest(form({ mode: 'to_tick', toTick: '121' }), 120)).toEqual({
      request: {
        to_tick: 121,
        stop_on: { game_over: true, under_attack: true, critical_alert: true },
      },
    });
  });
});

describe('advance 结果文案', () => {
  it('把 stopped_reason 翻译成中文并给出「停在 tick X」', () => {
    const result: AdvanceResponse = {
      start_tick: 100,
      end_tick: 612,
      stopped_reason: 'under_attack',
      detail: '我方目标 u-1 在 tick 612 受到伤害',
      elapsed_ms: 500,
      ticks_per_sec: 1200,
    };
    expect(describeAdvanceResult(result)).toBe('停在 tick 612（我方受袭）');
    expect(translateAdvanceStoppedReason('critical_alert')).toBe('关键警报');
    expect(translateAdvanceStoppedReason('weird')).toBe('weird');
  });
});

describe('admin 身份与多人门禁提示', () => {
  it('role=admin 才允许快进；bot 不计入人类玩家数', () => {
    const game = gameWith([
      { player_id: 'p1', role: 'commander', team_id: 'p1', is_alive: true },
      { player_id: 'p2', role: 'admin', team_id: 'p2', is_alive: true, bot: 'easy' },
    ]);
    expect(isAdminPlayer(game, 'p2')).toBe(true);
    expect(isAdminPlayer(game, 'p1')).toBe(false);
    expect(isAdminPlayer(game, 'p9')).toBe(false);
    expect(isAdminPlayer(undefined, 'p1')).toBe(false);
    expect(humanPlayerCount(game)).toBe(1);
  });
});
