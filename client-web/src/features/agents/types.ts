export interface AgentGatewayHealth {
  status: string;
}

export interface AgentTemplateSummary {
  id: string;
  name: string;
  providerKind: 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';
  description?: string;
  defaultModel?: string;
}

export interface AgentInstanceSummary {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  goal: string;
  activeThreadId: string;
}

export interface AgentThreadView {
  id: string;
  agentId: string;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    createdAt: string;
  }>;
  toolCalls: Array<{
    type: string;
    payload: Record<string, unknown>;
  }>;
  executionLogs: Array<{
    level: 'info' | 'error';
    message: string;
    createdAt: string;
  }>;
}
