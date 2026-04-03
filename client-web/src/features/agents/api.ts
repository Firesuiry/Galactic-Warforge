import type {
  AgentGatewayHealth,
  AgentInstanceSummary,
  AgentTemplateSummary,
  AgentThreadView,
} from './types';

async function expectJson<T>(input: Promise<Response>): Promise<T> {
  const response = await input;
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === 'string' ? payload.error : `request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchGatewayHealth() {
  return expectJson<AgentGatewayHealth>(fetch('/agent-api/health'));
}

export function fetchTemplates() {
  return expectJson<AgentTemplateSummary[]>(fetch('/agent-api/templates'));
}

export function createTemplate(payload: Record<string, unknown>) {
  return expectJson<AgentTemplateSummary>(fetch('/agent-api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchAgents() {
  return expectJson<AgentInstanceSummary[]>(fetch('/agent-api/agents'));
}

export function createAgent(payload: Record<string, unknown>) {
  return expectJson<AgentInstanceSummary>(fetch('/agent-api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchAgentThread(agentId: string) {
  return expectJson<AgentThreadView>(fetch(`/agent-api/agents/${agentId}/thread`));
}

export function sendAgentMessage(agentId: string, content: string) {
  return expectJson<{ accepted: boolean }>(fetch(`/agent-api/agents/${agentId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }));
}

export function exportAgentBundle(includeSecrets: boolean) {
  return expectJson<Record<string, unknown>>(fetch('/agent-api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ includeSecrets }),
  }));
}

export function importAgentBundle(bundle: unknown) {
  return expectJson<Record<string, unknown>>(fetch('/agent-api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  }));
}
