export type AgentAction =
  | { type: 'game.query'; query: string; args?: Record<string, unknown> }
  | { type: 'game.command'; command: Record<string, unknown> }
  | { type: 'game.cli'; commandLine: string }
  | { type: 'memory.note'; note: string }
  | { type: 'final_answer'; message: string };

export interface ProviderTurnRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderTurnResult {
  assistantMessage: string;
  actions: AgentAction[];
  done: boolean;
}

export interface ProviderProbeResult {
  available: boolean;
  reason?: string;
}
