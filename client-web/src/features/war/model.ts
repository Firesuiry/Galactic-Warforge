import type { GameEventDetail } from '@shared/types';

/**
 * 战争工作台 SSE 事件 → 失效哪些 react-query 的判定 helper。
 *
 * 设计原则：
 * - command_result 按 payload.command_type 精细化失效（避免无关查询空转）
 * - 战场瞬时事件（战报/制空权/导弹/点防）一律打 system-runtime
 * - 其余战争事件按语义广覆盖
 *
 * 与 use-war-realtime 的 WarInvalidationFlags 一一对应。
 */

function commandTypeOf(event: GameEventDetail): string {
  const value = event.payload?.command_type;
  return typeof value === 'string' ? value : '';
}

function isCommandEvent(event: GameEventDetail, prefixes: string[]) {
  if (event.event_type !== 'command_result') {
    return false;
  }
  const commandType = commandTypeOf(event);
  return prefixes.some((prefix) => commandType === prefix || commandType.startsWith(`${prefix}_`));
}

export function shouldRefreshWarSummary(event: GameEventDetail) {
  return event.event_type === 'tick_completed' || event.event_type === 'victory_declared';
}

export function shouldRefreshWarBlueprints(event: GameEventDetail) {
  return isCommandEvent(event, ['blueprint']);
}

export function shouldRefreshWarIndustry(event: GameEventDetail) {
  if ([
    'squad_deployed',
    'fleet_commissioned',
    'fleet_disbanded',
    'supply_line_disrupted',
    'building_state_changed',
  ].includes(event.event_type)) {
    return true;
  }
  return isCommandEvent(event, ['queue_military_production', 'refit_unit', 'deploy_squad', 'commission_fleet']);
}

export function shouldRefreshWarTaskForces(event: GameEventDetail) {
  if ([
    'fleet_commissioned',
    'fleet_disbanded',
    'fleet_assigned',
    'fleet_attack_started',
    'landing_started',
    'landing_failed',
    'supply_line_disrupted',
  ].includes(event.event_type)) {
    return true;
  }
  return isCommandEvent(event, ['task_force', 'fleet']);
}

export function shouldRefreshWarTheaters(event: GameEventDetail) {
  return isCommandEvent(event, ['theater']);
}

export function shouldRefreshWarFleets(event: GameEventDetail) {
  if ([
    'fleet_commissioned',
    'fleet_disbanded',
    'fleet_assigned',
    'fleet_attack_started',
    'entity_created',
    'entity_destroyed',
    'entity_updated',
  ].includes(event.event_type)) {
    return true;
  }
  return isCommandEvent(event, ['fleet', 'commission_fleet']);
}

export function shouldRefreshWarSystemRuntime(event: GameEventDetail) {
  if ([
    'battle_report_generated',
    'orbital_superiority_changed',
    'missile_salvo_fired',
    'point_defense_intercept',
    'fleet_commissioned',
    'fleet_disbanded',
    'fleet_assigned',
    'fleet_attack_started',
    'landing_started',
    'landing_failed',
    'supply_line_disrupted',
    'damage_applied',
    'entity_destroyed',
  ].includes(event.event_type)) {
    return true;
  }
  return isCommandEvent(event, [
    'blockade_planet',
    'landing_start',
    'commission_fleet',
    'fleet',
    'task_force_deploy',
  ]);
}
