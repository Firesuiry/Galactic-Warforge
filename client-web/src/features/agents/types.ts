export interface AgentGatewayHealth {
  status: string;
}

export type AgentProviderKindView = 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';

export interface AgentPolicyView {
  planetIds: string[];
  commandCategories: string[];
  canCreateChannel: boolean;
  canManageMembers: boolean;
  canInviteByPlanet: boolean;
  canCreateSchedules: boolean;
  canDirectMessageAgentIds: string[];
  canDispatchAgentIds: string[];
}

export interface AgentTemplateToolPolicyView {
  cliEnabled: boolean;
  maxSteps: number;
  maxToolCallsPerTurn: number;
  commandWhitelist: string[];
}

export type AgentTemplateProviderConfigView =
  | {
      baseUrl: string;
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

export interface AgentTemplateView {
  id: string;
  name: string;
  providerKind: AgentProviderKindView;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: AgentTemplateToolPolicyView;
  providerConfig: AgentTemplateProviderConfigView;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTemplatePayload {
  name: string;
  providerKind: AgentProviderKindView;
  description: string;
  defaultModel: string;
  systemPrompt: string;
  toolPolicy: AgentTemplateToolPolicyView;
  providerConfig: AgentTemplateProviderConfigView;
}

export interface AgentProfileView {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'queued' | 'running' | 'cooldown' | 'paused' | 'error' | 'completed';
  role?: 'worker' | 'manager' | 'director';
  policy?: AgentPolicyView;
}

export interface CreateAgentPayload {
  id?: string;
  name: string;
  templateId: string;
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
  createdAt: string;
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
