export interface AgentGatewayHealth {
  status: string;
}

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

export interface ConversationView {
  id: string;
  type: 'channel' | 'dm';
  name: string;
  topic: string;
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
  targetType: 'agent_dm' | 'conversation';
  targetId: string;
  intervalSeconds: number;
  messageTemplate: string;
  enabled: boolean;
}
