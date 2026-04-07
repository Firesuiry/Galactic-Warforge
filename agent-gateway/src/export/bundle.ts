export interface AgentExportBundle {
  manifest: {
    version: 1;
    exportedAt: string;
    appVersion: string;
  };
  providers: unknown[];
  encryptedSecrets?: unknown[];
}

export function exportBundle(input: {
  providers: unknown[];
  includeSecrets: boolean;
  encryptedSecrets: unknown[];
}): AgentExportBundle {
  return {
    manifest: {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
    },
    providers: input.providers,
    ...(input.includeSecrets ? { encryptedSecrets: input.encryptedSecrets } : {}),
  };
}
