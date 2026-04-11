export type ProviderKind = 'http_api' | 'codex_cli' | 'claude_code_cli';

export interface ProviderCapability {
  available: boolean;
  reason?: string;
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

export interface ModelProvider {
  id: string;
  name: string;
  providerKind: ProviderKind;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: {
    cliEnabled: boolean;
    maxSteps: number;
    maxToolCallsPerTurn: number;
    commandWhitelist: string[];
  };
  providerConfig: HttpApiProviderConfig | CliProviderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstance {
  id: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  playerKeySecretId: string;
  status: 'idle' | 'queued' | 'running' | 'cooldown' | 'paused' | 'error' | 'completed';
  goal: string;
  activeThreadId: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentPolicy;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
  createdAt: string;
  updatedAt: string;
}

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

export interface AgentThread {
  id: string;
  agentId: string;
  title: string;
  messages: AgentMessage[];
  toolCalls: Array<{ type: string; payload: Record<string, unknown> }>;
  executionLogs: AgentExecutionLog[];
  createdAt: string;
  updatedAt: string;
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
}

export interface Conversation {
  id: string;
  workspaceId: string;
  type: 'channel' | 'dm';
  name: string;
  topic: string;
  memberIds: string[];
  createdByType: 'player' | 'agent';
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface MentionTarget {
  type: 'agent';
  id: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: 'player' | 'agent' | 'system' | 'schedule';
  senderId: string;
  kind: 'chat' | 'system' | 'tool' | 'schedule';
  content: string;
  mentions: MentionTarget[];
  trigger: 'player_message' | 'agent_message' | 'agent_dispatch' | 'schedule_message' | 'system_message';
  replyToMessageId?: string;
  turnId?: string;
  createdAt: string;
}

export interface ConversationTurnActionSummary {
  type: string;
  status: 'pending' | 'succeeded' | 'failed';
  detail: string;
}

export type ConversationTurnOutcomeKind =
  | 'reply_only'
  | 'observed'
  | 'acted'
  | 'delegated'
  | 'blocked';

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

export interface ScheduleJob {
  id: string;
  workspaceId: string;
  name: string;
  ownerAgentId: string;
  creatorType: 'player' | 'agent';
  creatorId: string;
  targetType: 'agent_dm' | 'conversation';
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
