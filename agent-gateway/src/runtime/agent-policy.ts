import type { AgentMilitaryPolicy, AgentPolicy, AgentPolicyPatch } from '../types.js';

export function createDefaultMilitaryPolicy(): AgentMilitaryPolicy {
  return {
    theaterIds: [],
    taskForceIds: [],
    allowedCommandIds: [],
    maxMilitaryProductionCount: 0,
    allowBlockade: false,
    allowLanding: false,
    allowMilitaryProduction: false,
  };
}

export function normalizeMilitaryPolicy(
  policy?: Partial<AgentMilitaryPolicy>,
  base?: AgentMilitaryPolicy,
): AgentMilitaryPolicy {
  const fallback = base ?? createDefaultMilitaryPolicy();
  return {
    ...fallback,
    ...policy,
    theaterIds: policy?.theaterIds ?? fallback.theaterIds,
    taskForceIds: policy?.taskForceIds ?? fallback.taskForceIds,
    allowedCommandIds: policy?.allowedCommandIds ?? fallback.allowedCommandIds,
    maxMilitaryProductionCount: policy?.maxMilitaryProductionCount ?? fallback.maxMilitaryProductionCount,
    allowBlockade: policy?.allowBlockade ?? fallback.allowBlockade,
    allowLanding: policy?.allowLanding ?? fallback.allowLanding,
    allowMilitaryProduction: policy?.allowMilitaryProduction ?? fallback.allowMilitaryProduction,
  };
}

export function createDefaultPolicy(): AgentPolicy {
  return {
    planetIds: [],
    commandCategories: [],
    canCreateAgents: false,
    canCreateChannel: false,
    canManageMembers: false,
    canInviteByPlanet: false,
    canCreateSchedules: false,
    canDirectMessageAgentIds: [],
    canDispatchAgentIds: [],
    military: createDefaultMilitaryPolicy(),
  };
}

export function normalizePolicy(policy?: AgentPolicyPatch, base?: AgentPolicy): AgentPolicy {
  const fallback = base ?? createDefaultPolicy();
  return {
    ...fallback,
    ...policy,
    planetIds: policy?.planetIds ?? fallback.planetIds,
    commandCategories: policy?.commandCategories ?? fallback.commandCategories,
    canCreateAgents: policy?.canCreateAgents ?? fallback.canCreateAgents,
    canCreateChannel: policy?.canCreateChannel ?? fallback.canCreateChannel,
    canManageMembers: policy?.canManageMembers ?? fallback.canManageMembers,
    canInviteByPlanet: policy?.canInviteByPlanet ?? fallback.canInviteByPlanet,
    canCreateSchedules: policy?.canCreateSchedules ?? fallback.canCreateSchedules,
    canDirectMessageAgentIds: policy?.canDirectMessageAgentIds ?? fallback.canDirectMessageAgentIds,
    canDispatchAgentIds: policy?.canDispatchAgentIds ?? fallback.canDispatchAgentIds,
    military: normalizeMilitaryPolicy(policy?.military, fallback.military),
  };
}

export function isSubsetWithin(requested: string[] | undefined, allowed: string[] | undefined) {
  if (!requested || requested.length === 0) {
    return true;
  }
  if (!allowed || allowed.length === 0) {
    return true;
  }
  const allowedSet = new Set(allowed);
  return requested.every((value) => allowedSet.has(value));
}
