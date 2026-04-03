export interface AgentExportBundle {
  manifest: {
    version: 1;
    exportedAt: string;
    appVersion: string;
  };
  templates: unknown[];
  encryptedSecrets?: unknown[];
}

export function exportBundle(input: {
  templates: unknown[];
  includeSecrets: boolean;
  encryptedSecrets: unknown[];
}): AgentExportBundle {
  return {
    manifest: {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
    },
    templates: input.templates,
    ...(input.includeSecrets ? { encryptedSecrets: input.encryptedSecrets } : {}),
  };
}
