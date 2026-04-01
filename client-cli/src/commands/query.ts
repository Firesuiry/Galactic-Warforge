import { fetchHealth, fetchMetrics, fetchSummary, fetchStats, fetchGalaxy, fetchSystem, fetchPlanet, fetchPlanetInspect, fetchPlanetScene } from '../api.js';
import { DEFAULT_SYSTEM_ID, DEFAULT_PLANET_ID } from '../config.js';
import { fmtError, fmtGalaxy, fmtHealth, fmtMetrics, fmtPlanetSummary, fmtStats, fmtSummary, fmtSystem } from '../format.js';
import type { PlanetSceneParams } from '../api.js';
import { parseArgs, parseIntegerArg } from './args.js';

function parseRequiredInteger(raw: string | undefined, label: string): number {
  const value = parseIntegerArg(raw);
  if (value === undefined) {
    throw new Error(`${label} 必须是整数`);
  }
  return value;
}

export async function cmdHealth(_args: string[]): Promise<string> {
  try {
    return fmtHealth(await fetchHealth());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdMetrics(_args: string[]): Promise<string> {
  try {
    return fmtMetrics(await fetchMetrics());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdSummary(_args: string[]): Promise<string> {
  try {
    return fmtSummary(await fetchSummary());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdStats(_args: string[]): Promise<string> {
  try {
    return fmtStats(await fetchStats());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdGalaxy(_args: string[]): Promise<string> {
  try {
    return fmtGalaxy(await fetchGalaxy());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdSystem(args: string[]): Promise<string> {
  const systemId = args[0] ?? DEFAULT_SYSTEM_ID;
  try {
    return fmtSystem(await fetchSystem(systemId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdPlanet(args: string[]): Promise<string> {
  const planetId = args[0] ?? DEFAULT_PLANET_ID;
  try {
    return fmtPlanetSummary(await fetchPlanet(planetId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdScene(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;

  try {
    const request: PlanetSceneParams = {
      x: parseRequiredInteger(parsed.positionals[1], 'x'),
      y: parseRequiredInteger(parsed.positionals[2], 'y'),
      width: parseRequiredInteger(parsed.positionals[3], 'width'),
      height: parseRequiredInteger(parsed.positionals[4], 'height'),
    };
    return JSON.stringify(await fetchPlanetScene(planetId, request), null, 2);
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdInspect(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;
  const entityKind = parsed.positionals[1];
  const entityId = parsed.positionals[2];

  if (!entityKind || !entityId) {
    return fmtError('用法: inspect <planet_id> <building|unit|resource|sector> <entity_id>');
  }

  try {
    return JSON.stringify(await fetchPlanetInspect(planetId, {
      entityKind: entityKind as 'building' | 'unit' | 'resource' | 'sector',
      entityId: entityKind === 'sector' ? undefined : entityId,
      sectorId: entityKind === 'sector' ? entityId : undefined,
    }), null, 2);
  } catch (e) {
    return fmtError(String(e));
  }
}
