import { getAuth, getServerUrl } from '../api.js';
import {
  createAgentProfile,
  fetchAgentThread,
  listAgentProfiles,
  sendAgentMessage,
  updateAgentProfile,
  type AgentGatewayPolicy,
} from '../agent-api.js';
import { fmtError } from '../format.js';
import { getStringOption, parseArgs } from './args.js';

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBooleanOption(raw: string | undefined, label: string): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new Error(`${label} 必须是 true 或 false`);
}

function parseCsv(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function buildPolicy(parsed: ReturnType<typeof parseArgs>) {
  const canCreateAgents = parseBooleanOption(getStringOption(parsed, 'can-create-agents'), 'can-create-agents');
  const canCreateChannel = parseBooleanOption(getStringOption(parsed, 'can-create-channel'), 'can-create-channel');
  const canManageMembers = parseBooleanOption(getStringOption(parsed, 'can-manage-members'), 'can-manage-members');
  const canInviteByPlanet = parseBooleanOption(getStringOption(parsed, 'can-invite-by-planet'), 'can-invite-by-planet');
  const canCreateSchedules = parseBooleanOption(getStringOption(parsed, 'can-create-schedules'), 'can-create-schedules');
  const planetIds = parseCsv(getStringOption(parsed, 'planet-ids'));
  const commandCategories = parseCsv(getStringOption(parsed, 'command-categories'));
  const canDispatchAgentIds = parseCsv(getStringOption(parsed, 'dispatch-agent-ids'));
  const canDirectMessageAgentIds = parseCsv(getStringOption(parsed, 'direct-message-agent-ids'));

  const policy: AgentGatewayPolicy = {};
  if (planetIds) {
    policy.planetIds = planetIds;
  }
  if (commandCategories) {
    policy.commandCategories = commandCategories;
  }
  if (canCreateAgents !== undefined) {
    policy.canCreateAgents = canCreateAgents;
  }
  if (canCreateChannel !== undefined) {
    policy.canCreateChannel = canCreateChannel;
  }
  if (canManageMembers !== undefined) {
    policy.canManageMembers = canManageMembers;
  }
  if (canInviteByPlanet !== undefined) {
    policy.canInviteByPlanet = canInviteByPlanet;
  }
  if (canCreateSchedules !== undefined) {
    policy.canCreateSchedules = canCreateSchedules;
  }
  if (canDispatchAgentIds) {
    policy.canDispatchAgentIds = canDispatchAgentIds;
  }
  if (canDirectMessageAgentIds) {
    policy.canDirectMessageAgentIds = canDirectMessageAgentIds;
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
}

export async function cmdAgentList(): Promise<string> {
  try {
    const agents = await listAgentProfiles();
    if (agents.length === 0) {
      return 'No agents found.';
    }
    return agents.map((agent) => {
      const categories = agent.policy?.commandCategories?.join(',') || '*';
      const createAgents = agent.policy?.canCreateAgents ? 'yes' : 'no';
      return `${agent.id}  ${agent.name}  role=${agent.role ?? '-'}  status=${agent.status}  categories=${categories}  create_agents=${createAgents}`;
    }).join('\n');
  } catch (error) {
    return fmtError(toErrorMessage(error));
  }
}

export async function cmdAgentCreate(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const name = parsed.positionals[0];
  const providerId = getStringOption(parsed, 'provider');
  if (!name || !providerId) {
    return fmtError('Usage: agent_create <name> --provider <provider_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]');
  }

  const auth = getAuth();
  if (!auth.playerId || !auth.playerKey) {
    return fmtError('当前未配置 player 认证，请先 switch');
  }

  try {
    const created = await createAgentProfile({
      id: getStringOption(parsed, 'id'),
      name,
      providerId,
      serverUrl: getServerUrl(),
      playerId: auth.playerId,
      playerKey: auth.playerKey,
      role: getStringOption(parsed, 'role') as 'worker' | 'manager' | 'director' | undefined,
      goal: getStringOption(parsed, 'goal'),
      policy: buildPolicy(parsed),
    });
    return `Created agent ${created.id} (${created.name})`;
  } catch (error) {
    return fmtError(toErrorMessage(error));
  }
}

export async function cmdAgentUpdate(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const agentId = parsed.positionals[0];
  if (!agentId) {
    return fmtError('Usage: agent_update <agent_id> [--role <worker|manager|director>] [--can-create-agents <true|false>] [--command-categories <csv>] [--planet-ids <csv>] [--dispatch-agent-ids <csv>] [--direct-message-agent-ids <csv>]');
  }

  try {
    const updated = await updateAgentProfile(agentId, {
      role: getStringOption(parsed, 'role') as 'worker' | 'manager' | 'director' | undefined,
      goal: getStringOption(parsed, 'goal'),
      policy: buildPolicy(parsed),
    });
    return `Updated agent ${updated.id}`;
  } catch (error) {
    return fmtError(toErrorMessage(error));
  }
}

export async function cmdAgentMessage(args: string[]): Promise<string> {
  if (args.length < 2) {
    return fmtError('Usage: agent_message <agent_id> <content>');
  }
  try {
    const response = await sendAgentMessage(args[0], args.slice(1).join(' '));
    return response.accepted ? `Accepted message for ${args[0]}` : `Rejected message for ${args[0]}`;
  } catch (error) {
    return fmtError(toErrorMessage(error));
  }
}

export async function cmdAgentThread(args: string[]): Promise<string> {
  if (args.length < 1) {
    return fmtError('Usage: agent_thread <agent_id>');
  }
  try {
    const thread = await fetchAgentThread(args[0]);
    const messages = thread.messages.map((message) => `${message.role}: ${message.content}`);
    const tools = thread.toolCalls.map((call) => `tool:${call.type} ${JSON.stringify(call.payload)}`);
    const logs = thread.executionLogs.map((log) => `log:${log.level} ${log.message}`);
    return [
      `Thread: ${thread.id}`,
      ...messages,
      ...tools,
      ...logs,
    ].join('\n');
  } catch (error) {
    return fmtError(toErrorMessage(error));
  }
}
