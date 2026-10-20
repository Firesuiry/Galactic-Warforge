import { resolveIssuerId, type CommandContext } from './game-commands.js';
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
  fmtMechaInventory,
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
import { getStringOption, hasFlag, parseArgs, parseIntegerArg } from './args.js';
import { selectMyMecha } from '../mecha.js';
import { centeredWindow, fetchPlanetContext, type PlanetContext } from './scene-context.js';
import { fmtInspect, fmtNetworks, fmtScene, operatorMap, SCENE_SECTION_LIMIT } from './scene-format.js';

/** 省略窗口时以我的机甲为中心的边长（服务端最大窗口 257，48 够看一屏产线）。 */
const DEFAULT_SCENE_SIZE = 48;

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

export async function cmdSummary(_args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  try {
    const summary = await api.fetchSummary();
    const mecha = selectMyMecha(summary.players?.[api.getAuth().playerId], resolveIssuerId(ctx));
    return [fmtSummary(summary), fmtMechaInventory(mecha)].join('\n');
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

export async function cmdBriefing(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  try {
    let alertLimit: number | undefined;
    if (args[0] !== undefined && args[0] !== '') {
      alertLimit = parseRequiredInteger(args[0], 'alert_limit');
    }
    return fmtAgentBriefing(
      await api.fetchAgentBriefing(alertLimit !== undefined ? { alert_limit: alertLimit } : undefined),
      resolveIssuerId(ctx),
    );
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

export async function cmdPlanetRuntime(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;
  try {
    const runtime = await api.fetchPlanetRuntime(planetId);
    if (!hasFlag(parsed, 'mine')) {
      return fmtPlanetRuntime(runtime);
    }
    // --mine：只看自己机甲的施工任务。先按发令者找机甲（跨行星都算），
    // 找不到再退回「本行星上 operator 是我的机甲」。
    const summary = await api.fetchSummary();
    const issuerId = resolveIssuerId(ctx);
    const mecha = selectMyMecha(summary.players?.[api.getAuth().playerId], issuerId);
    if (!mecha) {
      return `${fmtPlanetRuntime(runtime, { mineOnly: true })}\n${fmtError(`当前发令者 ${issuerId} 未绑定机甲：mecha list / mecha assign <id>`)}`;
    }
    return fmtPlanetRuntime(runtime, { mineOnly: true, myMechaId: mecha.unit_id });
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

/** fetch 抛的是 Error，直接 String(e) 会得到「Error: Error: …」；取 message。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `scene [planet] [x y w h] [--near_x X --near_y Y --radius R] [--json] [--limit N|all]`
 *
 * - 省略 planet：我的机甲所在星球（summary.mechas 里 operator=发令者），否则焦点星球；
 * - 省略窗口：以我的机甲为中心 48×48（无机甲时从 0,0 起）；
 * - 位置参数一律按数字/非数字区分，不再把省略 planet 时的 x 当成 planet。
 */
export async function cmdScene(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  const wantsJson = parsed.options.json === true;
  const positionals = parsed.positionals;

  let planetArg: string | undefined;
  let windowArgs: string[];
  if (positionals.length >= 5) {
    [planetArg, ...windowArgs] = positionals;
  } else if (positionals.length === 4) {
    windowArgs = positionals;
  } else if (positionals.length === 1) {
    planetArg = positionals[0];
    windowArgs = [];
  } else if (positionals.length === 0) {
    windowArgs = [];
  } else {
    return fmtError('用法: scene [planet] [x y w h] [--near_x X --near_y Y --radius R] [--json]');
  }
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}（用法: scene [planet] [x y w h]）`);
  }
  // --limit：N（正整数）或 all；在发请求前校验，别等拉完场景才报错。
  const limitRaw = getStringOption(parsed, 'limit');
  if (parsed.options.limit !== undefined && limitRaw === undefined) {
    return fmtError('--limit 必须是正整数或 all');
  }
  let limit = SCENE_SECTION_LIMIT;
  if (limitRaw === 'all') {
    limit = Number.POSITIVE_INFINITY;
  } else if (limitRaw !== undefined) {
    const parsedLimit = parseIntegerArg(limitRaw);
    if (parsedLimit === undefined || parsedLimit <= 0) {
      return fmtError('--limit 必须是正整数或 all');
    }
    limit = parsedLimit;
  }

  try {
    const needContext = planetArg === undefined || windowArgs.length === 0;
    const context = needContext ? await fetchPlanetContext(api, resolveIssuerId(ctx)) : undefined;
    const planetId = planetArg ?? context!.planetId;

    let request: PlanetSceneParams;
    if (windowArgs.length === 4) {
      request = {
        x: parseRequiredInteger(windowArgs[0], 'x'),
        y: parseRequiredInteger(windowArgs[1], 'y'),
        width: parseRequiredInteger(windowArgs[2], 'width'),
        height: parseRequiredInteger(windowArgs[3], 'height'),
      };
    } else {
      const planet = await api.fetchPlanet(planetId);
      // 显式给了别的星球时，我的机甲不在这颗星上，不能拿它当窗口中心。
      const anchor = context?.planetId === planetId ? context.mecha : undefined;
      request = centeredWindow(anchor, DEFAULT_SCENE_SIZE, planet.map_width, planet.map_height);
    }
    for (const key of ['near_x', 'near_y', 'radius'] as const) {
      if (parsed.options[key] !== undefined) request[key] = parseRequiredInteger(String(parsed.options[key]), key);
    }
    const scene = await api.fetchPlanetScene(planetId, request);
    if (wantsJson) {
      return JSON.stringify(scene, null, 2);
    }
    if (!scene.discovered) {
      return fmtError(`星球 ${planetId} 尚未发现`);
    }
    const summary = context === undefined ? await api.fetchSummary() : undefined;
    const mechas = context?.mecha ? [context.mecha] : summary?.players?.[api.getAuth().playerId]?.mechas;
    return fmtScene(scene, {
      limit,
      operators: operatorMap(mechas),
      // 显式给了 planet 时不打印「默认星球」提示行，免得误导。
      context: planetArg === undefined ? context : undefined,
    });
  } catch (e) {
    return fmtError(errorMessage(e));
  }
}

const INSPECT_KINDS = new Set(['building', 'unit', 'resource', 'sector']);

/** 由实体 id 前缀推断 inspect 类型；认不出返回 undefined。 */
export function inferInspectKind(entityId: string): 'building' | 'unit' | 'resource' | 'sector' | undefined {
  if (entityId.startsWith('b-')) return 'building';
  if (entityId.startsWith('u-')) return 'unit';
  if (entityId.startsWith('res-') || entityId.includes('-res-')) return 'resource';
  if (/^\d+:\d+$/.test(entityId)) return 'sector';
  return undefined;
}

/**
 * `inspect [planet] <entity_id>` / `inspect [planet] <kind> <entity_id>`。
 *
 * - 省略 planet：同 `scene`（我的机甲所在星球 → 焦点星球）；
 * - 省略 kind：按 id 前缀推断（b- 建筑、u- 单位、res- 资源、`x:y` 扇区）；
 * - 默认输出人话摘要，`--json` 输出原始 JSON。
 */
export async function cmdInspect(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  const wantsJson = parsed.options.json === true;
  const positionals = parsed.positionals;
  if (hasFlag(parsed, 'help')) {
    return '用法: inspect [planet] [building|unit|resource|sector] <entity_id> [--json]';
  }
  if (positionals.length === 0) {
    return fmtError('用法: inspect [planet] [building|unit|resource|sector] <entity_id> [--json]');
  }

  let planetArg: string | undefined;
  let kindArg: string | undefined;
  let entityId: string;
  if (positionals.length >= 3) {
    [planetArg, kindArg, entityId] = positionals;
  } else if (positionals.length === 2) {
    const [first, second] = positionals;
    if (INSPECT_KINDS.has(first.toLowerCase())) {
      kindArg = first.toLowerCase();
      entityId = second;
    } else {
      planetArg = first;
      entityId = second;
    }
  } else {
    entityId = positionals[0];
  }
  const kind = (kindArg?.toLowerCase() ?? inferInspectKind(entityId)) as
    | 'building' | 'unit' | 'resource' | 'sector' | undefined;
  if (!kind) {
    return fmtError(`无法从 id 推断类型：${entityId}（显式写 inspect <planet> <building|unit|resource|sector> <id>）`);
  }
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}（用法: inspect [planet] [kind] <id>）`);
  }

  try {
    let context: PlanetContext | undefined;
    if (planetArg === undefined) {
      context = await fetchPlanetContext(api, resolveIssuerId(ctx));
    }
    const planetId = planetArg ?? context!.planetId;
    const view = await api.fetchPlanetInspect(planetId, {
      entityKind: kind,
      entityId: kind === 'sector' ? undefined : entityId,
      sectorId: kind === 'sector' ? entityId : undefined,
    });
    if (wantsJson) {
      return JSON.stringify(view, null, 2);
    }
    if (!view.discovered) {
      return fmtError(`星球 ${planetId} 尚未发现`);
    }
    const mechas = context?.mecha
      ? [context.mecha]
      : (await api.fetchSummary()).players?.[api.getAuth().playerId]?.mechas;
    return fmtInspect(view, { operator: operatorMap(mechas).get(entityId) });
  } catch (e) {
    return fmtError(errorMessage(e));
  }
}

export async function cmdNetworks(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  const wantsJson = parsed.options.json === true;
  const planetArg = parsed.positionals[0];
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}（用法: networks [planet] [--json]）`);
  }
  try {
    const context = planetArg === undefined ? await fetchPlanetContext(api, resolveIssuerId(ctx)) : undefined;
    const planetId = planetArg ?? context!.planetId;
    const view = await api.fetchPlanetNetworks(planetId);
    return wantsJson ? JSON.stringify(view, null, 2) : fmtNetworks(view, context);
  } catch (e) {
    return fmtError(errorMessage(e));
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
