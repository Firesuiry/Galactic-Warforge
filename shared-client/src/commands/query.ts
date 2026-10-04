import type { CommandContext } from './game-commands.js';
import { DEFAULT_SYSTEM_ID, DEFAULT_PLANET_ID } from '../config.js';
import {
  fmtError,
  fmtFogScene,
  fmtFleetDetail,
  fmtFleetList,
  fmtGalaxy,
  fmtHealth,
  fmtMetrics,
  fmtPlanetRuntime,
  fmtPlanetSummary,
  fmtStats,
  fmtSummary,
  fmtAgentBriefing,
  fmtCommandCatalog,
  fmtSystem,
  fmtSystemRuntime,
  fmtWarBlueprintDetail,
  fmtWarBlueprintList,
  fmtWarIndustry,
  fmtWarTaskForces,
  fmtWarTheaters,
} from './format.js';
import type { PlanetSceneParams } from '../api.js';
import { parseArgs, parseIntegerArg } from './args.js';

function parseRequiredInteger(raw: string | undefined, label: string): number {
  const value = parseIntegerArg(raw);
  if (value === undefined) {
    throw new Error(`${label} 必须是整数`);
  }
  return value;
}

export async function cmdHealth(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtHealth(await api.fetchHealth());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdMetrics(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtMetrics(await api.fetchMetrics());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdSummary(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtSummary(await api.fetchSummary());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdStats(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtStats(await api.fetchStats());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdBriefing(args: string[], { api }: CommandContext): Promise<string> {
  try {
    let alertLimit: number | undefined;
    if (args[0] !== undefined && args[0] !== '') {
      alertLimit = parseRequiredInteger(args[0], 'alert_limit');
    }
    return fmtAgentBriefing(await api.fetchAgentBriefing(alertLimit !== undefined ? { alert_limit: alertLimit } : undefined));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdCatalogCommands(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtCommandCatalog(await api.fetchCommandCatalog());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdGalaxy(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtGalaxy(await api.fetchGalaxy());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdSystem(args: string[], { api }: CommandContext): Promise<string> {
  const systemId = args[0] ?? DEFAULT_SYSTEM_ID;
  try {
    return fmtSystem(await api.fetchSystem(systemId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdPlanet(args: string[], { api }: CommandContext): Promise<string> {
  const planetId = args[0] ?? DEFAULT_PLANET_ID;
  try {
    return fmtPlanetSummary(await api.fetchPlanet(planetId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdSystemRuntime(args: string[], { api }: CommandContext): Promise<string> {
  const systemId = args[0] ?? DEFAULT_SYSTEM_ID;
  try {
    return fmtSystemRuntime(await api.fetchSystemRuntime(systemId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdFleetStatus(args: string[], { api }: CommandContext): Promise<string> {
  try {
    if (!args[0]) {
      return fmtFleetList(await api.fetchFleets());
    }
    return fmtFleetDetail(await api.fetchFleet(args[0]));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdPlanetRuntime(args: string[], { api }: CommandContext): Promise<string> {
  const planetId = args[0] ?? DEFAULT_PLANET_ID;
  try {
    return fmtPlanetRuntime(await api.fetchPlanetRuntime(planetId));
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdBlueprints(args: string[], { api }: CommandContext): Promise<string> {
  try {
    if (args[0]) {
      return fmtWarBlueprintDetail(await api.fetchWarfareBlueprint(args[0]));
    }
    return fmtWarBlueprintList(await api.fetchWarfareBlueprints());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdWarIndustry(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtWarIndustry(await api.fetchWarIndustry());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdTaskForces(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtWarTaskForces(await api.fetchWarTaskForces());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdTheaters(_args: string[], { api }: CommandContext): Promise<string> {
  try {
    return fmtWarTheaters(await api.fetchWarTheaters());
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdScene(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;

  try {
    const request: PlanetSceneParams = {
      x: parseRequiredInteger(parsed.positionals[1], 'x'),
      y: parseRequiredInteger(parsed.positionals[2], 'y'),
      width: parseRequiredInteger(parsed.positionals[3], 'width'),
      height: parseRequiredInteger(parsed.positionals[4], 'height'),
    };
    for (const key of ['near_x', 'near_y', 'radius'] as const) {
      if (parsed.options[key] !== undefined) request[key] = parseRequiredInteger(String(parsed.options[key]), key);
    }
    return JSON.stringify(await api.fetchPlanetScene(planetId, request), null, 2);
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdInspect(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;
  const entityKind = parsed.positionals[1];
  const entityId = parsed.positionals[2];

  if (!entityKind || !entityId) {
    return fmtError('用法: inspect <planet_id> <building|unit|resource|sector> <entity_id>');
  }

  try {
    return JSON.stringify(await api.fetchPlanetInspect(planetId, {
      entityKind: entityKind as 'building' | 'unit' | 'resource' | 'sector',
      entityId: entityKind === 'sector' ? undefined : entityId,
      sectorId: entityKind === 'sector' ? entityId : undefined,
    }), null, 2);
  } catch (e) {
    return fmtError(String(e));
  }
}

export async function cmdFog(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;
  const x = parseIntegerArg(parsed.positionals[1]) ?? 0;
  const y = parseIntegerArg(parsed.positionals[2]) ?? 0;
  const width = parseIntegerArg(parsed.positionals[3]) ?? 32;
  const height = parseIntegerArg(parsed.positionals[4]) ?? 16;

  if (width <= 0 || height <= 0) {
    return fmtError('width 和 height 必须是正整数');
  }

  try {
    const scene = await api.fetchPlanetScene(planetId, {
      x,
      y,
      width,
      height,
    });
    return fmtFogScene(scene);
  } catch (e) {
    return fmtError(String(e));
  }
}
