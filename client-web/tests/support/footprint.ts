/**
 * 细分网格（1 格 = 3×3 cell）后，服务端的 `position` 只是**占地原点**，
 * 建筑实际占用 `runtime.params.footprint` 的 W×H 个 cell（1×1/2×2/3×3/5×5）。
 *
 * 用例里「这块地空不空」的判定必须按整块占地来算：只标原点会让 3×3 兵营的
 * 落点与旁边的 5×5 基地重叠，服务端下一 tick 静默拒收（受理回执是 202，
 * 任务从未出现），表现为「命令受理了但没落地」的假回归。
 */

export interface SceneBuildingLike {
  id?: string;
  type?: string;
  owner_id?: string;
  position: { x: number; y: number };
  runtime?: { params?: { footprint?: { width?: number; height?: number } } };
}

export interface SceneLike {
  buildings?: Record<string, SceneBuildingLike>;
  units?: Record<string, { position: { x: number; y: number } }>;
  resources?: Array<{ position: { x: number; y: number } }>;
  surface?: { face_size?: number };
  map_width?: number;
}

/**
 * 细分网格倍率：旧 1 tile = 新 3×3 cell。
 *
 * 用例里凡是「旧格数」量纲的常量（机甲作业半径 6 tile、建造半径 5 tile 之类）
 * 都必须 ×3 才是 cell 量纲的同一物理距离；服务端 config-war.yaml 的
 * `executor.operate_range` 就是 18（cell），旧代码里写 6。
 */
export const LEGACY_TILE_CELLS = 3;

/** 旧格数 → cell 数（调用方应优先直接写 cell 常量并注明来源）。 */
export function legacyTiles(tiles: number): number {
  return tiles * LEGACY_TILE_CELLS;
}

export interface CatalogLike {
  buildings?: Array<{ id?: string; footprint?: { width?: number; height?: number } }>;
}

/**
 * 待建建筑在**当前目录**里的占地（cell）。
 *
 * 细分网格后占地按 cell 记且与旧 tile 不等价：风力涡轮机是 2×2 cell（旧 1×1 tile）、
 * 兵营/制造台 3×3、物流站 5×5。挑落点时写死 1×1 会让 2×2 的建筑与旁边建筑重叠，
 * 前端本地预检直接拦下（「该格已有你的建筑」），命令根本发不出去。
 */
export function catalogFootprint(
  catalog: CatalogLike | undefined,
  buildingType: string,
): { width: number; height: number } {
  const entry = (catalog?.buildings ?? []).find((candidate) => candidate.id === buildingType);
  return {
    width: Math.max(1, entry?.footprint?.width ?? 1),
    height: Math.max(1, entry?.footprint?.height ?? 1),
  };
}

/** 从服务端目录取全部建筑占地（id → W×H cell）。 */
export async function fetchCatalogFootprints(
  backend: string,
  authorization: string,
): Promise<Map<string, { width: number; height: number }>> {
  const response = await fetch(`${backend}/catalog`, { headers: { authorization } });
  if (!response.ok) {
    return new Map();
  }
  const catalog = (await response.json()) as CatalogLike;
  const map = new Map<string, { width: number; height: number }>();
  for (const entry of catalog.buildings ?? []) {
    if (!entry.id) continue;
    map.set(entry.id, {
      width: Math.max(1, entry.footprint?.width ?? 1),
      height: Math.max(1, entry.footprint?.height ?? 1),
    });
  }
  return map;
}

/** 占地尺寸：优先取运行时 footprint，缺失时按 1×1（与旧数据一致）。 */
export function buildingFootprint(building: SceneBuildingLike): { width: number; height: number } {
  const footprint = building.runtime?.params?.footprint;
  return {
    width: Math.max(1, footprint?.width ?? 1),
    height: Math.max(1, footprint?.height ?? 1),
  };
}

/** 面宽（环面回绕用）：优先 surface.face_size，其次 map_width / 3。 */
export function sceneFaceSize(scene: SceneLike): number {
  return scene.surface?.face_size ?? Math.max(1, Math.round((scene.map_width ?? 3) / 3));
}

/** 建筑占用的全部 cell（环面回绕，跨面接缝时坐标会绕回另一侧）。 */
export function buildingFootprintCells(
  building: SceneBuildingLike,
  faceSize: number,
): Array<{ x: number; y: number }> {
  const { width, height } = buildingFootprint(building);
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      const x = (((building.position.x + dx) % faceSize) + faceSize) % faceSize;
      const y = (((building.position.y + dy) % faceSize) + faceSize) % faceSize;
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * 场景里所有被占用的 cell（建筑按整块占地，单位/资源按 1 cell）。
 * 返回 `x:y` 字符串集合，与既有用例的 `occupied` 口径一致。
 * 用途：**建造落点**判空（单位/资源格不能放建筑）。
 */
export function occupiedCells(scene: SceneLike): Set<string> {
  const occupied = new Set<string>();
  for (const cell of buildingCells(scene)) {
    occupied.add(cell);
  }
  for (const unit of Object.values(scene.units ?? {})) {
    occupied.add(`${unit.position.x}:${unit.position.y}`);
  }
  for (const resource of scene.resources ?? []) {
    occupied.add(`${resource.position.x}:${resource.position.y}`);
  }
  return occupied;
}

/**
 * 只含建筑的占用 cell（按整块 footprint）。
 *
 * 用于**通行阻挡**判定（服务端 buildingEnclosure 的 unitTileBlockedBeforeBuild：
 * 只有建筑/地形/界外/施工预留阻挡通行，单位自己不是障碍物）。
 * 用 occupiedCells 代替会让「四邻全堵死」对每个格都成立，从而筛掉所有候选落点。
 */
export function buildingCells(scene: SceneLike): Set<string> {
  const faceSize = sceneFaceSize(scene);
  const cells = new Set<string>();
  for (const building of Object.values(scene.buildings ?? {})) {
    for (const cell of buildingFootprintCells(building, faceSize)) {
      cells.add(`${cell.x}:${cell.y}`);
    }
  }
  return cells;
}

/**
 * 某个占地尺寸的建筑放在该格是否不与场景里任何实体相交（用于挑选建造落点）。
 * 只做几何相交判定，地形/可见性/围死单位等规则由调用方各自补齐。
 */
export function footprintFits(
  scene: SceneLike,
  origin: { x: number; y: number },
  size: { width: number; height: number },
): boolean {
  const faceSize = sceneFaceSize(scene);
  const occupied = occupiedCells(scene);
  for (let dy = 0; dy < Math.max(1, size.height); dy += 1) {
    for (let dx = 0; dx < Math.max(1, size.width); dx += 1) {
      const x = (((origin.x + dx) % faceSize) + faceSize) % faceSize;
      const y = (((origin.y + dy) % faceSize) + faceSize) % faceSize;
      if (occupied.has(`${x}:${y}`)) {
        return false;
      }
    }
  }
  return true;
}
