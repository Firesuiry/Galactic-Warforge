export type TurnIntent = 'reply_only' | 'observe' | 'game_mutation' | 'agent_management';

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyTurnIntent(history: Array<{ role: string; content: string }>): TurnIntent {
  const latestUserMessage = [...history]
    .reverse()
    .find((entry) => entry.role === 'user')
    ?.content
    .toLowerCase() ?? '';

  if (!latestUserMessage) {
    return 'reply_only';
  }

  if (includesAny(latestUserMessage, [
    'agent.create',
    'agent.update',
    'conversation.ensure_dm',
    'conversation.send_message',
    'delegate',
    'dispatch',
    'create agent',
    'update agent',
    '委派',
    '拉人',
    '创建智能体',
    '更新智能体',
    '频道',
  ])) {
    return 'agent_management';
  }

  if (includesAny(latestUserMessage, [
    'build',
    'construct',
    'research',
    'start research',
    'transfer',
    'load',
    'switch',
    'set ray receiver',
    'set ',
    'launch',
    '建造',
    '研究',
    '装料',
    '切换',
    '设置',
    '发射',
  ])) {
    return 'game_mutation';
  }

  if (includesAny(latestUserMessage, [
    'scan',
    'inspect',
    'observe',
    'check',
    'status',
    'situation',
    'overview',
    '查看',
    '观察',
    '检查',
    '扫描',
    '状态',
    '局势',
  ])) {
    return 'observe';
  }

  return 'reply_only';
}
