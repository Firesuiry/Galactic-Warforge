import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
}

export type CanonicalAgentAction =
  | { type: 'game.cli'; commandLine: string }
  | { type: 'memory.note'; note: string }
  | { type: 'final_answer'; message: string }
  | {
      type: 'agent.create';
      id?: string;
      name: string;
      role?: string;
      goal?: string;
      providerId?: string;
      policy: CanonicalAgentPolicy;
      supervisorAgentIds?: string[];
      managedAgentIds?: string[];
    }
  | {
      type: 'agent.update';
      agentId: string;
      name?: string;
      role?: string;
      goal?: string;
      policy?: CanonicalAgentPolicy;
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
              'game.cli',
              'memory.note',
              'final_answer',
              'agent.create',
              'agent.update',
              'conversation.ensure_dm',
              'conversation.send_message',
            ],
          },
          commandLine: { type: 'string' },
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
          args: { type: 'object' },
          policy: {
            type: 'object',
            required: [
              'planetIds',
              'commandCategories',
              'canCreateAgents',
              'canCreateChannel',
              'canManageMembers',
              'canInviteByPlanet',
              'canCreateSchedules',
              'canDirectMessageAgentIds',
              'canDispatchAgentIds',
            ],
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

function normalizePolicy(value: unknown, fieldName: string) {
  const record = asRecord(value);
  if (!record) {
    throw new Error(`${fieldName} requires complete policy`);
  }

  const planetIds = asStringArray(record.planetIds);
  const commandCategories = asStringArray(record.commandCategories);
  const canDirectMessageAgentIds = asStringArray(record.canDirectMessageAgentIds);
  const canDispatchAgentIds = asStringArray(record.canDispatchAgentIds);

  if (
    !planetIds
    || !commandCategories
    || !canDirectMessageAgentIds
    || !canDispatchAgentIds
  ) {
    throw new Error(`${fieldName} requires complete policy`);
  }

  return {
    planetIds,
    commandCategories,
    canCreateAgents: normalizeBoolean(record.canCreateAgents, `${fieldName}.canCreateAgents`),
    canCreateChannel: normalizeBoolean(record.canCreateChannel, `${fieldName}.canCreateChannel`),
    canManageMembers: normalizeBoolean(record.canManageMembers, `${fieldName}.canManageMembers`),
    canInviteByPlanet: normalizeBoolean(record.canInviteByPlanet, `${fieldName}.canInviteByPlanet`),
    canCreateSchedules: normalizeBoolean(record.canCreateSchedules, `${fieldName}.canCreateSchedules`),
    canDirectMessageAgentIds,
    canDispatchAgentIds,
  } satisfies CanonicalAgentPolicy;
}

function mergeActionArgs(action: Record<string, unknown>) {
  const args = asRecord(action.args);
  if (!args) {
    return action;
  }
  return {
    ...args,
    ...action,
  };
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

  if (type === 'game.cli') {
    const commandLine = asString(merged.commandLine);
    if (!commandLine) {
      throw new Error('game.cli requires commandLine');
    }
    return { type, commandLine };
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
    return {
      type,
      ...(asString(merged.id) ? { id: asString(merged.id) } : {}),
      name,
      ...(asString(merged.role) ? { role: asString(merged.role) } : {}),
      ...(asString(merged.goal) ? { goal: asString(merged.goal) } : {}),
      ...(asString(merged.providerId)
        ? { providerId: asString(merged.providerId) }
        : {}),
      policy: normalizePolicy(merged.policy, 'agent.create'),
      ...(asStringArray(merged.supervisorAgentIds)
        ? { supervisorAgentIds: asStringArray(merged.supervisorAgentIds) }
        : {}),
      ...(asStringArray(merged.managedAgentIds)
        ? { managedAgentIds: asStringArray(merged.managedAgentIds) }
        : {}),
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
      ...(merged.policy
        ? { policy: normalizePolicy(merged.policy, 'agent.update') }
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
    actions: actions.map((action) => normalizeAction(action)),
  };
}

export function assertSupportedAction(action: Record<string, unknown>) {
  const normalized = normalizeAction(action);
  if (normalized.type === 'game.cli' && typeof normalized.commandLine !== 'string') {
    throw new Error('game.cli requires commandLine');
  }
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
