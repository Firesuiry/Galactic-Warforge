export type ProviderKind = 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';

export interface ProviderCapability {
  available: boolean;
  reason?: string;
}

export interface GatewayCapabilities {
  status: 'ok';
  providers: Record<ProviderKind, ProviderCapability>;
}

export interface OpenAICompatibleProviderConfig {
  baseUrl: string;
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

export interface AgentTemplate {
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
  providerConfig: OpenAICompatibleProviderConfig | CliProviderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstance {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  playerKeySecretId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  goal: string;
  activeThreadId: string;
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
