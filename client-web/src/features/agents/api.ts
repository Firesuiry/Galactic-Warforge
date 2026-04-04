import type {
  AgentGatewayHealth,
  AgentProfileView,
  AgentTemplateView,
  AddConversationMembersPayload,
  ConversationMessageView,
  ConversationView,
  CreateAgentPayload,
  CreateSchedulePayload,
  CreateTemplatePayload,
  ScheduleView,
  UpdateSchedulePayload,
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

export function fetchAgents() {
  return expectJson<AgentProfileView[]>(fetch('/agent-api/agents'));
}

export function createAgent(payload: CreateAgentPayload) {
  return expectJson<AgentProfileView>(fetch('/agent-api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchTemplates() {
  return expectJson<AgentTemplateView[]>(fetch('/agent-api/templates'));
}

export function createTemplate(payload: CreateTemplatePayload) {
  return expectJson<AgentTemplateView>(fetch('/agent-api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchConversations() {
  return expectJson<ConversationView[]>(fetch('/agent-api/conversations'));
}

export function createConversation(payload: {
  type: 'channel' | 'dm';
  name: string;
  topic: string;
  createdByType: 'player' | 'agent';
  createdById: string;
  memberIds: string[];
}) {
  return expectJson<ConversationView>(fetch('/agent-api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchConversationMessages(conversationId: string) {
  return expectJson<ConversationMessageView[]>(fetch(`/agent-api/conversations/${conversationId}/messages`));
}

export function sendConversationMessage(conversationId: string, payload: {
  senderType: 'player' | 'agent' | 'system' | 'schedule';
  senderId: string;
  content: string;
}) {
  return expectJson<{ accepted: boolean }>(fetch(`/agent-api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function inviteConversationMembersByPlanet(conversationId: string, payload: {
  actorType: 'player' | 'agent';
  actorId: string;
  planetId: string;
}) {
  return expectJson<{ memberIds: string[] }>(fetch(`/agent-api/conversations/${conversationId}/members/invite-by-planet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function addConversationMembers(conversationId: string, payload: AddConversationMembersPayload) {
  return expectJson<{ conversationId: string; memberIds: string[] }>(fetch(`/agent-api/conversations/${conversationId}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function fetchSchedules() {
  return expectJson<ScheduleView[]>(fetch('/agent-api/schedules'));
}

export function createSchedule(payload: CreateSchedulePayload) {
  return expectJson<ScheduleView>(fetch('/agent-api/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export function updateSchedule(scheduleId: string, payload: UpdateSchedulePayload) {
  return expectJson<ScheduleView>(fetch(`/agent-api/schedules/${scheduleId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}
