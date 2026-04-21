import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  GAME_COMMAND_NAMES,
  normalizeGameCommandAction,
  type CanonicalGameCommandAction,
} from './game-command-schema.js';

export interface CanonicalAgentPolicy {
  planetIds: string[];
  commandCategories: string[];
  canCreateAgents: boolean;
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
  military: CanonicalAgentMilitaryPolicy;
}

export interface CanonicalAgentMilitaryPolicy {
  theaterIds: string[];
  taskForceIds: string[];
  allowedCommandIds: string[];
  maxMilitaryProductionCount: number;
  allowBlockade: boolean;
  allowLanding: boolean;
  allowMilitaryProduction: boolean;
}

export type CanonicalAgentPolicyPatch =
  Partial<Omit<CanonicalAgentPolicy, 'military'>>
  & { military?: Partial<CanonicalAgentMilitaryPolicy> };

export type CanonicalAgentAction =
  | CanonicalGameCommandAction
  | { type: 'memory.note'; note: string }
  | { type: 'final_answer'; message: string }
  | {
      type: 'agent.create';
      id?: string;
      name: string;
      role?: string;
      goal?: string;
      providerId?: string;
      policy?: CanonicalAgentPolicyPatch;
      supervisorAgentIds?: string[];
      managedAgentIds?: string[];
    }
  | {
      type: 'agent.update';
      agentId: string;
      name?: string;
      role?: string;
      goal?: string;
      policy?: CanonicalAgentPolicyPatch;
    }
  | { type: 'conversation.ensure_dm'; targetAgentId: string }
  | {
      type: 'conversation.send_message';
      conversationId?: string;
      targetAgentId?: string;
      content: string;
    };

export interface CanonicalAgentTurn {
  assistantMessage: string;
  actions: CanonicalAgentAction[];
  done: boolean;
}

export const AGENT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'actions', 'done'],
  properties: {
    assistantMessage: { type: 'string' },
    done: { type: 'boolean' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'game.command',
              'memory.note',
              'final_answer',
              'agent.create',
              'agent.update',
              'conversation.ensure_dm',
              'conversation.send_message',
            ],
          },
          command: {
            type: 'string',
            enum: [...GAME_COMMAND_NAMES],
          },
          args: { type: 'object' },
          message: { type: 'string' },
          note: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' },
          goal: { type: 'string' },
          providerId: { type: 'string' },
          agentId: { type: 'string' },
          targetAgentId: { type: 'string' },
          conversationId: { type: 'string' },
          content: { type: 'string' },
          policy: {
            type: 'object',
            properties: {
              planetIds: { type: 'array', items: { type: 'string' } },
              commandCategories: { type: 'array', items: { type: 'string' } },
              canCreateAgents: { type: 'boolean' },
              canCreateChannel: { type: 'boolean' },
              canManageMembers: { type: 'boolean' },
              canInviteByPlanet: { type: 'boolean' },
              canCreateSchedules: { type: 'boolean' },
              canDirectMessageAgentIds: {
                type: 'array',
                items: { type: 'string' },
              },
              canDispatchAgentIds: {
                type: 'array',
                items: { type: 'string' },
              },
              military: {
                type: 'object',
                properties: {
                  theaterIds: { type: 'array', items: { type: 'string' } },
                  taskForceIds: { type: 'array', items: { type: 'string' } },
                  allowedCommandIds: { type: 'array', items: { type: 'string' } },
                  maxMilitaryProductionCount: { type: 'number' },
                  allowBlockade: { type: 'boolean' },
                  allowLanding: { type: 'boolean' },
                  allowMilitaryProduction: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function normalizeBoolean(value: unknown, fieldName: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

function normalizeOptionalPolicy(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }
  const record = asRecord(value);
  if (!record) {
    throw new Error(`${fieldName} must be an object`);
  }

  const policy: CanonicalAgentPolicyPatch = {};
  if (record.planetIds !== undefined) {
    const planetIds = asStringArray(record.planetIds);
    if (!planetIds) {
      throw new Error(`${fieldName}.planetIds must be a string array`);
    }
    policy.planetIds = planetIds;
  }
  if (record.commandCategories !== undefined) {
    const commandCategories = asStringArray(record.commandCategories);
    if (!commandCategories) {
      throw new Error(`${fieldName}.commandCategories must be a string array`);
    }
    policy.commandCategories = commandCategories;
  }
  if (record.canCreateAgents !== undefined) {
    policy.canCreateAgents = normalizeBoolean(record.canCreateAgents, `${fieldName}.canCreateAgents`);
  }
  if (record.canCreateChannel !== undefined) {
    policy.canCreateChannel = normalizeBoolean(record.canCreateChannel, `${fieldName}.canCreateChannel`);
  }
  if (record.canManageMembers !== undefined) {
    policy.canManageMembers = normalizeBoolean(record.canManageMembers, `${fieldName}.canManageMembers`);
  }
  if (record.canInviteByPlanet !== undefined) {
    policy.canInviteByPlanet = normalizeBoolean(record.canInviteByPlanet, `${fieldName}.canInviteByPlanet`);
  }
  if (record.canCreateSchedules !== undefined) {
    policy.canCreateSchedules = normalizeBoolean(record.canCreateSchedules, `${fieldName}.canCreateSchedules`);
  }
  if (record.canDirectMessageAgentIds !== undefined) {
    const canDirectMessageAgentIds = asStringArray(record.canDirectMessageAgentIds);
    if (!canDirectMessageAgentIds) {
      throw new Error(`${fieldName}.canDirectMessageAgentIds must be a string array`);
    }
    policy.canDirectMessageAgentIds = canDirectMessageAgentIds;
  }
  if (record.canDispatchAgentIds !== undefined) {
    const canDispatchAgentIds = asStringArray(record.canDispatchAgentIds);
    if (!canDispatchAgentIds) {
      throw new Error(`${fieldName}.canDispatchAgentIds must be a string array`);
    }
    policy.canDispatchAgentIds = canDispatchAgentIds;
  }
  if (record.military !== undefined) {
    const militaryRecord = asRecord(record.military);
    if (!militaryRecord) {
      throw new Error(`${fieldName}.military must be an object`);
    }
    const military: Partial<CanonicalAgentMilitaryPolicy> = {};
    if (militaryRecord.theaterIds !== undefined) {
      const theaterIds = asStringArray(militaryRecord.theaterIds);
      if (!theaterIds) {
        throw new Error(`${fieldName}.military.theaterIds must be a string array`);
      }
      military.theaterIds = theaterIds;
    }
    if (militaryRecord.taskForceIds !== undefined) {
      const taskForceIds = asStringArray(militaryRecord.taskForceIds);
      if (!taskForceIds) {
        throw new Error(`${fieldName}.military.taskForceIds must be a string array`);
      }
      military.taskForceIds = taskForceIds;
    }
    if (militaryRecord.allowedCommandIds !== undefined) {
      const allowedCommandIds = asStringArray(militaryRecord.allowedCommandIds);
      if (!allowedCommandIds) {
        throw new Error(`${fieldName}.military.allowedCommandIds must be a string array`);
      }
      military.allowedCommandIds = allowedCommandIds;
    }
    if (militaryRecord.maxMilitaryProductionCount !== undefined) {
      const maxMilitaryProductionCount = asFiniteNumber(militaryRecord.maxMilitaryProductionCount);
      if (maxMilitaryProductionCount === undefined) {
        throw new Error(`${fieldName}.military.maxMilitaryProductionCount must be a number`);
      }
      military.maxMilitaryProductionCount = maxMilitaryProductionCount;
    }
    if (militaryRecord.allowBlockade !== undefined) {
      military.allowBlockade = normalizeBoolean(militaryRecord.allowBlockade, `${fieldName}.military.allowBlockade`);
    }
    if (militaryRecord.allowLanding !== undefined) {
      military.allowLanding = normalizeBoolean(militaryRecord.allowLanding, `${fieldName}.military.allowLanding`);
    }
    if (militaryRecord.allowMilitaryProduction !== undefined) {
      military.allowMilitaryProduction = normalizeBoolean(
        militaryRecord.allowMilitaryProduction,
        `${fieldName}.military.allowMilitaryProduction`,
      );
    }
    policy.military = military;
  }

  return policy;
}

function mergeActionArgs(action: Record<string, unknown>) {
  const args = asRecord(action.args);
  if (!args) {
    return action;
  }
  const wrapsNestedAction = typeof args.type === 'string'
    || typeof args.command === 'string'
    || args.args !== undefined;
  if (wrapsNestedAction) {
    return {
      ...action,
      ...args,
    };
  }
  return {
    ...args,
    ...action,
  };
}

function isIgnorableActionShell(action: unknown) {
  const record = asRecord(action);
  if (!record) {
    return false;
  }

  if (Object.keys(record).length === 0) {
    return true;
  }

  const args = asRecord(record.args);
  if (!args || Object.keys(args).length > 0) {
    return false;
  }

  const merged = mergeActionArgs(record);
  return Object.keys(merged).every((key) => key === 'args');
}

function normalizeAction(action: unknown): CanonicalAgentAction {
  const record = asRecord(action);
  if (!record) {
    throw new Error('action must be an object');
  }

  const merged = mergeActionArgs(record);
  const type = asString(merged.type);
  if (!type) {
    throw new Error('action.type is required');
  }

  if (type === 'game.command') {
    return normalizeGameCommandAction(merged);
  }

  if (type === 'memory.note') {
    const note = asString(merged.note);
    if (!note) {
      throw new Error('memory.note requires note');
    }
    return { type, note };
  }

  if (type === 'final_answer') {
    const message = asString(merged.message);
    if (!message) {
      throw new Error('final_answer requires message');
    }
    return { type, message };
  }

  if (type === 'agent.create') {
    const name = asString(merged.name);
    if (!name) {
      throw new Error('agent.create requires name');
    }
    const supervisorAgentIds = asStringArray(merged.supervisorAgentIds);
    const managedAgentIds = asStringArray(merged.managedAgentIds);
    return {
      type,
      ...(asString(merged.id) ? { id: asString(merged.id) } : {}),
      name,
      ...(asString(merged.role) ? { role: asString(merged.role) } : {}),
      ...(asString(merged.goal) ? { goal: asString(merged.goal) } : {}),
      ...(asString(merged.providerId) ? { providerId: asString(merged.providerId) } : {}),
      ...(normalizeOptionalPolicy(merged.policy, 'agent.create') !== undefined
        ? { policy: normalizeOptionalPolicy(merged.policy, 'agent.create') }
        : {}),
      ...(supervisorAgentIds ? { supervisorAgentIds } : {}),
      ...(managedAgentIds ? { managedAgentIds } : {}),
    };
  }

  if (type === 'agent.update') {
    const agentId = asString(merged.agentId);
    if (!agentId) {
      throw new Error('agent.update requires agentId');
    }
    return {
      type,
      agentId,
      ...(asString(merged.name) ? { name: asString(merged.name) } : {}),
      ...(asString(merged.role) ? { role: asString(merged.role) } : {}),
      ...(asString(merged.goal) ? { goal: asString(merged.goal) } : {}),
      ...(normalizeOptionalPolicy(merged.policy, 'agent.update') !== undefined
        ? { policy: normalizeOptionalPolicy(merged.policy, 'agent.update') }
        : {}),
    };
  }

  if (type === 'conversation.ensure_dm') {
    const targetAgentId = asString(merged.targetAgentId);
    if (!targetAgentId) {
      throw new Error('conversation.ensure_dm requires targetAgentId');
    }
    return { type, targetAgentId };
  }

  if (type === 'conversation.send_message') {
    const conversationId = asString(merged.conversationId);
    const targetAgentId = asString(merged.targetAgentId);
    if (!conversationId && !targetAgentId) {
      throw new Error('conversation.send_message requires conversationId or targetAgentId');
    }
    const content = asString(merged.content);
    if (!content) {
      throw new Error('conversation.send_message requires content');
    }
    return {
      type,
      ...(conversationId ? { conversationId } : {}),
      ...(targetAgentId ? { targetAgentId } : {}),
      content,
    };
  }

  throw new Error(`unsupported action type: ${type}`);
}

export function normalizeProviderTurn(value: unknown): CanonicalAgentTurn {
  const record = asRecord(value);
  if (!record) {
    throw new Error('provider turn must be an object');
  }

  const actions = record.actions;
  if (!Array.isArray(actions)) {
    throw new Error('actions must be an array');
  }

  return {
    assistantMessage: asString(record.assistantMessage),
    done: normalizeBoolean(record.done, 'done'),
    actions: actions.flatMap((action) => {
      if (isIgnorableActionShell(action)) {
        console.warn('ignoring empty provider action shell');
        return [];
      }
      return [normalizeAction(action)];
    }),
  };
}

export function assertSupportedAction(action: Record<string, unknown>) {
  const normalized = normalizeAction(action);
  if (normalized.type === 'final_answer' && typeof normalized.message !== 'string') {
    throw new Error('final_answer requires message');
  }
  if (normalized.type === 'agent.create' && typeof normalized.name !== 'string') {
    throw new Error('agent.create requires name');
  }
  if (normalized.type === 'agent.update' && typeof normalized.agentId !== 'string') {
    throw new Error('agent.update requires agentId');
  }
  if (normalized.type === 'conversation.ensure_dm' && typeof normalized.targetAgentId !== 'string') {
    throw new Error('conversation.ensure_dm requires targetAgentId');
  }
  if (
    normalized.type === 'conversation.send_message'
    && typeof normalized.conversationId !== 'string'
    && typeof normalized.targetAgentId !== 'string'
  ) {
    throw new Error('conversation.send_message requires conversationId or targetAgentId');
  }
  if (normalized.type === 'conversation.send_message' && typeof normalized.content !== 'string') {
    throw new Error('conversation.send_message requires content');
  }
}

export async function ensureActionSchemaFile(root: string) {
  const dir = path.join(root, 'schemas');
  const filePath = path.join(dir, 'agent-turn.schema.json');

  try {
    await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(AGENT_ACTION_SCHEMA, null, 2), 'utf8');
  }

  return filePath;
}
