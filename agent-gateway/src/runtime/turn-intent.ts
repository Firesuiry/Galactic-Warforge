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

  const mentionsAgentCreation = (
    (latestUserMessage.includes('创建') || latestUserMessage.includes('新建') || latestUserMessage.includes('新增'))
    && (latestUserMessage.includes('智能体') || latestUserMessage.includes('成员') || latestUserMessage.includes('下级'))
  );
  const mentionsAgentPolicy = (
    latestUserMessage.includes('权限')
    || latestUserMessage.includes('可调度')
    || latestUserMessage.includes('managedagentids')
    || latestUserMessage.includes('supervisor')
  );

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
  ]) || mentionsAgentCreation || mentionsAgentPolicy) {
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
    'task force',
    'task_force',
    'theater',
    '战区',
    '巡逻',
    '护航',
    '补给',
    '封锁',
    '登陆',
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
    'contacts',
    'battle report',
    '侦察',
    '战报',
  ])) {
    return 'observe';
  }

  return 'reply_only';
}
