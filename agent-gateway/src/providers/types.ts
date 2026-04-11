export interface ProviderAction {
  type?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ProviderTurnRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderTurnResult {
  assistantMessage: string;
  actions: ProviderAction[];
  done: boolean;
}

export interface ProviderProbeResult {
  available: boolean;
  reason?: string;
}
