import chalk from 'chalk';

import { NO_MECHA_HINT, selectMyMecha } from '../mecha.js';
import type {
  Building,
  ConstructionTaskView,
  Footprint,
  Unit,
} from '../types.js';
import { getStringOption, hasFlag, parseArgs, parseIntegerArg } from './args.js';
import { fmtError } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';
import { fetchPlanetContext, fmtPlanetContext } from './scene-context.js';

/** 窗口半径：默认 48，服务端上限 128。 */
const DEFAULT_RADIUS = 48;
const MAX_RADIUS = 128;
/** 默认返回条数。 */
const DEFAULT_COUNT = 5;
/**
 * 场景窗口在目标窗口外再扩几格：`scene` 的建筑/单位按**锚点**过滤，
 * 锚点落在窗口外、占地压进窗口的建筑不会出现在响应里。最大占地 5×5，
 * 扩 4 格足以覆盖所有「锚点在外、占地在内」的情况。
 */
const FETCH_MARGIN = 4;
/** 视为「未落成」的施工状态；completed/cancelled 不占位。 */
const LIVE_TASK_STATES = new Set(['pending', 'in_progress', 'paused']);
/** 不占地面格的单位域（其余一律按地面单位占位）。 */
const NON_GROUND_DOMAINS = new Set(['space', 'orbital', 'air']);

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpaceResult {
  x: number;
  y: number;
  /** 到搜索锚点的距离（--near 未给时锚点就是机甲）。 */
  distance: number;
  /** 到我的机甲的距离；机甲不在本星球时等于 distance。 */
  mechaDistance: number;
  terrain: string;
}

export interface SpaceSearchResult {
  results: SpaceResult[];
  /** 跨立方体球面缝、被跳过的候选矩形数（同一面内才有效）。 */
  skippedSeam: number;
  /** 候选矩形总数（含被跳过的），用于「无解」时解释。 */
  candidates: number;
}

/** 按 rotation 交换宽高（与服务端 RotatedFootprint 同口径）。 */
export function rotatedFootprint(footprint: Footprint, rotation?: string): Footprint {
  if (rotation === '90' || rotation === '270') {
    return { width: footprint.height, height: footprint.width };
  }
  return footprint;
}

function markRect(blocked: boolean[][], bounds: Rect, rect: Rect): void {
  const x0 = Math.max(rect.x, bounds.x);
  const y0 = Math.max(rect.y, bounds.y);
  const x1 = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const y1 = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      blocked[y - bounds.y][x - bounds.x] = true;
    }
  }
}

export interface BlockedGridInput {
  /** 场景实际返回的窗口（以 scene.bounds 为准，服务端可能裁剪/平移）。 */
  bounds: Rect;
  terrain?: string[][];
  buildings?: Building[];
  units?: Unit[];
  tasks?: ConstructionTaskView[];
  /** building_type -> 目录占地（施工任务没有 runtime 时用）。 */
  footprints: Map<string, Footprint>;
}

/**
 * 把「不可建」格标成 true：地形不可建、建筑占地（按实际占地而非锚点）、
 * 地面单位所在格、未落成的施工任务占地（同玩家；服务端只下发自己的任务）。
 */
export function buildBlockedGrid(input: BlockedGridInput): boolean[][] {
  const { bounds } = input;
  const blocked = Array.from({ length: bounds.height }, () => new Array<boolean>(bounds.width).fill(false));
  if (input.terrain) {
    for (let y = 0; y < bounds.height; y += 1) {
      const row = input.terrain[y] ?? [];
      for (let x = 0; x < bounds.width; x += 1) {
        if ((row[x] ?? 'unknown') !== 'buildable') {
          blocked[y][x] = true;
        }
      }
    }
  }
  for (const building of input.buildings ?? []) {
    const footprint = building.runtime?.params?.footprint ?? input.footprints.get(building.type);
    if (!footprint || footprint.width <= 0 || footprint.height <= 0) {
      continue;
    }
    markRect(blocked, bounds, {
      x: building.position.x,
      y: building.position.y,
      width: footprint.width,
      height: footprint.height,
    });
  }
  for (const unit of input.units ?? []) {
    if (unit.domain && NON_GROUND_DOMAINS.has(unit.domain)) {
      continue;
    }
    markRect(blocked, bounds, { x: unit.position.x, y: unit.position.y, width: 1, height: 1 });
  }
  for (const task of input.tasks ?? []) {
    if (!LIVE_TASK_STATES.has(task.state)) {
      continue;
    }
    // 高架传送带只占自己那一格（服务端 ReservationKey），地面任务占整个占地。
    const elevated = (task.elevation ?? 0) > 0;
    const footprint = elevated
      ? { width: 1, height: 1 }
      : rotatedFootprint(input.footprints.get(task.building_type) ?? { width: 0, height: 0 }, task.rotation);
    if (footprint.width <= 0 || footprint.height <= 0) {
      continue;
    }
    markRect(blocked, bounds, {
      x: task.position.x,
      y: task.position.y,
      width: footprint.width,
      height: footprint.height,
    });
  }
  return blocked;
}

/** 二维前缀和：sum[y][x] = 左上角 [0,0)..[x,y) 的占用格数。 */
export function prefixSum(blocked: boolean[][]): number[][] {
  const height = blocked.length;
  const width = height > 0 ? blocked[0].length : 0;
  const sum = Array.from({ length: height + 1 }, () => new Array<number>(width + 1).fill(0));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sum[y + 1][x + 1] = (blocked[y][x] ? 1 : 0) + sum[y][x + 1] + sum[y + 1][x] - sum[y][x];
    }
  }
  return sum;
}

function rectSum(sum: number[][], x: number, y: number, width: number, height: number): number {
  return sum[y + height][x + width] - sum[y][x + width] - sum[y + height][x] + sum[y][x];
}

/** 锚点到矩形最近一格的欧氏距离（锚点在矩形内时为 0）。 */
export function distanceToRect(anchor: { x: number; y: number }, rect: Rect): number {
  const dx = anchor.x < rect.x ? rect.x - anchor.x
    : anchor.x > rect.x + rect.width - 1 ? anchor.x - (rect.x + rect.width - 1) : 0;
  const dy = anchor.y < rect.y ? rect.y - anchor.y
    : anchor.y > rect.y + rect.height - 1 ? anchor.y - (rect.y + rect.height - 1) : 0;
  return Math.round(Math.hypot(dx, dy));
}

export interface FindSpaceInput {
  bounds: Rect;
  search: Rect;
  blocked: boolean[][];
  size: { width: number; height: number };
  anchor: { x: number; y: number };
  count: number;
  /** 立方体球面每面边长；缺省/0 时不做跨面检查。 */
  faceSize?: number;
  /** 候选之间的最小锚点曼哈顿距离；缺省/0 不去重。 */
  spacing?: number;
  /** 机甲位置（输出「距机甲」用）；缺省等于 anchor。 */
  mechaAnchor?: { x: number; y: number };
}

/**
 * 在 search 窗口内枚举所有 size 的全空矩形，按距锚点升序取前 count 条。
 * `spacing > 0` 时贪心取分散候选：已选候选的锚点曼哈顿距离必须 ≥ spacing。
 */
export function findSpaceRects(input: FindSpaceInput): SpaceSearchResult {
  const { bounds, search, blocked, size, anchor, count, faceSize, spacing = 0, mechaAnchor } = input;
  const sum = prefixSum(blocked);
  const results: SpaceResult[] = [];
  let skippedSeam = 0;
  let candidates = 0;
  const maxX = search.x + search.width - size.width;
  const maxY = search.y + search.height - size.height;
  for (let y = Math.max(search.y, bounds.y); y <= maxY; y += 1) {
    for (let x = Math.max(search.x, bounds.x); x <= maxX; x += 1) {
      if (x + size.width > bounds.x + bounds.width || y + size.height > bounds.y + bounds.height) {
        continue;
      }
      candidates += 1;
      if (
        faceSize && faceSize > 0
        && (Math.floor(x / faceSize) !== Math.floor((x + size.width - 1) / faceSize)
          || Math.floor(y / faceSize) !== Math.floor((y + size.height - 1) / faceSize))
      ) {
        skippedSeam += 1;
        continue;
      }
      if (rectSum(sum, x - bounds.x, y - bounds.y, size.width, size.height) !== 0) {
        continue;
      }
      results.push({
        x,
        y,
        distance: distanceToRect(anchor, { x, y, ...size }),
        mechaDistance: distanceToRect(mechaAnchor ?? anchor, { x, y, ...size }),
        terrain: 'buildable',
      });
    }
  }
  results.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  if (spacing <= 0) {
    return { results: results.slice(0, count), skippedSeam, candidates };
  }
  const picked: SpaceResult[] = [];
  for (const spot of results) {
    if (picked.length >= count) {
      break;
    }
    if (picked.every((chosen) => Math.abs(chosen.x - spot.x) + Math.abs(chosen.y - spot.y) >= spacing)) {
      picked.push(spot);
    }
  }
  return { results: picked, skippedSeam, candidates };
}

/** 候选之间是否互相重叠（占地矩形相交）。 */
export function hasOverlap(results: SpaceResult[], size: { width: number; height: number }): boolean {
  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      const a = results[i];
      const b = results[j];
      if (a.x < b.x + size.width && b.x < a.x + size.width && a.y < b.y + size.height && b.y < a.y + size.height) {
        return true;
      }
    }
  }
  return false;
}

function expandRect(rect: Rect, margin: number, mapWidth: number, mapHeight: number): Rect {
  const x = Math.max(0, rect.x - margin);
  const y = Math.max(0, rect.y - margin);
  const right = Math.min(mapWidth, rect.x + rect.width + margin);
  const bottom = Math.min(mapHeight, rect.y + rect.height + margin);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** 以锚点为中心、半径 radius 的方形窗口，按图集尺寸裁剪。 */
export function radiusWindow(anchor: { x: number; y: number }, radius: number, mapWidth: number, mapHeight: number): Rect {
  const width = Math.max(1, Math.min(radius * 2 + 1, mapWidth));
  const height = Math.max(1, Math.min(radius * 2 + 1, mapHeight));
  const x = Math.min(Math.max(0, anchor.x - radius), Math.max(0, mapWidth - width));
  const y = Math.min(Math.max(0, anchor.y - radius), Math.max(0, mapHeight - height));
  return { x, y, width, height };
}

function fmtRect(rect: Rect): string {
  return `x=${rect.x}..${rect.x + rect.width - 1} y=${rect.y}..${rect.y + rect.height - 1}`;
}

/**
 * `find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]`
 *
 * 数据来源：`/world/planets/<id>/scene`（窗口 = 机甲周围，默认半径 48，最大 128）
 * 与 `/world/planets/<id>/runtime` 的 construction_tasks。
 * 只考虑完全落在窗口内、且不跨立方体球面缝的矩形。
 * `--spacing` 只影响已选候选之间的最小锚点曼哈顿距离，缺省不过滤；
 * 想互不重叠至少取 `max(w,h)+1`（`max(w,h)` 时锚点曼哈顿距离 3 的 3×3 仍会相交）。
 */
export async function cmdFindSpace(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  if (hasFlag(parsed, 'help')) {
    return 'Usage: find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]';
  }
  const positionals = [...parsed.positionals];
  const width = parseIntegerArg(positionals[0]);
  const height = parseIntegerArg(positionals[1]);
  if (!width || !height || width <= 0 || height <= 0) {
    return fmtError('Usage: find_space <w> <h> [--count N] [--near X Y] [--radius R] [--spacing N] [--planet <id>] [--json]');
  }

  // --near x y：parseArgs 只吃紧邻的一个值，第二个坐标留在 positionals 里。
  let near: { x: number; y: number } | undefined;
  const nearRaw = getStringOption(parsed, 'near');
  if (nearRaw !== undefined) {
    const [rawX, rawY] = nearRaw.includes(',')
      ? nearRaw.split(',')
      : [nearRaw, positionals[2]];
    const x = parseIntegerArg(rawX);
    const y = parseIntegerArg(rawY);
    if (x === undefined || y === undefined) {
      return fmtError('--near 需要两个整数坐标：--near <x> <y> 或 --near <x>,<y>');
    }
    near = { x, y };
  }
  const radius = parseIntegerArg(getStringOption(parsed, 'radius')) ?? DEFAULT_RADIUS;
  if (radius <= 0 || radius > MAX_RADIUS) {
    return fmtError(`--radius 必须在 1..${MAX_RADIUS}`);
  }
  const count = parseIntegerArg(getStringOption(parsed, 'count')) ?? DEFAULT_COUNT;
  if (count <= 0) {
    return fmtError('--count 必须是正整数');
  }
  const spacingRaw = getStringOption(parsed, 'spacing');
  if (parsed.options.spacing !== undefined && spacingRaw === undefined) {
    return fmtError('--spacing 需要 <n>（任意两个候选锚点的最小曼哈顿距离）');
  }
  const spacing = spacingRaw === undefined ? 0 : parseIntegerArg(spacingRaw);
  if (spacing === undefined || !Number.isInteger(spacing) || spacing < 0) {
    return fmtError('--spacing 必须是非负整数');
  }
  const planetArg = getStringOption(parsed, 'planet');
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}`);
  }

  try {
    const summary = await api.fetchSummary();
    const mecha = selectMyMecha(summary.players?.[api.getAuth().playerId], resolveIssuerId(ctx));
    // --planet 给了就不再取默认星球上下文（锚点只认该星球上的机甲）。
    const context = planetArg === undefined ? await fetchPlanetContext(api, resolveIssuerId(ctx)) : undefined;
    const planetId = planetArg ?? context!.planetId;
    const mechaHere = mecha && mecha.planet_id === planetId ? mecha : undefined;
    const planet = await api.fetchPlanet(planetId);
    // 机甲不在该星球（或没绑机甲）时回退到该星球场景中心；输出里注明。
    const fallbackAnchor = {
      x: Math.floor(planet.map_width / 2),
      y: Math.floor(planet.map_height / 2),
    };
    const anchor = near ?? mechaHere?.position ?? fallbackAnchor;

    const search = radiusWindow(anchor, radius, planet.map_width, planet.map_height);
    const fetch = expandRect(search, FETCH_MARGIN, planet.map_width, planet.map_height);
    const [scene, runtime, catalog] = await Promise.all([
      api.fetchPlanetScene(planetId, { x: fetch.x, y: fetch.y, width: fetch.width, height: fetch.height }),
      api.fetchPlanetRuntime(planetId),
      api.fetchCatalog(),
    ]);
    if (!scene.discovered) {
      return fmtError(`星球 ${planetId} 尚未发现`);
    }
    const footprints = new Map<string, Footprint>(
      (catalog.buildings ?? []).map((entry) => [entry.id, entry.footprint]),
    );
    const blocked = buildBlockedGrid({
      bounds: scene.bounds,
      terrain: scene.terrain,
      buildings: Object.values(scene.buildings ?? {}),
      units: Object.values(scene.units ?? {}),
      tasks: runtime.construction_tasks ?? [],
      footprints,
    });
    // 「距机甲」列：机甲在本星球才有意义；机甲不在该星球或没绑机甲时退回锚点距离。
    const mechaAnchor = mechaHere?.position ?? anchor;
    const found = findSpaceRects({
      bounds: scene.bounds,
      search,
      blocked,
      size: { width, height },
      anchor,
      count,
      faceSize: scene.surface?.face_size,
      spacing,
      mechaAnchor,
    });

    if (hasFlag(parsed, 'json')) {
      return JSON.stringify({
        planet_id: planetId,
        anchor,
        window: search,
        size: { width, height },
        spacing,
        skipped_seam: found.skippedSeam,
        results: found.results,
      }, null, 2);
    }

    const lines: string[] = [];
    if (context && planetArg === undefined) {
      lines.push(fmtPlanetContext(context));
    }
    if (near === undefined && !mechaHere) {
      const why = mecha
        ? `我的机甲 ${mecha.unit_id} 在 ${mecha.planet_id}，不在 ${planetId}`
        : `未绑定机甲（${NO_MECHA_HINT}）`;
      lines.push(chalk.dim(`锚点回退到 ${planetId} 场景中心 (${anchor.x},${anchor.y})：${why}；要用机甲附近就用 --near <x> <y>`));
    }
    lines.push(chalk.dim(
      `搜索 ${width}x${height}：窗口 ${fmtRect(search)}  锚点 (${anchor.x},${anchor.y})  `
      + `地形=${scene.terrain ? 'buildable' : 'unknown'}  建筑=${Object.keys(scene.buildings ?? {}).length} `
      + `单位=${Object.keys(scene.units ?? {}).length}  施工任务=${runtime.construction_tasks?.length ?? 0}`,
    ));
    if (found.results.length === 0) {
      lines.push(`${chalk.red('✗ ')}没找到 ${width}x${height} 的空地（候选 ${found.candidates} 个，窗口 ${fmtRect(search)}）`);
    } else {
      for (const spot of found.results) {
        lines.push(
          `空地 ${width}x${height} @ (${spot.x},${spot.y})  距锚点 ${spot.distance}  距机甲 ${spot.mechaDistance}  地形 ${spot.terrain}`,
        );
      }
      if (spacing <= 0 && hasOverlap(found.results, { width, height })) {
        lines.push(chalk.dim(
          `（候选互相重叠；要分散候选用 --spacing <n>，互不重叠至少 ${Math.max(width, height) + 1}，`
          + '任意两个候选的锚点曼哈顿距离 ≥ n）',
        ));
      }
    }
    if (found.skippedSeam > 0) {
      lines.push(chalk.dim(`（跳过 ${found.skippedSeam} 个跨球面缝的候选矩形）`));
    }
    lines.push(chalk.dim('占地内没有建筑（按实际占地）、地面单位和未落成施工任务；服务端只下发自己的施工任务'));
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}
