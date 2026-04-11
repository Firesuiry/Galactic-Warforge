import type { CanonicalAgentAction } from './action-schema.js';
import type { TurnIntent } from './turn-intent.js';

export interface TurnCompletionCheck {
  complete: boolean;
  needsCloseoutRepair: boolean;
  reason?: 'missing_final_delivery' | 'still_planning';
}

function normalizeText(text: string) {
  return text.trim().toLowerCase();
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function isObserveCloseoutIncomplete(text: string) {
  return includesAny(text, [
    '待结果返回',
    '稍后',
    '再总结',
    '之后总结',
    '待扫描结果',
    '已提交扫描请求',
    '扫描请求',
    'will summarize later',
    'once the result returns',
    'wait for the result',
  ]);
}

function isMutationCloseoutIncomplete(text: string) {
  return includesAny(text, [
    '待结果返回',
    '稍后',
    '之后',
    '再告诉你',
    '已提交',
    '先执行',
    '我现在去',
    'i will',
    'submitted',
    'will report back',
  ]);
}

function isAgentManagementCloseoutIncomplete(text: string) {
  return includesAny(text, [
    '我现在创建',
    '我会创建',
    '我来创建',
    '正在创建',
    '开始创建',
    '待创建结果',
    '稍后告知',
    '稍后同步',
    'create the agent',
    'creating the agent',
    'will create',
  ]);
}

function hasRequiredExecutedAction(intent: TurnIntent, executedActions: CanonicalAgentAction[]) {
  switch (intent) {
    case 'observe':
      return executedActions.some((action) => action.type === 'game.command');
    case 'game_mutation':
      return executedActions.some((action) => action.type === 'game.command');
    case 'agent_management':
      return executedActions.some((action) => (
        action.type === 'agent.create'
        || action.type === 'agent.update'
        || action.type === 'conversation.ensure_dm'
        || action.type === 'conversation.send_message'
      ));
    case 'reply_only':
    default:
      return true;
  }
}

export function checkTurnCompletion(input: {
  intent: TurnIntent;
  finalMessage: string;
  executedActions: CanonicalAgentAction[];
}): TurnCompletionCheck {
  if (input.intent === 'reply_only') {
    return {
      complete: input.finalMessage.trim() !== '',
      needsCloseoutRepair: input.finalMessage.trim() === '',
      reason: input.finalMessage.trim() === '' ? 'missing_final_delivery' : undefined,
    };
  }

  if (!hasRequiredExecutedAction(input.intent, input.executedActions)) {
    return {
      complete: false,
      needsCloseoutRepair: false,
    };
  }

  const normalizedMessage = normalizeText(input.finalMessage);
  if (!normalizedMessage) {
    return {
      complete: false,
      needsCloseoutRepair: true,
      reason: 'missing_final_delivery',
    };
  }

  const stillPlanning = input.intent === 'observe'
    ? isObserveCloseoutIncomplete(normalizedMessage)
    : input.intent === 'agent_management'
      ? isAgentManagementCloseoutIncomplete(normalizedMessage)
      : isMutationCloseoutIncomplete(normalizedMessage);

  if (stillPlanning) {
    return {
      complete: false,
      needsCloseoutRepair: true,
      reason: 'still_planning',
    };
  }

  return {
    complete: true,
    needsCloseoutRepair: false,
  };
}

export function buildCloseoutRepairPrompt(
  intent: TurnIntent,
  reason: TurnCompletionCheck['reason'],
) {
  const common = reason === 'missing_final_delivery'
    ? '你已经拿到工具执行结果。现在请只输出最终结论，不要漏掉用户要的结果交付。'
    : '你已经拿到工具执行结果。现在请只输出最终结论，不要再回复“已提交”“待结果返回”“稍后总结”这类中间态句子。';

  switch (intent) {
    case 'observe':
      return `${common} 如果信息已经足够，请直接给用户一句话总结当前观察结果。`;
    case 'agent_management':
      return `${common} 如果成员已创建或委派已完成，请直接说明创建/委派结果，不要再写“我现在创建”或“我会去做”。`;
    case 'game_mutation':
      return `${common} 如果动作已经执行，请直接说明执行结果或当前阻塞原因。`;
    default:
      return common;
  }
}
