export interface AgentGatewayHealth {
  status: string;
}

export type AgentProviderKindView = 'http_api' | 'codex_cli' | 'claude_code_cli';

export interface AgentPolicyView {
  planetIds: string[];
  commandCategories: string[];
  canCreateAgents?: boolean;
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
}

export interface ModelProviderToolPolicyView {
  cliEnabled: boolean;
  maxSteps: number;
  maxToolCallsPerTurn: number;
  commandWhitelist: string[];
}

export type ModelProviderConfigView =
  | {
      apiUrl: string;
      apiStyle: 'openai' | 'claude';
      apiKey?: string;
      apiKeySecretId?: string;
      hasSecret?: boolean;
      model: string;
      extraHeaders?: Record<string, string>;
    }
  | {
      command: string;
      model: string;
      workdir?: string;
      argsTemplate?: string[];
      envOverrides?: Record<string, string>;
    };

export interface ModelProviderView {
  id: string;
  name: string;
  providerKind: AgentProviderKindView;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: ModelProviderToolPolicyView;
  providerConfig: ModelProviderConfigView;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProviderPayload {
  name: string;
  providerKind: AgentProviderKindView;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: ModelProviderToolPolicyView;
  providerConfig: ModelProviderConfigView;
}

export interface AgentProfileView {
  id: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'queued' | 'running' | 'cooldown' | 'paused' | 'error' | 'completed';
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentPolicyView;
}

export interface CreateAgentPayload {
  id?: string;
  name: string;
  providerId: string;
  serverUrl: string;
  playerId: string;
  playerKey: string;
  goal?: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: Partial<AgentPolicyView>;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
}

export interface UpdateAgentPayload {
  name?: string;
  providerId?: string;
  serverUrl?: string;
  playerId?: string;
  playerKey?: string;
  goal?: string;
  role?: 'worker' | 'manager' | 'director';
  policy?: Partial<AgentPolicyView>;
  supervisorAgentIds?: string[];
  managedAgentIds?: string[];
  activeConversationIds?: string[];
}

export interface ConversationView {
  id: string;
  type: 'channel' | 'dm';
  name: string;
  topic: string;
  memberIds: string[];
}

export interface AddConversationMembersPayload {
  actorType: 'player' | 'agent';
  actorId: string;
  memberIds: string[];
}

export interface ConversationMessageView {
  id: string;
  conversationId: string;
  senderType: 'player' | 'agent' | 'system' | 'schedule';
  senderId: string;
  kind: 'chat' | 'system' | 'tool' | 'schedule';
  content: string;
  mentions: Array<{
    type: 'agent';
    id: string;
  }>;
  replyToMessageId?: string;
  turnId?: string;
  createdAt: string;
}

export interface ConversationTurnActionSummaryView {
  type: string;
  status: 'pending' | 'succeeded' | 'failed';
  detail: string;
}

export type ConversationTurnOutcomeKindView =
  | 'reply_only'
  | 'observed'
  | 'acted'
  | 'delegated'
  | 'blocked';

export interface ConversationTurnView {
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
  outcomeKind?: ConversationTurnOutcomeKindView;
  executedActionCount?: number;
  repairCount?: number;
  errorCode?: string;
  errorMessage?: string;
  rawErrorMessage?: string;
  errorHint?: string;
  actionSummaries: ConversationTurnActionSummaryView[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleView {
  id: string;
  ownerAgentId: string;
  targetType: 'agent_dm' | 'conversation';
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
  enabled: boolean;
}

export interface CreateSchedulePayload {
  ownerAgentId: string;
  creatorType: 'player' | 'agent';
  creatorId: string;
  targetType: 'agent_dm' | 'conversation';
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
}

export interface UpdateSchedulePayload {
  targetType?: 'agent_dm' | 'conversation';
  targetId?: string;
  intervalSeconds?: number;
  messageTemplate?: string;
  enabled?: boolean;
}
