import type { CanonicalAgentAction, CanonicalAgentTurn } from './action-schema.js';
import { isObserveGameCommandAction } from './game-command-schema.js';
import type { TurnIntent } from './turn-intent.js';

export type TurnOutcomeKind = 'reply_only' | 'observed' | 'acted' | 'delegated' | 'blocked';

export interface TurnValidationResult {
  valid: boolean;
  needsRepair: boolean;
  errorCode?: 'provider_incomplete_execution';
  errorMessage?: string;
}

function isDelegationAction(action: CanonicalAgentAction) {
  return (
    action.type === 'agent.create'
    || action.type === 'agent.update'
    || action.type === 'conversation.ensure_dm'
    || action.type === 'conversation.send_message'
  );
}

function isMutationGameCommand(action: CanonicalAgentAction) {
  return action.type === 'game.command' && !isObserveGameCommandAction(action);
}

function hasIntentRequiredAction(intent: TurnIntent, actions: CanonicalAgentAction[]) {
  switch (intent) {
    case 'reply_only':
      return true;
    case 'observe':
      return actions.some((action) => action.type === 'game.command' && isObserveGameCommandAction(action));
    case 'game_mutation':
      return actions.some(isMutationGameCommand);
    case 'agent_management':
      return actions.some(isDelegationAction);
    default:
      return false;
  }
}

export function buildRepairPrompt(intent: TurnIntent) {
  switch (intent) {
    case 'observe':
      return '上一轮只有规划，没有执行观察动作。请至少返回 1 条 observe 类 game.command（scan_galaxy / scan_system / scan_planet），不要只写计划句。';
    case 'game_mutation':
      return '上一轮只有规划，没有执行游戏变更动作。请至少返回 1 条非 observe 的 game.command，不要只写承诺句。';
    case 'agent_management':
      return '上一轮只有规划，没有执行委派或成员管理动作。请至少返回 1 条 agent/conversation 动作，不要只写计划句。';
    default:
      return '上一轮只有规划，没有执行所需动作。请返回真实动作，不要只写计划句。';
  }
}

export function validateTurnForIntent(
  turn: CanonicalAgentTurn,
  intent: TurnIntent,
  repairCount: number,
  executedActions: CanonicalAgentAction[] = [],
): TurnValidationResult {
  if (hasIntentRequiredAction(intent, executedActions)) {
    return { valid: true, needsRepair: false };
  }
  if (hasIntentRequiredAction(intent, turn.actions)) {
    return { valid: true, needsRepair: false };
  }
  if (intent === 'reply_only') {
    return { valid: true, needsRepair: false };
  }
  if (repairCount < 1) {
    return { valid: false, needsRepair: true };
  }
  return {
    valid: false,
    needsRepair: false,
    errorCode: 'provider_incomplete_execution',
    errorMessage: 'provider_incomplete_execution: 这轮只有规划，没有执行所需动作',
  };
}

export function resolveTurnOutcomeKind(
  executedActions: CanonicalAgentAction[],
  blocked = false,
): TurnOutcomeKind {
  if (blocked) {
    return 'blocked';
  }
  if (executedActions.some(isMutationGameCommand)) {
    return 'acted';
  }
  if (executedActions.some(isDelegationAction)) {
    return 'delegated';
  }
  if (executedActions.some((action) => action.type === 'game.command' && isObserveGameCommandAction(action))) {
    return 'observed';
  }
  return 'reply_only';
}

export function countsAsExecutedAction(action: CanonicalAgentAction) {
  return action.type === 'game.command' || isDelegationAction(action);
}
