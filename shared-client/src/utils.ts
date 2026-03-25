export function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

export function resolveServerUrl(serverUrl: string, path: string): string {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!normalizedServerUrl) {
    return normalizedPath;
  }
  return `${normalizedServerUrl}${normalizedPath}`;
}
