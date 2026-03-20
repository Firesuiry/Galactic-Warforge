import { SERVER_URL, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from './config.js';
import type {
  StateSummary, PlanetView, FogMapView, GalaxyView, SystemView,
  CommandRequest, CommandResponse, HealthResponse, MetricsSnapshot,
  Command,
} from './types.js';

let _playerId = '';
let _playerKey = '';

export function setAuth(playerId: string, playerKey: string) {
  _playerId = playerId;
  _playerKey = playerKey;
}

export function getAuth(): { playerId: string; playerKey: string } {
  return { playerId: _playerId, playerKey: _playerKey };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (_playerKey) {
    headers['Authorization'] = `Bearer ${_playerKey}`;
  }
  const res = await fetch(`${SERVER_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Public read endpoints ──────────────────────────────────────────────────

export function fetchHealth(): Promise<HealthResponse> {
  return fetch(`${SERVER_URL}/health`).then(r => r.json());
}

export function fetchMetrics(): Promise<MetricsSnapshot> {
  return fetch(`${SERVER_URL}/metrics`).then(r => r.json());
}

export function fetchSummary(): Promise<StateSummary> {
  return apiFetch<StateSummary>('/state/summary');
}

export function fetchGalaxy(): Promise<GalaxyView> {
  return apiFetch<GalaxyView>('/world/galaxy');
}

export function fetchSystem(systemId: string): Promise<SystemView> {
  return apiFetch<SystemView>(`/world/systems/${systemId}`);
}

export function fetchPlanet(planetId: string): Promise<PlanetView> {
  return apiFetch<PlanetView>(`/world/planets/${planetId}`);
}

export function fetchFogMap(planetId: string): Promise<FogMapView> {
  return apiFetch<FogMapView>(`/world/planets/${planetId}/fog`);
}

// ── Command helpers ────────────────────────────────────────────────────────

export async function sendCommands(commands: Command[]): Promise<CommandResponse> {
  const req: CommandRequest = {
    request_id: crypto.randomUUID(),
    issuer_type: 'player',
    issuer_id: _playerId,
    commands,
  };
  return sendCommandRequest(req);
}

export function cmdScanGalaxy(galaxyId = 'galaxy-1'): Promise<CommandResponse> {
  return sendCommands([{
    type: 'scan_galaxy',
    target: { layer: 'galaxy', galaxy_id: galaxyId },
  }]);
}

export function cmdScanSystem(systemId = DEFAULT_SYSTEM_ID): Promise<CommandResponse> {
  return sendCommands([{
    type: 'scan_system',
    target: { layer: 'system', system_id: systemId },
  }]);
}

export function cmdScanPlanet(planetId = DEFAULT_PLANET_ID): Promise<CommandResponse> {
  return sendCommands([{
    type: 'scan_planet',
    target: { layer: 'planet', planet_id: planetId },
  }]);
}

export function sendCommandRequest(req: CommandRequest): Promise<CommandResponse> {
  return apiFetch<CommandResponse>('/commands', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
