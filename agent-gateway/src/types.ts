export type ProviderKind = 'openai_compatible_http' | 'codex_cli' | 'claude_code_cli';

export interface ProviderCapability {
  available: boolean;
  reason?: string;
}

export interface GatewayCapabilities {
  status: 'ok';
  providers: Record<ProviderKind, ProviderCapability>;
}
