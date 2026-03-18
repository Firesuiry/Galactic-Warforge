import { SERVER_URL, DEFAULT_PLANET_ID } from './config.js';
import type {
  StateSummary, PlanetView, FogMapView, GalaxyView, SystemView,
  CommandRequest, CommandResponse, HealthResponse, MetricsSnapshot,
  BuildingType, UnitType, Command,
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
  return apiFetch<GalaxyView>('/galaxy');
}

export function fetchSystem(systemId: string): Promise<SystemView> {
  return apiFetch<SystemView>(`/systems/${systemId}`);
}

export function fetchPlanet(planetId: string): Promise<PlanetView> {
  return apiFetch<PlanetView>(`/planets/${planetId}`);
}

export function fetchFogMap(_planetId: string): Promise<FogMapView> {
  return apiFetch<FogMapView>('/fogmap');
}

// ── Command helpers ────────────────────────────────────────────────────────

export async function sendCommands(commands: Command[]): Promise<CommandResponse> {
  const req: CommandRequest = {
    request_id: crypto.randomUUID(),
    issuer_type: 'player',
    issuer_id: _playerId,
    commands,
  };
  return apiFetch<CommandResponse>('/commands', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function cmdBuild(x: number, y: number, buildingType: BuildingType): Promise<CommandResponse> {
  return sendCommands([{
    type: 'build',
    target: { layer: 'planet', planet_id: DEFAULT_PLANET_ID, position: { x, y, z: 0 } },
    payload: { building_type: buildingType },
  }]);
}

export function cmdMove(unitId: string, x: number, y: number): Promise<CommandResponse> {
  return sendCommands([{
    type: 'move',
    target: { layer: 'planet', entity_id: unitId, position: { x, y, z: 0 } },
  }]);
}

export function cmdAttack(attackerId: string, targetId: string): Promise<CommandResponse> {
  return sendCommands([{
    type: 'attack',
    target: { layer: 'planet', entity_id: attackerId },
    payload: { target_entity_id: targetId },
  }]);
}

export function cmdProduce(factoryId: string, unitType: UnitType): Promise<CommandResponse> {
  return sendCommands([{
    type: 'produce',
    target: { layer: 'planet', entity_id: factoryId },
    payload: { unit_type: unitType },
  }]);
}

export function cmdUpgrade(entityId: string): Promise<CommandResponse> {
  return sendCommands([{
    type: 'upgrade',
    target: { layer: 'planet', entity_id: entityId },
  }]);
}

export function cmdDemolish(entityId: string): Promise<CommandResponse> {
  return sendCommands([{
    type: 'demolish',
    target: { layer: 'planet', entity_id: entityId },
  }]);
}

export function sendRawCommands(rawJson: string): Promise<CommandResponse> {
  const parsed = JSON.parse(rawJson) as Command[];
  return sendCommands(parsed);
}
