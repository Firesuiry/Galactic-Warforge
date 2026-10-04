/**
 * agent-gateway HTTP 契约：网关持久化记录（即接口返回体）、请求载荷与 HTTP 客户端。
 * agent-gateway 服务端、client-web、client-cli 共用这一份定义。
 */

export type ProviderKind = 'http_api' | 'codex_cli' | 'claude_code_cli';

export interface ProviderCapability {
  available: boolean;
  reason?: string;
}

export interface GatewayHealth {
  status: string;
}

export interface GatewayCapabilities {
  status: 'ok';
  providers: Record<ProviderKind, ProviderCapability>;
}

export interface HttpApiProviderConfig {
  apiUrl: string;
  apiStyle: 'openai' | 'claude';
  apiKeySecretId: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export interface CliProviderConfig {
  command: string;
  model: string;
  workdir?: string;
  argsTemplate?: string[];
  envOverrides?: Record<string, string>;
}

export interface ModelProviderToolPolicy {
  cliEnabled: boolean;
  maxSteps: number;
  maxToolCallsPerTurn: number;
  commandWhitelist: string[];
}

export interface ModelProvider {
  id: string;
  name: string;
  providerKind: ProviderKind;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: ModelProviderToolPolicy;
  providerConfig: HttpApiProviderConfig | CliProviderConfig;
  createdAt: string;
  updatedAt: string;
}

/** GET /providers 返回体：http_api 配置额外带 hasSecret，不含密钥原文。 */
export type ModelProviderView = Omit<ModelProvider, 'providerConfig'> & {
  providerConfig: (HttpApiProviderConfig & { hasSecret: boolean }) | CliProviderConfig;
};

/** POST /providers：http_api 以 apiKey 明文提交，由网关落成 secret。 */
export interface HttpApiProviderConfigInput {
  apiUrl: string;
  apiStyle: 'openai' | 'claude';
  apiKey?: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export interface CreateProviderPayload {
  id?: string;
  name: string;
  providerKind: ProviderKind;
  description?: string;
  defaultModel: string;
  systemPrompt?: string;
  toolPolicy: ModelProviderToolPolicy;
  providerConfig: HttpApiProviderConfigInput | CliProviderConfig;
  createdAt?: string;
}

export type AgentRole = 'worker' | 'manager' | 'director';

export type AgentStatus = 'idle' | 'queued' | 'running' | 'cooldown' | 'paused' | 'error' | 'completed';

export interface AgentMilitaryPolicy {
  theaterIds: string[];
  taskForceIds: string[];
  allowedCommandIds: string[];
  maxMilitaryProductionCount: number;
  allowBlockade: boolean;
  allowMilitaryProduction: boolean;
}

export interface AgentPolicy {
  planetIds: string[];
  commandCategories: string[];
  canCreateAgents: boolean;
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
  military: AgentMilitaryPolicy;
}

export type AgentPolicyPatch =
  Partial<Omit<AgentPolicy, 'military'>>
  & { military?: Partial<AgentMilitaryPolicy> };

export interface AgentInstance {
  id: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  playerKeySecretId: string;
  status: AgentStatus;
  goal: string;
  activeThreadId: string;
  role?: AgentRole;
  policy?: AgentPolicy;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPayload {
  id?: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  goal?: string;
  role?: AgentRole;
  policy?: AgentPolicyPatch;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
}

export type UpdateAgentPayload = Partial<Omit<CreateAgentPayload, 'id'>>;

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
}

export interface AgentExecutionLog {
  level: 'info' | 'error';
  message: string;
  createdAt: string;
}

export type ConversationTurnOutcomeKind =
  | 'reply_only'
  | 'observed'
  | 'acted'
  | 'delegated'
  | 'blocked';

export interface AgentThread {
  id: string;
  agentId: string;
  title: string;
  messages: AgentMessage[];
  toolCalls: Array<{ type: string; payload: Record<string, unknown> }>;
  executionLogs: AgentExecutionLog[];
  lastTurn?: {
    status: 'running' | 'completed' | 'failed';
    outcomeKind?: ConversationTurnOutcomeKind;
    executedActionCount: number;
    repairCount: number;
    errorCode?: string;
    errorMessage?: string;
    rawErrorMessage?: string;
    finalMessage?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type ConversationActorType = 'player' | 'agent';

export type ConversationSenderType = 'player' | 'agent' | 'system' | 'schedule';

export interface Conversation {
  id: string;
  workspaceId: string;
  type: 'channel' | 'dm';
  name: string;
  topic: string;
  memberIds: string[];
  createdByType: ConversationActorType;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationPayload {
  id?: string;
  workspaceId?: string;
  type: 'channel' | 'dm';
  name: string;
  topic?: string;
  createdByType: ConversationActorType;
  createdById: string;
  memberIds?: string[];
}

export interface MentionTarget {
  type: 'agent';
  id: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: ConversationSenderType;
  senderId: string;
  kind: 'chat' | 'system' | 'tool' | 'schedule';
  content: string;
  mentions: MentionTarget[];
  trigger: 'player_message' | 'agent_message' | 'agent_dispatch' | 'schedule_message' | 'system_message';
  replyToMessageId?: string;
  turnId?: string;
  createdAt: string;
}

export interface SendConversationMessagePayload {
  senderType: ConversationSenderType;
  senderId: string;
  content: string;
}

export interface AddConversationMembersPayload {
  actorType: ConversationActorType;
  actorId: string;
  memberIds: string[];
}

export interface InviteConversationMembersByPlanetPayload {
  actorType: ConversationActorType;
  actorId: string;
  planetId: string;
}

export interface ConversationTurnActionSummary {
  type: string;
  status: 'pending' | 'succeeded' | 'failed';
  detail: string;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  requestMessageId: string;
  actorType: 'player' | 'agent' | 'schedule';
  actorId: string;
  targetAgentId: string;
  status: 'accepted' | 'queued' | 'planning' | 'executing' | 'succeeded' | 'failed';
  assistantPreview?: string;
  assistantMessageId?: string;
  finalMessageId?: string;
  outcomeKind?: ConversationTurnOutcomeKind;
  executedActionCount?: number;
  repairCount?: number;
  errorCode?: string;
  errorMessage?: string;
  rawErrorMessage?: string;
  errorHint?: string;
  actionSummaries: ConversationTurnActionSummary[];
  createdAt: string;
  updatedAt: string;
}

export type ScheduleTargetType = 'agent_dm' | 'conversation';

export interface ScheduleJob {
  id: string;
  workspaceId: string;
  name: string;
  ownerAgentId: string;
  creatorType: ConversationActorType;
  creatorId: string;
  targetType: ScheduleTargetType;
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSchedulePayload {
  id?: string;
  workspaceId?: string;
  name?: string;
  ownerAgentId: string;
  creatorType: ConversationActorType;
  creatorId: string;
  targetType: ScheduleTargetType;
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
}

export type UpdateSchedulePayload = Partial<Pick<
  ScheduleJob,
  'targetType' | 'targetId' | 'intervalSeconds' | 'messageTemplate' | 'enabled'
>>;

export interface AgentGatewayClientOptions {
  /** 网关根地址，如 `http://127.0.0.1:18180` 或经 vite 代理的 `/agent-api`。 */
  baseUrl: string;
}

export type AgentGatewayClient = ReturnType<typeof createAgentGatewayClient>;

export function createAgentGatewayClient(options: AgentGatewayClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function request<T>(path: string, method?: 'POST' | 'PATCH', body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`;
    const response = await (method
      ? fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      : fetch(url));
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(typeof payload?.error === 'string' ? payload.error : `request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    fetchHealth: () => request<GatewayHealth>('/health'),

    fetchAgents: () => request<AgentInstance[]>('/agents'),
    createAgent: (payload: CreateAgentPayload) => request<AgentInstance>('/agents', 'POST', payload),
    updateAgent: (agentId: string, payload: UpdateAgentPayload) =>
      request<AgentInstance>(`/agents/${agentId}`, 'PATCH', payload),
    sendAgentMessage: (agentId: string, content: string) =>
      request<{ accepted: boolean }>(`/agents/${agentId}/messages`, 'POST', { content }),
    fetchAgentThread: (agentId: string) => request<AgentThread>(`/agents/${agentId}/thread`),

    fetchProviders: () => request<ModelProviderView[]>('/providers'),
    createProvider: (payload: CreateProviderPayload) => request<ModelProviderView>('/providers', 'POST', payload),

    fetchConversations: () => request<Conversation[]>('/conversations'),
    createConversation: (payload: CreateConversationPayload) =>
      request<Conversation>('/conversations', 'POST', payload),
    fetchConversationMessages: (conversationId: string) =>
      request<ConversationMessage[]>(`/conversations/${conversationId}/messages`),
    fetchConversationTurns: (conversationId: string) =>
      request<ConversationTurn[]>(`/conversations/${conversationId}/turns`),
    sendConversationMessage: (conversationId: string, payload: SendConversationMessagePayload) =>
      request<{ accepted: boolean; message: ConversationMessage; turns: ConversationTurn[] }>(
        `/conversations/${conversationId}/messages`,
        'POST',
        payload,
      ),
    addConversationMembers: (conversationId: string, payload: AddConversationMembersPayload) =>
      request<{ conversationId: string; memberIds: string[] }>(
        `/conversations/${conversationId}/members`,
        'POST',
        payload,
      ),
    inviteConversationMembersByPlanet: (conversationId: string, payload: InviteConversationMembersByPlanetPayload) =>
      request<{ conversationId: string; memberIds: string[]; added: string[] }>(
        `/conversations/${conversationId}/members/invite-by-planet`,
        'POST',
        payload,
      ),

    fetchSchedules: () => request<ScheduleJob[]>('/schedules'),
    createSchedule: (payload: CreateSchedulePayload) => request<ScheduleJob>('/schedules', 'POST', payload),
    updateSchedule: (scheduleId: string, payload: UpdateSchedulePayload) =>
      request<ScheduleJob>(`/schedules/${scheduleId}`, 'PATCH', payload),
  };
}
