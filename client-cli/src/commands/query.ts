import { fetchHealth, fetchMetrics, fetchSummary, fetchStats, fetchGalaxy, fetchSystem, fetchPlanet, fetchFogMap } from '../api.js';
import { fmtHealth, fmtMetrics, fmtSummary, fmtStats, fmtGalaxy, fmtSystem, fmtPlanet, fmtError } from '../format.js';
import { DEFAULT_SYSTEM_ID, DEFAULT_PLANET_ID } from '../config.js';

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
    return fmtPlanet(await fetchPlanet(planetId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdFogmap(args: string[]): Promise<string> {
  const planetId = args[0] ?? DEFAULT_PLANET_ID;
  try {
    return JSON.stringify(await fetchFogMap(planetId), null, 2);
  } catch (e) {
    return fmtError(String(e));
  }
}
