import { createApiClient } from '../../../shared-client/src/api.js';
import type { SystemRuntimeView, WarTaskForceView, WarTheaterView } from '../../../shared-client/src/types.js';
import type { CanonicalAgentAction } from './action-schema.js';
import { summarizeGameCommandAction } from './game-command-executor.js';
import type { AgentInstance } from '../types.js';

const MILITARY_GAME_COMMANDS = new Set([
  'system_runtime',
  'war_industry',
  'task_forces',
  'theaters',
  'queue_military_production',
  'task_force_set_stance',
  'task_force_deploy',
  'blockade_planet',
  'landing_start',
]);

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function formatTaskForce(taskForce: WarTaskForceView) {
  const deployment = [
    taskForce.deployment?.system_id,
    taskForce.deployment?.planet_id,
  ].filter(Boolean).join('/');
  return [
    `${taskForce.id}:${taskForce.stance}`,
    taskForce.theater_id ? `theater=${taskForce.theater_id}` : '',
    deployment ? `deploy=${deployment}` : '',
    taskForce.supply_status?.condition ? `supply=${taskForce.supply_status.condition}` : '',
  ].filter(Boolean).join(' ');
}

function formatTheater(theater: WarTheaterView) {
  const zones = (theater.zones ?? [])
    .map((zone) => [zone.zone_type, zone.system_id, zone.planet_id].filter(Boolean).join('/'))
    .join(', ');
  const objective = theater.objective
    ? [theater.objective.objective_type, theater.objective.system_id, theater.objective.planet_id]
      .filter(Boolean)
      .join('/')
    : '';
  return [
    theater.id,
    zones ? `zones=${zones}` : '',
    objective ? `objective=${objective}` : '',
  ].filter(Boolean).join(' ');
}

function formatSystemRuntime(systemRuntime: SystemRuntimeView | null) {
  if (!systemRuntime) {
    return '';
  }
  const superiority = systemRuntime.orbital_superiority?.advantage_player_id
    ? `制轨=${systemRuntime.orbital_superiority.advantage_player_id}`
    : '制轨=未决';
  const contacts = `contacts=${systemRuntime.contacts?.length ?? 0}`;
  const blockades = `blockades=${systemRuntime.planet_blockades?.length ?? 0}`;
  const landings = `landings=${systemRuntime.landing_operations?.length ?? 0}`;
  const reports = `battle_reports=${systemRuntime.battle_reports?.length ?? 0}`;
  return [systemRuntime.system_id, superiority, contacts, blockades, landings, reports].join(' ');
}

function summarizeMilitaryReason(executedActions: CanonicalAgentAction[]) {
  const commands = executedActions
    .filter((action): action is Extract<CanonicalAgentAction, { type: 'game.command' }> => action.type === 'game.command')
    .map((action) => action.command);

  if (commands.includes('landing_start')) {
    return '为了趁当前战区窗口推进登陆准备并抢占桥头堡。';
  }
  if (commands.includes('blockade_planet')) {
    return '为了切断目标行星补给并建立轨道压制。';
  }
  if (commands.includes('queue_military_production')) {
    return '为了补齐委派战区的兵力和战备库存。';
  }
  if (commands.includes('task_force_set_stance') || commands.includes('task_force_deploy')) {
    return '为了让委派任务群回到指定战区并维持巡逻 / 护航节奏。';
  }
  if (commands.includes('system_runtime') || commands.includes('task_forces') || commands.includes('theaters')) {
    return '为了先确认战区 contacts、制轨、封锁和补给态势，再决定下一步动作。';
  }
  return '为了在委派权限范围内推进当前军事目标。';
}

function summarizeApproval(requestContent: string, agent: AgentInstance) {
  const request = requestContent.toLowerCase();
  const military = agent.policy?.military;
  if (!military) {
    return '是：当前 agent 没有军事委派 policy。';
  }
  if (
    includesAny(request, ['landing', '登陆'])
    && (!military.allowLanding || !military.allowedCommandIds.includes('landing_start'))
  ) {
    return '是：发起登陆仍需玩家额外批准。';
  }
  if (
    includesAny(request, ['blockade', '封锁'])
    && (!military.allowBlockade || !military.allowedCommandIds.includes('blockade_planet'))
  ) {
    return '是：发起封锁仍需玩家额外批准。';
  }
  if (
    includesAny(request, ['production', '量产', '排产'])
    && (!military.allowMilitaryProduction || !military.allowedCommandIds.includes('queue_military_production'))
  ) {
    return '是：军工量产仍需玩家额外批准。';
  }
  return '否：本轮动作都在已授予的军事权限边界内。';
}

async function loadMilitaryScope(agent: AgentInstance, playerKey: string) {
  const military = agent.policy?.military;
  if (!military || (military.theaterIds.length === 0 && military.taskForceIds.length === 0)) {
    return {
      theaters: [] as WarTheaterView[],
      taskForces: [] as WarTaskForceView[],
      systemRuntime: null as SystemRuntimeView | null,
    };
  }

  const api = createApiClient({
    serverUrl: agent.serverUrl,
    auth: {
      playerId: agent.playerId,
      playerKey,
    },
  });

  const [theaterList, taskForceList] = await Promise.all([
    api.fetchWarTheaters(),
    api.fetchWarTaskForces(),
  ]);

  const theaters = (theaterList.theaters ?? []).filter((theater) => military.theaterIds.includes(theater.id));
  const taskForces = (taskForceList.task_forces ?? []).filter((taskForce) => military.taskForceIds.includes(taskForce.id));
  const systemId = taskForces.find((taskForce) => taskForce.deployment?.system_id)?.deployment?.system_id
    ?? theaters.find((theater) => theater.objective?.system_id)?.objective?.system_id
    ?? theaters.flatMap((theater) => theater.zones ?? []).find((zone) => zone.system_id)?.system_id
    ?? null;

  return {
    theaters,
    taskForces,
    systemRuntime: systemId ? await api.fetchSystemRuntime(systemId) : null,
  };
}

export function isMilitaryGameCommandName(commandName: string) {
  return MILITARY_GAME_COMMANDS.has(commandName);
}

export function filterCommandsByMilitaryPolicy(allowedCommands: string[], agent: AgentInstance) {
  const military = agent.policy?.military;
  return allowedCommands.filter((commandName) => {
    if (!isMilitaryGameCommandName(commandName)) {
      return true;
    }
    return Boolean(military?.allowedCommandIds.includes(commandName));
  });
}

export async function buildMilitaryContextSections(agent: AgentInstance, playerKey: string) {
  const military = agent.policy?.military;
  if (!military || (military.theaterIds.length === 0 && military.taskForceIds.length === 0)) {
    return [];
  }

  try {
    const scope = await loadMilitaryScope(agent, playerKey);
    return [
      '军事委派规则：只能在已委派的战区 / 任务群内行动；超出范围或未授权高风险动作时，必须明确请求玩家批准。',
      `军事权限：commands=${military.allowedCommandIds.join(',') || '-'} `
        + `task_forces=${military.taskForceIds.join(',') || '-'} `
        + `theaters=${military.theaterIds.join(',') || '-'} `
        + `landing=${military.allowLanding} blockade=${military.allowBlockade} `
        + `production=${military.allowMilitaryProduction} max_production=${military.maxMilitaryProductionCount}`,
      ...(scope.theaters.length > 0
        ? [`委派战区：${scope.theaters.map(formatTheater).join('；')}`]
        : []),
      ...(scope.taskForces.length > 0
        ? [`委派任务群：${scope.taskForces.map(formatTaskForce).join('；')}`]
        : []),
      ...(scope.systemRuntime ? [`战区实时局势：${formatSystemRuntime(scope.systemRuntime)}`] : []),
      '军事任务模板：侦察恒星系优先用 system_runtime；维持战区补给优先看 war_industry 与 task_forces；巡逻 / 护航优先 task_force_set_stance + task_force_deploy；登陆准备若未授权 landing_start，必须在最终回复里要求玩家批准。',
      '军事交付要求：最终回复至少覆盖“做了什么 / 为什么 / 当前战区状态 / 需要玩家批准”。',
    ];
  } catch {
    return [
      '军事委派规则：只能在已委派的战区 / 任务群内行动；超出范围或未授权高风险动作时，必须明确请求玩家批准。',
      `军事权限：commands=${military.allowedCommandIds.join(',') || '-'} `
        + `task_forces=${military.taskForceIds.join(',') || '-'} `
        + `theaters=${military.theaterIds.join(',') || '-'} `
        + `landing=${military.allowLanding} blockade=${military.allowBlockade} `
        + `production=${military.allowMilitaryProduction} max_production=${military.maxMilitaryProductionCount}`,
    ];
  }
}

export async function appendMilitaryAuditSummary(input: {
  agent: AgentInstance;
  playerKey: string;
  requestContent: string;
  finalMessage: string;
  executedActions: CanonicalAgentAction[];
}) {
  const militaryActions = input.executedActions.filter((action) => (
    action.type === 'game.command' && isMilitaryGameCommandName(action.command)
  ));
  if (militaryActions.length === 0) {
    return input.finalMessage;
  }

  try {
    const scope = await loadMilitaryScope(input.agent, input.playerKey);
    const actions = militaryActions.map((action) => summarizeGameCommandAction(action)).join('；');
    const status = [
      scope.theaters.length > 0 ? `战区 ${scope.theaters.map(formatTheater).join('；')}` : '',
      scope.taskForces.length > 0 ? `任务群 ${scope.taskForces.map(formatTaskForce).join('；')}` : '',
      scope.systemRuntime ? `局势 ${formatSystemRuntime(scope.systemRuntime)}` : '',
    ].filter(Boolean).join('；');
    const summary = [
      `做了什么：${actions || '未执行军事动作。'}`,
      `为什么：${summarizeMilitaryReason(militaryActions)}`,
      `当前战区状态：${status || '未获取到战区实时状态。'}`,
      `需要玩家批准：${summarizeApproval(input.requestContent, input.agent)}`,
    ].join('\n');
    return `${input.finalMessage.trim()}\n\n${summary}`.trim();
  } catch {
    return `${input.finalMessage.trim()}\n\n做了什么：${militaryActions.map((action) => summarizeGameCommandAction(action)).join('；')}\n为什么：${summarizeMilitaryReason(militaryActions)}\n当前战区状态：暂时无法拉取最新战区快照，请稍后重试。\n需要玩家批准：${summarizeApproval(input.requestContent, input.agent)}`.trim();
  }
}
