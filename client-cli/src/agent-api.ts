import { getAgentGatewayUrl } from './config.js';

export interface AgentGatewayPolicy {
  planetIds?: string[];
  commandCategories?: string[];
  canCreateAgents?: boolean;
  canCreateChannel?: boolean;
  canManageMembers?: boolean;
  canInviteByPlanet?: boolean;
  canCreateSchedules?: boolean;
  canDirectMessageAgentIds?: string[];
  canDispatchAgentIds?: string[];
}

export interface AgentProfilePayload {
  id?: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  goal?: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentGatewayPolicy;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
}

export interface AgentProfilePatch {
  name?: string;
  providerId?: string;
  serverUrl?: string;
  playerId?: string;
  playerKey?: string;
  goal?: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentGatewayPolicy;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  status: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentGatewayPolicy;
}

export interface AgentThreadView {
  id: string;
  agentId: string;
  title?: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  toolCalls: Array<{ type: string; payload: Record<string, unknown> }>;
  executionLogs: Array<{ level: string; message: string; createdAt?: string }>;
}

function buildGatewayUrl(path: string) {
  return `${getAgentGatewayUrl().replace(/\/$/, '')}${path}`;
}

async function expectJson<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await responsePromise;
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === 'string' ? payload.error : `request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listAgentProfiles() {
  return expectJson<AgentProfile[]>(fetch(buildGatewayUrl('/agents')));
}

export function createAgentProfile(payload: AgentProfilePayload) {
  return expectJson<AgentProfile>(fetch(buildGatewayUrl('/agents'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function updateAgentProfile(agentId: string, payload: AgentProfilePatch) {
  return expectJson<AgentProfile>(fetch(buildGatewayUrl(`/agents/${agentId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function sendAgentMessage(agentId: string, content: string) {
  return expectJson<{ accepted: boolean }>(fetch(buildGatewayUrl(`/agents/${agentId}/messages`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }));
}

export function fetchAgentThread(agentId: string) {
  return expectJson<AgentThreadView>(fetch(buildGatewayUrl(`/agents/${agentId}/thread`)));
}
